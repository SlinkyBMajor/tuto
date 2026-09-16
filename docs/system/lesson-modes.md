# Lesson modes

A lesson mode is where a lesson's material comes from. Three exist today:

- **`topic`** — the tutor teaches from what the model already knows. No tools, no working directory.
- **`codebase`** — the tutor teaches from a project on this machine, reading it with `Read`, `Grep`, and `Glob` while the CLI runs inside the project folder.
- **`lab`** — the tutor teaches a tool by having the learner install and run it here, one explained step at a time. No tools either; what it teaches from is the machine itself, which the app reads before the lesson starts. See `lab-mode.md`.

Everything that differs between them lives in `src/bun/lesson-modes.ts`. The rest of the app carries a `LessonConfig` around and asks that module for a runtime, so no other file branches on the mode.

## The pieces

- **`LessonConfig`** (`src/shared/types.ts`) — a discriminated union, one variant per mode, fixed when the lesson starts and unchanged for its life, with exactly one exception: a lab lesson gains `labDir` when its plan card asks for a folder, because nothing can know whether it needs one until it has planned itself. A `codebase` variant cannot exist without a `project`, so an invalid combination is unrepresentable rather than validated. A `lab` variant carries no `language`, because the commands are the tool's own language — which is why `systemPromptFor` asks `"language" in config` rather than reading the field.
- **`LessonModeSpec`** (`lesson-modes.ts`) — one object per mode. The model and the thinking effort are deliberately *not* on it — those are one pair in Settings, shared by every mode (`settings.ts`). What is on it: its prompt section, its tools, *its tools for the first turn*, **what a card of its lessons may carry**, its per-turn timeout and cost ceiling, whether it prefetches, whether the learner's code-language preference applies, its working directory, and its opening message.
- **`TutorRuntime`** (`src/bun/claude.ts`) — what a turn needs to spawn: system prompt, tools, cwd, timeout, safe mode, model, budget. `runtimeFor(config)` builds it once per lesson; `claude.ts` runs turns without knowing that modes exist. `openingRuntimeFor(config)` is the same thing with `openingTools` instead, used for the first turn only.
- **`ActiveLesson`** (`src/bun/index.ts`) — the one open lesson: id, config, runtime, Claude session id.

Adding a mode is a prompt section plus one spec.

**The first turn of every lesson runs with no tools.** It asks the level question, and everything it could look up was already put in its opening message by the app — the project map, the machine report, the documentation excerpt. `openingTools` is a required field rather than an optional one, so a new mode has to decide it rather than inherit it. It exists because the prompt rule alone did not hold: codebase mode once opened 30 files to ask how well somebody knew a repository, and lab mode once ran 30 web searches and timed out at seven minutes, both while asking a question with three fixed options. A rule the model can talk itself out of is not a budget. `MODES` is a `Record<LessonModeId, …>`, so adding an id without its spec is a type error rather than a runtime one.

**Which panels a card may carry is a field on the spec, not a property of which prompt file the text sits in.** `cardFeatures` names them; `card-features.ts` is the registry and `docs/system/card-features.md` explains what qualifies. All three modes currently take all six, but the set is one line per mode and the prompt sections follow it, so narrowing a mode costs nothing and removes its tokens too.

**A mode may still add optional card fields of its own, and only optional ones.** Lab mode's `task` is a field on `Card` the other two never emit — it is not a card feature, because it changes the key bar, carries a check and persists its own state. A field that some mode *needs* would be a different question — the union is `LessonConfig`, not `Card`.

## Prompt composition

The system prompt is assembled per lesson, in this order:

1. `prompts/tutor.md` — the card protocol, outline, exercises, teaching rules, code. Mode-agnostic, and now genuinely so: everything optional moved out of it.
2. One section per enabled **card feature**, in registry order — the takeaway, the hierarchy, diagrams, cautions, costs, requirements. See `card-features.md`.
3. `prompts/modes/<mode>.md` — what kind of lesson this is, how it opens, and any sharpening of a feature this mode cares about.
4. The learner's code-language preference, when the mode uses it. Only `topic` does: `codebase` shows the project's own code in its own language, and `lab` shows the tool's own commands.

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
- **A budget in the prompt.** `prompts/modes/codebase.md` forbids reading anything before the level question — the map already names the project's parts, which is all that question needs — and treats the outline turn as the one survey, with a lookup or two per card after it. Both rules exist because the opposite was measured: given a map and no budget, the tutor read 30+ files to ask "how well do you know this codebase?", which cost more than having no map at all.

`--max-budget-usd` backstops the lot at $2 per turn. A healthy turn lands an order of magnitude under it; it exists so a turn that decides to read the whole repository fails instead of quietly billing for it.

## Lab mode specifics

