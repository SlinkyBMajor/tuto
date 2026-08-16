# The reading surface

How a lesson is read, section by section, and what the learner can attach to a section. Lives in `src/mainview/App.tsx` (position and keys), `components/card-markdown.tsx` (what a section is), `components/sticky-notes.tsx` (notes), and the `keyboard reading` / `sticky notes` blocks of `index.css`.

## Sections

A **section** is one `[data-segment]` element inside a feed item: a paragraph, a list, a code block, a diagram, or the card's takeaway panel. Markdown elements are tagged by `STATIC_COMPONENTS`; code blocks and diagrams tag themselves, including the diagram's loading skeleton — an async render that appeared late would otherwise shift every index below it.

Sections are read out of the DOM (`segmentsOf`), never tracked in React state, so markdown internals stay presentation-only. A section is addressed by a pair: the feed item's id and the section's index within that item, in DOM order.

**`data-item-id` sits on a wrapper, not on the card.** A card with a takeaway renders as two elements — the card and the panel under it — and both are sections of the same feed item, so the id that addresses them has to be above both. The takeaway is always the item's last section, which is what makes the arrow keys end a card on it before the next ArrowDown becomes Continue. See `takeaways.md` for why the panel itself carries `[data-segment]` rather than the paragraph inside it.

## The reading position

One section at a time is active. ArrowDown and ArrowUp walk the whole feed, crossing card boundaries in both directions; past the last section of the newest card, ArrowDown acts as Continue. Clicking a section puts the position there. Escape leaves reading mode.

The active section keeps full contrast and gets a marker bar outside its left edge; the card's other sections dim. Because that bar is drawn outside the section's own box, **no element carrying `[data-segment]` may set `overflow`** — put the scroll container inside instead (see `.mermaid-diagram__scroll`).

The class is applied imperatively rather than rendered, for the same reason the sections are queried: it keeps the markdown tree from re-rendering as the position moves.

## Sticky notes

A note is pinned to one section. **ArrowLeft** pins one to the section being read; pointing at a section shows the same thing as a button in the card's right padding, next to the button that asks a question about it (**ArrowRight** — see `questions.md`). Both call `addSticky` and focus the new note. Inside a note, Cmd+Enter (or Escape) hands the reading position back to its section — that is also why the window-level key handler ignores anything inside `[data-sticky]` (and inside `[data-thread]`).

A note left empty is removed on blur and never saved: an empty note is a slip, not a note.

**They live in the margin**, shared with question threads. Each wants to sit level with its section, and two on neighbouring sections would overlap, so `MarginLayer` lays them out together: sort by where each wants to be, walk down, push any that would collide below the one before it. Positions are written straight to the DOM as transforms, and re-measured when the notes change, when the feed's own height changes (a diagram or code block finishing its async render moves every section below it), and when a note's textarea grows.

**A note's first placement is instant; only later ones transition.** A note's untransformed position is the top of the layer — the top of the feed — so a transition on the first placement is a note sliding down the whole lesson, and for the 180ms it runs the note genuinely *is* up there. Focus follows the element, so a new note is focused with `preventScroll` as well: two independent reasons the learner would otherwise be thrown back to the first card the moment they added a note.

**The column gives up width for them.** The feed column shares its left edge with the header and the composer — the app has one left edge — but it is the only one that narrows on the right, and only once a lesson has notes (`.feed-column[data-stickies]`). Below `--reading-min` the passage stops being readable, so past that the notes are clipped instead and the window is what has to give. The scroll pane sets `overflow-x: clip` so that clipping never turns into a sideways scrollbar.

**The add button lives on the card, not in it.** Two constraints put it there. A card clips its own overflow, so the button cannot hang past the card's edge — it sits in the right padding strip, the one place inside a card that never lands on a word. And it must not be a child of the card *body*: prose zeroes the margin under its own last child, so a button appearing there hands that margin back and grows the card by a line as the pointer arrives. For the same reason hover is tracked on the whole card rather than on the body — the pointer has to leave the text to reach the button, so anything that is not a section leaves the last one standing and only leaving the card clears it.

**They are anchored by position on disk.** Feed item ids are per-session counters, so a saved note carries the card's index among the feed's cards plus the section index (`SavedSticky`). Cards are only ever appended, which is what makes that stable; resume maps the index back to the id that card was given (`resumeLesson`). A note pointing past the end of the feed is dropped rather than shown against the wrong card.

Colours come from a fixed pool (`STICKY_COLORS`), picked at random when a note is created and stored by name, so a note keeps its identity across themes. The values are theme tokens: paper in light mode, a tinted card in dark, because a real post-it yellow on a dark canvas glares.
