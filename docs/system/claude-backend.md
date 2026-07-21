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
- **Card-protocol failure** (`CardProtocolError` — no JSON object, invalid JSON, or a reply that doesn't match the card shape) — the reply *is* in the session, so naively re-sending the original message would teach the NEXT step and silently skip this one. The app defends against that on two axes: it **forks** the turn so a skip can't happen, and it walks a **recovery ladder** so the failure rarely surfaces at all.

**Forking keeps the lesson session recoverable.** Every resumed turn — the foreground streaming turn (`tutorTurn` passes `fork: Boolean(lessonSessionId)`) as well as the speculative prefetch — runs with `--fork-session`, and `lessonSessionId` advances (in `finishTurn`) only once a usable card is adopted. A reply the app can't use therefore advances only a throwaway fork; the lesson session stays where it was, so the error panel's **Try again** re-teaches the same step instead of skipping ahead. The first turn of a lesson has no session to fork and needs none — there is no prior step to skip.

**The recovery ladder** — each rung is reached only when the previous one fails:

1. **Tolerant parse** — `parseReply` retries `JSON.parse` after re-escaping raw control characters inside string literals (`escapeControlCharsInStrings`). An unescaped newline in the body is the most common break, and this recovers the whole card — outline, exercise, and notes routing included — with no model round-trip. It cannot fix an unescaped quote or a truncated reply, which fall through.
2. **Repair** — `repairCard` resumes the (forked) session and asks it to re-send the same card as valid JSON, up to `MAX_CARD_REPAIRS` times. It targets the session id the failed turn returned, so a prefetch fork repairs itself and the base session stays untouched.
3. **Salvage** — when repairs are exhausted, `salvageCard` reads the title and body straight out of the raw reply (the same tolerant reader the streaming preview uses) and that best-effort card is adopted. The learner keeps the content they watched stream in, and because the session genuinely taught the step, the next Continue still advances correctly. Structured extras (notes routing, exercise, outline) can't be recovered this way and are dropped, so a salvaged step is not filed into the notes document.
4. **Surfaced error** — only a reply too broken to yield even a title and body throws. The raw reply is logged in full (the only remaining copy of what was taught) and the turn becomes an error panel in the feed; forking is what makes retrying that panel safe.

This mirrors the guard-and-repair pattern used for broken Mermaid diagrams, which validates with `mermaid.parse` and silently asks for one fix before hiding the diagram. The tolerant-parse and salvage rungs are covered by `scripts/card-parse-test.ts` (`pnpm run test:parse`), a token-free regression test over crafted malformed replies.

## Still to document

- Where is the `claude` binary resolved from, and what happens when it's missing or unauthenticated?
- What is the exact JSON card schema the tutor must emit?
- Which model is used for tutor turns vs side-calls, and why is Haiku chosen for explain?
