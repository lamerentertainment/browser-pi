<script setup lang="ts">
// Angedockte DOCX-Ansicht: füllt die rechte Hälfte des Chat-Bereichs (statt als
// Modal-Overlay aufzugehen). Der Nutzer sieht das Word-Dokument neben den
// Agenten-Antworten und kann beides gleichzeitig im Blick behalten. Speichern
// hält das Panel offen (IDE-artig); Löschen oder Schliessen entfernt es.
import { ref, watch } from "vue";
import { deleteEntry, saveDocxBlob } from "../library/library.ts";
import { basename, vfs } from "../vfs/vfs.ts";
import ConfirmDialog from "./ConfirmDialog.vue";
import SuperDocEditor from "./SuperDocEditor.vue";

const props = defineProps<{ path: string }>();
const emit = defineEmits<{
	close: [];
	saved: [path: string];
	deleted: [];
}>();

const title = ref("");
const busy = ref(false);
const confirmingDelete = ref(false);
const docxBlob = ref<Blob | undefined>(undefined);
const superdocRef = ref<InstanceType<typeof SuperDocEditor> | null>(null);

// Beim Öffnen (und bei Pfadwechsel) das Dokument-Blob laden.
watch(
	() => props.path,
	async (path) => {
		docxBlob.value = undefined;
		const rec = await vfs.getRecord(path);
		title.value = basename(path);
		docxBlob.value = rec?.blob;
	},
	{ immediate: true },
);

async function save() {
	if (busy.value || !superdocRef.value) return;
	busy.value = true;
	try {
		const blob = await superdocRef.value.getBlob();
		await saveDocxBlob(props.path, blob);
		emit("saved", props.path);
	} finally {
		busy.value = false;
	}
}

async function confirmDelete() {
	await deleteEntry(props.path);
	emit("deleted");
}
</script>

<template>
	<aside class="doc-panel">
		<div class="doc-head">
			<span class="doc-title">{{ title }}</span>
			<button class="x" title="Schliessen" @click="emit('close')">✕</button>
		</div>

		<div class="doc-body">
			<SuperDocEditor v-if="docxBlob" ref="superdocRef" :blob="docxBlob" />
			<p v-else class="no-blob">
				Dokument-Bytes nicht verfügbar — bitte erneut hochladen.
			</p>
		</div>

		<div class="doc-foot">
			<button class="btn danger" :disabled="busy" @click="confirmingDelete = true">
				Löschen
			</button>
			<span class="spacer"></span>
			<button class="btn primary" :disabled="busy || !docxBlob" @click="save">
				Speichern
			</button>
		</div>

		<ConfirmDialog
			v-if="confirmingDelete"
			title="Löschen"
			:message="`„${title || 'Dieses Dokument'}“ wird endgültig gelöscht. Fortfahren?`"
			confirm-label="Löschen"
			danger
			@confirm="confirmDelete"
			@cancel="confirmingDelete = false"
		/>
	</aside>
</template>

<style scoped>
.doc-panel {
	display: flex;
	flex-direction: column;
	min-width: 0;
	background: #161b22;
	border-left: 1px solid #21262d;
}
.doc-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 12px 16px;
	border-bottom: 1px solid #21262d;
	color: #e6edf3;
	flex-shrink: 0;
}
.doc-title {
	font-weight: 600;
	font-size: 14px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.x {
	background: none;
	border: none;
	color: #8b949e;
	cursor: pointer;
	font-size: 14px;
	flex-shrink: 0;
	margin-left: 8px;
}
.doc-body {
	flex: 1;
	min-height: 0;
	padding: 12px;
	overflow: hidden;
}
.no-blob {
	color: #8b949e;
	font-size: 13px;
	margin: 0;
	padding: 24px 0;
	text-align: center;
}
.doc-foot {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px 16px;
	border-top: 1px solid #21262d;
	flex-shrink: 0;
}
.spacer { flex: 1; }
.btn {
	padding: 7px 14px;
	border-radius: 6px;
	cursor: pointer;
	font-size: 13px;
	border: 1px solid transparent;
}
.btn.primary { background: #238636; border-color: #2ea043; color: #fff; }
.btn.danger { background: none; border-color: #f85149; color: #f85149; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
