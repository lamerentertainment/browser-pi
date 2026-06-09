# CLAUDE.md — Produktvision: browser-pi

Dieses Dokument hält die **Grundideen** der geplanten Weiterentwicklung fest. Es ist
bewusst vision- und architekturorientiert. Verbindliche **Entwicklungsregeln**
(Code-Qualität, Tests, Git, Releases) stehen in [AGENTS.md](AGENTS.md) und gelten
unverändert weiter; dieses Dokument ersetzt sie nicht, sondern ergänzt sie um das
Produktziel.

Upstream-Projekt: pi Agent Harness (https://github.com/lamerentertainment/browser-pi,
Doku: https://pi.dev/docs/latest).

## Was wir bauen

Eine **Browser-Anwendung mit integriertem pi-Agenten**. Der pi-Agent läuft vollständig
im Browser, wird dort aufgerufen und arbeitet in einem **simulierten Terminal**. Es gibt
keinen Server-Roundtrip für die Agenten-Schleife und keinen Backend-Zwang — die App ist
im Kern eine lokale, datenschutzfreundliche **SPA, die als PWA offline-fähig ist**
(Vorbild: `/Users/jonasachermann/repos/iusable_anonymization`, Vue 3 + Vite, lokal-first).

Die zentrale Idee:

> Der Agent erhält eine vollwertige "Shell"-Erfahrung (Terminal + Datei-Tools), aber
> sein gesamter Dateizugriff ist auf ein **virtuelles Dokumenten-Dateisystem im Browser**
> beschränkt. Er sieht und verändert **niemals** das zugrunde liegende Host-Dateisystem.

**Datenschutz ist der bestimmende Constraint:** Es werden sensitive Daten bearbeitet, die
**nicht** an kommerzielle LLM-Provider gehen dürfen. Die App spricht deshalb
**ausschliesslich lokale LLMs** an (kein OpenAI/Anthropic/Gemini).

## Die drei Kern-Prinzipien

### 1. pi-Agent im Browser, mit simuliertem Terminal

- Der Agenten-Kern (`@earendil-works/pi-agent-core`) ist bereits **browser-sicher**.
  Beleg: [scripts/browser-smoke-entry.ts](scripts/browser-smoke-entry.ts) bündelt
  ausgewählte Exports mit `platform: "browser"`, und der CI-Gate
  `npm run check:browser-smoke` ([scripts/check-browser-smoke.mjs](scripts/check-browser-smoke.mjs))
  bricht, sobald ein Node-only-Import in browser-fähige Exports leckt.
- Die LLM-Schicht (`@earendil-works/pi-ai`) läuft per `fetch` im Browser, wird hier aber
  **nur gegen lokale LLMs** betrieben: ein **Ollama-API-Endpoint, vermittelt durch
  OpenWebUI** (OpenAI-kompatible bzw. Ollama-API). Kommerzielle Provider sind bewusst
  ausgeschlossen.
- **Direkter Browser→LLM-Call:** Der LLM-Aufruf geht **direkt vom Browser** an den
  lokalen Endpoint und **niemals** über den Server, der die PWA ausliefert. Folgen:
  - Der Endpoint (OpenWebUI/Ollama) ist **nutzerkonfigurierbar** und liegt auf einer
    anderen Origin → **CORS** muss dort erlaubt werden; ggf. Auth-Token, das lokal bleibt.
  - Der ausliefernde Server sieht keine Prompts/Daten; er liefert nur statische Assets.
- Das "Terminal" ist eine UI-Komponente: sie rendert die Agenten-Events (Tool-Aufrufe,
  Ausgaben) terminal-artig. `@earendil-works/pi-tui` ist für ein OS-Terminal gedacht;
  für die Browser-App wird eine **eigene Web-Render-Schicht** gebaut, die dieselben
  Agenten-Events konsumiert. Nicht die TUI ins Web zwingen — den Event-Stream rendern.

### 2. Eigenes Dokumenten-Dateisystem im Browser (IndexedDB als FS)

- Statt eines OS-Dateisystems nutzt die App **IndexedDB** als Persistenz-Träger des
  Dateisystems. Der App-Shell-Cache (Service Worker) trägt nur die statischen Assets
  für den Offline-Start; die **Daten** liegen in IndexedDB.
- **Lokal-only-Invariante:** **Prompts, Textbausteine und Dokumente werden
  ausschliesslich lokal in IndexedDB gespeichert.** Nutzergeschaffene Inhalte verlassen
  den Browser nie (kein Upload, kein Server-Sync).
- **Zentrale Auslieferung nur als read-only Basis:** Eine kuratierte, **nicht-sensitive**
  Grundausstattung an Prompts und Textbausteinen darf mit der App ausgeliefert werden
  (Seed/Defaults). Beim ersten Start wird sie in die lokale IndexedDB gespiegelt; ab dann
  bearbeitet/ergänzt der Nutzer nur seine lokale Kopie. Dokumente und Fälle sind **nie**
  zentral, immer rein lokal.
- Über diesem Storage liegt eine **VFS-Abstraktion** (Virtual File System), die einen
  pfadbasierten Namensraum bereitstellt (z. B. `/cases/<id>/...`, `/prompts/...`,
  `/textblocks/...`). Auf diesen Namensraum operieren alle Agenten-Tools.
- Export/Import als JSON (Backup, Geräte-Transfer ohne Cloud) ist Teil des Modells —
  analog zum Case-Export in iusable_anonymization.

### 3. Sandbox: Agenten-Shell-Befehle wirken NUR auf Browser-Dokumente

- Die Datei- und Shell-Tools liegen in
  [packages/coding-agent/src/core/tools/](packages/coding-agent/src/core/tools/):
  `bash.ts`, `read.ts`, `write.ts`, `edit.ts`, `grep.ts`, `find.ts`, `ls.ts`.
  Heute binden sie Node-`fs`/`fs/promises` und `child_process` direkt ein.
- **Nahtstelle:** [bash.ts](packages/coding-agent/src/core/tools/bash.ts) definiert
  bereits ein `BashOperations`-Interface ("Pluggable operations ... Override these to
  delegate command execution"). Das ist das Muster: Tool-Logik von der konkreten
  Ausführungs-/FS-Schicht entkoppeln und im Browser gegen die VFS-Sandbox tauschen.
- **Ziel-Architektur:** Jedes FS-berührende Tool bekommt eine injizierbare
  Operations-Schicht (FileSystem-Provider + Shell-Provider). Im Browser-Build
  implementieren diese Provider:
  - **FileSystem-Provider** → VFS auf OPFS/IndexedDB (siehe Prinzip 2).
  - **Shell-Provider** → ein **simulierter Shell-Interpreter**, der eine kuratierte,
    sichere Befehlsmenge versteht (`ls`, `cat`, `grep`, `find`, Pipes, Redirects auf das
    VFS). **Kein** `child_process`, **kein** Host-Zugriff, **kein** Netzwerk ausser den
    explizit erlaubten LLM-Aufrufen.
- **Sicherheits-Invariante (nicht verhandelbar):** Im Browser-Build darf kein Pfad aus
  dem VFS-Namensraum herausführen, kein Node-`fs`/`child_process` in den Browser-Bundle
  gelangen, und kein Tool darf beliebige Host-Kommandos ausführen. Der
  `check:browser-smoke`-Gate ist die erste Verteidigungslinie; FS-Provider müssen Pfade
  zusätzlich gegen `..`/Absolutpfade ausserhalb des Namensraums absichern.

## Fachliche Dokument-Domänen (Vorbild iusable_anonymization)

Drei Bibliotheken/Domänen leben im VFS und sind die fachliche Substanz der App:

1. **Prompt Library** — gespeicherte, wiederverwendbare Prompt-Vorlagen. Knüpft an die
   bestehenden pi-Prompt-Templates an (`packages/agent/src/harness/prompt-templates.ts`,
   `packages/coding-agent/src/core/prompt-templates.ts`).
2. **Case Management** — strukturierte Projekte/Fälle. Pro Fall: zusammengehörige
   Dokumente, Versionen, konsistente Entitäten/Platzhalter über Dokumente hinweg,
   Export/Import als JSON.
3. **Text Block Library** — häufig genutzte Textbausteine (z. B. Rechtsbelehrungen,
   Gesetzesartikel, Disclaimer), die dynamisch in Prompts injiziert werden.

Der Agent arbeitet auf genau diesen Dokumenten mit seinen "Shell"-Tools: Fälle
durchsuchen (`grep`/`find`), Dokumente lesen/schreiben (`read`/`write`/`edit`),
Textblöcke einsetzen, Prompts ausführen.

## Repo-Landkarte (relevant für die Weiterentwicklung)

| Paket | Rolle | Browser-Relevanz |
|---|---|---|
| `@earendil-works/pi-ai` ([packages/ai](packages/ai)) | Multi-Provider-LLM-API | Browser-fähig (`fetch`); hier **nur lokaler Ollama/OpenWebUI-Endpoint** |
| `@earendil-works/pi-agent-core` ([packages/agent](packages/agent)) | Agenten-Runtime, Tool-Calling, State | **Browser-sicher** — Fundament der Web-App |
| `@earendil-works/pi-coding-agent` ([packages/coding-agent](packages/coding-agent)) | CLI-Agent, Tools, Sessions | Quelle der FS/Shell-Tools; hier sitzen die Sandbox-Nahtstellen |
| `@earendil-works/pi-tui` ([packages/tui](packages/tui)) | Terminal-UI (OS) | **Nicht** ins Web zwingen — Web-Renderer auf Event-Stream bauen |

## Leitplanken für die Umsetzung

- **Agenten-Kern nicht forken.** Auf `pi-agent-core` aufsetzen und über
  Provider-/Operations-Schnittstellen erweitern. Upstream-Mergebarkeit erhalten.
- **Sandbox by construction**, nicht per Konvention: FS/Shell-Zugriff geht ausschliesslich
  über injizierte Provider; der Browser-Bundle enthält keine Node-Builtins.
- **Lokal-only & datenschutzfreundlich:** Prompts, Textbausteine und Dokumente bleiben
  ausschliesslich lokal (IndexedDB). Der einzige Netzwerk-Zugriff im Betrieb ist der
  direkte LLM-Call an den lokalen Ollama/OpenWebUI-Endpoint. Export/Import statt
  Cloud-Zwang.
- **Den Event-Stream rendern, nicht die TUI portieren.**
- **Entwicklungsregeln:** siehe [AGENTS.md](AGENTS.md) (Code-Qualität, erasable TS,
  `npm run check`, Tests via `./test.sh`, Git-/Commit-Regeln). Diese gelten weiterhin.

## Offene Designfragen (bewusst noch nicht entschieden)

- IndexedDB-Schema/VFS-Layout im Detail (Stores, Indizes, Quoten,
  `navigator.storage.persist()` für Persistenz-Garantie gegen Cache-Eviction).
- Seed-/Update-Mechanik der zentral ausgelieferten Prompt-/Textbaustein-Basis
  (Versionierung, Konfliktauflösung gegen lokal bearbeitete Kopien).
- Genauer Funktionsumfang des simulierten Shell-Interpreters (welche Befehle, Pipes,
  Globbing).
- Form der Provider-/Operations-Abstraktion in `coding-agent` (gemeinsames
  FileSystem-Interface über alle Tools vs. pro Tool wie das bestehende `BashOperations`).
- Bundling-Strategie für den Browser-Build (eigenes Vite-Paket vs. Erweiterung des
  Monorepos).
