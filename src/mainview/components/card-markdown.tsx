import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Children,
	isValidElement,
	type ReactElement,
	type ReactNode,
	useEffect,
	useMemo,
	useState,
} from "react";
import Markdown from "react-markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { getHighlighter } from "@/lib/highlighter";
import { bun } from "@/lib/rpc";

export function headingId(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

// Shown on the code block's title bar. Anything not listed falls back to the
// fence's own tag, so a new language still gets a sensible label.
const LANGUAGE_NAMES: Record<string, string> = {
	bash: "Shell",
	c: "C",
	cpp: "C++",
	cs: "C#",
	css: "CSS",
	go: "Go",
	html: "HTML",
	java: "Java",
	js: "JavaScript",
	json: "JSON",
	jsx: "JSX",
	kt: "Kotlin",
	php: "PHP",
	py: "Python",
	python: "Python",
	rb: "Ruby",
	rs: "Rust",
	rust: "Rust",
	sh: "Shell",
	sql: "SQL",
	swift: "Swift",
	ts: "TypeScript",
	tsx: "TSX",
	yaml: "YAML",
	yml: "YAML",
	zsh: "Shell",
};

function anchoredHeading(Tag: "h2" | "h3" | "h4") {
	return (props: { children?: ReactNode }) => {
		const text = Children.toArray(props.children).join("");
		return <Tag id={headingId(text)}>{props.children}</Tag>;
	};
}

// These are React component *types*, so their identities have to be stable:
// building them inline on each render makes React unmount and remount the whole
// markdown tree every time the card re-renders, which resets each diagram to its
// loading skeleton (re-running the mermaid render, and any repair round-trip
// with it), re-highlights every code block, and destroys the imperative
// `.segment-active` class that keyboard reading applies.
const STATIC_COMPONENTS = {
	// Headings get stable anchor ids so the notes ToC can jump
	h2: anchoredHeading("h2"),
	h3: anchoredHeading("h3"),
	h4: anchoredHeading("h4"),
	// Keyboard reading steps through sections: each paragraph or list is one
	// segment (code blocks and diagrams tag themselves)
	p: (props: { children?: ReactNode }) => <p data-segment>{props.children}</p>,
	ul: (props: { children?: ReactNode }) => (
		<ul data-segment>{props.children}</ul>
	),
	ol: (props: { children?: ReactNode }) => (
		<ol data-segment>{props.children}</ol>
	),
};

export function CardMarkdown({
	body,
	markBlank = false,
}: {
	body: string;
	// Practice snippets carry exactly one ____ blank; mark it as a slot
	markBlank?: boolean;
}) {
	const components = useMemo(
		() => ({
			...STATIC_COMPONENTS,
			pre: (props: { children?: ReactNode }) => (
				<PreBlock {...props} markBlank={markBlank} />
			),
		}),
		[markBlank],
	);

	return <Markdown components={components}>{body}</Markdown>;
}

function PreBlock(props: { children?: ReactNode; markBlank?: boolean }) {
	const child = Children.toArray(props.children).find(isValidElement) as
		| ReactElement<{ className?: string; children?: ReactNode }>
		| undefined;
	if (!child) {
		return <pre>{props.children}</pre>;
	}
	const lang =
		/language-([\w-]+)/.exec(child.props.className ?? "")?.[1] ?? "text";
	const source = String(child.props.children ?? "").replace(/\n$/, "");
	if (lang === "mermaid") {
		return <MermaidBlock source={source} />;
	}
	return <ShikiBlock source={source} lang={lang} markBlank={props.markBlank} />;
}

function CopyButton({ source }: { source: string }) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), 1600);
		return () => window.clearTimeout(timer);
	}, [copied]);

	async function copy() {
		try {
			await navigator.clipboard.writeText(source);
			setCopied(true);
		} catch {
			// The webview serves the UI over views://, which is not a secure
			// context, so the async clipboard API can be unavailable.
			const scratch = document.createElement("textarea");
			scratch.value = source;
			scratch.setAttribute("style", "position:fixed;top:-1000px;opacity:0");
			document.body.append(scratch);
			scratch.select();
			setCopied(document.execCommand("copy"));
			scratch.remove();
		}
	}

	return (
		<button
			type="button"
			onClick={() => void copy()}
			aria-label={copied ? "Copied" : "Copy code"}
			className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/6 hover:text-foreground"
		>
			<HugeiconsIcon
				icon={copied ? Tick02Icon : Copy01Icon}
				className={copied ? "size-3.5 text-success" : "size-3.5"}
			/>
			{copied ? "Copied" : "Copy"}
		</button>
	);
}

