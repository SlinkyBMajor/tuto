# Takeaways

The one line worth keeping from a card, shown under it as a small accented panel. Optional and deliberately rare: the panel earns its prominence by not appearing on every card.

Spread across `prompts/features/takeaway.md` (when one exists and what it may say — a card feature, see `card-features.md`), `Card.takeaway` in `src/shared/types.ts`, `parseReply`/`salvageCard` in `src/bun/claude.ts`, `TakeawayNote` in `src/mainview/App.tsx`, and the `takeaway` block of `index.css`.

## Where one comes from

The lesson turn writes it, in the same JSON reply as the card — `"takeaway"` next to `"title"` and `"body"`. There is no second call and no extra token cost beyond the sentence itself.

**The bar is the whole feature.** `prompts/tutor.md` sets it: one sentence of at most 20 words, stating the claim rather than reporting on the card ("Kafka keeps a message after it is read", never "this card explained retention"), never a reworded title, roughly one per outline concept and never two cards running, and step cards only — a question card is not teaching yet and a recap is already a summary. A takeaway on every card is a lesson with no takeaways, which is why the prompt spends more words on when to omit it than on how to write it. `prompts/modes/codebase.md` adds one rule of its own: the takeaway carries the claim, not the citation — the card already names the file.

Nothing enforces the frequency in code, and nothing can: each turn is independent, and the model's own session history is what keeps it honest. The smoke tests check the shape of the takeaways that do arrive (`takeawayProblem` in `scripts/card-prose.ts`: length, one line, no fence, no card reference, not a title restatement, not a report on the lesson) and never require one to be there.

## How it travels

- **Parsed** by `parseLine` — a non-empty string or nothing. Anything else is dropped rather than rendered as an empty panel. Lab mode's `caution` and `cost` are single lines on the same terms, so they share it.
- **Salvaged.** Unlike the structured extras (exercise, outline), a takeaway is a plain string on the card, so `salvageCard` pulls it out of an unparseable reply the same tolerant way it pulls the title and body.
- **Persisted for free.** It is a field on `Card`, and the feed's saved items carry whole cards (`SavedFeedItem`), so nothing in `store.ts` had to change. Lessons saved before takeaways existed simply have none.
- **Into the notes, when the notes are on.** `notesEntry` appends it under the card's body as a pull quote — `> **Key takeaway** — …`. Dormant today: see `NOTES_ENABLED` in `src/bun/lesson-modes.ts`.
- **Into exercise material.** `lessonMaterial` includes it with the card bodies it sends to `regenerateExercise`, so a replacement exercise may fairly blank a term the card only spelled out in the takeaway.

## How it renders

`TakeawayNote` draws a panel under the card: a yellow surface with a yellow edge, the label "Key takeaway" with a bulb icon, and the sentence at body size in a heavier weight.

**Yellow, and the only yellow in the app.** It is deliberately not the marker: the marker means *here is where you are* — the reading position, the blank to fill, the term you selected — and a takeaway is not a position, it is a keepsake. It is also why a lab lesson's caution panel is red rather than amber: a warning that can be mistaken for a keepsake is not a warning (see `lab-mode.md`). The four `--highlight-*` tokens are picked per theme rather than mixed from one value, because a yellow saturated enough to fill a panel with is far too light to read as text, and on a dark card the roles swap entirely. Markdown is rendered with a bare `<Markdown>` and `stripCardRefs`, not `CardMarkdown` — it is one sentence that may carry a name in backticks, and it has no fences, diagrams, or links to resolve.

**A feed item is now a wrapper, not a card.** `data-item-id` moved from the `<UICard>` onto a `<div>` holding the card and its takeaway, because every section coordinate in the app is (item id, section index) — the reading position, the dimming rules in `index.css`, a sticky note's anchor. The click that puts the reading position on a section moved to that wrapper for the same reason. Hover tracking for the add-a-note button stayed on the card itself, so the button never appears beside the takeaway.

**The panel is the section, not the paragraph inside it.** Two things follow, and both are the point:

- The whole panel dims with the rest of the card while another section is being read, instead of staying bright behind faded text.
- Its reading bar, drawn 1.15rem outside its own left edge like every other section's, lands in the same gutter column as the bars inside the card — because the panel is inset by exactly the card's padding (`--card-spacing`, 1.5rem). That inset is also what makes the panel's left edge sit under the card's *text* rather than under the card, which is what reads as "this came from that".

Being the last section of its card, the arrow keys land there last: read the card, land on the takeaway, and the next ArrowDown is Continue.

The tint is `color-mix(in oklab, …)` and not `oklch` — a light card is `oklch(1 0 0)`, whose hue is written as 0 rather than as none, so a polar mix interpolates the marker's 273° towards 0° and the panel comes out pink in light mode. Every other mix in `index.css` is against `transparent`, which is premultiplied and keeps its hue; this is the one that mixes against a real colour.

## Seeing it without a model call

`?demo` carries takeaways on two of the fixture cards (after a code block and after a diagram) and leaves the rest without one, so both states are on screen. `DEMO_NOTES` carries the matching pull quote.
