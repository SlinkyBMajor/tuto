# Claude backend

All AI runs through the local `claude` CLI, spawned per call from `src/bun/claude.ts`. There is no direct API use.

- **Lesson = session.** The first turn creates a Claude session; later turns pass `--resume <session-id>`. The session id is captured from the `result` line of the CLI output and stored with the lesson, so a resumed lesson continues the same conversation.
- **Speculative prefetch.** After each step card, `src/bun/index.ts` immediately requests the next card in a **forked** session (`--fork-session`). Pressing Continue adopts the fork (usually instant); any other turn runs against the untouched base session and the fork is discarded.
- **Streaming.** Foreground turns use `--output-format stream-json --include-partial-messages`; `runTutorTurnStreaming` reads `content_block_delta` events, extracts a live title/body preview from the partial JSON, and parses the authoritative card from the final `result`. Prefetch turns are non-streaming.
- **Card protocol.** The tutor is instructed to reply with a single JSON object; `parseReply` extracts the card, outline, exercise, and notes routing. System prompts live in `prompts/` and are imported as text.
- **Stateless side-calls.** Answer grading, term explanation, and Mermaid repair are one-shot calls with `--no-session-persistence` (and `--safe-mode` for explain) so they never touch the lesson session or its prefetch fork. Explanation uses the Haiku model; the rest use the default.

## Still to document

- Where is the `claude` binary resolved from, and what happens when it's missing or unauthenticated?
- What are the timeouts and failure/retry behaviors for a turn (e.g. `TURN_TIMEOUT_MS`)?
- What is the exact JSON card schema the tutor must emit, and how are malformed replies handled?
- Which model is used for tutor turns vs side-calls, and why is Haiku chosen for explain?
