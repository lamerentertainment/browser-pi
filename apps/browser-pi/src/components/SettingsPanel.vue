<script setup lang="ts">
import { ref } from "vue";
import { listModels } from "../agent/llm.ts";
import { settings } from "../store/settings.ts";
import { vfs } from "../vfs/vfs.ts";
import { idb } from "../vfs/idb.ts";

const emit = defineEmits<{ close: []; changed: [] }>();
const status = ref("");
const models = ref<string[]>([]);

async function test() {
	status.value = "Prüfe Endpoint…";
	try {
		models.value = await listModels(settings);
		status.value = `OK — ${models.value.length} Modelle erreichbar.`;
	} catch (e) {
		status.value = `Fehler: ${(e as Error).message} (CORS am Endpoint erlaubt?)`;
	}
}

async function exportVfs() {
	const data = await vfs.exportAll();
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `browser-pi-export-${Date.now()}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

async function importVfs(ev: Event) {
	const file = (ev.target as HTMLInputElement).files?.[0];
	if (!file) return;
	const records = JSON.parse(await file.text());
	const n = await vfs.importAll(records, { overwrite: true });
	status.value = `${n} Dateien importiert.`;
	emit("changed");
}

async function resetVfs() {
	if (!confirm("Gesamtes lokales Dateisystem löschen? (Nicht rückgängig machbar)")) return;
	const keys = await idb.allKeys();
	await Promise.all(keys.map((k) => idb.delete(k)));
	status.value = "VFS geleert. Seite neu laden für Seed.";
	emit("changed");
}
</script>

<template>
	<div class="overlay" @click.self="emit('close')">
		<div class="panel">
			<h2>Einstellungen — lokales LLM</h2>
			<p class="hint">
				Der Aufruf geht direkt vom Browser an deinen lokalen Endpoint
				(Ollama / OpenWebUI). Keine Daten gehen an kommerzielle Provider.
			</p>

			<label>Endpoint (OpenAI-kompatibel)
				<input v-model="settings.baseUrl" placeholder="http://localhost:11434/v1" />
			</label>
			<label>API-Token (optional, bleibt lokal)
				<input v-model="settings.apiKey" type="password" placeholder="(leer bei Ollama)" />
			</label>
			<label>Modell
				<input v-model="settings.model" list="models" placeholder="llama3.1" />
				<datalist id="models">
					<option v-for="m in models" :key="m" :value="m" />
				</datalist>
			</label>

			<div class="row">
				<button @click="test">Verbindung testen</button>
			</div>
			<p v-if="status" class="status">{{ status }}</p>

			<hr />
			<h3>Dokumente (lokal, IndexedDB)</h3>
			<div class="row">
				<button @click="exportVfs">Export (JSON)</button>
				<label class="filebtn">Import
					<input type="file" accept="application/json" @change="importVfs" />
				</label>
				<button class="danger" @click="resetVfs">VFS leeren</button>
			</div>

			<div class="row end">
				<button class="primary" @click="emit('close')">Schliessen</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.6);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 50;
}
.panel {
	background: #0d1117;
	border: 1px solid #30363d;
	border-radius: 10px;
	padding: 24px;
	width: 480px;
	max-width: 90vw;
	color: #c9d1d9;
}
h2 { margin: 0 0 4px; font-size: 16px; }
h3 { font-size: 13px; color: #8b949e; margin: 8px 0; }
.hint { color: #8b949e; font-size: 12px; margin: 0 0 16px; }
label { display: block; margin-bottom: 12px; font-size: 12px; color: #8b949e; }
input {
	display: block;
	width: 100%;
	margin-top: 4px;
	padding: 8px 10px;
	background: #010409;
	border: 1px solid #30363d;
	border-radius: 6px;
	color: #e6edf3;
	font-family: ui-monospace, monospace;
	box-sizing: border-box;
}
.row { display: flex; gap: 8px; align-items: center; margin: 8px 0; flex-wrap: wrap; }
.row.end { justify-content: flex-end; margin-top: 16px; }
button, .filebtn {
	padding: 7px 14px;
	background: #21262d;
	border: 1px solid #30363d;
	border-radius: 6px;
	color: #c9d1d9;
	cursor: pointer;
	font-size: 12px;
}
button.primary { background: #238636; border-color: #2ea043; color: #fff; }
button.danger { background: #21262d; color: #f85149; }
.filebtn input { display: none; }
.status { font-size: 12px; color: #79c0ff; }
hr { border: none; border-top: 1px solid #21262d; margin: 16px 0; }
</style>
