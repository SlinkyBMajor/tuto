# Takeaways

The one line worth keeping from a card, shown under it as a small accented panel and filed into the notes. Optional and deliberately rare: the panel earns its prominence by not appearing on every card.

Spread across `prompts/tutor.md` (when one exists and what it may say), `Card.takeaway` in `src/shared/types.ts`, `parseReply`/`salvageCard` in `src/bun/claude.ts`, `notesEntry` in `src/bun/index.ts`, `TakeawayNote` in `src/mainview/App.tsx`, and the `takeaway` block of `index.css`.

## Where one comes from

The lesson turn writes it, in the same JSON reply as the card — `"takeaway"` next to `"title"` and `"body"`. There is no second call and no extra token cost beyond the sentence itself.

**The bar is the whole feature.** `prompts/tutor.md` sets it: one sentence of at most 20 words, stating the claim rather than reporting on the card ("Kafka keeps a message after it is read", never "this card explained retention"), never a reworded title, roughly one per outline concept and never two cards running, and step cards only — a question card is not teaching yet and a recap is already a summary. A takeaway on every card is a lesson with no takeaways, which is why the prompt spends more words on when to omit it than on how to write it. `prompts/modes/codebase.md` adds one rule of its own: the takeaway carries the claim, not the citation — the card already names the file.

Nothing enforces the frequency in code, and nothing can: each turn is independent, and the model's own session history is what keeps it honest. The smoke tests check the shape of the takeaways that do arrive (`takeawayProblem` in `scripts/card-prose.ts`: length, one line, no fence, no card reference, not a title restatement, not a report on the lesson) and never require one to be there.

## How it travels

- **Parsed** by `parseTakeaway` — a non-empty string or nothing. Anything else is dropped rather than rendered as an empty panel.
- **Salvaged.** Unlike the structured extras (notes routing, exercise, outline), a takeaway is a plain string on the card, so `salvageCard` pulls it out of an unparseable reply the same tolerant way it pulls the title and body. A salvaged card keeps its takeaway on screen but still files nothing into the notes — it has no section path to file under.
- **Persisted for free.** It is a field on `Card`, and the feed's saved items carry whole cards (`SavedFeedItem`), so nothing in `store.ts` had to change. Lessons saved before takeaways existed simply have none.
- **Into the notes.** `notesEntry` appends it under the card's body as a pull quote — `> **Key takeaway** — …` — which the notes panel already styles with a marker left border. Card references are flattened on the way in, like the body's.
- **Into exercise material.** `lessonMaterial` includes it with the card bodies it sends to `regenerateExercise`, so a replacement exercise may fairly blank a term the card only spelled out in the takeaway.

## How it renders

`TakeawayNote` draws a panel under the card: a marker-tinted surface with a marker ring, the label "Key takeaway" with a bulb icon, and the sentence at body size in a heavier weight. Markdown is rendered with a bare `<Markdown>` and `stripCardRefs`, not `CardMarkdown` — it is one sentence that may carry a name in backticks, and it has no fences, diagrams, or links to resolve.

**A feed item is now a wrapper, not a card.** `data-item-id` moved from the `<UICard>` onto a `<div>` holding the card and its takeaway, because every section coordinate in the app is (item id, section index) — the reading position, the dimming rules in `index.css`, a sticky note's anchor. The click that puts the reading position on a section moved to that wrapper for the same reason. Hover tracking for the add-a-note button stayed on the card itself, so the button never appears beside the takeaway.

**The panel is the section, not the paragraph inside it.** Two things follow, and both are the point:

- The whole panel dims with the rest of the card while another section is being read, instead of staying bright behind faded text.
- Its reading bar, drawn 1.15rem outside its own left edge like every other section's, lands in the same gutter column as the bars inside the card — because the panel is inset by exactly the card's padding (`--card-spacing`, 1.5rem). That inset is also what makes the panel's left edge sit under the card's *text* rather than under the card, which is what reads as "this came from that".

Being the last section of its card, the arrow keys land there last: read the card, land on the takeaway, and the next ArrowDown is Continue.

The tint is `color-mix(in oklab, …)` and not `oklch` — a light card is `oklch(1 0 0)`, whose hue is written as 0 rather than as none, so a polar mix interpolates the marker's 273° towards 0° and the panel comes out pink in light mode. Every other mix in `index.css` is against `transparent`, which is premultiplied and keeps its hue; this is the one that mixes against a real colour.

## Seeing it without a model call

`?demo` carries takeaways on two of the fixture cards (after a code block and after a diagram) and leaves the rest without one, so both states are on screen. `DEMO_NOTES` carries the matching pull quote.
