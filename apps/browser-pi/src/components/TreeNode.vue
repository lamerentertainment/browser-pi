<script setup lang="ts">
// Rekursiver Baumknoten (referenziert sich über seinen Komponentennamen selbst).
import { type DirEntry, vfs } from "../vfs/vfs.ts";

const props = defineProps<{ entry: DirEntry; depth: number }>();
const emit = defineEmits<{ open: [path: string] }>();

import { ref } from "vue";
const open = ref(false);
const children = ref<DirEntry[]>([]);

async function toggle() {
	if (props.entry.type === "file") {
		emit("open", props.entry.path);
		return;
	}
	open.value = !open.value;
	if (open.value) children.value = await vfs.list(props.entry.path);
}

async function refresh() {
	if (open.value) children.value = await vfs.list(props.entry.path);
}
defineExpose({ refresh });
</script>

<template>
	<li>
		<div
			class="node"
			:class="entry.type"
			:style="{ paddingLeft: `${depth * 12 + 4}px` }"
			@click="toggle"
		>
			{{ entry.type === "dir" ? (open ? "▾" : "▸") : "·" }}
			{{ entry.name }}{{ entry.type === "dir" ? "/" : "" }}
		</div>
		<ul v-if="open" class="tree">
			<TreeNode
				v-for="child in children"
				:key="child.path"
				:entry="child"
				:depth="depth + 1"
				@open="(p: string) => emit('open', p)"
			/>
		</ul>
	</li>
</template>

<style scoped>
.tree { list-style: none; margin: 0; padding: 0; }
.node {
	padding: 3px 8px;
	cursor: pointer;
	color: #c9d1d9;
	font-family: ui-monospace, monospace;
	white-space: nowrap;
	font-size: 12px;
}
.node:hover { background: #161b22; }
.node.dir { color: #79c0ff; }
</style>
