# Lesson modes

A lesson mode is where a lesson's material comes from. Two exist today:

- **`topic`** — the tutor teaches from what the model already knows. No tools, no working directory.
- **`codebase`** — the tutor teaches from a project on this machine, reading it with `Read`, `Grep`, and `Glob` while the CLI runs inside the project folder.

Everything that differs between them lives in `src/bun/lesson-modes.ts`. The rest of the app carries a `LessonConfig` around and asks that module for a runtime, so no other file branches on the mode.

## The pieces

- **`LessonConfig`** (`src/shared/types.ts`) — a discriminated union, one variant per mode, fixed when the lesson starts and unchanged for its life. A `codebase` variant cannot exist without a `project`, so an invalid combination is unrepresentable rather than validated.
- **`LessonModeSpec`** (`lesson-modes.ts`) — one object per mode: its prompt section, its tools, its per-turn timeout and cost ceiling, its model, whether it prefetches, whether the learner's code-language preference applies, its working directory, and its opening message.
- **`TutorRuntime`** (`src/bun/claude.ts`) — what a turn needs to spawn: system prompt, tools, cwd, timeout, safe mode, model, budget. `runtimeFor(config)` builds it once per lesson; `claude.ts` runs turns without knowing that modes exist.
- **`ActiveLesson`** (`src/bun/index.ts`) — the one open lesson: id, config, runtime, Claude session id.

Adding a mode is a prompt section plus one spec.

## Prompt composition

The system prompt is assembled per lesson, in this order:

1. `prompts/tutor.md` — the card protocol, outline, notes, exercises, teaching rules, code, diagrams. Mode-agnostic.
2. `prompts/modes/<mode>.md` — what kind of lesson this is and how it opens.
3. The learner's code-language preference, when the mode uses it (`topic` does; `codebase` shows the project's own code in its own language).

Later sections are allowed to be more specific than earlier ones, and `prompts/tutor.md` says so at the top.

## Codebase mode specifics

- **Read-only tools.** `Read`, `Grep`, `Glob` — enough to follow the code, nothing that can change it, run it, or reach the network.
- **Working directory** is the project root, so paths in the tutor's citations are relative to what the learner sees in their editor.
- **Longer turns.** 420s versus 180s: a codebase turn reads its way to an answer before it writes a word. `maxRequestTime` on both RPC ends is 900s to cover a turn plus its repair attempts.
- **Streaming activity.** With tools the model can be silent for a minute, so `streamTutorTurn` reads `tool_use` blocks off the `assistant` events and pushes a line ("Reading src/auth/tokens.ts") through `streamCard`. Text that arrives *before* a tool call is discarded — the card is what comes after the last lookup.
- **Prefetch stays on.** Discarded forks cost more here than in topic mode, but without it every Continue waits out a fresh round of reading.
- **Project validation.** `src/bun/project.ts` resolves and checks the folder when it is picked, and again on resume — a saved lesson can outlive the folder it points at.

## What a codebase turn costs, and why it costs that

A codebase turn is the expensive kind — tool results land in the session on every card. The three turns cost very different amounts, and averaging them hides the shape. Measured on a 20-service monorepo, same question each time ("how identity and org-scoped tokens work"):

| turn | before | after |
|---|---|---|
| **open** — ask the level question | $0.34 · 89s · 9 model steps | $0.10 · 8s · 1 step |
| **plan** — outline plus the first card | $0.60 · 56s · 12 steps | $0.34 · 100s · 9 steps, 7 lookups |
| **teach** — every Continue after that | not measured | $0.16 · 67s · 3 steps, 2 lookups |

The middle turn is expensive by design: it surveys the project to plan an outline, and it happens once. Every Continue after it teaches from a session that already holds the research. So a twenty-card lesson is roughly `0.10 + 0.34 + 19 × 0.16` ≈ **$3.50**, not the $9 that a naive "$0.47 per turn" from the first two turns would suggest.

Two honest caveats. The *plan* turn is noisy — samples have ranged from 7 to 23 lookups, and once cost $0.87. And the "before" column has no steady-state number to compare against, because `smoke:codebase` only grew a third turn once it became clear that turns 1 and 2 are both atypical.

Four things get it there. All are properties of the mode, not of a call site.

- **The project map** (`repo-map.ts`). Before the first turn the Bun process walks the project and reads its index file (`AGENTS.md`, else `CLAUDE.md`, else `README.md`) plus every path under `docs/{system,architecture,adr,reference}`. That listing goes into the opening message. The walk costs ~80ms warm and the listing is ~3.5k tokens *once per lesson*, and it replaces the blind grepping every lesson used to start with: the tutor now opens `services/auth-service/docs/system/oauth.md` directly because it was told the file exists. Projects that don't document themselves get the top-level folder list and fall back to searching — nothing requires the layout.
- **Hermetic spawns** (`HERMETIC_ARGS` — `--safe-mode --strict-mcp-config`, unconditional on every call the app makes). Without them a turn inherits the developer's CLAUDE.md, skills, plugins, hooks and MCP servers — tens of thousands of tokens and a hook run per turn, none of it about the lesson. Not a per-mode setting: a lesson should teach the same thing on any machine.
- **A pinned model.** Codebase turns run on `claude-sonnet-5` rather than whatever tier the machine defaults to.
- **A budget in the prompt.** `prompts/modes/codebase.md` forbids reading anything before the level question — the map already names the project's parts, which is all that question needs — and treats the outline turn as the one survey, with a lookup or two per card after it. Both rules exist because the opposite was measured: given a map and no budget, the tutor read 30+ files to ask "how well do you know this codebase?", which cost more than having no map at all.

`--max-budget-usd` backstops the lot at $2 per turn. A healthy turn lands an order of magnitude under it; it exists so a turn that decides to read the whole repository fails instead of quietly billing for it.

## How a card is written

`prompts/tutor.md` carries a controlled-writing standard, adapted from ASD-STE100 (Simplified Technical English): a sentence holds one fact in at most 25 words, a paragraph is one or two sentences, active voice, simple tenses, noun clusters of three words, one word per concept, and a numbered list for anything with three or more steps. It constrains sentence *construction*, never vocabulary — precise names (`scopedRoles`, `issueIdentityToken`, file paths) are the part that must survive intact.

The pacing rule alongside it is **one new term per card**: name it, define it in everyday words in the same breath, then use it. Everything else in that card has to be a term already taught.

Codebase mode makes this harder and says so: the project's own names — `admin-web-bff`, `PKCE`, `login_requests` — feel like background to a model that has just read the code, and are new terms to the learner. Two rules are non-negotiable there: every step card names at least one file, and nothing may point at a line number, because the learner is reading a card and not the file.

`scripts/card-prose.ts` measures the same segments the arrow keys step through, and both smoke tests fail on a section over 60 words or any `line 44` / `path.ts:18` reference. All three rules exist because a real lesson broke them — a 96-word paragraph stacking ten unexplained terms, and a citation pointing at a line the learner could not see.

Levers still untouched, in rough order of promise: `--effort` (thinking is a real share of the wall clock), giving prefetch a smaller tool budget than a foreground turn, and pinning topic mode's model too. Any of them should be judged the same way these were — `pnpm smoke:codebase` prints cost, wall clock and model steps per turn, and two runs are the minimum before believing a change helped.
