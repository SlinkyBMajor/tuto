# Persistence

Lessons are stored as plain files on disk — no database. Layout and paths are defined in `src/bun/paths.ts`; the store is `src/bun/store.ts` and the notes document is `src/bun/notes.ts`.

- **One folder per lesson** under the OS app-data dir: `~/Library/Application Support/tuto/lessons/<id>/` (`.tuto/` on non-mac). The id is `<date>-<topic-slug>-<random>`.
- **`lesson.json`** — the display snapshot the WebView sends each turn (feed, outline, current concept, exercises and their answered state) merged with bun-owned metadata (Claude session id, language, timestamps). The WebView owns display state; the Bun process owns all file I/O.
- **`notes.md`** — the rendered structured notes (human-readable, greppable).
- **`notes.json`** — the notes section tree, so a resumed lesson keeps filing new material into the right sections.
- **Ownership split.** `saveLesson` writes after each turn/answer; `listLessons` powers the home screen; `resumeLesson` restores the session id and notes tree, then the WebView rehydrates from the record.

## Still to document

- What happens on a corrupt or partially-written `lesson.json` / `notes.json` (recovery, schema versioning)?
- Is there any migration path if the snapshot or notes-tree shape changes?
- Are writes atomic, or can a crash mid-write leave a lesson unopenable?
- Retention — is anything ever cleaned up, or do lessons accumulate indefinitely?
