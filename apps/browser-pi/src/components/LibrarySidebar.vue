<script setup lang="ts">
// Anfängergerechte Navigation: drei benannte Bibliotheken (Vorlagen,
// Textbausteine, Fälle) mit Anzeige-Titeln statt VFS-Pfaden. Ersetzt den rohen
// Pfad-Baum (CLAUDE.md, "Zielgruppe & Bedienkonzept"). Fälle sind aufklappbar
// und zeigen ihre Dokumente.
import { onMounted, reactive, ref } from "vue";
import {
	createDocument,
	createEntry,
	deleteEntry,
	type LibraryDef,
	type LibraryEntry,
	LIBRARIES,
	type LibraryId,
	loadLibrary,
	renameCase,
	uploadDocument,
} from "../library/library.ts";
import { ACCEPTED_EXTENSIONS } from "../import/extract.ts";
import ConfirmDialog from "./ConfirmDialog.vue";
import Modal from "./Modal.vue";

const emit = defineEmits<{ open: [path: string] }>();

const entries = reactive<Record<LibraryId, LibraryEntry[]>>({
	prompts: [],
	textblocks: [],
	cases: [],
});
const openSections = reactive<Record<LibraryId, boolean>>({
	prompts: true,
	textblocks: true,
	cases: true,
});
const expandedCases = reactive<Set<string>>(new Set());

// Anlege-Dialog: entweder ein neuer Bibliotheks-Eintrag oder ein Dokument im Fall.
type CreateTarget =
	| { kind: "library"; def: LibraryDef }
	| { kind: "caseDoc"; folder: string; sectionId: LibraryId };
const creating = ref<{ target: CreateTarget; label: string; field: string } | null>(null);
const newTitle = ref("");
const creatingBusy = ref(false);

// Lösch-Bestätigung für einen ganzen Fall.
const deletingCase = ref<LibraryEntry | null>(null);

// Umbenennen eines ganzen Falls.
const renamingCase = ref<LibraryEntry | null>(null);
const renameTitle = ref("");
const renamingBusy = ref(false);

// Datei-Upload in einen Fall (PDF/DOCX/TXT).
const fileInput = ref<HTMLInputElement | null>(null);
const uploadTargetCase = ref<string | null>(null);
const uploadBusy = ref(false);
const uploadError = ref<string | null>(null);
const uploadAccept = ACCEPTED_EXTENSIONS.join(",");

function startUpload(caseEntry: LibraryEntry) {
	uploadTargetCase.value = caseEntry.path;
	fileInput.value?.click();
}

async function onFilesSelected(e: Event) {
	const input = e.target as HTMLInputElement;
	const folder = uploadTargetCase.value;
	const files = input.files ? [...input.files] : [];
	if (!folder || files.length === 0 || uploadBusy.value) {
		input.value = "";
		return;
	}
	uploadBusy.value = true;
	let lastPath = "";
	try {
		for (const file of files) {
			lastPath = await uploadDocument(folder, file);
		}
		expandedCases.add(folder);
		await refresh();
		if (lastPath) emit("open", lastPath);
	} catch (err) {
		uploadError.value = `Datei konnte nicht verarbeitet werden: ${(err as Error).message}`;
	} finally {
		uploadBusy.value = false;
		uploadTargetCase.value = null;
		input.value = ""; // erlaubt erneutes Hochladen derselben Datei
	}
}

async function refresh() {
	for (const def of LIBRARIES) {
		entries[def.id] = await loadLibrary(def);
	}
}

function toggleSection(id: LibraryId) {
	openSections[id] = !openSections[id];
}

function toggleCase(path: string) {
	if (expandedCases.has(path)) expandedCases.delete(path);
	else expandedCases.add(path);
}

function startCreate(def: LibraryDef) {
	creating.value = { target: { kind: "library", def }, label: def.newLabel, field: def.newField };
	newTitle.value = "";
}

function startAddDocument(caseEntry: LibraryEntry) {
	creating.value = {
		target: { kind: "caseDoc", folder: caseEntry.path, sectionId: "cases" },
		label: `Neues Dokument in „${caseEntry.title}“`,
		field: "Titel des Dokuments",
	};
	newTitle.value = "";
	expandedCases.add(caseEntry.path);
}