- **`WebSearch` and `WebFetch`, and nothing else.** The learner runs every command themselves; the app's only execution is the fixed, read-only machine probe (`docs/adr/0001-…`). The web pair is the one place a lesson reaches the network, granted to this mode alone because it is the one where reality answers back — a step fails and the fix turns on a version no briefing anticipated (`docs/adr/0002-…`).
- **Two things are read before the first turn**, both into the opening message and both fetched at once. `env-probe.ts` reads what is installed here, the Docker and `kubectl` context and cloud-CLI login state, so setup is planned around what is present. `context7.ts` fetches current documentation for the topic, so the commands are today's. Either can come back empty and the lesson still runs.
- **A working directory only when the lesson asked for one.** A `workspace` requirement on the plan card creates a folder and writes it into the lesson's config, so every runtime built after that carries it and adds `Read`/`Grep`/`Glob` to the web pair — the one place a lesson's tools change mid-lesson. Labs whose work is in a browser never get one.
- **No language preference.** `docker run` is not written in anybody's favourite language.
- **Prefetch is off.** The next card depends on how the step actually went, so a speculative one is usually wrong — and the learner is away doing the step, which is where the latency hides.
- **420s and `--max-budget-usd 2`** — codebase mode's footing. The model is not the mode's business: it comes from Settings with every other lesson's.

## Model and effort

Neither is a property of the mode. Both come from **Settings**, apply to every turn of every lesson, and default to Opus 5 at `xhigh` (`src/bun/settings.ts`, and **Model and effort** in `claude-backend.md` for why those defaults).

The one rule worth repeating here: the effort menu starts at `high`. `low` was measured writing lesson cards and it spends **zero** thinking tokens — it does not think less, it stops. A lab lesson taught that way wrote a card introducing two new terms in two sentences and a setup task for a tool the machine probe had already found installed. There is no saving worth that.

## What a lab turn costs

The cheap kind, as long as the tutor is not searching. Measured with `pnpm smoke:lab` on 2026-08-18, one run each of a free local topic and a cloud one, with the documentation briefing in the opening message:

| turn | Grafana (local, free) | Azure Container Apps |
|---|---|---|
| **open** — the level question, no tools | $0.07 · 45s · 0 lookups | $0.16 · 72s · 0 lookups |
| **plan** — requirements, outline, first card | $0.06 · 16s · 0 lookups | $0.10 · 40s · 0 lookups |
| **teach** — every step after that | $0.03 · 10s · 0 lookups | $0.07 · 33s · 0 lookups |
| **diagnose** — a failed check going back in | $0.04 · 20s · 0 lookups | — |

A twenty-card lesson lands around **$0.70 local, $1.50 on a cloud topic**. Both are far under the plan's $4–5 estimate, for one reason: the survey happens in the Bun process, costs no tokens, and lands in the session as ~600 tokens the tutor keeps for the whole lesson.

**Every number above is what it is because of the search budget, and both halves of that budget were bought with a regression.** Given `WebSearch` and only a prompt rule, the opening turn of the Azure lesson ran 30 searches and hit the 420s timeout without producing a card; tightening the prompt cut it to 9 searches and $1.40 for three turns; taking the tools off the first turn entirely brought the same three turns to $0.33. The prompt still carries the per-card budget — at most one search, most cards none — and `smoke:lab` prints lookups per turn so a regression shows up as a number rather than as a bill.

The 420s timeout is sized for a turn that searches. The shape is otherwise the opposite of codebase mode's: there the plan turn is the expensive one because it surveys a repository; here no turn surveys anything, because the app did it first.

**These numbers were measured on `claude-sonnet-5` at whatever effort the CLI chose**, before either was a setting. On the Opus 5 / `xhigh` default they are the floor, not the figure: Opus lists at 1.67x Sonnet, so read them as roughly what the Sonnet setting still costs. Two runs before believing any new number, as always.

## How a card is written

`prompts/tutor.md` carries a controlled-writing standard, adapted from ASD-STE100 (Simplified Technical English): a sentence holds one fact in at most 25 words, a paragraph is one or two sentences, active voice, simple tenses, noun clusters of three words, one word per concept, and a numbered list for anything with three or more steps. It constrains sentence *construction*, never vocabulary — precise names (`scopedRoles`, `issueIdentityToken`, file paths) are the part that must survive intact.

The pacing rule alongside it is **one new term per card**: name it, define it in everyday words in the same breath, then use it. Everything else in that card has to be a term already taught.

Codebase mode makes this harder and says so: the project's own names — `admin-web-bff`, `PKCE`, `login_requests` — feel like background to a model that has just read the code, and are new terms to the learner. Two rules are non-negotiable there: every step card names at least one file, and nothing may point at a line number, because the learner is reading a card and not the file.

`scripts/card-prose.ts` measures the same segments the arrow keys step through, and both smoke tests fail on a section over 60 words or any `line 44` / `path.ts:18` reference. All three rules exist because a real lesson broke them — a 96-word paragraph stacking ten unexplained terms, and a citation pointing at a line the learner could not see.

Levers still untouched: giving prefetch a smaller tool budget than a foreground turn, and pinning topic mode's model too. Any of them should be judged the same way these were — `pnpm smoke:codebase` prints cost, wall clock and model steps per turn, and two runs are the minimum before believing a change helped.
