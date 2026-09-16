# 1. The learner executes, the app only verifies

## Context

Tuto is getting a third lesson mode. A **lab** lesson teaches a tool by having the
learner install it, run it, and use it on their own machine — a local Grafana, a first
Dockerfile, something small on a cloud free tier. The plan is `docs/lab-mode-plan.md`.

Every other mode teaches from material: what the model knows, or a project it reads.
A lab lesson teaches from *what happens on the machine*, and that raises a question the
first two modes never had to answer: who runs the commands?

The forces in tension:

- **Pedagogy.** Typing the command is the learning. A learner who watches the app run
  `docker run` has seen a demo, not done a lab, and cannot repeat it without the app.
- **Trust.** The app's existing promise is narrow and load-bearing: *a lesson only ever
  reads.* Codebase mode is `Read`, `Grep`, `Glob` and nothing else, and
  `docs/architecture/security.md` states it in MUST voice. A lab lesson that could
  install software would retract that promise for every lesson, not just its own.
- **Security.** A card is model output, assembled from a system prompt, the learner's
  messages, and — from P2 — documentation fetched off the web. That is untrusted input.
  Handing untrusted input to a shell is the whole of the problem; there is no amount of
  prompt care that makes it safe.
- **Usefulness.** A lab that cannot tell whether the container actually started is a
  printed tutorial. Reacting to what really happened is the reason the mode exists.

The alternatives considered:

1. **The app runs the steps** (an agent with `Bash`). Fastest to a running Grafana, and
   it teaches nothing, breaks the read-only promise, and puts model text on a shell.
2. **The app runs nothing at all.** Keeps every promise; leaves the tutor blind, so a
   failed step is only ever discovered by the learner writing out what they saw.
3. **The learner executes; the app verifies within a fixed, read-only boundary.**

## Decision

We take the third. The boundary is the mode's spine, and it is stated in one line:

> **The learner executes. The app verifies — read-only, allowlisted, shell-free.**

Concretely, for lab lessons and anything built on them:

- **Every mutating command is a task card the learner runs themselves**, in their own
  terminal. Installs, `docker run`, `az login`, edits, and teardown are all steps the
  learner performs. The app never runs them, not even when asked, and not for cleanup.
- **The app executes exactly two kinds of thing, both read-only**: a fixed environment
  probe at lesson start and resume, written by us and not by the model; and verification
  checks the tutor proposes, run only when the learner clicks *Check*.
- **A proposed check is an argv array, never a shell string.** It is spawned directly
  (`Bun.spawn(argv)`), so no shell parses model output at any point. There is no shell in
  the path, so there is no shell injection in the path.
- **A proposed check is validated against an app-side allowlist before it runs** — the
  binary, and the read-only subcommand within that binary. The allowlist lives in our
  code. A check that fails validation downgrades the card to manual confirmation; it is
  never an error shown to the learner, and never a prompt to allow it just this once.
- **The tutor's tool set stays read-only.** `Bash` and `Write` are never granted to a
  lesson, in any mode. Where a lab lesson has a folder of the learner's work, the tutor
  may read it with `Read`, `Grep`, `Glob` — the codebase-mode set, pointed somewhere else.
- **Credentials never pass through the app.** A step that needs a login is a task card.
  The app neither sees, stores, nor prints secrets, and the probe reads only the named
  facts it is written to read.

## Consequences

**Easier.**

- The read-only promise survives intact and gets sharper: the app reads, the learner
  writes. It can be said in one sentence to a learner and held to in review.
- The security argument does not rest on the model behaving. Fetched documentation and
  card text reach an allowlist and an argv array, not a shell, so a lesson that is talked
  past still cannot run anything that was not already permitted.
- The learner leaves with a skill and a runbook rather than a machine somebody else set
  up. The notes document is replayable because every command in it was theirs.
- Verification failures become the mode's best teaching moment: real output, from their
  machine, diagnosed in the next card.

**Harder.**

- Setup is slower and more fragile than an agent doing it. Every step is a card the
  learner must act on, and the lesson can only proceed at their pace.
- The allowlist needs maintenance, and it will reject checks that were in fact harmless.
  We accept the false negatives: the failure mode is a manual "I did it" button, which is
  the honest fallback rather than a degraded one.
- Teardown cannot be automated. A lesson that touched a paid service has to *tell* the
  learner what is still running, clearly enough that they act on it — cost honesty
  becomes a content rule (a `cost` field on any step that can bill) rather than something
  the app can guarantee by cleaning up itself.
- Some things a lab would like to check are not observable this way. A check that would
  need to write, log in, or reach a remote API is simply not available, and those steps
  stay on manual confirmation.
