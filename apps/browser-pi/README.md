# browser-pi (Prototyp)

Erster Prototyp der in [../../CLAUDE.md](../../CLAUDE.md) beschriebenen
Progressive Web App: ein **pi-Agent, der vollständig im Browser läuft**, in einem
**simulierten Terminal** arbeitet und dessen gesamter Dateizugriff auf ein
**virtuelles Dokumenten-Dateisystem (VFS)** beschränkt ist.

## Was der Prototyp zeigt (die drei Kern-Prinzipien)

1. **pi-Agent im Browser + simuliertes Terminal**
   - Tool-Calling-Agenten-Schleife läuft im Browser, kein Server-Roundtrip:
     [src/agent/agentLoop.ts](src/agent/agentLoop.ts).
   - Der LLM-Aufruf geht **direkt vom Browser** an einen **lokalen, OpenAI-kompatiblen
     Endpoint** (Ollama / OpenWebUI) — kommerzielle Provider sind ausgeschlossen:
     [src/agent/llm.ts](src/agent/llm.ts).
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
   - Tools delegieren an die VFS-/Shell-Schicht (injizierbar):
     [src/agent/tools.ts](src/agent/tools.ts).

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

- Integration von `@earendil-works/pi-agent-core` / `pi-ai` statt der eigenständigen
  Loop (die Schnittstellen sind bewusst kompatibel gehalten).
- Detailliertes VFS-Schema (Indizes, Quoten), Seed-Update-/Versionierungs-Mechanik.
- Erweiterter Funktionsumfang des Shell-Interpreters (Globbing, weitere Befehle).

> Dieser Prototyp ist eigenständig und **nicht** in die Monorepo-Workspaces eingehängt,
> damit der bestehende `npm run check`/Build der Pakete unberührt bleibt.
