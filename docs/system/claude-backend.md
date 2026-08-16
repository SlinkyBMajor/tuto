# Claude backend

All AI runs through the local `claude` CLI, spawned per call from `src/bun/claude.ts`. There is no direct API use.

- **Lesson = session.** The first turn creates a Claude session; later turns pass `--resume <session-id>`. The session id is captured from the `result` line of the CLI output and stored with the lesson, so a resumed lesson continues the same conversation.
- **Runtime per lesson.** How a turn is spawned — system prompt, tools, working directory, timeout — comes from a `TutorRuntime`, built once when the lesson starts from its mode (`src/bun/lesson-modes.ts`, and see `lesson-modes.md`). `claude.ts` runs turns without knowing what kinds of lesson exist. A lesson taught from a project gets read-only tools and runs in that project's folder; a topic lesson gets `--tools ""` as before.
- **Speculative prefetch.** After each step card, `src/bun/index.ts` immediately requests the next card in a **forked** session (`--fork-session`). Pressing Continue adopts the fork (usually instant); any other turn runs against the untouched base session and the fork is discarded.
- **Streaming.** Foreground turns use `--output-format stream-json --include-partial-messages`; `runTutorTurnStreaming` reads `content_block_delta` events, extracts a live title/body preview from the partial JSON, and parses the authoritative card from the final `result`. When the mode has tools it also reads `tool_use` blocks off the `assistant` events and pushes what the tutor is looking at, and drops accumulated text on a tool call — the card is what comes after the last lookup. Prefetch turns are non-streaming.
- **Card protocol.** The tutor is instructed to reply with a single JSON object; `parseReply` extracts the card, outline, exercise, takeaway, and notes routing. Prompts live in `prompts/` and are imported as text; a lesson's system prompt is the core `tutor.md` plus its mode's section plus learner preferences. A card may also carry a **takeaway** — one line worth keeping, written in the same reply at no extra call; see `takeaways.md`.
- **Hermetic, always.** `HERMETIC_ARGS` (`--safe-mode --strict-mcp-config`) goes into every command line the app builds — both `tutorArgs` and `runSideCall` splat it in, unconditionally. Nothing from the machine's install (CLAUDE.md, skills, plugins, hooks, MCP servers, custom agents, output styles) reaches any call. It is not a runtime field a mode can opt out of, because it isn't a real choice. Note `--bare` is *not* an alternative: it also disables OAuth/keychain auth, which this app depends on.
- **Stateless side-calls.** Answer grading, term explanation, Mermaid repair, exercise regeneration, and the section conversations (`questions.md`) all go through one helper, `runSideCall`, so they can't drift apart. On top of `HERMETIC_ARGS` it pins the same footing for each: `--no-session-persistence` (never touches the lesson session or its prefetch fork), `--tools ""`, a 60s timeout, and `MAX_THINKING_TOKENS=0`. Only the model is overridable, and only regeneration overrides it. See **Model and effort** below for why.

## Model and effort

Nothing is left to the machine's default tier — what a call costs should be a property of the code, not of whatever the developer last set `claude` to.

| Call | Model | Thinking | Why |
|------|-------|----------|-----|
| Topic lesson turn | machine default | on | Teaching from the model's own knowledge |
| Codebase lesson turn | `claude-sonnet-5` (pinned in `lesson-modes.ts`) | on | Reads its way to an answer; several tool results per card |
| Grade, explain, Mermaid fix | `claude-haiku-4-5-20251001` | **off** | Small, bounded, judgement-light jobs |
| Exercise regeneration | `claude-sonnet-5` | **off** | Writes teaching material rather than judging it |
| Section conversation | `claude-sonnet-5` | **off** | Same — teaching prose, written against the lesson it was handed |

Three of the four side-calls are judgement-light by construction: grading is handed the expected answer rather than working the problem out, Mermaid repair is handed the parser error, and explanation is a lookup in a context that is already on screen. The teaching judgement lives in the lesson turn.

**The two that write rather than judge take the higher tier, and only the tier.** Regeneration authors an exercise from the lesson's own cards, and a section conversation answers a question about a passage — both are the job a lesson turn does, so both run on Sonnet. Thinking stays off with the rest: the rules are spelled out in their prompts and the material is in the prompt too, so reasoning tokens buy little — and the learner waits through every one of them, with the exercise card blocked or the thread showing a skeleton.

**Thinking off is the bigger lever, by a wide margin.** Measured on one grading call, Haiku spent ~875 output tokens and 12.7s with thinking on, versus ~76 tokens and 4.4s with `MAX_THINKING_TOKENS=0` — same verdict, same quality of explanation. The tier alone was nearly a wash (Haiku thinking freely was *slower* than Opus at `--effort low`, because output tokens dominate the wall clock on a call this small). The env var is scoped to `runSideCall` via `spawnClaude`'s `env` option; lesson turns are untouched and still think.

