<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { AgentEvent } from "../agent/events.ts";
import { marked } from "marked";

const COLLAPSED_LINES = 10;

const props = defineProps<{ events: AgentEvent[]; busy: boolean }>();
const scroller = ref<HTMLElement | null>(null);
const expanded = ref(new Set<number>());

watch(
	() => props.events.length,
	async () => {
		await nextTick();
		if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
	},
);

function toggleExpand(i: number): void {
	const s = new Set(expanded.value);
	if (s.has(i)) s.delete(i);
	else s.add(i);
	expanded.value = s;
}

function toolResultDisplay(output: string, i: number): { text: string; hiddenLines: number } {
	const lines = output.split("\n");
	const isExpanded = expanded.value.has(i);
	if (isExpanded || lines.length <= COLLAPSED_LINES) {
		return { text: output, hiddenLines: 0 };
	}
	return {
		text: lines.slice(0, COLLAPSED_LINES).join("\n"),
		hiddenLines: lines.length - COLLAPSED_LINES,
	};
}

function argsPreview(args: Record<string, unknown>): string {
	const json = JSON.stringify(args);
	return json.length > 200 ? `${json.slice(0, 200)}…` : json;
}

function renderMarkdown(text: string, streaming?: boolean): string {
	if (!text) return "";
	const content = streaming ? `${text}<span class="blink">▌</span>` : text;
	return marked.parse(content, { gfm: true, breaks: true }) as string;
}
</script>

<template>
	<div ref="scroller" class="terminal">
		<div v-for="(ev, i) in events" :key="i" class="line" :class="ev.type">
			<template v-if="ev.type === 'user'">
				<span class="prompt">›</span> <span class="user-text">{{ ev.text }}</span>
			</template>
			<template v-else-if="ev.type === 'reasoning'">
				<details class="reasoning" :open="ev.streaming">
					<summary>💭 {{ ev.streaming ? "Überlegt …" : "Überlegung" }}</summary>
					<div class="reasoning-body">{{ ev.text
						}}<span v-if="ev.streaming" class="blink">▌</span></div>
				</details>
			</template>
			<template v-else-if="ev.type === 'assistant'">
				<div class="assistant-markdown" v-html="renderMarkdown(ev.text, ev.streaming)"></div>
			</template>
			<template v-else-if="ev.type === 'tool_call'">
				<span class="tool">⚙ {{ ev.name }}</span>
				<span class="tool-args">{{ argsPreview(ev.args) }}</span>
			</template>
			<template v-else-if="ev.type === 'tool_result'">
				<pre class="tool-result" :class="{ err: ev.exitCode !== 0 }">{{ toolResultDisplay(ev.output, i).text }}</pre>
				<button
					v-if="toolResultDisplay(ev.output, i).hiddenLines > 0 || expanded.has(i)"
					class="expand-btn"
					@click="toggleExpand(i)"
				>{{ expanded.has(i) ? "▲ Weniger anzeigen" : `▼ … ${toolResultDisplay(ev.output, i).hiddenLines} weitere Zeilen` }}</button>
			</template>
			<template v-else-if="ev.type === 'error'">
				<span class="error-text">✗ {{ ev.text }}</span>
			</template>
			<template v-else-if="ev.type === 'status'">
				<span class="status-text">{{ ev.text }}</span>
			</template>
		</div>
		<div v-if="busy" class="line"><span class="status-text blink">█</span></div>
		<div v-if="events.length === 0" class="empty">
			pi-Agent bereit. Stelle eine Aufgabe — der Agent arbeitet im sandboxierten
			Dokumenten-Dateisystem (/cases, /prompts, /textblocks).
		</div>
	</div>
</template>

