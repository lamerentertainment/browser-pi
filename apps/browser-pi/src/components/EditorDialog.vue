<script setup lang="ts">
// Bearbeiten-Dialog: Titel und Inhalt getrennt, ohne sichtbaren Pfad oder
// Markdown-Gerüst. Titel ändern = Umbenennen. Plus Duplizieren und Löschen.
// Konventionelle Verwaltung statt Shell (CLAUDE.md, "Zielgruppe & Bedienkonzept").
import { ref, watch } from "vue";
import {
	deleteEntry,
	duplicateEntry,
	parseDoc,
	saveEntry,
} from "../library/library.ts";
import { vfs } from "../vfs/vfs.ts";
import ConfirmDialog from "./ConfirmDialog.vue";
import Modal from "./Modal.vue";

const props = defineProps<{ path: string }>();
const emit = defineEmits<{
	close: [];
	saved: [path: string];
	deleted: [];
}>();

const title = ref("");
const body = ref("");
const busy = ref(false);
const confirmingDelete = ref(false);

// Beim Öffnen (und bei Pfadwechsel) Inhalt laden und Titel/Rumpf trennen.
watch(
	() => props.path,
	async (path) => {
		const content = await vfs.readFile(path);
		const parsed = parseDoc(content);
		title.value = parsed.title;
		body.value = parsed.body;
	},
	{ immediate: true },
);

async function save() {
	if (busy.value) return;
	busy.value = true;
	try {
		const finalPath = await saveEntry(props.path, title.value, body.value);
		emit("saved", finalPath);
		emit("close");
	} finally {
		busy.value = false;
	}
}

async function duplicate() {
	if (busy.value) return;
	busy.value = true;
	try {
		const newPath = await duplicateEntry(props.path);
		emit("saved", newPath);
		emit("close");
	} finally {
		busy.value = false;
	}
}

async function confirmDelete() {
	await deleteEntry(props.path);
	emit("deleted");
	emit("close");
}
</script>

<template>
	<Modal title="Bearbeiten" @close="emit('close')">
		<label class="field">
			<span>Titel</span>
			<input v-model="title" placeholder="Titel" />
		</label>
		<label class="field">
			<span>Inhalt</span>
			<textarea v-model="body" spellcheck="false" rows="14"></textarea>
		</label>

		<template #footer>
			<button class="btn danger" :disabled="busy" @click="confirmingDelete = true">
				Löschen
			</button>
			<span class="spacer"></span>
			<button class="btn ghost" :disabled="busy" @click="duplicate">Duplizieren</button>
			<button class="btn ghost" :disabled="busy" @click="emit('close')">Abbrechen</button>
			<button class="btn primary" :disabled="busy" @click="save">Speichern</button>
		</template>
	</Modal>

	<ConfirmDialog
		v-if="confirmingDelete"
		title="Löschen"
		:message="`„${title || 'Dieser Eintrag'}“ wird endgültig gelöscht. Fortfahren?`"
		confirm-label="Löschen"
		danger
		@confirm="confirmDelete"
		@cancel="confirmingDelete = false"
	/>
</template>

<style scoped>
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.field span { color: #8b949e; font-size: 12px; }
.field input,
.field textarea {
	background: #0d1117;
	border: 1px solid #30363d;
	border-radius: 6px;
	padding: 9px 12px;
	color: #e6edf3;
	font-size: 13px;
}
.field textarea {
	resize: vertical;
	font-family: ui-monospace, monospace;
	line-height: 1.5;
}
.field input:focus,
.field textarea:focus { outline: none; border-color: #2f81f7; }
.spacer { flex: 1; }
.btn {
	padding: 7px 14px;
	border-radius: 6px;
	cursor: pointer;
	font-size: 13px;
	border: 1px solid transparent;
}
.btn.ghost { background: #21262d; border-color: #30363d; color: #c9d1d9; }
.btn.primary { background: #238636; border-color: #2ea043; color: #fff; }
.btn.danger { background: none; border-color: #f85149; color: #f85149; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
