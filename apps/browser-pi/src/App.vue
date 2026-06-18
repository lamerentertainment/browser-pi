<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import type { AgentEvent } from "./agent/events.ts";
import {
	SLASH_COMMANDS,
	type SlashCommand,
	matchSlashCommands,
	resolveSlashCommand,
} from "./agent/commands.ts";
import { PiAgentSession } from "./agent/piSession.ts";
import { settings } from "./store/settings.ts";
import { requestPersistence } from "./vfs/idb.ts";
import { seedIfNeeded } from "./vfs/seed.ts";
import Terminal from "./components/Terminal.vue";
import CommandPalette from "./components/CommandPalette.vue";
import LibrarySidebar from "./components/LibrarySidebar.vue";
import EditorDialog from "./components/EditorDialog.vue";
import SettingsPanel from "./components/SettingsPanel.vue";

const events = ref<AgentEvent[]>([]);
const input = ref("");
const busy = ref(false);
const showSettings = ref(false);
const explorer = ref<InstanceType<typeof LibrarySidebar> | null>(null);
const editingPath = ref<string | null>(null);

const session = shallowRef<PiAgentSession | null>(null);

// --- Slash-Command-Palette --------------------------------------------------
const paletteIndex = ref(0);
const paletteDismissed = ref(false); // Esc schliesst sie bis zur nächsten Eingabe.

const paletteCommands = computed(() => {
	if (busy.value || paletteDismissed.value) return null;
	return matchSlashCommands(input.value);
});

// Jede Tastatureingabe setzt Auswahl zurück und hebt ein vorheriges Esc auf.
watch(input, () => {
	paletteIndex.value = 0;
	paletteDismissed.value = false;
});

// Mappt ein natives pi-AgentEvent auf den UI-Event-Stream (Terminal.vue).
function onAgentEvent(ev: AgentEvent): void {
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
}

function createSession(): void {
	session.value = new PiAgentSession(settings, onAgentEvent);
}

onMounted(async () => {
	await seedIfNeeded();
	await requestPersistence();
	createSession();
});

/** Hängt eine lokale Statuszeile an (Befehls-Feedback, nicht vom Agenten). */
function pushStatus(text: string): void {
	events.value = [...events.value, { type: "status", text }];
}

async function submit() {
	const text = input.value.trim();
	if (!text || busy.value || !session.value) return;

	// Slash-Befehle werden lokal ausgeführt, nicht an den Agenten geschickt.
	const resolved = resolveSlashCommand(text);
	if (resolved) {
		if ("unknown" in resolved) {
			input.value = "";
			pushStatus(`Unbekannter Befehl: /${resolved.unknown} — „/hilfe“ zeigt alle Befehle.`);
		} else {
			runCommand(resolved);
		}
		return;
	}

	input.value = "";
	busy.value = true;
	session.value.updateConfig(settings);
	await session.value.send(text);
	busy.value = false;
	explorer.value?.refresh();
}

// --- Befehlsausführung ------------------------------------------------------
function acceptCommand(cmd: SlashCommand | string): void {
	const c =
		typeof cmd === "string" ? SLASH_COMMANDS.find((x) => x.name === cmd) : cmd;
	if (c) runCommand(c);
}

function runCommand(cmd: SlashCommand): void {
	input.value = "";
	paletteDismissed.value = true;
	switch (cmd.name) {
		case "neu":
			events.value = [];
			createSession();
			pushStatus("Neue Sitzung gestartet.");
			break;
		case "leeren":
			events.value = [];
			break;
		case "einstellungen":
			showSettings.value = true;
			break;
		case "export":
			exportTranscript();
			break;
		case "hilfe":
			showHelp();
			break;
	}
}

function showHelp(): void {
	const lines = SLASH_COMMANDS.map((c) => `  /${c.name}  —  ${c.description}`);
	pushStatus(`Verfügbare Befehle:\n${lines.join("\n")}`);
}

/** Rendert ein Event als lesbare Transkript-Zeile (oder "" zum Überspringen). */
function transcriptLine(ev: AgentEvent): string {
	switch (ev.type) {
		case "user":
			return `› ${ev.text}`;
		case "reasoning":
			return ev.streaming ? "" : `💭 ${ev.text}`;
		case "assistant":
			return ev.streaming ? "" : ev.text;
		case "tool_call":
			return `⚙ ${ev.name} ${JSON.stringify(ev.args)}`;
		case "tool_result":
			return ev.output;
		case "error":
			return `✗ ${ev.text}`;
		case "status":
			return ev.text;
	}
}

function exportTranscript(): void {
	const lines = events.value.map(transcriptLine).filter((l) => l.length > 0);
	if (lines.length === 0) {
		pushStatus("Nichts zu exportieren — der Verlauf ist leer.");
		return;
	}
	const blob = new Blob([lines.join("\n\n")], {
		type: "text/plain;charset=utf-8",
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `browser-pi-sitzung-${Date.now()}.txt`;
	a.click();
	URL.revokeObjectURL(url);
	pushStatus("Gesprächsverlauf exportiert.");
}

// --- Tastatur in der Eingabezeile (Palette-Navigation) ----------------------
function onInputKeydown(e: KeyboardEvent): void {
	const cmds = paletteCommands.value;
	if (!cmds || cmds.length === 0) return;
	switch (e.key) {
		case "ArrowDown":
			e.preventDefault();
			paletteIndex.value = (paletteIndex.value + 1) % cmds.length;
			break;
		case "ArrowUp":
			e.preventDefault();
			paletteIndex.value = (paletteIndex.value - 1 + cmds.length) % cmds.length;
			break;
		case "Enter":
			e.preventDefault();
			acceptCommand(cmds[paletteIndex.value]);
			break;
		case "Tab":
			e.preventDefault();
			input.value = `/${cmds[paletteIndex.value].name}`;
			break;
		case "Escape":
			e.preventDefault();
			paletteDismissed.value = true;
			break;
	}
}

function cancel() {
	session.value?.cancel();
	busy.value = false;
}

function openFile(path: string) {
	editingPath.value = path;
}

function onEditorClosed() {
	editingPath.value = null;
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
					<CommandPalette
						v-if="paletteCommands && paletteCommands.length"
						:commands="paletteCommands"
						:active-index="paletteIndex"
						@select="acceptCommand"
						@hover="paletteIndex = $event"
					/>
					<span class="prompt">›</span>
					<input
						v-model="input"
						:disabled="busy"
						placeholder="Aufgabe stellen – z.B. „Fasse diesen Fall zusammen“ · „/“ für Befehle"
						autofocus
						@keydown="onInputKeydown"
					/>
					<button v-if="!busy" type="submit" :disabled="!input.trim()">Senden</button>
					<button v-else type="button" class="stop" @click="cancel">Stopp</button>
				</form>
			</main>

			<EditorDialog
				v-if="editingPath"
				:path="editingPath"
				@close="onEditorClosed"
			/>
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
	position: relative;
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
</style>
