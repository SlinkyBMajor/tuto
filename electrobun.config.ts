import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Tuto",
		identifier: "dev.pontus.tuto",
		version: "0.1.0",
		description: "A visual, plain-language AI learning app",
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
			// prompts/*.md are imported as strings into the bun process
			loader: {
				".md": "text",
			},
		},
		// Vite builds the view to dist/, Electrobun copies it into the bundle
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		// Vite output must not trigger electrobun rebuilds in watch mode
		watchIgnore: ["dist/**"],
		// Prompt edits should rebuild the bun process in watch mode
		watch: ["prompts/tutor.md"],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
