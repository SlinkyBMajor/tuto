# RPC (Bun ↔ WebView)

The Bun main process and the React WebView communicate over Electrobun's typed RPC. The single schema is `src/shared/types.ts` (`TutoRPC`), imported by both sides.

- **Bun handlers** are defined in `src/bun/index.ts` via `BrowserView.defineRPC<TutoRPC>`. Requests include `startLesson`, `sendMessage`, `continueLesson`, `checkAnswer`, `explainTerm`, `fixMermaid`, and the persistence set (`saveLesson`, `listLessons`, `resumeLesson`, `deleteLesson`, `getNotes`).
- **WebView side** is `src/mainview/lib/rpc.ts` (`Electroview.defineRPC`). It exposes `bun` (requests) and `bunSend` (messages), and guards construction so the app still renders in a plain browser (the `?demo` fixtures) where the bridge is absent.
- **Messages (Bun → WebView).** `streamCard` pushes a live `{title, body}` preview during a streaming turn; `logToBun` goes the other way for debugging. The WebView subscribes to `streamCard` via `onStreamCard`.
- Request/response types double as the app's contract: `TurnResult` carries the card plus optional `outline`, `exercise`, `notes` routing, and `lessonId`.

## Still to document

- What is the request timeout (`maxRequestTime`) and how are RPC failures surfaced to the user?
- Ordering guarantees between a `streamCard` message stream and the final request response.
- How schema changes to `TutoRPC` are rolled out across the two processes without version skew.
