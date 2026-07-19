# Tuto — AI Learning App (working title)

## Problem

Learning new technical concepts through a general-purpose AI chat is hard. The
agent's default response format — long, dense answers — is not optimized for
learning. The pacing, length, and presentation need to be different when the
goal is understanding rather than getting an answer.

## Core idea

A desktop app built with **Electrobun** that uses **`claude -p`** (Claude Code
headless mode) under the hood, with custom instructions that turn the agent
into a tutor. The user says what they want to learn and at what level; the app
delivers the material as a stepwise lesson in a feed of short, readable cards.

Learning stays **practical and visual**: concepts are illustrated with
short, syntax-highlighted code examples in the user's preferred language
(e.g. JavaScript examples when learning Kafka) and with **Mermaid diagrams**
used generously — flows, architectures, and relationships drawn rather than
described, since the target user learns visually. Each explained concept
also generates a hands-on exercise in a separate **Practice tab** — e.g. a
Kafka listener declaration with the topic part blanked out, where the user
fills in what belongs there.

The feed is the *conversation*; alongside it the lesson builds an
*artifact*: a **structured notes document** (a markdown file maintained in
the background), organized by topic with a growing **table of contents**.
Where the feed is chronological, the notes are hierarchical — if the lesson
later deepens a concept ("pods"), the new material files *under* the Pods
section rather than just appearing later in the feed. This is what the user
returns to for re-reading.

## Decisions

