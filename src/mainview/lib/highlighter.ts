import c from "@shikijs/langs/c";
import cpp from "@shikijs/langs/cpp";
import csharp from "@shikijs/langs/csharp";
import css from "@shikijs/langs/css";
import go from "@shikijs/langs/go";
import html from "@shikijs/langs/html";
import java from "@shikijs/langs/java";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsx from "@shikijs/langs/jsx";
import kotlin from "@shikijs/langs/kotlin";
import php from "@shikijs/langs/php";
import python from "@shikijs/langs/python";
import ruby from "@shikijs/langs/ruby";
import rust from "@shikijs/langs/rust";
import shellscript from "@shikijs/langs/shellscript";
import sql from "@shikijs/langs/sql";
import swift from "@shikijs/langs/swift";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import yaml from "@shikijs/langs/yaml";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";
import type { HighlighterCore } from "shiki/core";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// The default `shiki` entry ships every theme and grammar as its own async
// chunk — 400+ of them. The packaged app serves its build over a `views://`
// custom protocol where those runtime fetches do not resolve, so highlighting
// silently fell back to unstyled text. These imports are deliberately static:
// the grammars we label become part of the main bundle, so there is no fetch
// left to fail. (A dynamic `import()` here would re-split them.)
//
// Keep this list in step with LANGUAGE_NAMES in card-markdown.tsx — if the UI
// is willing to put a language's name on a block, it should highlight it.
const LANGS = [
	c,
	cpp,
	csharp,
	css,
	go,
	html,
	java,
	javascript,
	json,
	jsx,
	kotlin,
	php,
	python,
	ruby,
	rust,
	shellscript,
	sql,
	swift,
	tsx,
	typescript,
	yaml,
];

let instance: Promise<HighlighterCore> | null = null;

// One highlighter for the whole app, created on first use.
export function getHighlighter(): Promise<HighlighterCore> {
	instance ??= createHighlighterCore({
		themes: [githubLight, githubDark],
		langs: LANGS,
		// The JavaScript engine avoids loading the Oniguruma wasm binary, which
		// would reintroduce the runtime fetch this module exists to remove.
		// `forgiving` skips the few grammar patterns it cannot express instead
		// of throwing and losing the whole block.
		engine: createJavaScriptRegexEngine({ forgiving: true }),
	});
	return instance;
}