async function confirmCreate() {
	const dialog = creating.value;
	const title = newTitle.value.trim();
	if (!dialog || !title || creatingBusy.value) return;
	creatingBusy.value = true;
	try {
		const { target } = dialog;
		const path =
			target.kind === "library"
				? await createEntry(target.def, title)
				: await createDocument(target.folder, title);
		await refresh();
		openSections[target.kind === "library" ? target.def.id : target.sectionId] = true;
		creating.value = null;
		emit("open", path);
	} finally {
		creatingBusy.value = false;
	}
}

function startRename(caseEntry: LibraryEntry) {
	renamingCase.value = caseEntry;
	renameTitle.value = caseEntry.title;
}

async function confirmRename() {
	const target = renamingCase.value;
	const title = renameTitle.value.trim();
	if (!target || !title || renamingBusy.value) return;
	renamingBusy.value = true;
	try {
		const newPath = await renameCase(target.path, title);
		// Aufklapp-Zustand auf den (ggf. neuen) Pfad übertragen.
		if (expandedCases.delete(target.path)) expandedCases.add(newPath);
		renamingCase.value = null;
		await refresh();
	} finally {
		renamingBusy.value = false;
	}
}

async function confirmDeleteCase() {
	const target = deletingCase.value;
	if (!target) return;
	await deleteEntry(target.path);
	expandedCases.delete(target.path);
	deletingCase.value = null;
	await refresh();
}

defineExpose({ refresh });
onMounted(refresh);
</script>

<template>
	<div class="sidebar">
		<section v-for="def in LIBRARIES" :key="def.id" class="lib">
			<div class="lib-head">
				<button class="lib-toggle" @click="toggleSection(def.id)">
					<span class="caret">{{ openSections[def.id] ? "▾" : "▸" }}</span>
					{{ def.label }}
				</button>
				<button class="add" :title="def.newLabel" @click="startCreate(def)">＋</button>
			</div>

			<ul v-if="openSections[def.id]" class="entries">
				<li v-if="entries[def.id].length === 0" class="empty">Noch nichts vorhanden</li>

				<template v-for="entry in entries[def.id]" :key="entry.path">
					<!-- Fälle: aufklappbar, mit Dokumenten darunter -->
					<li v-if="def.nested" class="case">
						<div class="case-head">
							<button class="entry case-row" @click="toggleCase(entry.path)">
								<span class="caret">{{ expandedCases.has(entry.path) ? "▾" : "▸" }}</span>
								<span class="case-icon">📁</span>{{ entry.title }}
							</button>
							<button
								class="row-act"
								title="Dokument hinzufügen"
								@click="startAddDocument(entry)"
							>
								＋
							</button>
							<button
								class="row-act"
								title="Datei hochladen (PDF, DOCX, TXT)"
								:disabled="uploadBusy"
								@click="startUpload(entry)"
							>
								📎
							</button>
							<button class="row-act" title="Fall umbenennen" @click="startRename(entry)">
								✏️
							</button>
							<button class="row-act danger" title="Fall löschen" @click="deletingCase = entry">
								🗑
							</button>
						</div>
						<ul v-if="expandedCases.has(entry.path)" class="docs">
							<li v-for="doc in entry.documents" :key="doc.path">
								<button class="entry doc" @click="emit('open', doc.path)">
									<span class="doc-icon">{{ doc.mime === "application/pdf" ? "📕" : "📄" }}</span>{{ doc.title }}
								</button>
							</li>
						</ul>
					</li>
					<!-- Vorlagen / Textbausteine: flache Liste -->
					<li v-else>
						<button class="entry" @click="emit('open', entry.path)">
							<span class="doc-icon">📄</span>{{ entry.title }}
						</button>
					</li>
				</template>
			</ul>
		</section>

		<Modal v-if="creating" :title="creating.label" @close="creating = null">
			<label class="field">
				<span>{{ creating.field }}</span>
				<input
					v-model="newTitle"
					autofocus
					placeholder="z.B. Zusammenfassung Darlehen"
					@keydown.enter.prevent="confirmCreate"
				/>
			</label>
			<template #footer>
				<button class="btn ghost" @click="creating = null">Abbrechen</button>
				<button
					class="btn primary"
					:disabled="!newTitle.trim() || creatingBusy"
					@click="confirmCreate"
				>
					Anlegen
				</button>
			</template>
		</Modal>

		<Modal v-if="renamingCase" title="Fall umbenennen" @close="renamingCase = null">
			<label class="field">
				<span>Name des Falls</span>
				<input
					v-model="renameTitle"
					autofocus
					@keydown.enter.prevent="confirmRename"
				/>
			</label>
			<template #footer>
				<button class="btn ghost" @click="renamingCase = null">Abbrechen</button>
				<button
					class="btn primary"
					:disabled="!renameTitle.trim() || renamingBusy"
					@click="confirmRename"
				>
					Umbenennen
				</button>
			</template>
		</Modal>

		<ConfirmDialog
			v-if="deletingCase"
			title="Fall löschen"
			:message="`Der Fall „${deletingCase.title}“ und alle darin enthaltenen Dokumente werden endgültig gelöscht. Fortfahren?`"
			confirm-label="Fall löschen"
			danger
			@confirm="confirmDeleteCase"
			@cancel="deletingCase = null"
		/>

		<!-- Verstecktes Datei-Input für den Upload in einen Fall. -->
		<input
			ref="fileInput"
			type="file"
			multiple
			:accept="uploadAccept"
			class="file-input"
			@change="onFilesSelected"
		/>

		<Modal v-if="uploadError" title="Upload fehlgeschlagen" @close="uploadError = null">
			<p class="upload-error">{{ uploadError }}</p>
			<template #footer>
				<button class="btn primary" @click="uploadError = null">OK</button>
			</template>
		</Modal>
	</div>
