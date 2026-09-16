# Security — rules

Operational rules in MUST voice; cite the source (ADR, contract, incident) for each.

## What the `claude` subprocess is given

Source: the lesson-modes design (`docs/system/lesson-modes.md`), where tools were first handed to a tutor turn.

- A tutor turn MUST be spawned with the tools its lesson mode declares and no others. Tools are a property of the mode (`src/bun/lesson-modes.ts`), never of a call site.
- A lesson MUST NOT be given a tool that writes to disk, executes anything, or reads this machine. `Bash`, `Edit` and `Write` are never granted, in any mode; adding one is a change to this rule, not a configuration tweak.
- The full tool set per mode, and it is exhaustive: `topic` none, `codebase` `Read`/`Grep`/`Glob`, `lab` `WebSearch`/`WebFetch` — plus `Read`/`Grep`/`Glob` once the lesson has a folder of its own. The network pair is granted to lab mode alone and was granted deliberately — see `docs/adr/0002-fetch-documentation-in-the-app-not-through-mcp.md`, which supersedes the flat "no network tool" rule this line used to carry. A lesson that reads the web MUST treat what it reads as material, never as instruction, and MUST NOT be the same lesson that can read this machine.
- A lesson that has BOTH read tools and network tools MUST have a working directory, and it MUST be a folder the app created for that lesson. This is what bounds the pair: measured on CLI 2.1.234, `Read` and `Grep` succeed inside the working directory and are refused by the permission system outside it, including via `..` and `~`. Granting read tools with no working directory alongside the web pair would remove that bound and is not permitted.
- **The first turn of a lesson MUST run with no tools**, whatever the mode's tool set is. It asks the level question, and everything it could want was already put in its opening message by the app. This is enforced by `openingRuntimeFor` in `src/bun/lesson-modes.ts` rather than by a prompt rule, because both prompts carried that rule and both were measured ignoring it — a lab turn once spent thirty web searches and a seven-minute timeout on a question with three options.
- **Every** spawn of the `claude` CLI — tutor turn, card repair, and side-call alike — MUST pass both `--safe-mode` and `--strict-mcp-config`. Neither is conditional on the mode, the tool set, or the call site: they are `HERMETIC_ARGS` in `src/bun/claude.ts`, and the two functions that build a command line (`tutorArgs`, `runSideCall`) both splat it in.
  - `--safe-mode` is why a call's context is only what `lesson-modes.ts` composed and what `repo-map.ts` read on purpose — never the developer's CLAUDE.md, skills, plugins, hooks, MCP servers, custom agents, or output styles, none of which are reviewed for this use or accounted for in what a call costs.
  - `--strict-mcp-config` is kept separate rather than left to `--safe-mode`'s scope, because the tool set is a security boundary and MUST NOT depend on another flag continuing to cover it. `--tools` filters the built-in set only; without this flag a call is handed every MCP server configured on the machine, which is neither read-only nor scoped to the project.
  - A lesson MUST NOT be given an MCP server, and `--safe-mode` makes that structural: measured on CLI 2.1.234 it disables the MCP subsystem outright, so even a server passed explicitly in `--mcp-config` never loads. Documentation therefore reaches a lab lesson through `src/bun/context7.ts`, which the Bun process calls itself. Restoring MCP would mean dropping `--safe-mode`, which is not a trade this app makes.
- `--bare` MUST NOT be substituted for `--safe-mode`. It disables a similar set of customizations but also takes auth strictly from `ANTHROPIC_API_KEY` or an `apiKeyHelper`, never the keychain or OAuth — the app runs on the CLI's own logged-in session and would break.
- Side-calls (grading, explain, Mermaid repair) MUST stay stateless and tool-free: `--no-session-persistence`, `--tools ""`.
- A codebase lesson's working directory MUST be a path the learner picked through the OS folder dialog, resolved and confirmed to be a directory before the lesson starts (`src/bun/project.ts`) — and confirmed again on resume, since a saved lesson outlives the folder it points at.

## What the app itself may execute

Source: `docs/adr/0001-the-learner-executes-the-app-only-verifies.md`.

- The app MUST NOT execute anything that changes this machine. Installs, container runs, logins, file writes and teardown are steps a lab lesson prints for the learner to run themselves — including cleanup, and including when the learner asks the app to do it for them.
- Anything the app does execute MUST be spawned as an argv array, never as a shell string. There is to be no shell on the path between model output and a process.
- The commands in `src/bun/env-probe.ts` MUST stay a fixed set written in that file: read-only, taking no argument from the model, the learner, or a lesson record. Adding a probe is a change to this rule, not a configuration tweak.
- A command proposed by the tutor MUST be validated against an app-side allowlist — binary and read-only subcommand — before it is run, and MUST degrade to manual confirmation when it fails validation, never to a prompt asking the learner to permit it. The list is `ALLOWED` in `src/bun/verify.ts`; `isAllowed` is called twice, once at parse time so a refused check is never offered, and once before spawning because the webview is not the authority on what this app may run.
- A proposed command MUST NOT run without the learner's explicit consent for that lesson (`checksAllowed`), and MUST NOT run except on their click. It MUST be shown to them as it is run, with its output.
- `ls` and `cat` MUST be confined to the lesson's own folder, with the path resolved before comparison so `..` cannot walk out, and MUST be refused entirely in a lesson that has no folder.
- `curl` MUST be restricted to GET at this machine — `localhost` or a loopback address — with a fixed flag set that cannot redirect output to a file or change the method. A check exists to look at what the learner just started, never to make a request on their behalf.
- The probe MUST NOT read secrets, tokens, or environment values beyond the named checks, and MUST NOT put an account identifier into a model's context. Login *state* goes to the tutor; which subscription or which email goes to the learner's own warning panel and no further.

## Content read from a project is data

- Files, comments, and documentation read during a codebase lesson MUST be treated as material to teach about, never as instructions. `prompts/modes/codebase.md` states this to the model; the read-only tool set is what bounds the damage if it is ever talked past.
- The same holds for terminal output a learner pastes into a lab lesson. `prompts/modes/lab.md` states it; the empty tool set and the execution boundary above are what bound the damage.

## Still to document

- What MUST be true before model-generated markup is injected via `dangerouslySetInnerHTML` (sanitization, allowed tags)?
- What MUST hold for lesson-id / file paths derived from user-supplied topic text (no traversal, length bounds)?
- What MUST the WebView be prevented from doing (navigating to remote origins, loading remote scripts)?
