// Every free-text field in this app takes one of three things: a question, a
// note, or a token of code. The platform's helpfulness is wrong for all three —
// a completion dropdown covering the box, autocorrect rewriting a symbol name,
// a capital forced onto `groupId`, a red squiggle under every real API name.
// So they all turn it off, from one place, rather than each field remembering
// to.
//
// autoCorrect is a WebKit attribute and the one that matters here: this app
// runs in the OS WebView, where macOS text substitution is on by default.
export const RAW_TEXT_INPUT = {
	autoComplete: "off",
	autoCorrect: "off",
	autoCapitalize: "off",
	spellCheck: false,
} as const;