| Decision | Choice |
|---|---|
| Pacing | **User-driven** — each card ends with a "Continue" action; the user reads at their own pace and explicitly advances. |
| Lesson shape | **Adaptive outline** — the tutor drafts a concept outline at lesson start and may revise it as the lesson adapts. Enables progress display and groups the Practice tab by concept. |
| Structured notes | **Yes** — the lesson maintains a markdown document in the background, organized as a nested table of contents (outline items = top-level sections; deeper concepts nest under their parent). Rendered in-app as a readable reference for re-reading. |
| Notes content | **Written once** — the card body *is* the notes content. The tutor writes reference-quality prose; the feed shows it as a card and the app files the same markdown into the notes doc. No double generation. |
| Tone | **No conversational filler** — no "Great question!", no praise padding, no chit-chat framing. Clean instructional prose everywhere; this doubles as what makes cards reusable as notes. |
| Language | **Plain language** — everyday words a normal human reads without effort. Jargon is allowed only when the term *is* the lesson content, and then it's defined in plain words on first use. Never complicated language to sound smart. |
| Prose length | **Short** — brevity is enforced with hard limits per card, not left to taste. Long, tiring sections are the failure mode this app exists to fix. |
| Lesson ending | **Recap card + next steps** — when the outline is covered, a summary card recaps the concepts and suggests follow-on topics that can seed a new lesson. |
| Follow-up questions | **Yes** — at any point the user can type a question; the agent answers in a card, then the lesson resumes. |
| Knowledge checks | **Practice tab only** — no inline quiz cards in the feed; the exercises are the knowledge check. |
| Level adjustment | **Yes** — the user can say "too basic" / "slow down" mid-lesson and the agent recalibrates. |
| Code examples | **Yes** — concepts illustrated with short code examples, syntax highlighted. |
| Diagrams | **Heavy use of Mermaid** — the tutor draws concepts (flows, architectures, relationships) whenever a concept has visual structure. Diagrams live as ` ```mermaid ` fences in the card body, so they render in the feed, in Notes, and anywhere else the markdown goes. |
| Example language | **Configured preferred language** (e.g. JavaScript), used *when applicable* — topics that imply their own language (e.g. learning Rust) use that instead. Per-lesson override available. |
| Practical exercises | **Yes** — one fill-in-the-blank code exercise per covered concept (e.g. after "pods" in a Kubernetes lesson), added to a separate Practice tab. Wrong answer or "I don't know" → the app fetches an explanation. |
| Persistence | **Yes** — lessons are saved locally and resumable; a home screen lists past lessons. |
| Audience | **Personal tool** — assume Claude Code is installed and authenticated on the machine. No auth/onboarding work. |
| AI backend | `claude -p` subprocess (not the API directly) — reuses the existing Claude Code login. |

## Stack

| Layer | Choice |
|---|---|
| Shell | **Electrobun** — Bun main process + system webview |
| UI | **React + TypeScript** |
| Components | **shadcn/ui** (Tailwind CSS), initialized with preset: `pnpm dlx shadcn@latest init --preset bKsE3qD2` |
| Design language | **Large and rounded** — big base type, generous corner radius across all components |
| Lint/format | **Biome** |
| Package manager | **pnpm — required.** Bun remains the *runtime* (Electrobun's main process, `electrobun` CLI); pnpm manages dependencies. |
| Versions | **Pinned exactly, no ranges** — no `^`/`~` anywhere in `package.json`. |
| Highlighting | Shiki |
| Diagrams | mermaid.js |

Stack notes:

- **Exact pinning setup:** `save-prefix=""` in `.npmrc` so every `pnpm add`
  saves an exact version; pin pnpm itself via the `packageManager` field.
- **pnpm gotcha:** pnpm v10 blocks dependency build scripts by default.
  Electrobun installs platform binaries via a lifecycle script, so it must
  be allowlisted (`pnpm.onlyBuiltDependencies` in `package.json`). Verify
  at scaffold time.
- Electrobun's templates/docs assume `bun install` — expect small
  deviations from their README; the `react-tailwind-vite` template is the
  closest reference for our setup.

## User flow

1. **Home screen** — list of saved lessons + a chatbox: *"What would you like
   to learn?"*
2. User describes a topic, optionally with a starting level
   (e.g. "Kubernetes, from the basics").
3. If no level is supplied, the agent asks for it before starting.
4. The tutor drafts an **outline** of concepts for the topic and level
   (e.g. Kubernetes basics → containers recap, pods, deployments,
   services, …). The outline is visible as lesson progress and may be
   revised by the tutor as the lesson adapts.
5. **Lesson feed** — the agent produces short cards, one concept-step at a
   time. Each card ends with a **Continue** action.
6. Cards use **code examples** where a concept benefits from one, written in
   the user's preferred language, and **Mermaid diagrams** wherever a
   concept has visual structure (e.g. how a Deployment manages ReplicaSets
   manages Pods).
7. Mid-lesson, the user can at any time:
   - type a free-form follow-up question → answered in a card, lesson resumes
   - adjust the level ("too basic", "slow down") → agent recalibrates
8. As the lesson progresses, the material also files into the **Notes
   document**: each step's content lands under its concept's section, and
   deeper material (e.g. advanced pod concepts arriving later) nests
   *under* the existing Pods section. Follow-up answers file under the
   section they relate to. The user can open Notes at any time to re-read
   a topic in structured form.
9. After each covered concept (e.g. "pods"), **an exercise lands in the
   Practice tab**:
   - a short code snippet with one part blanked/marked
     (e.g. a Kafka listener with the topic blanked out)
   - the user types what belongs there, or presses **"I don't know"**
   - wrong or don't-know → the app fetches an explanation and shows it
     under the exercise
10. When the outline is covered, the lesson ends with a **recap card**:
    a summary of the concepts plus suggested follow-on topics, each of which
    can seed a new lesson with one click.
11. Closing the app mid-lesson is fine — the lesson resumes from the home
    screen later.

## UI

- **Design language:** large and rounded — big base type, generous corner
  radius, shadcn/ui components themed by the chosen preset.
- **Home screen:** lesson list (topic, level, progress, last opened) + the
  "what do you want to learn" chatbox.
- **Lesson view:** three tabs — **Lesson**, **Practice**, and **Notes**.
- **Lesson tab:** vertical feed, each agent response a **card**.
  - Large font size, easy-to-read font. Readability is the priority.
  - A slim **outline/progress header**: the concept list with the current
    one highlighted ("pods — 3 of 8").
  - Card types: *lesson step*, *follow-up answer*, *level check*, *recap*.
  - Code examples rendered as **syntax-highlighted** blocks inside cards.
  - **Mermaid diagrams** rendered inline in cards, theme-aware (light/dark).
  - Persistent input box at the bottom for follow-ups/answers; **Continue**
    as the primary action between steps.
  - **Keyboard reading:** ArrowDown steps through the newest card one
    section at a time — paragraph or list (highlighted), code block or
    diagram (outlined). Past the last section, ArrowDown acts as Continue.
    ArrowUp steps back.
- **Practice tab:** list of exercises, one per covered concept, grouped by
  outline concept.
  - Each exercise: syntax-highlighted snippet with the blanked part visually
    marked, an answer input, an **"I don't know"** button, and a feedback
    area where the fetched explanation appears.
  - A badge on the tab when new exercises arrive.
- **Notes tab:** the structured document, rendered from the background
  markdown file.
  - **Table of contents** — nested sections, click to jump. The ToC's top
    level mirrors the lesson outline; subsections appear as the lesson
    deepens a concept. *(Implemented as an "On this page" block above the
    document rather than a sidebar — fits the single-column reading
    layout.)*
  - Same readability standards as the feed: large type, highlighted code,
    rendered Mermaid diagrams.
- **Settings:** preferred programming language for examples (e.g. JavaScript),
  overridable per lesson.
- **Syntax highlighting:** Shiki — TextMate-grammar accurate, runs in the
  webview, has light/dark themes.
- **Diagrams:** mermaid.js rendering ` ```mermaid ` fences client-side in
  the webview, with theme support. Because model-generated Mermaid
  occasionally has syntax errors, the app validates each diagram
  (`mermaid.parse`) before rendering; on failure it silently sends the
  broken diagram back to the session for a one-shot fix, falling back to
  hiding the diagram (never show the user a parse error).

