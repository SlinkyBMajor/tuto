# The lesson's chrome

The furniture around the feed: the rail, the top bar, and the progress pill that stands in for what used to be a docked sidebar. Lives in `src/mainview/components/app-rail.tsx`, `components/lesson-progress.tsx`, and the `<header>` in `App.tsx`.

## The pill, not a sidebar

Everything *about* the lesson — the topic, the project it is taught from, the destination, the progress, the stats, and the outline as a navigable list — is folded into one pill in the top-left corner, and opens from it as a floating panel.

**Why it stopped being a column.** The margin beside the feed wants 24rem the moment a question thread opens (see `questions.md`). A permanent 20rem panel meant the reading column paid for that on any normal window — at 1440px the cards were squeezed to about 42rem of their 52rem. What the column showed at all times was a progress bar and a list you consult a few times a lesson, so the bar became a ring you can read at a glance, the current chapter stayed spelled out beside it, and the list moved one click away.

**The panel floats; it does not push.** A lesson you are mid-sentence in must not slide sideways because you wanted to check how far along you are. It is a Base UI popover, so click-away and Esc close it, and selecting a concept closes it too — that selection is a jump into the feed, and the panel has no reason to survive it.

**The stats are per mode where they need to be.** `LessonStats` always carries cards and exercises; `stepsDone`/`stepsTotal` appear only once some card in the lesson has a task, which turns the row into three figures for a lab lesson and leaves it at two everywhere else (see `lab-mode.md`).

**What the collapsed pill says**: the ring (`covered / total`, green and full once the lesson ends), the lesson topic, and the current chapter under it. A finished lesson reads *Lesson complete* rather than naming the last concept it taught, which beside a full ring would read as being stuck on it. The destination of a groundwork lesson sits beside the pill rather than inside the panel — see `prerequisites.md`.

## The top bar is chrome

The bar holding the pill and the tabs is **the one row in the pane that does not carry `.reading-column`**. It is pinned to the pane's own edges so the reading column and its margin can slide left underneath it. Every other row — feed, practice, notes, key bar — still shares the column, and still must (see `questions.md`).

There is no title row: the pill names the lesson and the chapter, and the selected tab names the panel. Nothing in the chrome says the same thing twice.
