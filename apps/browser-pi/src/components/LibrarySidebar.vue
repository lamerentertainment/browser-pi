<script setup lang="ts">
// Anfängergerechte Navigation: drei benannte Bibliotheken (Vorlagen,
// Textbausteine, Fälle) mit Anzeige-Titeln statt VFS-Pfaden. Ersetzt den rohen
// Pfad-Baum (CLAUDE.md, "Zielgruppe & Bedienkonzept"). Fälle sind aufklappbar
// und zeigen ihre Dokumente.
import { onMounted, reactive, ref } from "vue";
import {
	createEntry,
	type LibraryDef,
	type LibraryEntry,
	LIBRARIES,
	type LibraryId,
	loadLibrary,
} from "../library/library.ts";
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

// Anlege-Dialog.
const creating = ref<LibraryDef | null>(null);
const newTitle = ref("");
const creatingBusy = ref(false);

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
	creating.value = def;
	newTitle.value = "";
}

async function confirmCreate() {
	const def = creating.value;
	const title = newTitle.value.trim();
	if (!def || !title || creatingBusy.value) return;
	creatingBusy.value = true;
	try {
		const path = await createEntry(def, title);
		await refresh();
		openSections[def.id] = true;
		creating.value = null;
		emit("open", path);
	} finally {
		creatingBusy.value = false;
	}
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
						<button class="entry case-row" @click="toggleCase(entry.path)">
							<span class="caret">{{ expandedCases.has(entry.path) ? "▾" : "▸" }}</span>
							<span class="case-icon">📁</span>{{ entry.title }}
						</button>
						<ul v-if="expandedCases.has(entry.path)" class="docs">
							<li v-for="doc in entry.documents" :key="doc.path">
								<button class="entry doc" @click="emit('open', doc.path)">
									<span class="doc-icon">📄</span>{{ doc.title }}
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

		<Modal
			v-if="creating"
			:title="creating.newLabel"
			@close="creating = null"
		>
			<label class="field">
				<span>{{ creating.newField }}</span>
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
.case-row { font-weight: 500; }
.docs { list-style: none; margin: 0; padding: 0; }
.docs .entry { padding-left: 40px; color: #adbac7; }

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
