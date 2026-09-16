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

**The material is context, not the answer set.** It is labelled that way where it is handed over, and `prompts/discuss.md` says the same in more words, because the default behaviour is the opposite: given a block of text and a question, the model answers from the text and starts declining whatever the text is silent about. A thread is usually the learner stepping sideways — comparing what they just read to something else, asking how it looks in another language, chasing an aside — and the margin is the one place a linear lesson is allowed not to be linear. Two rules keep that from becoming invention: "I don't know" means the model does not know it, never that the material is silent; and a claim about a *codebase lesson's own project* still has to come from a file the lesson showed. Everything outside the project is ordinary knowledge and gets answered.

The prompt used to hand the model the phrase "the lesson doesn't cover this, but…" and also tell it never to open with a qualification. It resolved that by opening every single answer with the disclaimer, which made helpful answers read as refusals — and on comparisons it went further and declined outright. Both rules are gone; the disclaimer is now explicitly forbidden.

It is **not** the tutor's session and never touches it. The lesson does not learn that a question was asked, and the tutor prompt says so explicitly, so it cannot write a card that assumes a side conversation happened. That is the trade for a thread costing a small flat amount per message instead of re-sending the whole lesson conversation every time.

`sectionTextOf` reads the passage out of the DOM rather than from the card's markdown, so a code block arrives highlighted-as-seen and a diagram arrives as its rendered labels. Sections that carry chrome — a code block's language label and Copy button, the takeaway's "Key takeaway", a lab task panel's "Run this" and its own Copy button — mark where their words start with `data-section-text`, because a question about a snippet must not arrive asking about `JavaScriptCopy`. A task panel marks the command *and* what to expect, so "what does this do?" arrives with both.

## In the margin

Closed, a thread is a card: the opening question and the start of its answer, both clamped. Open, the same card becomes the conversation and a box to add to it, and **the reading keys stop reaching it** — the window handler ignores anything inside `[data-thread]`. That is the point of the column: it is where you stop reading and talk.

It hands one key back. **On an empty box, ArrowLeft leaves the thread** — the mirror of the ArrowRight that opened it — through the same `onClose` Escape uses, so the discard rule and the reading position come from `closeThread` and nothing new decides them. The test is `draft === ""` and not a trimmed one: with any text in the box the key belongs to the caret again.

Only one thread is open at a time. Opening one scrolls by exactly as much as it takes to fit — and not at all when it already fits, so opening a thread never yanks the lesson under the learner. A thread nobody asked anything in is discarded on close, the same rule an empty note follows.

**Notes and threads share one layer** (`MarginLayer`, extracted from what used to be `StickyLayer`). They are pinned to the same sections, so two columns would leave each with holes where the other's items are and a note would drift from its paragraph. Sorting them together is what keeps everything level with its own section. A note stays note-sized (`--sticky-width`) inside the wider margin a thread asks for.

**Nothing hangs off the end of the lesson.** Sitting level with its section is the rule; finishing where the feed finishes outranks it. Open a thread on the last section of the last card and it is tall, its section is the lowest thing on screen, and there is nothing below to scroll to — so level with its section would leave the conversation dangling past the feed with empty pane beside it. `MarginLayer` clamps each item's wanted position to `feedEnd - height`, which puts that thread back alongside the card it belongs to. Anywhere above the end of the feed the clamp never binds.

**The lesson slides left; it is not squeezed.** `data-margin` on the pane's shell picks the gutter and the margin's width, and every `.reading-column` computes its own position from them. So the empty half of the pane is spent before the passage is: the cards keep their full 52rem and move, and only a pane too narrow to hold both starts taking width off the reading column (never below `--reading-min`, past which the margin is clipped instead).

| `data-margin` | Gutter | Margin | `--column-shift` | Set by |
|---|---|---|---|---|
| — | 0rem | 0rem | 0rem | nothing pinned yet |
| `notes` | 12rem | 11rem | 6rem | a sticky note exists |
| `threads` | 24rem | 22rem | 12rem | a thread exists |
| `thread-open` | 36rem | 34rem | **0rem** | a thread is **open** |

**`--column-shift` is what moves the lesson, not the gutter.** `--column-left` centres the column and its gutter together and then adds the shift back. While reading, the shift is half the gutter, which is exactly what undoes that centring — so **the lesson sits centred on the pane whatever is pinned beside it**, because while you are reading, the lesson is what has the focus. Opening a thread drops the shift to zero, and the column falls back to centring as one block with a 36rem margin. On a wide pane that is a move of roughly 18rem.

Going through the gutter alone cannot do this: `--column-left` halves it, so a gutter grown by 5rem moves the lesson 2.5rem, which reads as nothing. The gutter says how much room the margin needs; the shift says where the lesson stands.

`--column-left` is clamped at both ends — never left of the pane, and never so far right that the margin hangs off it. The upper clamp is what makes the reading position degrade on a narrow pane: the lesson gives up as much of the middle as the margin needs and no more.

Two more things mark the open state, both undone on close. `.feed-list` (the cards, without the margin beside them, which is why the class exists) goes to **0.85 opacity** — faint on purpose, because the sliding is what says the conversation has the floor, and the passage still has to be readable beside the answer. And `.thread[data-open]` sets the conversation at **1.05rem** against the card's ~1.125rem, with more padding and a 30rem log, so an answer reads as material rather than as a footnote; a closed preview keeps its small type, because that one is a glance. `.reading-column` and `.margin-layer` share one 320ms curve so the slide and the growth read as a single movement, and the reduced-motion block at the end of `index.css` zeroes all of it.

**The whole pane moves, not just the feed.** The feed, the practice and notes panels and the key bar all carry `.reading-column` and compute the same numbers from their own width — they are all the width of the shell, so they agree without anything measuring. That is what keeps the app's one left edge intact while the margin opens, and it is why none of them may go back to `mx-auto`: centring a row on its own would centre it *over* its margin rather than beside it. The top bar is the one row that does **not** carry the column — it is chrome pinned to the pane's own edges (see `lesson-chrome.md`), so the column can slide under it.

## The gutter marker

A section with a conversation carries `data-questions="<n>"`, written straight to the DOM like the reading highlight and for the same reason: sections are markdown internals, and threading a count through them would rebuild the markdown tree on every answer. CSS draws it as a pill in the card's right padding.

That is the same strip the two action buttons use, so **a card under the pointer trades its counts for its buttons**. While you are pointing at a card, what you can do there is worth more than what is already there.

## Follow-ups

After the recap, the bar offers **Ask a follow-up**. That is the one place free text still reaches the lesson session: it runs an ordinary turn, and the answer lands in the feed as an ordinary card marked `followUp`, which labels itself *Follow-up* instead of naming a concept. The mark is persisted, so a lesson re-read months later still shows which cards came from the outline and which came from a question.

`lessonEnded` is "the feed contains a recap", not "the last card is a recap" — otherwise answering a follow-up would make the lesson unfinished again and put the Continue button back. `store.listLessons` computes `ended` the same way.

## Seeing it without a model call

`?demo` carries two threads: one that ran to several questions and one single exchange, on different cards, so the stacking, the counts, and the open conversation can all be checked with no RPC bridge.