## Architecture

### Shell: Electrobun

- Bun main process creates a `BrowserWindow` loading the UI from
  `views://mainview/index.html`.
- **Typed RPC** between Bun and the webview (`BrowserView.defineRPC` in Bun,
  `Electroview.defineRPC` in the browser): the UI sends requests like
  `startLesson`, `continueLesson`, `askFollowUp`; Bun pushes card payloads
  back as messages.

### AI backend: `claude -p`

- Bun spawns `claude -p` per turn.
- **Session continuity:** each lesson maps to one Claude session — first turn
  creates it, subsequent turns use `--resume <session-id>`. This gives both
  in-lesson context *and* resume-after-restart for free.
- **Custom tutor instructions** via system-prompt flag: enforce short
  responses, one concept per card, level-appropriate language, when to quiz.
- **Structured output:** instruct the tutor to reply as JSON and parse with
  `--output-format json`, so the app renders typed cards instead of raw text.
  Sketch of the protocol:
  - card: `{ type: "step" | "answer" | "levelCheck" | "recap", title, body,
    code?: { language, source } }`
  - question-type cards can carry clickable `options`
    (`{ id, label, description }`); the level question always offers exactly
    three, with fixed ids (`beginner`/`intermediate`/`advanced`) mapped to
    icons in the UI while labels stay model-authored and topic-tailored.
  - the lesson's first turn returns the **outline**:
    `outline: [{ id, title }]`; step cards reference their concept via
    `conceptId`. The tutor may return a revised `outline` on any turn when
    the lesson adapts.
  - a step that completes a concept also carries an exercise:
    `exercise: { conceptId, code: { language, source },
    blank: { marker, answer }, question }` — the app routes it to the
    Practice tab.
  - content is **written once**: the card `body` is reference-quality
    markdown. Content-bearing cards carry a routing field —
    `notes: { sectionPath: ["Pods", "Multi-container pods"] }` — and the
    *app* files the card body into the notes file under that section path
    (creating nested sections as needed). Cards without a `notes` field
    (level checks, meta-questions) don't file. The tutor never rewrites
    the document, so it stays fast and drift-free.
  - the recap card carries `suggestions: [topic]` for seeding new lessons.
- **Exercise evaluation:** the user's answer is conceptual, not an exact
  string ("what goes in the blank?"), so checking is a model call returning
  `{ correct, explanation }`. The "I don't know" button is the same call
  with an explicit don't-know flag. *(Implementation note: checking runs as
  a stateless one-shot call with the full exercise as context — not against
  the lesson session — so grading never invalidates the speculative
  prefetch fork or pollutes lesson history.)*
- **Preferred language** (from settings, or the per-lesson override) is
  injected into the tutor instructions: use it *when applicable*, but let
  the topic win when it implies its own language (Rust lesson → Rust
  examples) or when code isn't the right medium at all.
- **No tools needed:** the tutor only generates text — disable tool use for
  speed and safety (it should never touch the filesystem).
- **Speculative prefetch:** after each step card, the bun process
  immediately asks for the next card in a **forked** session
  (`--fork-session`), so Continue is usually instant. Continue adopts the
  fork; any other user turn (question, level change) runs against the
  untouched base session and the fork is discarded.
- *Later enhancement:* `--output-format stream-json` to stream card content
  in as it generates.

### Persistence

- One folder per lesson, `<data-dir>/lessons/<id>/` (macOS:
  `~/Library/Application Support/tuto/lessons/`), containing:
  - `lesson.json` — bun-owned metadata (topic, language, Claude session id,
    timestamps) merged with the webview's display snapshot (outline, current
    concept, card/user feed, exercises and their answered state).
  - `notes.md` — the rendered structured notes, plain markdown so it's
    readable/greppable outside the app.
  - `notes.json` — the notes section tree, so a resumed lesson keeps filing
    new material into the right sections after a restart.
