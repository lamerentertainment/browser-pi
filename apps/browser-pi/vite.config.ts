import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

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
	server: {
		port: 5173,
	},
});
