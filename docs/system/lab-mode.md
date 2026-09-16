# Lab lessons

A lab lesson teaches a tool by having the learner install it, run it, and use it on this machine, one explained step at a time. It is the third lesson mode (`lab`), alongside `topic` and `codebase` — see `lesson-modes.md` for what a mode is.

The contract, as the learner reads it on the first panel of the lesson:

> **You do everything; the lesson explains, and checks.**

Spread across `prompts/modes/lab.md` (how a lab lesson is shaped and written), `src/bun/env-probe.ts` (what the app reads about this machine), `src/bun/context7.ts` (what it reads about the tool), `src/bun/verify.ts` (the only thing it runs), `src/bun/settings.ts` (the machine settings the webview pushes over), the `lab` variant of `LessonConfig` and the `task`/`caution`/`cost`/`requirements` fields of `Card` in `src/shared/types.ts`, `LAB_MODE` in `src/bun/lesson-modes.ts`, the parsers in `src/bun/claude.ts`, `src/mainview/components/lab-panels.tsx`, and the `lab panels` block of `index.css`.

## The execution boundary

**The learner executes. The app verifies — read-only, allowlisted, shell-free.** The decision and its consequences are `docs/adr/0001-the-learner-executes-the-app-only-verifies.md`; what follows is what the code does about it.

- The tutor's tool set is `WebSearch` and `WebFetch` — pages, and nothing that touches this machine. It cannot run, write, or read anything here, in this mode or any other.
- Every mutating command — installs, `docker run`, a login, teardown — is a task card the learner performs in their own terminal. The app never runs one, including cleanup.
- The only commands the app itself runs are the fixed argv arrays in `env-probe.ts`, written by us and not by the model. They are spawned directly, so no shell parses model output anywhere in this mode.
- Nothing in the mode's UI implies the app checked anything. A step is done because the learner said so, and the wording says exactly that.

## What opens a lesson

`env-probe.ts` is the `repo-map.ts` pattern pointed at the machine instead of a project: a token-free orientation pass whose result goes into the opening message, so the tutor plans setup around what is here. It runs a fixed set of local, read-only probes in parallel — tool presence and versions (`docker`, `kubectl`, `helm`, `git`, `node`, `python3`, `brew`), the Docker context and whether the daemon answers, the current `kubectl` context, and whether the cloud CLIs are logged in. About 1.2s on a warm machine.

It produces two things, for two different readers.

- **The machine report** (`renderMachine`) goes into the opening message, in the learner's voice, followed by `What I want to learn, hands-on: <topic>`. It names the CLIs that are logged in but never *which* account — that is the learner's business, and the tutor only needs to know a step could land somewhere real.
- **The warnings** (`machineWarnings`) go to the learner, before the tutor has said a word: a `kubectl` context that is not in the known-local set (`docker-desktop`, `minikube`, `kind-*`, `k3d-*`, `orbstack`, `rancher-desktop`, `colima`), and each logged-in cloud CLI, named. These are computed in our code and not asked of the model, because whether this Mac points at a real cluster is a safety fact and must not depend on a model remembering a prompt rule. The tutor's own `caution` fields are a second layer on top, not a replacement.

The probe is memoised for 30 seconds, because it is asked for twice within a second at the start of a lesson — once by the webview for the warnings, once by the mode for the opening message. Deliberately short: a lesson resumed an hour later must re-read the machine, since that is exactly when the container has been stopped and the work cluster has become current.

## Where the commands come from

A command that was right two years ago and is wrong today costs the learner an error they cannot diagnose, so a lab lesson is given current documentation before it plans anything.

**`context7.ts` fetches it, and the tutor never calls context7 itself.** Two POSTs to `https://mcp.context7.com/mcp` — `resolve-library-id`, then `query-docs` — and what comes back goes into the opening message beside the machine report. It is the repo-map pattern for a third kind of context, and it is app-side for a hard reason: `--safe-mode` disables the MCP subsystem outright, including a server passed explicitly in `--mcp-config`, so context7-as-a-tool and hermetic spawns cannot both be had. See `docs/adr/0002-fetch-documentation-in-the-app-not-through-mcp.md` for the measurements.

