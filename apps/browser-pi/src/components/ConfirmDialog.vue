<script setup lang="ts">
// Bestätigungsdialog — Anfänger brauchen die „Wirklich löschen?"-Rückfrage vor
// nicht umkehrbaren Aktionen (CLAUDE.md, "Zielgruppe & Bedienkonzept").
import Modal from "./Modal.vue";

withDefaults(
	defineProps<{
		title: string;
		message: string;
		confirmLabel?: string;
		danger?: boolean;
	}>(),
	{ confirmLabel: "Bestätigen", danger: false },
);
const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
	<Modal :title="title" @close="emit('cancel')">
		<p class="msg">{{ message }}</p>
		<template #footer>
			<button class="btn ghost" @click="emit('cancel')">Abbrechen</button>
			<button class="btn" :class="danger ? 'danger' : 'primary'" @click="emit('confirm')">
				{{ confirmLabel }}
			</button>
		</template>
	</Modal>
</template>

<style scoped>
.msg { margin: 0; color: #c9d1d9; line-height: 1.5; }
.btn {
	padding: 7px 14px;
	border-radius: 6px;
	cursor: pointer;
	font-size: 13px;
	border: 1px solid transparent;
}
.btn.ghost { background: #21262d; border-color: #30363d; color: #c9d1d9; }
.btn.primary { background: #238636; border-color: #2ea043; color: #fff; }
.btn.danger { background: #da3633; border-color: #f85149; color: #fff; }
</style>
