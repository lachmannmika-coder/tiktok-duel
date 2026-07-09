# Follower-Duell — Setup

Das Tool besteht aus zwei Teilen, die zusammen funktionieren:

- **Das Dashboard** (`index.html`) — zeigt euch beide im Duell, mit Graph.
- **Die automatische Erfassung** (`scripts/fetch.mjs` + `.github/workflows/daily.yml`) — zieht einmal pro Tag eure TikTok-Zahlen und speichert sie in `data/history.json`.

Lokal kannst du `index.html` jederzeit doppelklicken — dann siehst du das Dashboard mit den Startzahlen. Damit es sich **von selbst aktualisiert (auch bei ausgeschaltetem PC)**, kommt es auf GitHub. Das ist gratis. Hier die Schritte, alles über die Webseite, ohne irgendwas zu installieren.

## Was du selbst machen musst

GitHub-Account und Repo musst du selbst anlegen — ich kann für dich keine Accounts erstellen. Dauert keine zehn Minuten.

### 1. GitHub-Account erstellen
Geh auf [github.com](https://github.com) und registrier dich (gratis). E-Mail bestätigen, fertig.

### 2. Neues Repository anlegen
Oben rechts auf **+** → **New repository**.
- Name: z.B. `follower-duell`
- **Public** auswählen (nötig, damit die Gratis-Webseite funktioniert — drin stehen nur öffentliche Follower-Zahlen, nichts Privates)
- Sonst nichts ankreuzen, **Create repository**.

### 3. Die Dateien hochladen
Im leeren Repo auf **uploading an existing file** (oder **Add file → Upload files**).
Zieh den **gesamten Inhalt** des Ordners `TikTok-Duell` ins Fenster — also `index.html`, den Ordner `data`, den Ordner `scripts` und den Ordner `.github`. Beim Reinziehen von Ordnern bleibt die Struktur erhalten. Dann unten **Commit changes**.

> Wichtig: Der Ordner `.github` muss mit hochgeladen werden, sonst läuft die automatische Erfassung nicht. Falls dein Datei-Explorer ihn versteckt (Punkt am Anfang), Ordner-Inhalt einzeln reinziehen.

### 4. Dem Bot Schreibrechte geben
**Settings** (im Repo) → links **Actions** → **General** → runterscrollen zu **Workflow permissions** → **Read and write permissions** auswählen → **Save**.
Das erlaubt der täglichen Erfassung, den neuen Schnappschuss zu speichern.

### 5. Erfassung einmal testen
Oben im Reiter **Actions**. Falls gefragt: Workflows aktivieren (**I understand my workflows, enable them**). Links **Täglicher TikTok-Schnappschuss** anklicken → rechts **Run workflow** → **Run workflow**. Nach ~1 Minute sollte ein grüner Haken erscheinen und in `data/history.json` ein zweiter Schnappschuss stehen. Ab jetzt läuft das jeden Morgen automatisch.

### 6. Dashboard online schalten
**Settings** → links **Pages** → unter **Source**: **Deploy from a branch** → Branch **main**, Ordner **/ (root)** → **Save**.
Nach ein, zwei Minuten ist dein Dashboard live unter:
`https://DEIN-NAME.github.io/follower-duell/`
Den Link kannst du Tino schicken — ihr seht beide dasselbe, immer aktuell.

## Das Dashboard

Cleanes Vergleichs-Dashboard, Mika (rot) vs. Tino (blau):
- **Head-to-Head**: Follower beider groß nebeneinander, Vorsprungs-Balken, Tageszuwachs, „Führt"-Badge.
- **Statistik-Vergleich**: Gesamt-Uploads, Likes gesamt, Ø Likes/Video, Follower-Zuwachs gesamt, Videos seit Start — der bessere Wert ist markiert.
- **Charts**: Follower-Verlauf (Linie) und Videos pro Tag (Balken).
- Ist ein Profil mal nicht erreichbar, steht dort dezent „Daten vom Vortag".

**Lokal ansehen / testen**
- Doppelklick auf `index.html` zeigt das Dashboard sofort (mit den zuletzt gespeicherten Zahlen).
- Mit Server: `npm run serve` → http://localhost:5173/
- Logik-Tests: `npm test` (13 Unit-Tests gegen Test-Szenarien in `test/fixtures/`).
- Einzelne Szenarien testen: `…/?data=test/fixtures/03_streak.json` an die URL hängen.

**Aufbau**
- `src/logic.js` — reine Berechnung (Zuwächse, Führung, Durchschnitte), DOM-frei, getestet.
- `src/dashboard.js` — Anzeige und Charts. `src/config.js` — Farben und Update-Stunde.

## Wenn sich ein TikTok-Handle ändert

Benennt einer von euch seinen TikTok-Account um, findet die Erfassung ihn nicht mehr und
übernimmt so lange die letzten bekannten Werte (im Dashboard steht dann „Daten vom Vortag").
Zum Beheben: in `data/history.json` oben bei `creators` den `handle` auf den neuen
TikTok-Benutzernamen ändern (der Teil nach dem `@` im Profil) — direkt auf GitHub editierbar.

## Gut zu wissen
- Die Erfassung läuft täglich um ~07:00–08:00 Schweizer Zeit. GitHub kann das mal um ein paar Minuten verschieben, das ist normal.
- Verlauf gibt es erst ab dem Tag, an dem die Erfassung läuft — rückwirkend geht nicht. Drum lohnt sich früh starten.
- Die Datenquelle (tikwm) ist inoffiziell. Sollte sie mal ausfallen, tauschen wir nur eine Stelle in `scripts/fetch.mjs` — das Dashboard und alle gesammelten Daten bleiben.
- Kosten: keine. Zwei öffentliche Accounts einmal am Tag bleiben locker im Gratis-Rahmen.
