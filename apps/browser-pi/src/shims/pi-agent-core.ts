// Browser-Shim für @earendil-works/pi-agent-core.
//
// Re-exportiert NUR den schmalen Teil des Agenten-Kerns, den die App nutzt:
// die Agent-Klasse und die Loop-Funktionen aus agent.ts. Damit umgehen wir den
// Paket-Index (der u.a. die node-only JSONL-Session-Repos zieht). Der
// erreichbare Graph beschränkt sich auf agent.ts + agent-loop.ts + types.ts,
// und deren pi-ai-Imports laufen über das pi-ai-Shim.
//
// Diese Datei ist vom App-Typecheck ausgeschlossen (tsconfig "exclude");
// die Typen liefert src/pi-shims.d.ts.

export { Agent } from "../../../../packages/agent/src/agent.ts";
