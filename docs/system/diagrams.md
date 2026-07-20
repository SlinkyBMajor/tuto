# Diagrams

The tutor emits Mermaid in a ```mermaid fence; `MermaidBlock` in `src/mainview/components/card-markdown.tsx` renders it to SVG. Mermaid is code-split behind a dynamic import, and each diagram type is a further chunk loaded on first use. `main.tsx` imports the entry eagerly at startup anyway — not to warm it, but to prove it resolves, since chunks load over `views://` in the packaged app.

## Available diagram types

Five types render. The loader for any other is rewritten at build time into a rejected promise, so an unbundled type fails at `mermaid.parse` and takes the repair path below — where the fixer is told to rewrite it as one of the five.

| Type | Used for |
|------|----------|
| `flowchart` | steps, decisions, data moving between parts — the default |
| `sequenceDiagram` | an exchange over time between participants |
| `stateDiagram-v2` | one-state-at-a-time things and their transitions |
| `classDiagram` | types, fields, and how they relate |
| `erDiagram` | entities, attributes, cardinality |

The set is a bundle-size decision, not a capability one. Mermaid registers ~36 built-in types through lazy loaders that are statically reachable from its entry, so a bundler emits a chunk per type regardless of what is registered at runtime, and no Mermaid API removes a built-in. `mermaidDiagramSubset()` in `vite.config.ts` therefore rewrites the unwanted `import()` sites out of the diagram and layout registries.

Measured `dist/` cost per type, each added individually to a `flowchart` + `sequenceDiagram` baseline of 4,488 KB. The three added since cost +152 KB together, so figures below are indicative rather than additive — types share chunks:

- **Cheap (26–72 KB each):** `journey`, `timeline`, `quadrantChart`, `xychart-beta`, `block-beta`. These reuse the dagre layout and already-bundled renderer chunks.
- **Expensive:** `mindmap` +528 KB (drags in cytoscape via `cose-bilkent`), `gitGraph` +697 KB (the `@mermaid-js/parser` Langium bundle), `architecture-beta` +1.24 MB (both). The Langium chunk is ~648 KB and paid once, so a second parser-based type is far cheaper than the first.

## Adding a type

1. Add its chunk basename to `KEPT_DIAGRAMS` in `vite.config.ts`. The match is a prefix, so `stateDiagram` also catches `stateDiagram-v2`.
2. Check whether it needs a layout engine beyond dagre, and add that to `KEPT_LAYOUTS`. **`buildEnd` cannot catch this** — it only proves the kept prefixes matched a chunk. `mindmap` is the trap: it resolves `cose-bilkent` through the layout registry at *render* time, so bundling it with dagre alone builds clean and then throws on the first diagram.
3. Add the family's theme variables (below) — a type with none renders off-palette rather than failing.
4. Name it in the Diagrams section of `prompts/tutor.md` and in the type list in `prompts/mermaid-fix.md`. The tutor will not emit a type it has not been told about, and the fixer needs to know which types it may rewrite into.

## Theming

Mermaid runs on its `base` theme with `themeVariables` from `diagramPalette()`. The palette lives in hex CSS variables (`--diagram-*` in `index.css`) rather than the app's oklch tokens, because Mermaid parses colours with khroma, which has no oklch support.

Two things about how the base theme resolves these:

- **Overrides always win.** `Theme.calculate()` applies the override keys, derives everything else, then re-applies the overrides. So a variable Mermaid assigns unconditionally (`innerEndBackground`, `specialStateColor`) is still overridable.
- **`attributeBackgroundColorOdd` / `attributeBackgroundColorEven` are the exception to "unset means derived."** They fall back to a hardcoded `#ffffff` / `#f2f2f2`. Left unset, every ER attribute row is a light band behind dark-mode text.

Diagrams do **not** re-render on a live light/dark switch: the render effect depends on `[source]`, and the theme is toggled imperatively on `documentElement` in `main.tsx`, outside React. A flip leaves the old palette until the card remounts.

## Highlighting the current step

The tutor accents the one node a card is teaching with `classDef focus` plus `class <id> focus` (see `prompts/tutor.md`). It emits a fixed light-mode indigo, because a prompt cannot read a CSS variable; `withFocusStyle` then swaps that line for one built from the live `--diagram-accent` / `--diagram-accent-text` tokens before parsing.

This is done in the diagram source rather than in CSS because **Mermaid inlines classDef styles scoped to the render id** — `#mmd… .focus>*{fill:…!important}`. That ID selector outranks any stylesheet rule the app could write, `!important` or not.

The substitution only applies to `flowchart` / `graph` / `stateDiagram` sources: in `classDiagram`, `class` declares a class instead. Leaving the tutor's own `classDef` line in the prompt means the highlight degrades to a legible indigo if the substitution never fires.

## Failure handling

`MermaidBlock` validates with `mermaid.parse` before rendering. On failure it makes one stateless `fixMermaid` call (`prompts/mermaid-fix.md`, `--no-session-persistence`) and re-parses. If anything in that chain fails — import, repair, parse, render — the diagram is hidden rather than shown as an error. A card must never sit on a loading skeleton, so the skeleton carries `data-segment` to keep keyboard reading's segment order stable while it loads.

This mirrors the guard-and-repair pattern used for unparseable tutor cards; see [claude-backend.md](claude-backend.md).

## Still to document

- Should the subset decision and its measured costs be recorded as an ADR?
- What happens to a diagram that parses but lays out badly (very wide flowcharts) — is `overflow-x` scroll the intended answer?
