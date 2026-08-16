# RPC (Bun ↔ WebView)

The Bun main process and the React WebView communicate over Electrobun's typed RPC. The single schema is `src/shared/types.ts` (`TutoRPC`), imported by both sides.

- **Bun handlers** are defined in `src/bun/index.ts` via `BrowserView.defineRPC<TutoRPC>`. Requests include `startLesson`, `sendMessage`, `continueLesson`, `pickProject`, `checkAnswer`, `regenerateExercise`, `explainTerm`, `fixMermaid`, and the persistence set (`saveLesson`, `listLessons`, `resumeLesson`, `deleteLesson`, `getNotes`).
- **`regenerateExercise` carries its own material.** The webview sends the lesson text the replacement exercise must be answerable from, because it owns the feed — the bun process would otherwise have to guess which cards taught the concept. See `claude-backend.md` for the rest of that loop.
- **`startLesson` takes a whole `LessonConfig`** — the mode and everything that mode needs — rather than loose fields, so the wire carries the same union the rest of the app does (see `lesson-modes.md`). `pickProject` opens the OS folder dialog in the Bun process and returns a validated `ProjectRef`; a cancelled dialog is `{ project: null }` with no error.
- **WebView side** is `src/mainview/lib/rpc.ts` (`Electroview.defineRPC`). It exposes `bun` (requests) and `bunSend` (messages), and guards construction so the app still renders in a plain browser (the `?demo` fixtures) where the bridge is absent.
- **Messages (Bun → WebView).** `streamCard` pushes a live `{title, body, activity?}` preview during a streaming turn — `activity` names the file or search a tool-using tutor is busy with; `logToBun` goes the other way for debugging. The WebView subscribes to `streamCard` via `onStreamCard`.
- **What the WebView shows while it waits** is driven entirely by that one message, in three states. Until the outline exists the lesson is still being set up — the app's longest wait — and `components/lesson-planning.tsx` takes the whole feed area, showing the topic, the project, the trail of lookups so far and, past eight seconds, a clock. The moment the card itself starts arriving the streaming preview takes over, because watching a card write itself beats any placeholder. Every later turn gets the small `PendingCard` skeleton. `?demoplanning[=level]` (plus `&demoproject`) holds the planning screen open without a model call.
- **`maxRequestTime` is 900s on both ends**, set to cover the slowest mode's turn plus its repair attempts.
- Request/response types double as the app's contract: `TurnResult` carries the card plus optional `outline`, `exercise`, `notes` routing, and `lessonId`.

## Still to document

- What is the request timeout (`maxRequestTime`) and how are RPC failures surfaced to the user?
- Ordering guarantees between a `streamCard` message stream and the final request response.
- How schema changes to `TutoRPC` are rolled out across the two processes without version skew.
