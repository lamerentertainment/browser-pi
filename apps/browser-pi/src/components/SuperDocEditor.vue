<script setup lang="ts">
// DOCX-Editor auf Basis von SuperDoc (AGPL-3.0). Läuft vollständig im Browser;
// kein Byte des Dokuments verlässt den Client (CLAUDE.md, Lokal-only-Invariante).
// SuperDoc montiert eine eigene Vue-Instanz in containerRef — sie ist von der
// browser-pi-App-Instanz isoliert.
import { onMounted, onUnmounted, ref } from "vue";
import {
	SuperDoc,
	type DocumentApi,
	type Editor,
	type ContextMenuContext,
} from "@harbour-enterprises/superdoc";
import "@harbour-enterprises/superdoc/style.css";
import type { CiteAnchor } from "../agent/docCite.ts";

const props = defineProps<{ blob: Blob }>();
// „cite" trägt die markierte Stelle nach oben (DocumentPanel → App), wo sie als
// Anker in die Chat-Eingabe wandert — so weiss der Agent, WO im Dokument er
// arbeiten soll (die Word-Tools adressieren rein über wörtlichen Ankertext).
const emit = defineEmits<{ cite: [anchor: CiteAnchor] }>();

const flat = (s: string) => s.trim().replace(/\s+/g, " ");

/**
 * Ermittelt den Agenten-Anker aus dem Rechtsklick-Kontext:
 *  - Auswahl oder nicht-leerer Absatz → direkt am wörtlichen Text ankerbar.
 *  - Leere Zeile (kein eigener Text) → relativ zum nächsten nicht-leeren
 *    Nachbar-Absatz beschrieben (danach bevorzugt, sonst davor), was sich auf
 *    word_insert{nach} abbildet.
 */
function resolveAnchor(editor: Editor, ctx: ContextMenuContext): CiteAnchor | null {
	const selected = ctx.selectedText?.trim();
	if (selected) return { kind: "text", text: flat(selected) };

	let doc: Editor["state"]["doc"];
	try {
		doc = editor.state.doc;
		const para = flat(doc.resolve(ctx.selectionStart).parent.textContent);
		if (para) return { kind: "text", text: para };
	} catch {
		return null;
	}

	// Leerzeile: alle Absätze (Textblöcke) mit ihrer Position einsammeln und den
	// nächsten nicht-leeren Nachbarn relativ zur Cursor-Position bestimmen.
	const blocks: { pos: number; text: string }[] = [];
	// Struktur-Annotation statt prosemirror-model-Import (nur transitiv vorhanden).
	doc.descendants((node: { isTextblock: boolean; textContent: string }, pos: number) => {
		if (node.isTextblock) {
			blocks.push({ pos, text: flat(node.textContent) });
			return false; // nicht in den Textblock absteigen
		}
		return true;
	});
	const here = ctx.selectionStart;
	const before = [...blocks].reverse().find((b) => b.pos < here && b.text);
	if (before) return { kind: "after", text: before.text };
	const after = blocks.find((b) => b.pos > here && b.text);
	if (after) return { kind: "before", text: after.text };
	return { kind: "empty" };
}

// Eindeutige ID für die Toolbar (SuperDoc akzeptiert nur CSS-Selektor-String,
// kein HTMLElement). containerRef erhält das Element direkt (Config.selector
// akzeptiert string | HTMLElement).
const toolbarId = `sdtb-${Math.random().toString(36).slice(2, 9)}`;
const containerRef = ref<HTMLElement>();

let instance: SuperDoc | null = null;

onMounted(() => {
	if (!containerRef.value) return;
	const file = new File([props.blob], "document.docx", { type: props.blob.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
	instance = new SuperDoc({
		selector: containerRef.value,
		toolbar: `#${toolbarId}`,
		document: file,
		documentMode: "editing",
		// Autor für Tracked Changes: die Agentenvorschläge erscheinen unter diesem
		// Namen im Überarbeitungsmodus (der Mensch bleibt der "Editor").
		user: { name: "KI-Assistent (pi)", email: "agent@browser-pi.local" },
		// Eigener Rechtsklick-Befehl neben „Link/Tabelle einfügen": reicht die
		// angeklickte Textstelle als Anker an den Agenten (siehe resolveAnchor).
		modules: {
			contextMenu: {
				customItems: [
					{
						id: "pi-agent",
						items: [
							{
								id: "pi-show-location",
								label: "Diese Stelle dem Agenten zeigen",
								action: (editor: Editor, ctx: ContextMenuContext) => {
									const anchor = resolveAnchor(editor, ctx);
									if (anchor) emit("cite", anchor);
								},
							},
						],
					},
				],
			},
		},
	});
});

onUnmounted(() => {
	instance?.destroy();
	instance = null;
});

/**
 * Exportiert den aktuellen Dokumentenstand als DOCX-Blob. Wird von
 * EditorDialog aufgerufen, bevor das Modal geschlossen wird.
 */
async function getBlob(): Promise<Blob> {
	if (!instance) throw new Error("SuperDoc-Instanz nicht bereit");
	const blobs = await instance.exportEditorsToDOCX();
	const blob = blobs[0];
	if (!blob) throw new Error("Export lieferte kein Dokument");
	return blob;
}

/**
 * Liefert die agentenfreundliche DocumentApi des LIVE-Editors. Die Word-Tools
 * (wordTools.ts) bearbeiten darüber das offene Dokument mit Tracked Changes.
 * Wirft, solange der Editor noch nicht bereit ist.
 */
function getDocumentApi(): DocumentApi {
	const editor = instance?.activeEditor;
	if (!editor) throw new Error("Word-Editor noch nicht bereit");
	return editor.doc;
}

defineExpose({ getBlob, getDocumentApi });
</script>

<template>
	<div class="superdoc-wrap">
		<div :id="toolbarId" class="superdoc-toolbar"></div>
		<div ref="containerRef" class="superdoc-container"></div>
	</div>
</template>

<style scoped>
.superdoc-wrap {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 380px;
}
.superdoc-toolbar {
	flex-shrink: 0;
	border-bottom: 1px solid #30363d;
}
.superdoc-container {
	flex: 1;
	overflow: auto;
	background: #fff;
	border-radius: 0 0 4px 4px;
}
</style>
