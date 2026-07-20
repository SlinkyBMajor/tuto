import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Diagram types the tutor is allowed to emit, as the chunk basenames mermaid
// gives them. Keep in step with the Diagrams section of prompts/tutor.md.
//
// These five are the cheap ones: each of the three beyond flow and sequence
// costs 26–49 KB, because they reuse the dagre layout and the renderer chunks
// already pulled in. The types deliberately left out are the ones that drag in
// a second heavyweight dependency — `mindmap` (+528 KB, cytoscape),
// `gitGraph` (+697 KB, the Langium parser) and `architecture` (+1.24 MB, both).
const KEPT_DIAGRAMS = [
	"flowDiagram",
	"sequenceDiagram",
	// Prefix-matched, so these also catch the -v2 chunks alongside the v1 ones.
	"stateDiagram",
	"classDiagram",
	"erDiagram",
];

// Layout engines those need. The other two mermaid registers — `swimlanes`
// and `cose-bilkent`, which drags in all of cytoscape — serve only the swimlane
// and mindmap diagrams, which are not bundled.
//
// Adding a diagram type here is not always enough: `mindmap` resolves its
// layout through this registry at RENDER time, so bundling it without
// `cose-bilkent` builds clean and then throws on the first diagram. buildEnd
// below cannot catch that — it only proves the kept prefixes matched a chunk.
const KEPT_LAYOUTS = ["dagre"];

// Mermaid registers all ~36 of its built-in diagram types through lazy loaders
// in mermaid.core.mjs, each an `import("./chunks/mermaid.core/<type>-<hash>.mjs")`,
// and its layout engines the same way in a sibling chunk. Those import sites are
// statically reachable from the entry, so the bundler emits a chunk per type no
// matter what is registered at runtime — and no mermaid API removes a built-in
// (registerExternalDiagrams only adds). The unused ones drag in their own heavy
// dependencies — cytoscape, katex, cose-bilkent — which were most of the build.
//
// So strip the loaders we do not want out of the two registries instead. This
// keys on the registries rather than on mermaid's hashed chunk filenames, so it
// survives a mermaid upgrade; buildEnd fails the build if a rename ever means
// the loaders we meant to keep stopped matching.
function mermaidDiagramSubset(): Plugin {
	const kept = new Set<string>();

	// Both registries have the same shape: a table of lazy loaders, each one an
	// `import()` of a sibling chunk. Rewriting the import site rather than
	// stubbing what it resolves to means no `import()` is left and the bundler
	// emits no chunk at all. (A resolveId hook cannot do this — rolldown
	// resolves mermaid's own relative specifiers without consulting JS plugins.)
	function pruneLoaders(code: string, keepPrefixes: string[]): string {
		return code.replace(
			/import\("\.\/(?:chunks\/mermaid\.core\/)?([\w.-]+)\.mjs"\)/g,
			(site, chunk: string) => {
				const keep = keepPrefixes.find((prefix) => chunk.startsWith(prefix));
				if (keep) {
					kept.add(keep);
					return site;
				}
				// A rejected loader surfaces as a failed parse in MermaidBlock,
				// which hides the diagram rather than showing the learner an error.
				const message = `mermaid chunk "${chunk}" is not bundled (see vite.config.ts)`;
				return `Promise.reject(new Error(${JSON.stringify(message)}))`;
			},
		);
	}

	return {
		name: "mermaid-diagram-subset",
		transform(code, id) {
			if (!id.includes("/mermaid/dist/")) return null;
			const keepPrefixes = id.endsWith("/mermaid.core.mjs")
				? KEPT_DIAGRAMS
				: code.includes("registerDefaultLayoutLoaders")
					? KEPT_LAYOUTS
					: null;
			if (!keepPrefixes) return null;
			const rewritten = pruneLoaders(code, keepPrefixes);
			return rewritten === code ? null : { code: rewritten, map: null };
		},
		buildEnd() {
			// A mermaid upgrade that renames these chunks would otherwise prune the
			// loaders we meant to keep, and every diagram would silently vanish at
			// runtime. Fail the build instead.
			const missing = [...KEPT_DIAGRAMS, ...KEPT_LAYOUTS].filter(
				(prefix) => !kept.has(prefix),
			);
			if (missing.length > 0) {
				this.error(
					`mermaid-diagram-subset matched no chunk for: ${missing.join(", ")}. ` +
						"Mermaid's chunk names likely changed — update KEPT_DIAGRAMS/KEPT_LAYOUTS.",
				);
			}
		},
	};
}

export default defineConfig({
	plugins: [react(), tailwindcss(), mermaidDiagramSubset()],
	root: "src/mainview",
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "src/mainview"),
		},
	},
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
