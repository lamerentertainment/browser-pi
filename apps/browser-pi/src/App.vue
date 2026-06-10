<script setup lang="ts">
import { onMounted, ref, shallowRef } from "vue";
import type { AgentEvent } from "./agent/events.ts";
import { PiAgentSession } from "./agent/piSession.ts";
import { settings } from "./store/settings.ts";
import { requestPersistence } from "./vfs/idb.ts";
import { seedIfNeeded } from "./vfs/seed.ts";
import { vfs } from "./vfs/vfs.ts";
import Terminal from "./components/Terminal.vue";
import LibrarySidebar from "./components/LibrarySidebar.vue";
import SettingsPanel from "./components/SettingsPanel.vue";

const events = ref<AgentEvent[]>([]);
const input = ref("");
const busy = ref(false);
const showSettings = ref(false);
const explorer = ref<InstanceType<typeof LibrarySidebar> | null>(null);
const viewer = ref<{ path: string; content: string } | null>(null);

const session = shallowRef<PiAgentSession | null>(null);

onMounted(async () => {
	await seedIfNeeded();
	await requestPersistence();
	session.value = new PiAgentSession(settings, (ev) => {
		// Status-Events ersetzen die jeweils letzte Statuszeile (kein Spam).
		if (ev.type === "status") return;
		// Streaming-Events (reasoning/assistant) ersetzen das jeweils letzte,
		// noch laufende Event gleichen Typs, statt jedes Token als neue Zeile
		// anzuhängen. Eingefrorene (streaming !== true) Events bleiben stehen.
		const last = events.value[events.value.length - 1];
		const coalesce =
			(ev.type === "reasoning" || ev.type === "assistant") &&
			last?.type === ev.type &&
			"streaming" in last &&
			last.streaming === true;
		events.value = coalesce
			? [...events.value.slice(0, -1), ev]
			: [...events.value, ev];
		if (ev.type === "tool_result") explorer.value?.refresh();
	});
});

async function submit() {
	const text = input.value.trim();
	if (!text || busy.value || !session.value) return;
	input.value = "";
	busy.value = true;
	session.value.updateConfig(settings);
	await session.value.send(text);
	busy.value = false;
	explorer.value?.refresh();
}

function cancel() {
	session.value?.cancel();
	busy.value = false;
}

async function openFile(path: string) {
	try {
		viewer.value = { path, content: await vfs.readFile(path) };
	} catch (e) {
		viewer.value = { path, content: `Fehler: ${(e as Error).message}` };
	}
}

async function saveFile() {
	if (!viewer.value) return;
	await vfs.writeFile(viewer.value.path, viewer.value.content);
	explorer.value?.refresh();
}
</script>

<template>
	<div class="app">
		<header class="topbar">
			<div class="brand"><span class="pi">π</span> browser-pi <span class="tag">Prototyp</span></div>
			<div class="endpoint">{{ settings.model }} @ {{ settings.baseUrl }}</div>
			<button class="gear" @click="showSettings = true">⚙ Einstellungen</button>
		</header>

		<div class="body">
			<LibrarySidebar ref="explorer" @open="openFile" />

			<main class="main">
				<Terminal :events="events" :busy="busy" />
				<form class="inputbar" @submit.prevent="submit">
					<span class="prompt">›</span>
					<input
						v-model="input"
						:disabled="busy"
						placeholder="Frag den Assistenten zum geöffneten Dokument – z.B. „Fasse diesen Fall zusammen“"
						autofocus
					/>
					<button v-if="!busy" type="submit" :disabled="!input.trim()">Senden</button>
					<button v-else type="button" class="stop" @click="cancel">Stopp</button>
				</form>
			</main>

			<aside v-if="viewer" class="viewer">
				<div class="viewer-head">
					<span>{{ viewer.path }}</span>
					<div>
						<button @click="saveFile">Speichern</button>
						<button @click="viewer = null">✕</button>
					</div>
				</div>
				<textarea v-model="viewer.content" spellcheck="false"></textarea>
			</aside>
		</div>

		<SettingsPanel
			v-if="showSettings"
			@close="showSettings = false"
			@changed="explorer?.refresh()"
		/>
	</div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100vh; }
.topbar {
	display: flex;
	align-items: center;
	gap: 16px;
	padding: 0 16px;
	height: 44px;
	background: #010409;
	border-bottom: 1px solid #21262d;
	color: #c9d1d9;
	font-size: 13px;
}
.brand { font-weight: 700; display: flex; align-items: center; gap: 8px; }
.pi { color: #7ee787; font-size: 18px; }
.tag {
	font-size: 10px;
	background: #21262d;
	padding: 2px 6px;
	border-radius: 4px;
	color: #8b949e;
	font-weight: 500;
}
.endpoint { margin-left: auto; color: #6e7681; font-family: ui-monospace, monospace; font-size: 11px; }
.gear { background: none; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; padding: 5px 10px; cursor: pointer; font-size: 12px; }
.body { flex: 1; display: flex; min-height: 0; }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.inputbar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 14px;
	background: #010409;
	border-top: 1px solid #21262d;
}
.inputbar .prompt { color: #7ee787; font-weight: bold; }
.inputbar input {
	flex: 1;
	background: #0d1117;
	border: 1px solid #30363d;
	border-radius: 6px;
	padding: 9px 12px;
	color: #e6edf3;
	font-family: ui-monospace, monospace;
	font-size: 13px;
}
.inputbar button {
	padding: 8px 16px;
	background: #238636;
	border: 1px solid #2ea043;
	border-radius: 6px;
	color: #fff;
	cursor: pointer;
	font-size: 13px;
}
.inputbar button:disabled { opacity: 0.5; cursor: not-allowed; }
.inputbar button.stop { background: #da3633; border-color: #f85149; }
.viewer {
	width: 380px;
	border-left: 1px solid #21262d;
	background: #0d1117;
	display: flex;
	flex-direction: column;
}
.viewer-head {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 8px 12px;
	border-bottom: 1px solid #21262d;
	color: #8b949e;
	font-size: 12px;
	font-family: ui-monospace, monospace;
}
.viewer-head button {
	background: #21262d;
	border: 1px solid #30363d;
	border-radius: 5px;
	color: #c9d1d9;
	padding: 4px 10px;
	cursor: pointer;
	margin-left: 6px;
	font-size: 12px;
}
.viewer textarea {
	flex: 1;
	background: #0b0e14;
	border: none;
	color: #c9d1d9;
	padding: 12px;
	font-family: ui-monospace, monospace;
	font-size: 12px;
	resize: none;
	outline: none;
}
</style>
