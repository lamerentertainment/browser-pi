<script setup lang="ts">
// Wiederverwendbarer Dialog — Fundament der konventionellen, anfängergerechten
// Bedienung (CLAUDE.md, "Zielgruppe & Bedienkonzept"): Verwaltung per Modal
// statt Shell. Schliesst per Backdrop-Klick und Esc.
import { onMounted, onUnmounted } from "vue";

defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();

function onKey(e: KeyboardEvent) {
	if (e.key === "Escape") emit("close");
}
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
	<div class="overlay" @click.self="emit('close')">
		<div class="modal" :class="{ wide }" role="dialog" aria-modal="true">
			<div class="modal-head">
				<span class="modal-title">{{ title }}</span>
				<button class="x" title="Schliessen" @click="emit('close')">✕</button>
			</div>
			<div class="modal-body"><slot /></div>
			<div v-if="$slots.footer" class="modal-foot"><slot name="footer" /></div>
		</div>
	</div>
</template>

<style scoped>
.overlay {
	position: fixed;
	inset: 0;
	background: rgba(1, 4, 9, 0.7);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 100;
}
.modal {
	width: 440px;
	max-width: calc(100vw - 32px);
}
.modal.wide {
	width: 900px;
	background: #161b22;
	border: 1px solid #30363d;
	border-radius: 10px;
	box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
	color: #e6edf3;
}
.modal-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 14px 16px;
	border-bottom: 1px solid #21262d;
}
.modal-title { font-weight: 600; font-size: 14px; }
.x {
	background: none;
	border: none;
	color: #8b949e;
	cursor: pointer;
	font-size: 14px;
}
.modal-body { padding: 16px; font-size: 13px; }
.modal-foot {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	padding: 12px 16px;
	border-top: 1px solid #21262d;
}
</style>
