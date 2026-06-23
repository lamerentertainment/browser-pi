/// <reference types="node" />
import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// pi-Pakete werden direkt aus dem Monorepo-Source eingebunden (kein dist-Build
// nötig). Der Agenten-Kern (pi-agent-core) ist browser-sicher; die LLM-Schicht
// (pi-ai) wird hier nur für Typen/Stream-Utilities genutzt — der eigentliche
// Provider-Call läuft über eine eigene, browser-sichere streamFn (siehe
// src/agent/piStream.ts). Damit gelangt kein Node-only-Provider in den Bundle.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const shim = (p: string) => fileURLToPath(new URL(`./src/shims/${p}`, import.meta.url));

// Eigenständige PWA für browser-pi. Bewusst NICHT in die Monorepo-Workspaces
// eingehängt, damit der bestehende `npm run check`/build-Pipeline unberührt bleibt.
export default defineConfig({
	plugins: [
		vue(),
		VitePWA({
			registerType: "autoUpdate",
			// App-Shell (statische Assets) wird gecacht -> Offline-Start.
			// Nutzerdaten liegen NICHT hier, sondern in IndexedDB (Lokal-only-Invariante).
			workbox: {
				globPatterns: ["**/*.{js,css,html,svg,ico,woff2}"],
				// Der SuperDoc-DOCX-Editor zieht einen grossen JS-Chunk (~8 MB) nach.
				// Damit die App-Shell auch mit Editor offline startet (Offline-first-
				// Invariante, CLAUDE.md), wird das Default-Limit von 2 MiB angehoben.
				maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
			},
			manifest: {
				name: "browser-pi",
				short_name: "browser-pi",
				description:
					"Lokaler pi-Agent im Browser mit sandboxiertem Dokumenten-Dateisystem.",
				theme_color: "#0b0e14",
				background_color: "#0b0e14",
				display: "standalone",
				start_url: "/",
				icons: [
					{
						src: "icon.svg",
						sizes: "any",
						type: "image/svg+xml",
						purpose: "any maskable",
					},
				],
			},
		}),
	],
	resolve: {
		alias: {
			"@earendil-works/pi-agent-core": shim("pi-agent-core.ts"),
			"@earendil-works/pi-ai": shim("pi-ai.ts"),
		},
	},
	server: {
		port: 5173,
		// Zugriff auf die Monorepo-Quellen ausserhalb des App-Roots erlauben.
		fs: { allow: [repoRoot] },
	},
});