- **Ownership split:** the webview holds the display state and pushes a
  snapshot to bun after each turn/answer (`saveLesson`); bun owns all file
  I/O, the lesson id/folder, and the notes files. Card history is stored so
  the feed re-renders instantly on resume without replaying the session.
- **Resume:** the home screen lists saved lessons (`listLessons` →
  topic, progress, last-opened); opening one restores bun's session id /
  language / notes tree and rehydrates the webview from the record, so
  Continue picks up the live Claude session. A back button returns to the
  library mid-lesson; `deleteLesson` removes a folder.
- *(UI-verification aid: `?demohome` renders the home library from fixture
  lessons without a running bun process.)*

### The prompt is the product

The custom tutor instructions are the heart of the app and will need the
most iteration. The two failure modes the app exists to fix — **jargon** and
**long prose** — are prompt problems, so the rules below are written to be
enforceable, not aspirational:

- **Plain language.** Everyday words, short sentences, the way you'd
  explain something to a colleague over coffee. Complicated vocabulary to
  sound smart is forbidden. A technical term may be used only when the term
  itself is what's being taught — and then it's defined in plain words the
  first time it appears (learning Kubernetes means learning the word "pod";
  it doesn't mean tolerating "orchestrated container topology").
- **Hard length limits.** Brevity by rule, not by taste. Starting limits to
  iterate from: max ~100 words of prose per card, paragraphs of 1–3
  sentences, one idea per paragraph. If a concept needs more, that's a
  signal to split it into two cards, not to write a longer one.
- **No conversational filler.** Never "Great question!", never praise
  padding. Every card must read as clean instructional prose — this is what
  makes card content directly reusable as notes content.
- **Write for the document.** Card bodies should stand alone when read
  later out of feed order, since they are filed into the notes doc.
- **Introduce, then draw.** When a concept has visual structure — a flow,
  a hierarchy, components talking to each other — draw it as a Mermaid
  diagram, but only after the sentence or two of context that makes the
  diagram readable. Never open a card with an unexplained diagram. Prefer
  simple diagram types (flowchart, sequence) that the model generates
  reliably.

Because cards arrive as structured JSON, the length rule is also
**checkable in code**: the app can count words in `body` and, when a card
blows past the limit, silently ask the session to split it — the same
guard-and-retry pattern used for broken Mermaid diagrams.

Worth keeping the instructions in a versioned file (e.g. `prompts/tutor.md`)
rather than inline in code.

## Build phases

*Status: Phases 1–5 are built and verified. Phase 6 is the remaining
backlog. (Phases 3–5 are committed-pending review at time of writing.)*

**Phase 1 — core loop (walking skeleton)** ✅
- Electrobun scaffold (React + TypeScript views, pnpm, pinned versions,
  Biome, shadcn init with the preset).
- One window, minimal feed UI.
- `claude -p` wrapper in Bun: start lesson → parse JSON → render card →
  Continue → next card.
- First version of the tutor prompt.

**Phase 2 — the full lesson experience** ✅
- Outline in the protocol: progress header, adaptive revisions, recap card
  with next-topic suggestions.
- Follow-up questions, level adjustment.
- Code examples in cards with Shiki syntax highlighting; preferred-language
  setting with per-lesson override.
- Mermaid rendering in cards, with validation + silent-fix fallback.
- Card polish: typography, card types visually distinct.

**Phase 3 — Practice tab** ✅
- Exercise generation in the card protocol, Practice tab UI.
- Answer checking + explanation fetch, "I don't know" flow.

**Phase 4 — Notes document** ✅
- Notes routing in the protocol; app-side markdown file maintenance
  (card bodies filed by section path, nested sections created as needed).
- Notes tab: rendered markdown + ToC navigation.

**Phase 5 — persistence** ✅
- Home screen with lesson list, save/resume via `--resume`.
- Lesson folder layout (`lesson.json` + `notes.md` + `notes.json`);
  exercises and their state (answered, correct, explanation shown) persist
  with the lesson.

**Phase 6 — nice-to-haves (backlog)**
- Streaming card content.
- "Final exam": mixed review exercises at lesson end.
- User annotations/edits in the notes document.
- Cross-lesson notes search ("where did I read about consumer groups?").

## Open questions

*(all settled — see Decisions)*
