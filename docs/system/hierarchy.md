# The hierarchy so far

Some subjects are a set of things that live inside one another — Pulumi's projects, stacks and resources; a Kubernetes cluster, node, pod, container. A learner meeting those one card at a time can know every word and still not be able to say which contains which, and that, not the definitions, is what they are missing. So a card that names a new rung can carry the whole picture with it.

`Hierarchy` in `src/shared/types.ts`, the bar in `prompts/tutor.md` ("The hierarchy so far"), `parseHierarchy` in `src/bun/claude.ts`, `HierarchyNote` in `src/mainview/components/hierarchy.tsx`, and the `hierarchy` block of `index.css`.

## The shape

A flat list of rungs, each with a `name`, a containment `depth`, and an optional `note` — plus `current`, the rung this card just taught.

**Flat with an explicit depth, not nested JSON.** Nested structures are the thing models get wrong most reliably, and the rendering wants a flat list anyway: the indent is `calc(var(--depth) * 1.15rem)` on each row, and a tree of nested lists would produce the same picture with far more to go wrong. Depth also expresses siblings — two rungs at the same depth live inside the same parent — so it describes a tree, not only a chain.

**Sent whole every time, never as a diff.** Nothing in the app accumulates it, exactly like the outline. A hierarchy arriving without its outer rungs is a hierarchy that has lost them.

`parseHierarchy` treats it as untrusted: nameless rungs are dropped, depth is clamped to 0–5 (it drives an indent, and a rung claiming depth 40 would walk the panel off its own right edge), the list is cut at `MAX_HIERARCHY_LEVELS`, and fewer than two surviving rungs is not a hierarchy at all.

## The bar

The prompt asks one question: can you say *"a B lives inside an A"* and have it be true? Things that merely relate — a client and a server, a producer and a consumer — are not a hierarchy, and a diagram in the card body says that better.

The other half of the bar is frequency. It goes on the card that **adds** a rung, not on every card after it; a lesson that redraws the same tree six times has stopped saying anything with it. Only rungs already taught appear — it is "so far", so a rung the learner has not met is a spoiler, not a map.

Checked against the real model: a Pulumi lesson drew it once, on the card that introduced the stack (`Project → Stack`, current `Stack`), and a REST API lesson — peers, not containment — never drew one.

## How it renders

A neutral panel under the card, inset to the card's own padding like the takeaway, so its left edge lands under the card's text and its reading bar lands in the same gutter column as every other section's. It is a reading section in its own right, so the arrow keys land on it and it dims with the rest of the card.

**Neutral on purpose.** The app has two accents and this uses neither for its surface: the takeaway's yellow means *keep this*, the marker means *you are here*. A hierarchy is the lesson's furniture — a map you glance at. Only `current` is picked out, in the marker, because that genuinely is a position.

The connectors are drawn from two borders on a `::before` — a corner box sitting in the indent the rung's depth bought. That is what makes an indented list read as a tree.

**A card with a hierarchy usually has no takeaway.** The prompt says so; the render handles both anyway, structure first and the line to keep second — the map tells you where you are, the takeaway is what you leave with.

## Elsewhere

It files into the notes as a nested markdown list under a bold heading (`hierarchyMarkdown`). The feed needs connectors drawn; a markdown document does not, because an indented list already *is* how a hierarchy is written down.

`?demo` carries one on the message-flow fixture card (cluster → topic → partition → message, current `Topic`), on a card that also has a takeaway, so the two panels can be seen together.
