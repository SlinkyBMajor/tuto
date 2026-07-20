# Claude backend

All AI runs through the local `claude` CLI, spawned per call from `src/bun/claude.ts`. There is no direct API use.

- **Lesson = session.** The first turn creates a Claude session; later turns pass `--resume <session-id>`. The session id is captured from the `result` line of the CLI output and stored with the lesson, so a resumed lesson continues the same conversation.
- **Speculative prefetch.** After each step card, `src/bun/index.ts` immediately requests the next card in a **forked** session (`--fork-session`). Pressing Continue adopts the fork (usually instant); any other turn runs against the untouched base session and the fork is discarded.
- **Streaming.** Foreground turns use `--output-format stream-json --include-partial-messages`; `runTutorTurnStreaming` reads `content_block_delta` events, extracts a live title/body preview from the partial JSON, and parses the authoritative card from the final `result`. Prefetch turns are non-streaming.
- **Card protocol.** The tutor is instructed to reply with a single JSON object; `parseReply` extracts the card, outline, exercise, and notes routing. System prompts live in `prompts/` and are imported as text.
- **Stateless side-calls.** Answer grading, term explanation, and Mermaid repair are one-shot calls with `--no-session-persistence` (and `--safe-mode` for explain) so they never touch the lesson session or its prefetch fork. Explanation uses the Haiku model; the rest use the default.

## Failure handling

Two failure classes, deliberately handled differently, because `--resume` appends to the session in place: once a reply exists, the turn is committed whether or not the app could use it.

- **Transport failure** (non-zero exit, `is_error`, no JSON envelope) — the call never got far enough to persist an assistant message, so `withTransportRetry` re-runs it up to `MAX_TRANSPORT_RETRIES` times with exponential backoff. **Timeouts are excluded**: the model may have finished and persisted in the moment before `TURN_TIMEOUT_MS` killed it, and re-running would teach the step twice.
- **Card-protocol failure** (`CardProtocolError` — no JSON object, invalid JSON, or a reply that doesn't match the card shape) — the reply *is* in the session, so retrying the original message would teach the NEXT step and silently skip this one. Instead `repairCard` resumes that same session and asks it to re-send the same card as valid JSON, up to `MAX_CARD_REPAIRS` times. Verified behaviour: the model re-sends an identical title and body, and a later Continue still advances normally.

Repair targets the session id the failed turn returned, so a prefetch fork repairs itself and leaves the base session untouched. When repairs are exhausted the raw reply is logged in full — the session has moved on, so that log is the only remaining copy of what was taught — and the turn surfaces as an error panel in the feed. The card is never persisted to `lesson.json` and never filed into the notes document.

This mirrors the guard-and-repair pattern used for broken Mermaid diagrams, which validates with `mermaid.parse` and silently asks for one fix before hiding the diagram.

## Still to document

- Where is the `claude` binary resolved from, and what happens when it's missing or unauthenticated?
- What is the exact JSON card schema the tutor must emit?
- Which model is used for tutor turns vs side-calls, and why is Haiku chosen for explain?
