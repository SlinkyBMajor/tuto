# Security — trust boundaries

Tuto is a personal desktop app with no user accounts, login, or network API of its own. Its trust boundary is elsewhere:

- **Subprocess execution.** `src/bun/claude.ts` spawns the local `claude` CLI (`Bun.spawn`) for every turn and side-call. The app relies on the user's existing Claude Code install and auth; it passes no credentials itself. Tool use is disabled on tutor turns (`--tools ""`), and side-calls add `--safe-mode` (no CLAUDE.md/skills/hooks/MCP).
- **Local filesystem.** `src/bun/store.ts` and `notes.ts` read and write under the OS app-data dir (`~/Library/Application Support/tuto/lessons/<id>/`). Paths are built in `paths.ts` from a date + slugified topic + random suffix.
- **Rendering model-generated markup.** Card and notes bodies are model output. Code is rendered by Shiki and Mermaid diagrams by mermaid.js, both injected via `dangerouslySetInnerHTML` (`src/mainview/components/card-markdown.tsx`). Mermaid source is validated with `mermaid.parse` before render.

## Still to document

- What, if anything, sanitizes model-generated markdown/HTML before it reaches `dangerouslySetInnerHTML` — can a lesson body inject arbitrary HTML/script into the WebView?
- Are the WebView's capabilities restricted (navigation, remote content, node/bun access from the view)?
- What is the threat model — is any lesson content ever from an untrusted source, or is the only actor the local user and Claude?
- Is there any risk in the `slugify`/lesson-id path construction (path traversal via topic text)?
