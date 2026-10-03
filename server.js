const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL fehlt.');
if (isProd && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET fehlt.');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id BIGSERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('Admin','Gerätewart','Mitglied')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS items(
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      cat TEXT NOT NULL,
      shelf TEXT NOT NULL,
      slot TEXT UNIQUE NOT NULL,
      qty INTEGER NOT NULL DEFAULT 0 CHECK(qty >= 0),
      min INTEGER NOT NULL DEFAULT 0 CHECK(min >= 0),
      note TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS history(
      id BIGSERIAL PRIMARY KEY,
      time TEXT NOT NULL,
      type TEXT NOT NULL,
      item TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      person TEXT NOT NULL,
      note TEXT DEFAULT ''
    );
  `);
  const { rows } = await pool.query('SELECT id FROM users LIMIT 1');
  if (!rows.length) {
    const username = (process.env.INITIAL_ADMIN_USER || 'admin').trim().toLowerCase();
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    if (!password || password.length < 12) {
      throw new Error('Beim ersten Start muss INITIAL_ADMIN_PASSWORD mit mindestens 12 Zeichen gesetzt sein.');
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.query('INSERT INTO users(username,display_name,password_hash,role) VALUES($1,$2,$3,$4)', [username, 'Administrator', hash, 'Admin']);
    console.log(`Erster Admin wurde angelegt: ${username}`);
  }
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'nur-lokal-aendern',
  resave: false,
  saveUninitialized: false,
  name: 'ffcarlsfeld.sid',
  cookie: { httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 }
}));

const userById = async id => (await pool.query('SELECT id,username,display_name AS name,role,active FROM users WHERE id=$1',[id])).rows[0];
async function auth(req,res,next){try{if(!req.session.uid)return res.status(401).json({error:'Nicht angemeldet'});const u=await userById(req.session.uid);if(!u||!u.active)return res.status(401).json({error:'Sitzung ungültig'});req.user=u;next()}catch(e){next(e)}}
function roles(...r){return (req,res,next)=>r.includes(req.user.role)?next():res.status(403).json({error:'Keine Berechtigung'})}
const nowDe=()=>new Date().toLocaleString('de-DE',{timeZone:'Europe/Berlin'});

app.get('/api/health', (req,res)=>res.json({ok:true}));
app.post('/api/login',async(req,res,next)=>{try{let {username,password}=req.body||{};username=String(username||'').trim().toLowerCase();const {rows}=await pool.query('SELECT * FROM users WHERE username=$1 AND active=TRUE',[username]);const u=rows[0];if(!u||!await bcrypt.compare(String(password||''),u.password_hash))return res.status(401).json({error:'Benutzername oder Passwort falsch'});req.session.uid=u.id;res.json({user:await userById(u.id)})}catch(e){next(e)}});
app.post('/api/logout',auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',async(req,res,next)=>{try{if(!req.session.uid)return res.status(401).json({error:'Nicht angemeldet'});const u=await userById(req.session.uid);u?res.json({user:u}):res.status(401).json({error:'Nicht angemeldet'})}catch(e){next(e)}});
app.get('/api/data',auth,async(req,res,next)=>{try{const [a,b]=await Promise.all([pool.query('SELECT * FROM items ORDER BY shelf,slot'),pool.query('SELECT * FROM history ORDER BY id')]);res.json({items:a.rows,history:b.rows})}catch(e){next(e)}});
app.post('/api/items',auth,roles('Admin','Gerätewart'),async(req,res)=>{const x=req.body||{};try{const r=await pool.query('INSERT INTO items(name,cat,shelf,slot,qty,min,note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[x.name,x.cat,x.shelf,x.slot,Math.max(0,+x.qty||0),Math.max(0,+x.min||0),x.note||'']);await pool.query('INSERT INTO history(time,type,item,amount,person,note) VALUES($1,$2,$3,$4,$5,$6)',[nowDe(),'Angelegt',x.name,0,req.user.name,`${x.shelf}/${x.slot}`]);res.json({id:r.rows[0].id})}catch(e){res.status(400).json({error:'Fach bereits belegt oder Eingabe ungültig'})}});
app.put('/api/items/:id',auth,roles('Admin','Gerätewart'),async(req,res)=>{const x=req.body||{};try{const old=(await pool.query('SELECT * FROM items WHERE id=$1',[req.params.id])).rows[0];if(!old)return res.status(404).json({error:'Nicht gefunden'});await pool.query('UPDATE items SET name=$1,cat=$2,shelf=$3,slot=$4,qty=$5,min=$6,note=$7 WHERE id=$8',[x.name,x.cat,x.shelf,x.slot,Math.max(0,+x.qty||0),Math.max(0,+x.min||0),x.note||'',req.params.id]);await pool.query('INSERT INTO history(time,type,item,amount,person,note) VALUES($1,$2,$3,$4,$5,$6)',[nowDe(),'Bearbeitet',x.name,0,req.user.name,`${old.shelf}/${old.slot} → ${x.shelf}/${x.slot}`]);res.json({ok:true})}catch(e){res.status(400).json({error:'Fach bereits belegt oder Eingabe ungültig'})}});
app.delete('/api/items/:id',auth,roles('Admin','Gerätewart'),async(req,res,next)=>{try{const x=(await pool.query('SELECT * FROM items WHERE id=$1',[req.params.id])).rows[0];if(x){await pool.query('DELETE FROM items WHERE id=$1',[req.params.id]);await pool.query('INSERT INTO history(time,type,item,amount,person,note) VALUES($1,$2,$3,$4,$5,$6)',[nowDe(),'Gelöscht',x.name,0,req.user.name,`${x.shelf}/${x.slot}`])}res.json({ok:true})}catch(e){next(e)}});
app.post('/api/movement',auth,async(req,res)=>{const {itemId,type,person,note}=req.body||{};let amount=Math.max(1,+req.body.amount||1);if(!['Entnahme','Rückgabe'].includes(type))return res.status(400).json({error:'Ungültige Buchung'});const client=await pool.connect();try{await client.query('BEGIN');const x=(await client.query('SELECT * FROM items WHERE id=$1 FOR UPDATE',[itemId])).rows[0];if(!x){await client.query('ROLLBACK');return res.status(404).json({error:'Material nicht gefunden'})}if(type==='Entnahme'&&amount>x.qty){await client.query('ROLLBACK');return res.status(400).json({error:'Nicht genügend Bestand vorhanden'})}const q=x.qty+(type==='Rückgabe'?amount:-amount);await client.query('UPDATE items SET qty=$1 WHERE id=$2',[q,itemId]);await client.query('INSERT INTO history(time,type,item,amount,person,note) VALUES($1,$2,$3,$4,$5,$6)',[nowDe(),type,x.name,amount,String(person||req.user.name),String(note||'')]);await client.query('COMMIT');res.json({ok:true})}catch(e){await client.query('ROLLBACK');res.status(500).json({error:'Buchung fehlgeschlagen'})}finally{client.release()}});
app.get('/api/users',auth,roles('Admin'),async(req,res,next)=>{try{res.json({users:(await pool.query('SELECT id,username,display_name AS name,role,active,created_at FROM users ORDER BY id')).rows})}catch(e){next(e)}});
app.post('/api/users',auth,roles('Admin'),async(req,res)=>{let {username,name,password,role}=req.body||{};username=String(username||'').trim().toLowerCase();if(!/^[a-z0-9._-]{3,32}$/.test(username)||String(password||'').length<8||!['Admin','Gerätewart','Mitglied'].includes(role))return res.status(400).json({error:'Eingaben prüfen (Passwort mindestens 8 Zeichen)'});try{await pool.query('INSERT INTO users(username,display_name,password_hash,role) VALUES($1,$2,$3,$4)',[username,String(name||username).trim(),await bcrypt.hash(password,12),role]);res.json({ok:true})}catch(e){res.status(400).json({error:'Benutzername existiert bereits'})}});
app.put('/api/users/:id',auth,roles('Admin'),async(req,res)=>{let {name,role,active,password}=req.body||{};if(!['Admin','Gerätewart','Mitglied'].includes(role))return res.status(400).json({error:'Ungültige Rolle'});await pool.query('UPDATE users SET display_name=$1,role=$2,active=$3 WHERE id=$4',[name,role,!!active,req.params.id]);if(password){if(password.length<8)return res.status(400).json({error:'Passwort mindestens 8 Zeichen'});await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await bcrypt.hash(password,12),req.params.id])}res.json({ok:true})});

app.use(express.static(path.join(__dirname,'public')));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Interner Serverfehler'})});

initDb().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`FF Carlsfeld Lagerverwaltung läuft auf Port ${PORT}`))).catch(err=>{console.error(err);process.exit(1)});
