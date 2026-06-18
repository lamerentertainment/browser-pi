<script setup lang="ts">
// Autovervollständigungs-Menü über der Eingabezeile. Reine Darstellung:
// Navigation (Tasten) und Ausführung liegen in App.vue. `mousedown.prevent`
// statt `click`, damit der Fokus in der Eingabe bleibt (kein Blur vor Auswahl).
import type { SlashCommand } from "../agent/commands.ts";

defineProps<{ commands: SlashCommand[]; activeIndex: number }>();
const emit = defineEmits<{ select: [name: string]; hover: [index: number] }>();
</script>

<template>
	<div class="palette" role="listbox">
		<div class="hdr">Befehle — ↑↓ wählen, ⏎ ausführen, Esc schliessen</div>
		<div
			v-for="(cmd, i) in commands"
			:key="cmd.name"
			class="item"
			:class="{ active: i === activeIndex }"
			role="option"
			:aria-selected="i === activeIndex"
			@mousedown.prevent="emit('select', cmd.name)"
			@mouseenter="emit('hover', i)"
		>
			<span class="name">/{{ cmd.name }}</span>
			<span class="desc">{{ cmd.description }}</span>
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
	color: #7ee787;
	font-family: ui-monospace, monospace;
	font-size: 13px;
	min-width: 130px;
}
.desc { color: #8b949e; font-size: 12px; }
</style>
