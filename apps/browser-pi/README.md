# browser-pi (Prototyp)

Erster Prototyp der in [../../CLAUDE.md](../../CLAUDE.md) beschriebenen
Progressive Web App: ein **pi-Agent, der vollständig im Browser läuft**, in einem
**simulierten Terminal** arbeitet und dessen gesamter Dateizugriff auf ein
**virtuelles Dokumenten-Dateisystem (VFS)** beschränkt ist.

## Was der Prototyp zeigt (die drei Kern-Prinzipien)

1. **pi-Agent im Browser + simuliertes Terminal**
   - Es läuft der **echte `@earendil-works/pi-agent-core`** im Browser (kein Fork):
     [src/agent/piSession.ts](src/agent/piSession.ts) instanziiert die `Agent`-Klasse,
     registriert die Tools und mappt deren native `AgentEvent`s auf die UI-Events.
   - Der LLM-Aufruf geht **direkt vom Browser** an einen **lokalen, OpenAI-kompatiblen
     Endpoint** (Ollama / OpenWebUI) — kommerzielle Provider sind ausgeschlossen. Statt
     pi-ai's Provider-Registry (die Node-only-SDKs zöge) injizieren wir eine eigene,
     browser-sichere `streamFn`: [src/agent/piStream.ts](src/agent/piStream.ts).
   - Das Terminal rendert den **Agenten-Event-Stream**, statt die TUI zu portieren:
     [src/components/Terminal.vue](src/components/Terminal.vue),
     [src/agent/events.ts](src/agent/events.ts).

2. **Eigenes Dokumenten-Dateisystem (IndexedDB als FS)**
   - Pfadbasierter Namensraum `/cases`, `/prompts`, `/textblocks` über IndexedDB:
     [src/vfs/vfs.ts](src/vfs/vfs.ts), [src/vfs/idb.ts](src/vfs/idb.ts).
   - Nutzerdaten bleiben **rein lokal**. Seed/Defaults werden beim ersten Start
     einmalig gespiegelt: [src/vfs/seed.ts](src/vfs/seed.ts).
   - Export/Import als JSON (Backup ohne Cloud) im Einstellungs-Panel.

3. **Sandbox: Shell-Befehle wirken NUR auf VFS-Dokumente**
   - Simulierter Shell-Interpreter mit kuratierter Befehlsmenge (`ls`, `cat`, `grep`,
     `find`, `write`, `mkdir`, `rm`, Pipes `|`, Redirects `>`/`>>`):
     [src/shell/shell.ts](src/shell/shell.ts).
   - **Kein** `child_process`, **kein** Host-Zugriff, **kein** Netzwerk ausser dem
     LLM-Call. Pfade werden gegen `..`/Absolut-Ausbrüche abgesichert
     (`normalizePath` in [src/vfs/vfs.ts](src/vfs/vfs.ts)).
   - Die Tools sind native `pi-AgentTool`s (TypeBox-Schema), delegieren aber an die
     VFS-/Shell-Sandbox: [src/agent/piTools.ts](src/agent/piTools.ts).

## Integration von pi-agent-core (statt eigener Schleife)

Die frühere, selbstgebaute Agenten-Schleife ist durch den **echten Agenten-Kern**
ersetzt. Schlüssel war, den Kern einzubinden, **ohne** die Node-only-Provider von
pi-ai in den Browser-Bundle zu ziehen:

- **Vite-Aliase auf schmale Shims** ([src/shims/](src/shims/)): `@earendil-works/pi-ai`
  und `@earendil-works/pi-agent-core` zeigen auf [src/shims/pi-ai.ts](src/shims/pi-ai.ts)
  bzw. [src/shims/pi-agent-core.ts](src/shims/pi-agent-core.ts). Das pi-ai-Shim
  re-exportiert nur die browser-sicheren Laufzeit-Werte (`EventStream`,
  `createAssistantMessageEventStream`, `Type`) und **stubbt** `streamSimple`
  (wir injizieren ja unsere eigene `streamFn`).
- **Eigene `streamFn`** ([src/agent/piStream.ts](src/agent/piStream.ts)): konvertiert
  den pi-`Context` in eine OpenAI-Chat-Completions-Anfrage an den lokalen Endpoint und
  erfüllt das `AssistantMessageEventStream`-Protokoll. So bleibt der direkte
  Browser→lokales-LLM-Call erhalten.
- **Typen via Ambient-Deklaration** ([src/pi-shims.d.ts](src/pi-shims.d.ts)): der
  App-Typecheck nutzt eine schmale, selbst deklarierte Surface; die pi-Quellen werden
  nicht mit den strengen App-Compiler-Flags geprüft.
- Verifiziert: `npm run build` (Typecheck + Bundle, der echte Kern ist gebündelt) und
  ein Runtime-Smoke des `Agent` mit der injizierten `streamFn` + Tool-Ausführung
  (Tool-Call → Tool läuft → Ergebnis → finale Antwort).

### Bewusste Vereinfachungen (TODO für Produktiv-Einsatz)

- `validateToolArguments` ist im Shim ein permissiver Pass-Through (die echte Variante
  zöge `typebox/compile`/`typebox/value` als Subpath-Imports, die aus dem Monorepo-Source
  heraus nicht sauber bündeln). Die Tools coercen ihre Argumente defensiv. Echte
  Schema-Validierung ist wieder zu aktivieren.
- Die `streamFn` ist nicht-streamend (eine `done`-Antwort statt Token-Deltas). Für
  Token-für-Token-Ausgabe später SSE parsen und `text_delta`-Events emittieren.

## Starten

```bash
cd apps/browser-pi
npm install
npm run dev
```

Dann im Browser öffnen (Standard: http://localhost:5173) und über **⚙ Einstellungen**
den lokalen LLM-Endpoint setzen.

### Lokales LLM (Ollama-Beispiel)

```bash
ollama serve
ollama pull llama3.1
```

CORS muss am Endpoint für die App-Origin erlaubt sein, z.B.:

```bash
OLLAMA_ORIGINS="http://localhost:5173" ollama serve
```

Default-Endpoint in den Einstellungen: `http://localhost:11434/v1`, Modell `llama3.1`.
Es eignen sich Modelle mit **Tool-/Function-Calling** (z.B. `llama3.1`, `qwen2.5`).

## Bewusst noch offen (siehe CLAUDE.md, „Offene Designfragen")

- Detailliertes VFS-Schema (Indizes, Quoten), Seed-Update-/Versionierungs-Mechanik.
- Erweiterter Funktionsumfang des Shell-Interpreters (Globbing, weitere Befehle).
- Streaming-Antworten + echte Schema-Validierung (siehe Abschnitt oben).

> Dieser Prototyp ist eigenständig und **nicht** in die Monorepo-Workspaces eingehängt,
> damit der bestehende `npm run check`/Build der Pakete unberührt bleibt.
