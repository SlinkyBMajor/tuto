import { Notebook01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import { CardMarkdown, headingId } from "@/components/card-markdown";
import { CardContent, CardHeader, Card as UICard } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { bun } from "@/lib/rpc";
import { cn } from "@/lib/utils";

interface TocEntry {
	depth: number;
	text: string;
	id: string;
}

// Headings from the notes markdown, skipping fenced code blocks
function extractToc(markdown: string): TocEntry[] {
	const entries: TocEntry[] = [];
	let inFence = false;
	for (const line of markdown.split("\n")) {
		if (line.startsWith("```")) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const match = /^(#{2,4})\s+(.*)$/.exec(line);
		if (match?.[1] && match[2]) {
			entries.push({
				depth: match[1].length,
				text: match[2].trim(),
				id: headingId(match[2].trim()),
			});
		}
	}
	return entries;
}

export function NotesPanel({ demoMarkdown }: { demoMarkdown?: string }) {
	const [markdown, setMarkdown] = useState<string | null>(demoMarkdown ?? null);
	const [error, setError] = useState<string>();
	const [activeId, setActiveId] = useState<string>();

	useEffect(() => {
		if (demoMarkdown !== undefined) return;
		bun
			.getNotes({})
			.then((result) => setMarkdown(result.markdown))
			.catch((fetchError: unknown) =>
				setError(
					fetchError instanceof Error ? fetchError.message : String(fetchError),
				),
			);
	}, [demoMarkdown]);

	const toc = useMemo(
		() => (markdown === null ? [] : extractToc(markdown)),
		[markdown],
	);

	// Track the section the reader is in so the contents list says where you
	// are, not just what exists. The content pane scrolls rather than the
	// window, so the listener has to run in the capture phase to see it.
	useEffect(() => {
		if (toc.length === 0) return;
		function update() {
			const first = document.getElementById(toc[0]?.id ?? "");
			const pane = first?.closest("[data-scroll-pane]");
			const threshold = (pane?.getBoundingClientRect().top ?? 0) + 24;
			let current = toc[0]?.id;
			for (const entry of toc) {
				const top = document
					.getElementById(entry.id)
					?.getBoundingClientRect().top;
				if (top !== undefined && top <= threshold) current = entry.id;
			}
			setActiveId(current);
		}
		update();
		window.addEventListener("scroll", update, { passive: true, capture: true });
		return () =>
			window.removeEventListener("scroll", update, { capture: true });
	}, [toc]);

	if (error) {
		return (
			<p className="py-16 text-center text-base text-muted-foreground">
				Could not load notes: {error}
			</p>
		);
	}
	if (markdown === null) {
		return (
			<div className="space-y-3 py-8">
				<Skeleton className="h-8 w-2/5 rounded-lg" />
				<Skeleton className="h-4 w-full rounded-md" />
				<Skeleton className="h-4 w-4/5 rounded-md" />
			</div>
		);
	}

	if (toc.length === 0) {
		return (
			<div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-20 text-center">
				<span className="grid size-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
					<HugeiconsIcon icon={Notebook01Icon} className="size-5.5" />
				</span>
				<p className="max-w-xs text-base text-muted-foreground">
					Notes build up here as the lesson covers concepts.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-4 pb-24">
			<UICard size="sm">
				<CardHeader>
					<div className="text-sm text-muted-foreground">On this page</div>
				</CardHeader>
				<CardContent className="flex flex-col items-stretch gap-px">
					{toc.map((entry) => (
						<button
							key={`${entry.id}-${entry.depth}`}
							type="button"
							className={cn(
								"truncate rounded-lg py-1.5 pr-2 text-left text-sm transition-colors",
								entry.id === activeId
									? "bg-accent font-medium text-accent-foreground"
									: "text-muted-foreground hover:bg-muted hover:text-foreground",
							)}
							style={{ paddingLeft: `${0.5 + (entry.depth - 2) * 0.85}rem` }}
							onClick={() =>
								document
									.getElementById(entry.id)
									?.scrollIntoView({ behavior: "smooth", block: "start" })
							}
						>
							{entry.text}
						</button>
					))}
				</CardContent>
			</UICard>
			<UICard>
				<CardContent>
					<article className="notes-doc reading prose prose-lg max-w-none dark:prose-invert [&_h2]:scroll-mt-4 [&_h3]:scroll-mt-4 [&_h4]:scroll-mt-4">
						<CardMarkdown body={markdown} />
					</article>
				</CardContent>
			</UICard>
		</div>
	);
}
