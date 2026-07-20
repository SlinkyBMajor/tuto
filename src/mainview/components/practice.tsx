import {
	CheckmarkCircle02Icon,
	Idea01Icon,
	Target01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { CardMarkdown } from "@/components/card-markdown";
import { Button } from "@/components/ui/button";
import {
	CardContent,
	CardHeader,
	CardTitle,
	Card as UICard,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { bun } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import type { Exercise } from "../../shared/types";

export interface PracticeItem {
	id: number;
	exercise: Exercise;
	status: "open" | "checking" | "correct" | "wrong";
	userAnswer?: string;
	explanation?: string;
	error?: string;
}

export function PracticePanel({
	items,
	onUpdate,
	conceptTitle,
}: {
	items: PracticeItem[];
	onUpdate: (id: number, patch: Partial<PracticeItem>) => void;
	conceptTitle?: (conceptId?: string) => string | undefined;
}) {
	if (items.length === 0) {
		return (
			<div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-20 text-center">
				<span className="grid size-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
					<HugeiconsIcon icon={Target01Icon} className="size-5.5" />
				</span>
				<p className="max-w-xs text-base text-muted-foreground">
					Exercises appear here as you complete concepts in the lesson.
				</p>
			</div>
		);
	}

	const done = items.filter((item) => item.status !== "open").length;

	return (
		<div className="space-y-4 pb-24">
			{/* The pane header already titles this view, so this row only carries
			    what it doesn't say. */}
			<div className="flex items-baseline justify-between gap-4 px-1 pb-1">
				<p className="text-sm text-muted-foreground">
					One exercise per concept you've covered.
				</p>
				<span className="shrink-0 text-sm text-muted-foreground tabular-nums">
					{done} of {items.length} done
				</span>
			</div>
			{items.map((item, index) => (
				<ExerciseCard
					key={item.id}
					item={item}
					index={index}
					concept={conceptTitle?.(item.exercise.conceptId)}
					onUpdate={onUpdate}
				/>
			))}
		</div>
	);
}

function ExerciseCard({
	item,
	index,
	concept,
	onUpdate,
}: {
	item: PracticeItem;
	index: number;
	concept?: string;
	onUpdate: (id: number, patch: Partial<PracticeItem>) => void;
}) {
	const [answer, setAnswer] = useState("");
	const { exercise } = item;
	const solved = item.status === "correct";

	async function check(userAnswer: string | null) {
		onUpdate(item.id, {
			status: "checking",
			userAnswer: userAnswer ?? undefined,
			error: undefined,
		});
		const result = await bun
			.checkAnswer({ exercise, userAnswer })
			.catch((error: unknown) => ({
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			}));
		if (result.ok) {
			onUpdate(item.id, {
				status: result.correct ? "correct" : "wrong",
				explanation: result.explanation,
			});
		} else {
			onUpdate(item.id, { status: "open", error: result.error });
		}
	}

	return (
		<UICard className={cn(solved && "ring-success/25")}>
			<CardHeader className="gap-2">
				<div
					className={cn(
						"flex items-center gap-1.5 text-sm",
						solved ? "text-success" : "text-muted-foreground",
					)}
				>
					{solved && (
						<HugeiconsIcon
							icon={CheckmarkCircle02Icon}
							className="size-4 shrink-0"
						/>
					)}
					<span className="truncate">{concept ?? `Exercise ${index + 1}`}</span>
				</div>
				<CardTitle className="text-[1.2rem] leading-[1.4] font-[560] tracking-[-0.018em]">
					{exercise.question}
				</CardTitle>
			</CardHeader>
			<CardContent className="[&_.code-block]:my-0">
				<CardMarkdown
					markBlank
					body={`\`\`\`${exercise.code.language}\n${exercise.code.source}\n\`\`\``}
				/>
			</CardContent>
			{item.status === "open" && (
				<CardContent className="flex flex-col gap-2.5">
					<form
						className="flex gap-2.5"
						onSubmit={(event) => {
							event.preventDefault();
							if (answer.trim()) void check(answer.trim());
						}}
					>
						<Input
							value={answer}
							onChange={(event) => setAnswer(event.target.value)}
							placeholder="What goes in the blank?"
							className="h-11 flex-1 rounded-2xl border-border bg-card px-4 font-mono text-[0.95rem]"
						/>
						<Button
							type="submit"
							className="h-11 shrink-0 rounded-2xl px-5"
							disabled={!answer.trim()}
						>
							Check
						</Button>
						<Button
							type="button"
							variant="ghost"
							className="h-11 shrink-0 rounded-2xl px-4 text-muted-foreground"
							onClick={() => void check(null)}
						>
							I don't know
						</Button>
					</form>
					{item.error && (
						<p className="text-sm text-destructive">
							Checking failed: {item.error}
						</p>
					)}
				</CardContent>
			)}
			{item.status === "checking" && (
				<CardContent className="space-y-2.5">
					<Skeleton className="h-4 w-3/5 rounded-md" />
					<Skeleton className="h-4 w-4/5 rounded-md" />
				</CardContent>
			)}
			{(item.status === "correct" || item.status === "wrong") && (
				<CardContent>
					<div
						className={cn(
							"rounded-2xl border p-4",
							solved
								? "border-success/25 bg-success/8"
								: "border-border bg-muted/60",
						)}
					>
						<div className="flex items-center gap-2">
							<HugeiconsIcon
								icon={solved ? CheckmarkCircle02Icon : Idea01Icon}
								className={cn(
									"size-5 shrink-0",
									solved ? "text-success" : "text-muted-foreground",
								)}
							/>
							<span className="text-[0.95rem] font-semibold">
								{solved
									? "Correct"
									: item.userAnswer
										? "Not quite"
										: "Here's how it works"}
							</span>
							{!solved && item.userAnswer && (
								<span className="min-w-0 truncate rounded-md bg-foreground/6 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
									{item.userAnswer}
								</span>
							)}
						</div>
						{item.explanation && (
							<p className="mt-2 text-[0.95rem] leading-relaxed text-muted-foreground">
								{item.explanation}
							</p>
						)}
					</div>
				</CardContent>
			)}
		</UICard>
	);
}
