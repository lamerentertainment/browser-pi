<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { AgentEvent } from "../agent/events.ts";

const props = defineProps<{ events: AgentEvent[]; busy: boolean }>();
const scroller = ref<HTMLElement | null>(null);

watch(
	() => props.events.length,
	async () => {
		await nextTick();
		if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
	},
);

function argsPreview(args: Record<string, unknown>): string {
	const json = JSON.stringify(args);
	return json.length > 200 ? `${json.slice(0, 200)}…` : json;
}
</script>

<template>
	<div ref="scroller" class="terminal">
		<div v-for="(ev, i) in events" :key="i" class="line" :class="ev.type">
			<template v-if="ev.type === 'user'">
				<span class="prompt">›</span> <span class="user-text">{{ ev.text }}</span>
			</template>
			<template v-else-if="ev.type === 'assistant'">
				<span class="assistant-text">{{ ev.text }}</span>
			</template>
			<template v-else-if="ev.type === 'tool_call'">
				<span class="tool">⚙ {{ ev.name }}</span>
				<span class="tool-args">{{ argsPreview(ev.args) }}</span>
			</template>
			<template v-else-if="ev.type === 'tool_result'">
				<pre class="tool-result" :class="{ err: ev.exitCode !== 0 }">{{ ev.output }}</pre>
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
.assistant-text { color: #c9d1d9; white-space: pre-wrap; }
.tool { color: #79c0ff; font-weight: bold; margin-right: 8px; }
.tool-args { color: #6e7681; }
.tool-result {
	margin: 2px 0 6px 0;
	padding: 6px 10px;
	background: #11151c;
	border-left: 2px solid #30363d;
	color: #8b949e;
	max-height: 220px;
	overflow: auto;
	white-space: pre-wrap;
}
.tool-result.err { border-left-color: #f85149; color: #ffa198; }
.error-text { color: #f85149; }
.status-text { color: #6e7681; font-style: italic; }
.empty { color: #6e7681; font-style: italic; padding-top: 8px; }
.blink { animation: blink 1s step-start infinite; }
@keyframes blink { 50% { opacity: 0; } }
</style>
