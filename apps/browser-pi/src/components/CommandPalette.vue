<script setup lang="ts">
// Autovervollständigungs-Menü über der Eingabezeile. Zeigt built-in Commands
// und Prompt-Bibliotheks-Einträge gemeinsam an. Reine Darstellung: Navigation
// und Ausführung liegen in App.vue. `mousedown.prevent` hält Fokus in der Eingabe.
import type { PaletteEntry } from "../agent/commands.ts";

defineProps<{ commands: PaletteEntry[]; activeIndex: number }>();
const emit = defineEmits<{ select: [entry: PaletteEntry]; hover: [index: number] }>();
</script>

<template>
	<div class="palette" role="listbox">
		<div class="hdr">↑↓ wählen · ⏎ einfügen · Tab vervollständigen · Esc schliessen</div>
		<div
			v-for="(entry, i) in commands"
			:key="entry.kind === 'command' ? entry.name : entry.path"
			class="item"
			:class="{ active: i === activeIndex }"
			role="option"
			:aria-selected="i === activeIndex"
			@mousedown.prevent="emit('select', entry)"
			@mouseenter="emit('hover', i)"
		>
			<template v-if="entry.kind === 'command'">
				<span class="name cmd">/{{ entry.name }}</span>
				<span class="desc">{{ entry.description }}</span>
			</template>
			<template v-else>
				<span class="name prompt">📋 {{ entry.title }}</span>
				<span class="desc">Prompt einfügen</span>
			</template>
		</div>
	</div>
</template>

<style scoped>
.palette {
	position: absolute;
	left: 14px;
	right: 14px;
	bottom: calc(100% + 6px);
	background: #0d1117;
	border: 1px solid #30363d;
	border-radius: 8px;
	overflow: hidden;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	z-index: 20;
}
.hdr {
	padding: 6px 12px;
	font-size: 10px;
	color: #6e7681;
	background: #010409;
	border-bottom: 1px solid #21262d;
	font-family: ui-monospace, monospace;
}
.item {
	display: flex;
	align-items: baseline;
	gap: 10px;
	padding: 8px 12px;
	cursor: pointer;
}
.item.active { background: #161b22; }
.name {
	font-family: ui-monospace, monospace;
	font-size: 13px;
	min-width: 160px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.name.cmd { color: #7ee787; }
.name.prompt { color: #79c0ff; }
.desc { color: #8b949e; font-size: 12px; }
</style>
