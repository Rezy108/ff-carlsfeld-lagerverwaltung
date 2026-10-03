Lagerverwaltung Freiwillige Feuerwehr Carlsfeld – V4 Online
============================================================

V4 verwendet PostgreSQL statt SQLite und speichert auch Sessions serverseitig.
Sie ist für Render vorbereitet.

ONLINE AUF RENDER (empfohlen)
1. ZIP entpacken.
2. Den Inhalt in ein GitHub-Repository hochladen (keine .env-Datei hochladen).
3. Bei Render anmelden und "New > Blueprint" wählen.
4. Das GitHub-Repository verbinden. Render erkennt render.yaml.
5. Beim Anlegen wird INITIAL_ADMIN_PASSWORD abgefragt. Verwende ein neues, langes Passwort (mindestens 12 Zeichen).
6. Blueprint deployen. Webservice und PostgreSQL-Datenbank werden erstellt.
7. Nach erfolgreichem Deploy die angezeigte *.onrender.com-Adresse öffnen.
8. Mit Benutzer "admin" und deinem selbst gesetzten INITIAL_ADMIN_PASSWORD anmelden.
9. In der Benutzerverwaltung weitere Konten anlegen.

WICHTIG
- INITIAL_ADMIN_PASSWORD wird nur verwendet, wenn die Benutzer-Tabelle noch leer ist.
- Das Passwort steht NICHT im Projektcode.
- SESSION_SECRET wird von Render automatisch erzeugt.
- DATABASE_URL wird automatisch mit der Render-PostgreSQL-Datenbank verbunden.
- Für produktiven Einsatz regelmäßig Backups einplanen und starke, einzigartige Passwörter verwenden.
- Prüfe vor echtem Feuerwehrbetrieb intern, welche personenbezogenen Daten im Buchungsverlauf gespeichert werden dürfen/sollen.

LOKAL TESTEN
Du brauchst lokal eine PostgreSQL-Datenbank. Kopiere .env.example zu .env und setze die Werte.
Hinweis: Node liest .env nicht automatisch; setze die Variablen in deiner Shell oder nutze dein übliches Env-Tool.
Dann: npm install && npm start
