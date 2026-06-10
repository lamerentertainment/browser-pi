# Deployment — browser-pi

browser-pi ist eine **reine statische SPA/PWA** (Vue 3 + Vite). Es gibt **kein
Backend**: Der Agent läuft komplett im Browser, der einzige Netzwerk-Zugriff im
Betrieb ist der direkte Browser→LLM-Call an deinen lokalen Ollama/OpenWebUI-Endpoint.
Deployen heisst also nur: statische Dateien aus `dist/` zu Firebase Hosting hochladen.

## Wo liegt es?

- **Live-URL:** https://browser-pi-krg.web.app
- **Firebase-Projekt:** `gen-lang-client-0915148106` (Display-Name „skills") — dasselbe
  Projekt wie der KRG-chatresearcher.
- **Hosting-Site:** `browser-pi-krg` — eine **eigene** Site neben der Default-Site,
  auf der chatresearcher läuft. Die beiden stören sich nicht.
- **Hosting-Target:** `browser-pi` (Alias in [.firebaserc](.firebaserc), zeigt auf die
  Site `browser-pi-krg`).

## Voraussetzungen (einmalig)

- Node.js + npm (für den Vite-Build).
- Firebase CLI installiert und eingeloggt:
  ```bash
  firebase --version      # vorhanden?
  firebase login           # falls nicht eingeloggt
  ```
- Abhängigkeiten installiert (einmalig bzw. nach Änderungen an package.json):
  ```bash
  cd apps/browser-pi
  npm install
  ```

## Deployen — der einfache Weg

**Aus dem Ordner `apps/browser-pi/`** (das Skript wechselt selbst in sein
Verzeichnis, du kannst es also auch von woanders mit vollem Pfad aufrufen):

```bash
cd apps/browser-pi
./deploy.sh
```

Das Skript macht zwei Schritte:
1. `npm run build` → Typecheck (`vue-tsc`) + Vite-Build nach `dist/`.
2. `firebase deploy --only hosting:browser-pi` → lädt `dist/` auf die Site hoch.

Danach ist die neue Version unter https://browser-pi-krg.web.app live.

## Deployen — manuell (gleiches Ergebnis)

Falls du es ohne Skript machen willst, **aus `apps/browser-pi/`**:

```bash
cd apps/browser-pi
npm run build
firebase deploy --only hosting:browser-pi --project gen-lang-client-0915148106
```

## Lokal testen vor dem Deploy

```bash
cd apps/browser-pi
npm run dev        # Dev-Server auf http://localhost:5173
# oder den Production-Build prüfen:
npm run build && npm run preview
```

## Betriebshinweis: LLM-Endpoint (CORS & Mixed Content)

Die App ruft das LLM **direkt aus dem Browser** auf. Weil die Seite jetzt unter
**HTTPS** (`https://browser-pi-krg.web.app`) läuft, gilt:

- **`http://localhost:…`** als Endpoint funktioniert (localhost ist von der
  Mixed-Content-Sperre der Browser ausgenommen).
- Ein **`http://`-Endpoint im LAN** (z. B. `http://192.168.x.x:11434`) wird von der
  HTTPS-Seite **blockiert**. Dort brauchst du HTTPS am Endpoint (oder einen
  localhost-Tunnel).
- **CORS:** Dein OpenWebUI/Ollama muss die Origin `https://browser-pi-krg.web.app`
  per CORS erlauben, sonst scheitert der Aufruf.

## Konfigurationsdateien

| Datei | Zweck |
|---|---|
| [firebase.json](firebase.json) | Hosting-Config: `public: dist`, SPA-Rewrite auf `/index.html`, `sw.js` ohne Cache. |
| [.firebaserc](.firebaserc) | Default-Projekt + Mapping Hosting-Target `browser-pi` → Site `browser-pi-krg`. |
| [deploy.sh](deploy.sh) | Build + Deploy in einem Befehl. |

## Eine zweite/andere Site anlegen (falls je nötig)

```bash
firebase hosting:sites:create <neue-site-id> --project gen-lang-client-0915148106
# danach in .firebaserc unter targets ein neues Target auf die Site mappen
```
