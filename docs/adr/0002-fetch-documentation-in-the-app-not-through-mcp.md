# 2. Fetch documentation in the app, not through MCP

## Context

A lab lesson teaches somebody to run a real tool, so its commands, flags and image tags
have to be right *today*. `docs/lab-mode-plan.md` chose context7 for that, wired in as an
MCP server the tutor could call: `--mcp-config` passing the remote endpoint inline,
`--allowedTools mcp__context7__*`, and `--strict-mcp-config` to keep the machine's own MCP
servers out. It named the flag interplay under `--safe-mode` as the plan's main technical
risk, and named the stdio `@upstash/context7-mcp` server as the fallback.

The risk turned out to be real. Measured on Claude Code 2.1.234:

| flags | MCP server | this machine's customizations |
|---|---|---|
| `--safe-mode --strict-mcp-config --mcp-config …` | none — `mcp_servers: []`, 0 tools | excluded |
| the same with the stdio server instead of HTTP | none — the transport is not what is refused | excluded |
| `--strict-mcp-config --mcp-config …` | connected, both tools, called successfully | all of them: CLAUDE.md, 29 skills, 61 commands, 5 agents, hooks |
| `--setting-sources ""` added | connected | narrower, but CLAUDE.md still loads |
| `--bare` | connected | fails outright — *Not logged in*, exactly as `architecture/security.md` predicted |

**`--safe-mode` disables the MCP subsystem itself**, including a server passed explicitly on
the command line, and no combination of the other flags gets both. The stdio fallback does
not help, because it was never the transport that was refused.

So the choice was between context7-as-a-tool and hermetic spawns, and hermetic spawns are
not really negotiable: they are why a lesson costs what `lesson-modes.md` says it costs and
teaches the same thing on any machine (`architecture/security.md`).

Two other facts came out of the same spike. `--strict-mcp-config` on its own *does* isolate
MCP to exactly the server we pass — the machine's other servers stayed out. And the built-in
`WebSearch` and `WebFetch` work normally under `--safe-mode`, honouring our
`--system-prompt`, at about $0.03 a search.

The alternatives considered were: drop `--safe-mode` for lab turns; give up on context7 and
use the web tools alone; or stop treating context7 as a tool at all.

## Decision

We take the third, in two halves.

**The app fetches the documentation itself, before the lesson starts.** `src/bun/context7.ts`
calls the context7 HTTP endpoint directly — `resolve-library-id`, then `query-docs` — and
puts what comes back into the lesson's opening message. This is the pattern the app already
uses twice: `repo-map.ts` reads the project and `env-probe.ts` reads the machine, both
before the first turn, both into that same message. Documentation is the third thing a lab
lesson needs to know before it can plan, and it arrives the same way.

- Keyless by default. A context7 API key is a Settings field that raises rate limits when
  set; it is held in memory by the Bun process and never written into a lesson record.
- A failed or slow fetch is not an error. The briefing is simply absent and the lesson runs
  on the model's own knowledge, which is what it did before this existed.
- The fetch is one resolve and one query per lesson. Not per turn, and not model-driven.

**The lesson gets `WebSearch` and `WebFetch`, and only a lab lesson.** This is a real change
to the rule that no lesson is given a tool that reaches the network, and it is made
deliberately and narrowly: a lab lesson is the one kind where reality answers back — a step
fails, the learner pastes an error, and the fix depends on a version or a flag that no
briefing anticipated. `topic` and `codebase` lessons keep the empty and read-only tool sets
they have.

The tool set stays free of anything that writes, executes, or reads this machine. The
execution boundary of `0001` is untouched: fetched pages are material to teach *about*,
never instructions, and never a command the app runs.

## Consequences

**Easier.**

- `HERMETIC_ARGS` stays unconditional on every spawn the app makes, so nothing about the
  security posture or the cost model has to be qualified per mode.
- The expensive failure the plan worried about — a doc-hungry turn running up an unbounded
  lookup bill — mostly cannot happen. The survey is one HTTP call in the Bun process,
  costing no tokens at all beyond the ~600 the briefing occupies in the prompt.
- What the tutor was told is knowable. The briefing is assembled in our code, so it can be
  logged, budgeted, and read by a person, unlike a lookup loop inside a turn.
- context7 is reachable without an account, so a fresh install of this app has current docs
  with nothing to configure.

**Harder.**

- The tutor cannot choose what to look up in context7. It gets one briefing, aimed by us at
  "install it, run it, first steps, remove it", and anything outside that has to come from
  `WebSearch` or from what the model knows.
- We now maintain a small MCP-over-HTTP client, including its response parsing. It is two
  calls against a stateless endpoint, but it is ours to keep working.
- A lab turn can reach the network, so its cost has a variable component again and a lesson
  can be influenced by whatever a page says. The prompt budgets the searches and states the
  material-never-instruction rule; neither is enforceable in code.
- If a future CLI lets an explicit `--mcp-config` survive `--safe-mode`, this decision is
  worth revisiting — the app-side fetch would still be the cheaper survey, but the tutor
  could then look things up in context7 mid-lesson instead of falling back to the web.