function ShikiBlock({
	source,
	lang,
	markBlank,
}: {
	source: string;
	lang: string;
	markBlank?: boolean;
}) {
	const [html, setHtml] = useState<string>();

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const highlighter = await getHighlighter();
			// A topic can produce a fence we never bundled a grammar for; shiki
			// renders "text" unstyled rather than throwing.
			const language = highlighter.getLoadedLanguages().includes(lang)
				? lang
				: "text";
			const rendered = highlighter.codeToHtml(source, {
				lang: language,
				themes: { light: "github-light", dark: "github-dark" },
			});
			// The blank is a single token in every language we highlight, so it
			// survives into the markup as a plain run of underscores.
			if (!cancelled)
				setHtml(
					markBlank
						? rendered.replaceAll(
								"____",
								'<span class="code-blank">____</span>',
							)
						: rendered,
				);
		})().catch(() => {
			// fall through to the plain <pre> fallback below
		});
		return () => {
			cancelled = true;
		};
	}, [source, lang, markBlank]);

	const label = LANGUAGE_NAMES[lang] ?? (lang === "text" ? "" : lang);

	return (
		<figure className="code-block not-prose" data-segment>
			<figcaption className="code-block__bar">
				<span className="code-block__lang">{label}</span>
				<CopyButton source={source} />
			</figcaption>
			{html ? (
				<div
					// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki escapes the source it highlights
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			) : (
				<pre>
					<code>{source}</code>
				</pre>
			)}
		</figure>
	);
}

// Mermaid's colour helpers can't parse oklch, so the diagram palette lives in
// hex CSS variables that mirror the design tokens (see index.css).
function diagramTheme() {
	const styles = getComputedStyle(document.documentElement);
	const token = (name: string) => styles.getPropertyValue(name).trim();
	const surface = token("--diagram-surface");
	const node = token("--diagram-node");
	const border = token("--diagram-border");
	const text = token("--diagram-text");
	const line = token("--diagram-line");
	const soft = token("--diagram-accent-soft");
	return {
		darkMode: document.documentElement.classList.contains("dark"),
		background: surface,
		primaryColor: node,
		primaryTextColor: text,
		primaryBorderColor: border,
		secondaryColor: soft,
		tertiaryColor: surface,
		mainBkg: node,
		nodeBkg: node,
		nodeBorder: border,
		nodeTextColor: text,
		textColor: text,
		titleColor: text,
		lineColor: line,
		defaultLinkColor: line,
		arrowheadColor: line,
		clusterBkg: surface,
		clusterBorder: border,
		edgeLabelBackground: surface,
		actorBkg: node,
		actorBorder: border,
		actorTextColor: text,
		signalColor: line,
		signalTextColor: text,
		labelBoxBkgColor: soft,
		labelBoxBorderColor: border,
		labelTextColor: text,
		loopTextColor: text,
		noteBkgColor: soft,
		noteBorderColor: border,
		noteTextColor: text,
	};
}

function MermaidBlock({ source }: { source: string }) {
	const [svg, setSvg] = useState<string>();
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const mermaid = (await import("mermaid")).default;
			mermaid.initialize({
				startOnLoad: false,
				theme: "base",
				themeVariables: diagramTheme(),
				fontFamily: "'Inter Variable', sans-serif",
				fontSize: 14,
				flowchart: { curve: "basis", padding: 12, useMaxWidth: true },
				sequence: { useMaxWidth: true },
			});

			let code = source;
			try {
				await mermaid.parse(code);
			} catch (parseError) {
				// Model-generated diagrams occasionally have syntax errors: try a
				// silent one-shot fix; never show the learner a parse error.
				const fixed = await bun.fixMermaid({
					code,
					error: String(parseError),
				});
				if (!fixed.ok) throw new Error(fixed.error);
				code = fixed.code;
				await mermaid.parse(code);
			}

			// Unique per render run: StrictMode double-mounts share useId, and
			// mermaid.render collides on duplicate element ids
			const renderId = `mmd${Math.random().toString(36).slice(2)}`;
			const rendered = await mermaid.render(renderId, code);
			if (!cancelled) setSvg(rendered.svg);
		})().catch(() => {
			// Whatever went wrong (import, fix, parse, render): hide the
			// diagram — a card must never be stuck on a loading skeleton.
			if (!cancelled) setFailed(true);
		});
		return () => {
			cancelled = true;
		};
	}, [source]);

	if (failed) return null;
	// Rendering a diagram is async (import, parse, a possible repair round-trip),
	// and keyboard reading indexes segments by DOM order. Without data-segment
	// here the diagram is missing from that list while it loads, so ArrowDown
	// steps straight past it and every later segment is off by one.
	if (!svg)
		return <Skeleton className="my-6 h-40 w-full rounded-2xl" data-segment />;
	return (
		// The segment wrapper must not clip: the keyboard reading bar is a
		// ::before sitting outside its left edge, so overflow lives on the
		// inner element instead.
		<div className="mermaid-diagram not-prose" data-segment>
			<div
				className="mermaid-diagram__scroll"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: SVG produced by mermaid from validated source
				dangerouslySetInnerHTML={{ __html: svg }}
			/>
		</div>
	);
}
