# Security — rules

Operational rules in MUST voice; cite the source (ADR, contract, incident) for each.

## Still to document

- What MUST be true before model-generated markup is injected via `dangerouslySetInnerHTML` (sanitization, allowed tags)?
- What MUST the `claude` subprocess never be given (tools, filesystem access, credentials) on a tutor turn vs a side-call?
- What MUST hold for lesson-id / file paths derived from user-supplied topic text (no traversal, length bounds)?
- What MUST the WebView be prevented from doing (navigating to remote origins, loading remote scripts)?