<style scoped>
.terminal {
	flex: 1;
	overflow-y: auto;
	padding: 12px 16px;
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 13px;
	line-height: 1.55;
	background: #0b0e14;
	color: #c9d1d9;
}
.line {
	margin-bottom: 4px;
	white-space: pre-wrap;
	word-break: break-word;
}
.prompt { color: #7ee787; font-weight: bold; }
.user-text { color: #e6edf3; }
.assistant-markdown {
	color: #c9d1d9;
}
.assistant-markdown :deep(p) {
	margin-top: 0;
	margin-bottom: 8px;
	line-height: 1.6;
}
.assistant-markdown :deep(p:last-child) {
	margin-bottom: 0;
}
.assistant-markdown :deep(h1),
.assistant-markdown :deep(h2),
.assistant-markdown :deep(h3),
.assistant-markdown :deep(h4) {
	margin-top: 16px;
	margin-bottom: 8px;
	font-weight: 600;
	color: #e6edf3;
}
.assistant-markdown :deep(h1) { font-size: 1.4em; }
.assistant-markdown :deep(h2) { font-size: 1.25em; }
.assistant-markdown :deep(h3) { font-size: 1.1em; }
.assistant-markdown :deep(*:first-child) {
	margin-top: 0;
}
.assistant-markdown :deep(ul),
.assistant-markdown :deep(ol) {
	padding-left: 20px;
	margin-top: 0;
	margin-bottom: 8px;
}
.assistant-markdown :deep(li) {
	margin-bottom: 4px;
}
.assistant-markdown :deep(code) {
	background: #161b22;
	padding: 2px 4px;
	border-radius: 4px;
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 12px;
	color: #ff7b72;
}
.assistant-markdown :deep(pre) {
	background: #161b22;
	border: 1px solid #30363d;
	border-radius: 6px;
	padding: 12px;
	margin: 12px 0;
	overflow-x: auto;
}
.assistant-markdown :deep(pre code) {
	background: none;
	padding: 0;
	border-radius: 0;
	color: #c9d1d9;
	font-size: 13px;
}
.assistant-markdown :deep(blockquote) {
	border-left: 3px solid #30363d;
	padding-left: 10px;
	color: #8b949e;
	margin: 8px 0;
	font-style: italic;
}
.assistant-markdown :deep(a) {
	color: #58a6ff;
	text-decoration: none;
}
.assistant-markdown :deep(a:hover) {
	text-decoration: underline;
}
.assistant-markdown :deep(table) {
	border-collapse: collapse;
	width: 100%;
	margin: 12px 0;
	font-size: 12px;
}
.assistant-markdown :deep(th),
.assistant-markdown :deep(td) {
	border: 1px solid #30363d;
	padding: 6px 8px;
}
.assistant-markdown :deep(th) {
	background: #161b22;
	font-weight: 600;
	text-align: left;
}
.reasoning { color: #8b949e; margin: 2px 0; }
.reasoning > summary {
	cursor: pointer;
	color: #6e7681;
	font-style: italic;
	font-size: 12px;
	list-style: none;
	user-select: none;
}
.reasoning > summary::-webkit-details-marker { display: none; }
.reasoning-body {
	margin: 4px 0 6px 0;
	padding: 6px 10px;
	border-left: 2px solid #30363d;
	background: #0d1117;
	color: #6e7681;
	font-style: italic;
	font-size: 12px;
	white-space: pre-wrap;
}
.tool { color: #79c0ff; font-weight: bold; margin-right: 8px; }
.tool-args { color: #6e7681; }
.tool-result {
	margin: 2px 0 0 0;
	padding: 6px 10px;
	background: #11151c;
	border-left: 2px solid #30363d;
	color: #8b949e;
	overflow-x: auto;
	white-space: pre-wrap;
	word-break: break-all;
}
.tool-result.err { border-left-color: #f85149; color: #ffa198; }
.expand-btn {
	display: block;
	margin: 0 0 6px 0;
	padding: 2px 10px;
	background: none;
	border: none;
	border-left: 2px solid #30363d;
	color: #58a6ff;
	font-family: inherit;
	font-size: 11px;
	cursor: pointer;
	text-align: left;
	width: 100%;
}
.expand-btn:hover { background: #161b22; }
.error-text { color: #f85149; }
.status-text { color: #6e7681; font-style: italic; }
.empty { color: #6e7681; font-style: italic; padding-top: 8px; }
.blink { animation: blink 1s step-start infinite; }
@keyframes blink { 50% { opacity: 0; } }
</style>
