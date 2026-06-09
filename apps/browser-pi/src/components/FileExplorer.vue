<script setup lang="ts">
import { onMounted, ref } from "vue";
import { type DirEntry, vfs } from "../vfs/vfs.ts";
import TreeNode from "./TreeNode.vue";

const emit = defineEmits<{ open: [path: string] }>();
const roots = ref<DirEntry[]>([]);
// Schlüssel zum Neu-Mounten des Baums nach Änderungen (re-liest VFS-Zustand).
const treeKey = ref(0);

async function refresh() {
	roots.value = await vfs.list("/");
	treeKey.value++;
}

defineExpose({ refresh });
onMounted(refresh);
</script>

<template>
	<div class="explorer">
		<div class="header">
			Dokumente (VFS)
			<button class="refresh" title="Aktualisieren" @click="refresh">⟳</button>
		</div>
		<ul :key="treeKey" class="tree">
			<TreeNode
				v-for="entry in roots"
				:key="entry.path"
				:entry="entry"
				:depth="0"
				@open="(p: string) => emit('open', p)"
			/>
		</ul>
	</div>
</template>

<style scoped>
.explorer {
	width: 240px;
	background: #0d1117;
	border-right: 1px solid #21262d;
	display: flex;
	flex-direction: column;
	overflow-y: auto;
}
.header {
	padding: 10px 12px;
	color: #8b949e;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	font-size: 10px;
	display: flex;
	justify-content: space-between;
	align-items: center;
	border-bottom: 1px solid #21262d;
}
.refresh {
	background: none;
	border: none;
	color: #8b949e;
	cursor: pointer;
	font-size: 13px;
}
.tree { list-style: none; margin: 0; padding: 0; }
</style>
