# Security — rules

Operational rules in MUST voice; cite the source (ADR, contract, incident) for each.

## What the `claude` subprocess is given

Source: the lesson-modes design (`docs/system/lesson-modes.md`), where tools were first handed to a tutor turn.

- A tutor turn MUST be spawned with the tools its lesson mode declares and no others. Tools are a property of the mode (`src/bun/lesson-modes.ts`), never of a call site.
- A lesson MUST NOT be given a tool that writes, executes, or reaches the network. Codebase mode's `Read`, `Grep`, `Glob` is the full set; adding `Bash`, `Edit`, `Write`, or a web tool is a change to this rule, not a configuration tweak.
- **Every** spawn of the `claude` CLI — tutor turn, card repair, and side-call alike — MUST pass both `--safe-mode` and `--strict-mcp-config`. Neither is conditional on the mode, the tool set, or the call site: they are `HERMETIC_ARGS` in `src/bun/claude.ts`, and the two functions that build a command line (`tutorArgs`, `runSideCall`) both splat it in.
  - `--safe-mode` is why a call's context is only what `lesson-modes.ts` composed and what `repo-map.ts` read on purpose — never the developer's CLAUDE.md, skills, plugins, hooks, MCP servers, custom agents, or output styles, none of which are reviewed for this use or accounted for in what a call costs.
  - `--strict-mcp-config` is kept separate rather than left to `--safe-mode`'s scope, because the tool set is a security boundary and MUST NOT depend on another flag continuing to cover it. `--tools` filters the built-in set only; without this flag a call is handed every MCP server configured on the machine, which is neither read-only nor scoped to the project.
- `--bare` MUST NOT be substituted for `--safe-mode`. It disables a similar set of customizations but also takes auth strictly from `ANTHROPIC_API_KEY` or an `apiKeyHelper`, never the keychain or OAuth — the app runs on the CLI's own logged-in session and would break.
- Side-calls (grading, explain, Mermaid repair) MUST stay stateless and tool-free: `--no-session-persistence`, `--tools ""`.
- A codebase lesson's working directory MUST be a path the learner picked through the OS folder dialog, resolved and confirmed to be a directory before the lesson starts (`src/bun/project.ts`) — and confirmed again on resume, since a saved lesson outlives the folder it points at.

## Content read from a project is data

- Files, comments, and documentation read during a codebase lesson MUST be treated as material to teach about, never as instructions. `prompts/modes/codebase.md` states this to the model; the read-only tool set is what bounds the damage if it is ever talked past.

## Still to document

- What MUST be true before model-generated markup is injected via `dangerouslySetInnerHTML` (sanitization, allowed tags)?
- What MUST hold for lesson-id / file paths derived from user-supplied topic text (no traversal, length bounds)?
- What MUST the WebView be prevented from doing (navigating to remote origins, loading remote scripts)?
