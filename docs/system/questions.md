# Asking questions

A lesson has no chat box. A question about the material belongs beside the passage that raised it, not in a box at the bottom that has forgotten which one that was — so questions hang off sections as **threads** in the margin, and free text reaches the lesson itself only once, at the end, as a **follow-up**.

Lives in `src/mainview/components/question-threads.tsx` (the cards), `components/margin-layer.tsx` (where they sit), `discussSection` in `src/bun/claude.ts` with `prompts/discuss.md`, and the thread state and keys in `App.tsx`.

## The two gestures

On the section you are reading — or the one under the pointer, which shows the same pair of buttons in the card's right padding:

| | |
|---|---|
| **→** | ask about this section (opens its thread) |
| **←** | pin a sticky note to it |

The bottom bar says so. It is where the composer used to be, and it spends that width on the key legend now, because none of these keys announce themselves.

**One thread per section, always.** A second conversation beside the same paragraph would sit on top of the first, and "what I asked about this passage" is one thread of thought however many questions went into it. `openQuestion` therefore opens the existing thread rather than starting another. Several threads on one *card* is the normal case — that is what the stacking in the margin is for.

## What a thread knows

`askAboutSection` is a stateless side-call, so everything the answer is built from goes out with the question: the lesson topic, every card read so far (`lessonMaterial`, the same flattening exercise regeneration uses), the card's title, the section's own words, and the thread's earlier turns. The webview owns all of it; the bun process holds nothing.

It is **not** the tutor's session and never touches it. The lesson does not learn that a question was asked, and the tutor prompt says so explicitly, so it cannot write a card that assumes a side conversation happened. That is the trade for a thread costing a small flat amount per message instead of re-sending the whole lesson conversation every time.

`sectionTextOf` reads the passage out of the DOM rather than from the card's markdown, so a code block arrives highlighted-as-seen and a diagram arrives as its rendered labels. Sections that carry chrome — a code block's language label and Copy button, the takeaway's "Key takeaway" — mark where their words start with `data-section-text`, because a question about a snippet must not arrive asking about `JavaScriptCopy`.

## In the margin

Closed, a thread is a card: the opening question and the start of its answer, both clamped. Open, the same card becomes the conversation and a box to add to it, and **the reading keys stop reaching it** — the window handler ignores anything inside `[data-thread]`. That is the point of the column: it is where you stop reading and talk.

Only one thread is open at a time. Opening one scrolls by exactly as much as it takes to fit — and not at all when it already fits, so opening a thread never yanks the lesson under the learner. A thread nobody asked anything in is discarded on close, the same rule an empty note follows.

**Notes and threads share one layer** (`MarginLayer`, extracted from what used to be `StickyLayer`). They are pinned to the same sections, so two columns would leave each with holes where the other's items are and a note would drift from its paragraph. Sorting them together is what keeps everything level with its own section. A note stays note-sized (`--sticky-width`) inside the wider margin a thread asks for.

**The column gives up width for whichever is out there** — `data-margin="notes"` or `"threads"` on `.feed-column`, 12rem or 24rem. The width subtracts `--column-left` as well as the gutter: the column's left edge is fixed to the header's, so the room actually available on the right is the pane minus that offset. Subtracting only the gutter leaves the margin hanging past the pane, where the scroll pane clips it — a thread cut in half down its right side.

## The gutter marker

A section with a conversation carries `data-questions="<n>"`, written straight to the DOM like the reading highlight and for the same reason: sections are markdown internals, and threading a count through them would rebuild the markdown tree on every answer. CSS draws it as a pill in the card's right padding.

That is the same strip the two action buttons use, so **a card under the pointer trades its counts for its buttons**. While you are pointing at a card, what you can do there is worth more than what is already there.

## Follow-ups

After the recap, the bar offers **Ask a follow-up**. That is the one place free text still reaches the lesson session: it runs an ordinary turn, and the answer lands in the feed as an ordinary card marked `followUp`, which labels itself *Follow-up* instead of naming a concept. The mark is persisted, so a lesson re-read months later still shows which cards came from the outline and which came from a question.

`lessonEnded` is "the feed contains a recap", not "the last card is a recap" — otherwise answering a follow-up would make the lesson unfinished again and put the Continue button back. `store.listLessons` computes `ended` the same way.

## Seeing it without a model call

`?demo` carries two threads: one that ran to several questions and one single exchange, on different cards, so the stacking, the counts, and the open conversation can all be checked with no RPC bridge.
