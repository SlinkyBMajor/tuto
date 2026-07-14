import {
	Children,
	isValidElement,
	type ReactElement,
	type ReactNode,
	useEffect,
	useState,
} from "react";
import Markdown from "react-markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { bun } from "@/lib/rpc";

export function CardMarkdown({ body }: { body: string }) {
	return (
		<Markdown
			components={{
				pre: PreBlock,
				// Keyboard reading steps through sections: each paragraph or
				// list is one segment (code blocks and diagrams tag themselves)
				p: (props: { children?: ReactNode }) => (
					<p data-segment>{props.children}</p>
				),
				ul: (props: { children?: ReactNode }) => (
					<ul data-segment>{props.children}</ul>
				),
				ol: (props: { children?: ReactNode }) => (
					<ol data-segment>{props.children}</ol>
				),
			}}
		>
			{body}
		</Markdown>
	);
}

function PreBlock(props: { children?: ReactNode }) {
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
	return <ShikiBlock source={source} lang={lang} />;
}

function ShikiBlock({ source, lang }: { source: string; lang: string }) {
	const [html, setHtml] = useState<string>();

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const shiki = await import("shiki");
			const language = lang in shiki.bundledLanguages ? lang : "text";
			const rendered = await shiki.codeToHtml(source, {
				lang: language,
				themes: { light: "github-light", dark: "github-dark" },
			});
			if (!cancelled) setHtml(rendered);
		})().catch(() => {
			// fall through to the plain <pre> fallback below
		});
		return () => {
			cancelled = true;
		};
	}, [source, lang]);

	if (!html) {
		return (
			<pre data-segment>
				<code>{source}</code>
			</pre>
		);
	}
	return (
		<div
			className="code-block"
			data-segment
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki escapes the source it highlights
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
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
				theme: document.documentElement.classList.contains("dark")
					? "dark"
					: "neutral",
				fontFamily: "'Inter Variable', sans-serif",
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
	if (!svg) return <Skeleton className="h-40 w-full rounded-2xl" />;
	return (
		<div
			className="mermaid-diagram not-prose"
			data-segment
			// biome-ignore lint/security/noDangerouslySetInnerHtml: SVG produced by mermaid from validated source
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
}