This matters because these are the calls a learner waits on with the UI blocked — mid-exercise, or on a term they just highlighted — where latency is felt directly, unlike a lesson turn that streams as it writes and is often prefetched anyway.

## Exercises

An exercise is a snippet with exactly one `____` blank, written by the lesson turn alongside the card that completes a concept. Two things keep them answerable.

**The blank has to be code.** The failure this app kept producing was a blank inside a *comment* — `# v1 sits ____ to v2` (closer), `# the model replies "____"` (I don't know). The learner is then guessing the tutor's wording, any English word looks plausible, and one of those answers collided with the panel's own "I don't know" button. `prompts/tutor.md` now requires the blank to replace a token the learner would type — a parameter name, an argument value, a keyword, a config value — and says what to do when a concept looks like it has no line to type: blank the line that carries it (grounding lives in a prompt string, so blank a word of the instruction) rather than the prose about it.

**A learner can reject one.** Every exercise card carries a **New question** button. It sends the rejected exercise plus the lesson material for its concept to `regenerateExercise`, which writes a different one on the same concept. The material comes from the *webview* — it holds the cards, so it sends the bodies of the ones that taught that concept (card references flattened), falling back to the whole lesson when the exercise names no concept. The bun process never has to guess which cards taught what.

`blankIsInsideComment` guards the reply mechanically: a blank that lands after a `#` or `//` on its own line earns one re-ask with the fault named. A second offender is *kept* rather than surfaced as an error — a mediocre exercise the learner can reject again beats a card showing a failure message. The check is deliberately conservative (line comments only, matched at a line start or after whitespace so a URL's `//` and a shell flag don't trip it): a false positive costs one extra call and nothing else.

`pnpm run smoke:exercise` runs the whole path against the real model, using a real failed exercise from a saved lesson as its fixture.

## Failure handling

Two failure classes, deliberately handled differently, because `--resume` appends to the session in place: once a reply exists, the turn is committed whether or not the app could use it.

- **Transport failure** (non-zero exit, `is_error`, no JSON envelope) — the call never got far enough to persist an assistant message, so `withTransportRetry` re-runs it up to `MAX_TRANSPORT_RETRIES` times with exponential backoff. **Timeouts are excluded**: the model may have finished and persisted in the moment before `TURN_TIMEOUT_MS` killed it, and re-running would teach the step twice.
- **Card-protocol failure** (`CardProtocolError` — no JSON object, invalid JSON, or a reply that doesn't match the card shape) — the reply *is* in the session, so naively re-sending the original message would teach the NEXT step and silently skip this one. The app defends against that on two axes: it **forks** the turn so a skip can't happen, and it walks a **recovery ladder** so the failure rarely surfaces at all.

**Forking keeps the lesson session recoverable.** Every resumed turn — the foreground streaming turn (`tutorTurn` passes `fork: Boolean(lessonSessionId)`) as well as the speculative prefetch — runs with `--fork-session`, and `lessonSessionId` advances (in `finishTurn`) only once a usable card is adopted. A reply the app can't use therefore advances only a throwaway fork; the lesson session stays where it was, so the error panel's **Try again** re-teaches the same step instead of skipping ahead. The first turn of a lesson has no session to fork and needs none — there is no prior step to skip.

**The recovery ladder** — each rung is reached only when the previous one fails:

1. **Tolerant parse** — `parseReply` retries `JSON.parse` after re-escaping raw control characters inside string literals (`escapeControlCharsInStrings`). An unescaped newline in the body is the most common break, and this recovers the whole card — outline, exercise, and notes routing included — with no model round-trip. It cannot fix an unescaped quote or a truncated reply, which fall through.
2. **Repair** — `repairCard` resumes the (forked) session and asks it to re-send the same card as valid JSON, up to `MAX_CARD_REPAIRS` times. It targets the session id the failed turn returned, so a prefetch fork repairs itself and the base session stays untouched.
3. **Salvage** — when repairs are exhausted, `salvageCard` reads the title, body, and takeaway straight out of the raw reply (the same tolerant reader the streaming preview uses) and that best-effort card is adopted. The learner keeps the content they watched stream in, and because the session genuinely taught the step, the next Continue still advances correctly. Only plain strings on the card come back this way; the structured extras (notes routing, exercise, outline) are dropped, so a salvaged step is not filed into the notes document.
4. **Surfaced error** — only a reply too broken to yield even a title and body throws. The raw reply is logged in full (the only remaining copy of what was taught) and the turn becomes an error panel in the feed; forking is what makes retrying that panel safe.

This mirrors the guard-and-repair pattern used for broken Mermaid diagrams, which validates with `mermaid.parse` and silently asks for one fix before hiding the diagram. The tolerant-parse and salvage rungs are covered by `scripts/card-parse-test.ts` (`pnpm run test:parse`), a token-free regression test over crafted malformed replies.

## Still to document

- Where is the `claude` binary resolved from, and what happens when it's missing or unauthenticated?
- What is the exact JSON card schema the tutor must emit?