</template>

<style scoped>
.sidebar {
	width: 240px;
	background: #0d1117;
	border-right: 1px solid #21262d;
	display: flex;
	flex-direction: column;
	overflow-y: auto;
	padding-bottom: 12px;
}
.lib { border-bottom: 1px solid #161b22; }
.lib-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 4px 6px 4px 8px;
}
.lib-toggle {
	flex: 1;
	text-align: left;
	background: none;
	border: none;
	color: #8b949e;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	font-size: 10px;
	cursor: pointer;
	padding: 6px 0;
}
.caret { display: inline-block; width: 12px; color: #6e7681; }
.add {
	background: none;
	border: none;
	color: #6e7681;
	cursor: pointer;
	font-size: 15px;
	line-height: 1;
	padding: 2px 6px;
	border-radius: 5px;
}
.add:hover { color: #7ee787; background: #161b22; }
.entries { list-style: none; margin: 0; padding: 0 0 6px; }
.empty { color: #484f58; font-size: 12px; padding: 4px 12px 8px 26px; font-style: italic; }
.entry {
	width: 100%;
	text-align: left;
	background: none;
	border: none;
	color: #c9d1d9;
	cursor: pointer;
	font-size: 13px;
	padding: 5px 10px 5px 22px;
	display: flex;
	align-items: center;
	gap: 6px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.entry:hover { background: #161b22; }
.doc-icon, .case-icon { font-size: 11px; }
.case-head { display: flex; align-items: center; }
.case-head .case-row { width: auto; flex: 1; min-width: 0; font-weight: 500; }
.row-act {
	background: none;
	border: none;
	color: #6e7681;
	cursor: pointer;
	font-size: 12px;
	line-height: 1;
	padding: 4px 6px;
	border-radius: 5px;
	opacity: 0;
}
.case-head:hover .row-act { opacity: 1; }
.row-act:hover { background: #161b22; color: #adbac7; }
.row-act.danger:hover { color: #f85149; }
.docs { list-style: none; margin: 0; padding: 0; }
.docs .entry { padding-left: 40px; color: #adbac7; }
.file-input { display: none; }
.upload-error { color: #e6edf3; font-size: 13px; margin: 0; line-height: 1.5; }

.field { display: flex; flex-direction: column; gap: 6px; }
.field span { color: #8b949e; font-size: 12px; }
.field input {
	background: #0d1117;
	border: 1px solid #30363d;
	border-radius: 6px;
	padding: 9px 12px;
	color: #e6edf3;
	font-size: 13px;
}
.field input:focus { outline: none; border-color: #2f81f7; }
.btn {
	padding: 7px 14px;
	border-radius: 6px;
	cursor: pointer;
	font-size: 13px;
	border: 1px solid transparent;
}
.btn.ghost { background: #21262d; border-color: #30363d; color: #c9d1d9; }
.btn.primary { background: #238636; border-color: #2ea043; color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
