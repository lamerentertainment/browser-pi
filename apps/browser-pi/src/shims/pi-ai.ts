// Browser-Shim für @earendil-works/pi-ai.
//
// Vite aliasiert "@earendil-works/pi-ai" auf diese Datei (für die App UND für
// die Imports im pi-agent-core-Source). Damit gelangt NICHT die volle
// Provider-Registry (Bedrock/OpenAI/Mistral-SDKs, node:http-Proxy) in den
// Browser-Bundle — nur die wenigen browser-sicheren Laufzeit-Werte, die der
// Agenten-Kern tatsächlich braucht. Typen werden beim Transpile ohnehin
// entfernt; für den Typecheck der App liefert src/pi-shims.d.ts die Surface.
//
// Diese Datei ist vom App-Typecheck ausgeschlossen (tsconfig "exclude").

export {
	AssistantMessageEventStream,
	createAssistantMessageEventStream,
	EventStream,
} from "../../../../packages/ai/src/utils/event-stream.ts";
export { Type } from "typebox";

// validateToolArguments validiert die Tool-Call-Argumente gegen das TypeBox-
// Schema. Die echte Implementierung zieht typebox/compile + typebox/value, die
// als Subpath-Imports aus dem Monorepo-Source heraus nicht sauber bündeln. Für
// den Prototyp genügt ein permissiver Pass-Through: Die Tools coercen ihre
// Argumente ohnehin defensiv (str()) und behandeln fehlende Felder.
// TODO: echte Schema-Validierung wieder aktivieren (eigener typebox/value-Pfad).
export function validateToolArguments(_tool: unknown, toolCall: { arguments?: unknown }): unknown {
	return toolCall?.arguments ?? {};
}

// Der Agenten-Kern referenziert streamSimple/completeSimple nur als Default-
// Fallback. Wir injizieren immer eine eigene, browser-sichere streamFn
// (src/agent/piStream.ts), daher dürfen diese Stubs nie aufgerufen werden.
export function streamSimple(): never {
	throw new Error(
		"streamSimple ist im Browser-Build nicht verfügbar — es muss eine eigene streamFn injiziert werden.",
	);
}
export function completeSimple(): never {
	throw new Error("completeSimple ist im Browser-Build nicht verfügbar.");
}
