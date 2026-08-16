# Persistence

Lessons are stored as plain files on disk — no database. Layout and paths are defined in `src/bun/paths.ts`; the store is `src/bun/store.ts` and the notes document is `src/bun/notes.ts`.

- **One folder per lesson** under the OS app-data dir: `~/Library/Application Support/tuto/lessons/<id>/` (`.tuto/` on non-mac). The id is `<date>-<topic-slug>-<random>`.
- **`lesson.json`** — the display snapshot the WebView sends each turn (feed, outline, current concept, exercises and their answered state, sticky notes) merged with bun-owned metadata (Claude session id, the lesson's `config`, timestamps). The WebView owns display state; the Bun process owns all file I/O. `saveLesson` spreads the snapshot, so a new display field reaches disk by being added to `LessonSnapshot` — and has to be optional, since records written before it exists will not carry it.
- **Sticky notes and question threads are saved by position, not by id.** Each names the card's index among the feed's cards and the section's index within it (`SavedSticky`, `SavedThread`); the WebView's item ids are counters handed out on load and mean nothing on disk. See `reading.md` and `questions.md`. A thread persists only what was said — in-flight and failed state is not written — and one with nothing in it is dropped, like an empty note.
- **`config` is how the lesson was started** — its mode, for a codebase lesson the project it reads (see `lesson-modes.md`), and for a lesson taken as groundwork the `goal` it leads back to (see `prerequisites.md`). Because the goal lives here rather than in the tutor's head, a resumed detour still offers the way back. Records written before modes existed have no `config` and a top-level `language`; `store.configOf` reads those as topic lessons, so old lessons resume unchanged. Metadata merges over what is already on disk, so a save for a lesson that is no longer the open one cannot blank out its session id.
- **`notes.md`** — the rendered structured notes (human-readable, greppable).
- **`notes.json`** — the notes section tree, so a resumed lesson keeps filing new material into the right sections.
- **Ownership split.** `saveLesson` writes after each turn/answer; `listLessons` powers the home screen; `resumeLesson` restores the session id and notes tree, then the WebView rehydrates from the record.

## Still to document

- What happens on a corrupt or partially-written `lesson.json` / `notes.json` (recovery, schema versioning)?
- Is there any migration path if the snapshot or notes-tree shape changes?
- Are writes atomic, or can a crash mid-write leave a lesson unopenable?
- Retention — is anything ever cleaned up, or do lessons accumulate indefinitely?
