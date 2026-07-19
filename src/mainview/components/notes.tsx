import { useEffect, useState } from "react";
import { CardMarkdown, headingId } from "@/components/card-markdown";
import { Button } from "@/components/ui/button";
import {
	CardContent,
	CardHeader,
	CardTitle,
	Card as UICard,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { bun } from "@/lib/rpc";

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

	if (error) {
		return (
			<p className="py-16 text-center text-lg text-muted-foreground">
				Could not load notes: {error}
			</p>
		);
	}
	if (markdown === null) {
		return (
			<div className="space-y-3 py-8">
				<Skeleton className="h-8 w-2/5" />
				<Skeleton className="h-5 w-full" />
				<Skeleton className="h-5 w-4/5" />
			</div>
		);
	}

	const toc = extractToc(markdown);
	if (toc.length === 0) {
		return (
			<p className="py-16 text-center text-lg text-muted-foreground">
				Notes build up here as the lesson covers concepts.
			</p>
		);
	}

	return (
		<div className="space-y-5 pb-24">
			<UICard className="rounded-3xl">
				<CardHeader>
					<CardTitle className="text-lg text-muted-foreground">
						On this page
					</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col items-start gap-0.5">
					{toc.map((entry) => (
						<Button
							key={`${entry.id}-${entry.depth}`}
							type="button"
							variant="ghost"
							size="sm"
							className="h-8 rounded-lg font-normal"
							style={{ marginLeft: `${(entry.depth - 2) * 1.25}rem` }}
							onClick={() =>
								document
									.getElementById(entry.id)
									?.scrollIntoView({ behavior: "smooth", block: "start" })
							}
						>
							{entry.text}
						</Button>
					))}
				</CardContent>
			</UICard>
			<article className="prose prose-lg max-w-none px-2 dark:prose-invert [&_h2]:scroll-mt-20 [&_h3]:scroll-mt-20 [&_h4]:scroll-mt-20">
				<CardMarkdown body={markdown} />
			</article>
		</div>
	);
}
