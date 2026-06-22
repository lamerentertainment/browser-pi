<script setup lang="ts">
// DOCX-Editor auf Basis von SuperDoc (AGPL-3.0). Läuft vollständig im Browser;
// kein Byte des Dokuments verlässt den Client (CLAUDE.md, Lokal-only-Invariante).
// SuperDoc montiert eine eigene Vue-Instanz in containerRef — sie ist von der
// browser-pi-App-Instanz isoliert.
import { onMounted, onUnmounted, ref } from "vue";
import { SuperDoc } from "@harbour-enterprises/superdoc";
import "@harbour-enterprises/superdoc/dist/style.css";

const props = defineProps<{ blob: Blob }>();

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

defineExpose({ getBlob });
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
	height: 68vh;
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