- **Keyless.** The endpoint answers without an account. A context7 API key is a Settings field that raises rate limits; it is pushed to the Bun process over `setContext7Key`, held in memory, and never written into a lesson record.
- **The lesson request is cleaned before it is asked.** A learner types "Grafana, hands-on", not a package name, so `libraryNameFrom` takes the clause before the first comma and strips lesson phrasing. Asked verbatim, the endpoint once answered "Azure Container Apps, hands-on" with an SRE agent.
- **context7 always answers**, including for subjects it has never indexed — it returns its nearest neighbour with the same confidence as a real match. `titleMatchesTopic` is a coarse filter (one word of five letters or more from the topic has to appear in the library's own title) and the prompt is the real guard: the tutor is told the excerpt may be about the wrong thing and to ignore it when it is. A rejected or failed lookup is not an error; the briefing is simply absent and the lesson runs on what the model knows.
- **The match is only as good as the endpoint's ranking.** "Grafana" and "Docker" land on their own docs; "Azure Container Apps" lands on a Terraform module for it. Good enough to be worth having, not good enough to trust blindly — which is what the prompt says too.

**`WebSearch` and `WebFetch` are the tutor's own lookup**, for the thing a briefing cannot anticipate: a step failed and the error is unfamiliar, or a version detail is about to waste the learner's time. The prompt budgets them at one search per card, most cards none, and `smoke:lab` prints the count per turn.

**The first turn has no tools at all.** That is enforced in code (`openingRuntimeFor`), not asked of the model — see `lesson-modes.md` for what it cost to learn that.

## The shape of a lesson

`prompts/modes/lab.md` fixes the arc: the level question, then a plan card carrying `requirements` and the outline, then setup (one task card per thing the report says is *missing*), the practical part with task and teaching cards alternating, and clean-up before the recap. The outline must contain a setup concept near the start and a clean-up concept at the end — everything the lesson starts, the lesson stops.

**There is no orientation block, and there used to be.** The prompt asked for two or three no-task teaching cards between setup and the practical part, described with the lab it was written from: *what the container is doing for us, what is listening on port 3000*. On a lesson whose setup starts nothing — build your first Docker image, on a Mac that already has Docker — there is nothing to orient around, so the tutor oriented around the tool itself: what a daemon is, what it keeps, how to list images. Three cards of theory before the learner had built anything, one of them showing `docker images` on a machine with no images in it. The rule was obeyed exactly; it was the rule that was wrong. Concepts now land at the step that needs them, which is what the practical part already said.

Two rules do most of the teaching work. **The body explains why before the task says what**, because a command the learner does not understand is a step they cannot debug. And **one command per task card** — the one-idea rule in this mode's form.

The default path is the simplest and cheapest one that teaches: local over hosted, free tier over sized, one container over a cluster. The learner has to ask for the production shape to get it.

**A lab lesson never offers a prerequisite detour.** Taking one starts a `topic` lesson and comes back to a `topic` lesson, which would quietly drop the hands-on part the learner asked for. The mode prompt forbids the offer, `App.tsx` does not render it for a lab lesson either, and `smoke:lab` fails if one arrives.

## The protocol fields

All four are optional additions to `Card`, ignored by the other modes, and parsed in `claude.ts` on the same terms as everything else: what cannot be drawn is dropped rather than rendered empty.

- **`task`** — `{kind, command?, expect?}`. `kind` is `run` (a terminal command), `ui` (a click in a browser or app), or `edit` (a file to write). `parseTask` drops a task whose kind it does not know, and drops a `run` task with no command: the card would tell the learner to run something and show nothing to run, and the body still teaches on its own without it.
- **`caution`** — one line about a step that could touch something outside this lesson.
- **`cost`** — one line about money, on any step that can bill and on the plan card when the lesson needs an account or a card at all.
- **`requirements`** — the plan card's checklist, one row per thing the learner needs before the first command. Each row has a `kind` the app has an icon for (`install`, `account`, `payment`, `disk`, `time`, `workspace`); a row with any other kind is dropped, because the panel's whole value is that it can be skimmed. At most eight rows.

`caution` and `cost` share `parseLine` with the takeaway — usable text or nothing.

## Doing a step

A card with a task replaces Continue in the key bar with two buttons, and `advanceLesson` routes both the primary button and ArrowDown, so the key and the button can never disagree.

- **I did it** marks the card `done` and sends a message rather than a bare "continue", so the lesson's own session records that the step happened.
- **Something went wrong** marks the card `failed` and opens the composer — the only other place free text reaches a lesson (the first is a follow-up after the recap). The learner pastes what their terminal printed; the app prefixes it with "That step did not work" so the tutor reads it as a failed step and not as a question, and answers with a diagnosis card. Escape closes the composer, so a mis-click cannot hide Continue for good.

`taskStatus` (`open` | `done` | `verified` | `failed`) lives on `SavedFeedItem` and persists, so a lesson resumed tomorrow does not present ten finished steps as open ones. `done` is the learner's own word for it; `verified` is the app's, and only a passing check sets it. The check itself persists too — a step marked failed is worth coming back to, and without the output it says nothing.

## Checking a step

A task may carry a **check**: a read-only command the app runs, once the learner presses Check, to see whether the step really worked. Most tasks have none.

**The allowlist is the boundary, and it lives in `verify.ts`.** `isAllowed` takes the argv array and answers yes or no — the binary must be on the list, and the subcommand must be in that binary's reporting set. `docker ps` yes, `docker run` never. `curl` is GET-only and `localhost`-only, with a fixed set of flags that cannot redirect it to a file or change the method. `kubectl config view` yes, `kubectl config use-context` no. A binary written as a path (`/usr/bin/docker`, `../docker`) is refused outright, because a path is not a name on a list.

**A refused check is dropped at parse time**, in `parseVerify` — so it never reaches the webview, the card simply has no Check button, and the learner sees the ordinary "I did it". A check the app will not run must never surface as an error, and never as a question about whether to permit it. `runVerify` validates a second time before spawning, because the webview is not the authority on what this app may run.

**The judge is a side-call**, `prompts/verify-check.md` on Haiku, handed the tutor's expectation and the real output and asked whether they agree — the exercise-grading pattern, about a cent a check. It returns `{pass, note}`, and the note is one sentence of fact ("the container exited two seconds after starting"), never a fix. The fix is the lesson's job.

Then:

- **Pass** → the card becomes `verified` and the key bar goes back to Continue. The outcome rides along in the next message ("I did that step and the check passed: …"), so the session knows without a turn being spent on it.
- **Fail** → the card becomes `failed` and shows the judge's note with the command and its full output under it, in a disclosure. The key bar becomes *Mark done anyway* / *Ask the tutor*, and asking sends the command, the output and the verdict straight into the lesson. **The learner is never asked to paste something the app is already holding** — this is the moment the mode earns its keep.
- **A check that could not run at all** leaves the step where it was, with one line saying so. It is not a step that failed.

**Consent is per lesson**, on the plan card under the requirements, and again on the first step that actually has a check in case the first ask was skipped past. `checksAllowed` persists with the lesson; until it is `true` no check runs and no Check button appears.

A question asked about a task panel carries the check with it: `askInThread` appends the command, the first 800 characters of output and the verdict to the section's own words, so "what does this mean?" arrives with the evidence.

## The lesson's folder

Some labs have the learner write files — a Dockerfile, a config, a small app. Those get a folder of their own; the ones whose work lives in a browser or a cloud console never do, and never mention one.

**Asking for it is what creates it.** The tutor puts a `workspace` row on the plan card's requirements; `openLabFolder` in `index.ts` sees it, creates `<labRoot>/<lesson-id>`, and rebuilds the lesson's runtime with that folder as its working directory and `Read`/`Grep`/`Glob` added to the web pair. The root is a Settings field (`~/Documents/Tuto Labs` by default) and is deliberately **not** under the app data dir — these are the learner's files, and they belong somewhere a person opens in Finder.

**This is the one part of a `LessonConfig` that is not fixed when the lesson starts**, and it is set at most once. Nothing can know whether a lesson needs a folder until the lesson has planned itself. The config carries `labDir` from then on, so a resume comes back to the same folder — remade with `mkdir -p` if it has gone, because a folder the app created is the app's to restore, not something to refuse a resume over.

**The session is told**, because the folder appears mid-lesson, after the opening message. `openLabFolder` writes the folder into the lesson's config — every runtime built after that carries it — and leaves a line on the lesson (`announce`) that the next turn's message carries: a runtime that quietly grows a working directory and two read tools is a tutor that does not know it has them.

**The tutor reads; the learner writes.** No mode ever gets a write tool. A file that needs changing is a task card like any other change to this machine.

**How far the read tools reach was measured, not assumed.** On CLI 2.1.234, with a working directory set and `--safe-mode`, `Read` and `Grep` succeed inside that directory and are refused by the permission system outside it — `/etc/hosts`, `~/.zshrc`, and `../../etc/hosts` all came back *"Claude requested permissions to read from … but you haven't granted it yet"*. That is what makes read tools and web tools acceptable in the same lesson: what can be read is the folder this lesson made.

A check may also `ls` or `cat` inside that folder, and nowhere else. `isInsideLabFolder` resolves the path before comparing, so `..` cannot walk out; a path that reads as `~` is refused whatever it would actually mean without a shell; `ls -R` is refused; and a bare `cat` is refused because it would sit on standard input until the timeout.

## How it renders

`lab-panels.tsx` draws four panels under the card and one above the lesson. Each of the four is a `[data-segment]` section of the feed item, exactly like the takeaway, so arrow-key reading, the question rail and sticky notes all reach them with no new wiring (see `reading.md`). They share the takeaway's geometry — inset by the card's own padding — which is what puts their reading bars in the same gutter column as the body's.

The order under a card is **requirements → hierarchy → takeaway → caution → cost → task**: what the lesson needs, then the picture and the line to keep, then the doing. The task is last, directly above the button that says it is done.

- **The task panel is marker-accented**, because the marker is the colour of what you are *doing* inside the content, and on a lab card it is the one thing to do. A done step drops the accent for a neutral well and a tick — a finished step is history, and the marker has moved on.
- **The caution panel is red, not amber.** Yellow already means *keep this* (see `takeaways.md`), and a warning that can be mistaken for a keepsake is not a warning. Red reuses `--destructive` rather than introducing a third content colour.
- **The cost panel is a neutral well** with a coin. Money is neither good nor bad news; the coin and the label carry it, and the tutor's words are the part that matters.
- **The requirements panel** is one row per requirement: a kind icon, the name, the detail, and the cost as a badge on the right.
- **The machine notice** is a full panel above the first card, in the app's own voice — the warnings, then a line saying what was read and that nothing here runs on its own. It is not persisted: on resume it is re-derived from a *fresh* probe and put back at the top of the feed, because the machine it warns about may have changed since.
- **On a resumed lesson it also carries drift** — what moved while the lesson was closed. The probe is saved with the lesson and compared against a fresh one (`probeDrift`): Docker was running and is not, the `kubectl` context changed, a cloud CLI has logged in, a tool has gone. Only losses and switches, never gains — somebody who started Docker before re-opening the lesson does not need telling that Docker is running. A resume with news but nothing to warn about gets the quiet version of the panel rather than a red one.
- **The recap carries a teardown reminder**, written by the app and not by the tutor: every task card the learner never marked done, with its command. Whether the clean-up steps were actually run is something only the app knows, and it is right even when the recap forgot to mention any of it.

The progress pill grows a third figure, `Steps`, when any card in the lesson has a task (`LessonStats.stepsDone`/`stepsTotal` — see `lesson-chrome.md`).

## What a turn costs

Cheap, as long as the tutor is not searching. Measured with `pnpm smoke:lab` on 2026-08-18, two topics, one run each, with the documentation briefing in the opening message:

| turn | Grafana (local, free) | Azure Container Apps |
|---|---|---|
| **open** — the level question, no tools | $0.07 · 45s · 0 lookups | $0.16 · 72s · 0 lookups |
| **plan** — requirements, outline, first card | $0.06 · 16s · 0 lookups | $0.10 · 40s · 0 lookups |
| **teach** — every step after that | $0.03 · 10s · 0 lookups | $0.07 · 33s · 0 lookups |
| **diagnose** — a failed check going back in | $0.04 · 20s · 0 lookups | — |

Those numbers were measured on `claude-sonnet-5`. The model and the thinking effort are now one pair in Settings and apply to every turn of every lesson, so a lab lesson costs whatever the learner picked — Opus 5 at `xhigh` by default. See **Model and effort** in `claude-backend.md`.

The verdict on a check is a Haiku side-call on top, about a cent. A twenty-card lesson lands around **$0.70** local and **$1.50** on a cloud topic — well under the $4–5 the plan budgeted, because the survey happens in the Bun process for no tokens and arrives as ~600 tokens the session keeps.

Those numbers are entirely the search budget's doing. The same Azure lesson, given the web with only a prompt rule to restrain it, spent 30 searches and a 420s timeout on the level question; the tightened prompt brought it to 9 searches and $1.40 for three turns; taking the tools off the opening turn brought it to $0.33. See `lesson-modes.md`.

Prefetch is off for this mode, and not as a cost saving: the next card depends on how the step actually went, so a speculative one is usually the wrong card — and the learner is away doing the step, which is where the latency hides.

## Seeing it without a model call

`?demolab` renders a fixture lesson: the machine notice, the plan card's requirements, a step whose check passed, a step whose check failed with its output, a clean-up card carrying the caution/cost/task trio, and a recap with the teardown reminder under it. `?demolab=ask` renders it before the learner has said whether the app may run checks; `?demolab=resume` renders it as a lesson being returned to, with drift. Fixtures live in `src/mainview/lib/demo.ts`.

`pnpm smoke:verify` is the one to run after touching `verify.ts`. The allowlist half is token-free and is a table of commands that must run and commands that must never — `docker run`, `kubectl config use-context`, `bash -c`, a path instead of a binary name, a curl that writes a file or changes the method. The judge half spends a few cents on canned outputs, so a verdict can be checked against one that is known in advance.

`pnpm smoke:lab ["topic…"]` runs the real thing headless. It prints the machine report, the warnings and which library the documentation lookup found — all before spending anything — then checks the level question, the outline's setup and clean-up bookends, the requirements list, and that a task card arrives within the first few steps with a command and an observable expectation. It counts lookups per turn and warns when a turn goes over budget, and it reads the topic's own words to decide which way the money check runs: a topic that can bill must carry a `cost` field, and a free local one must not cry wolf.
