import {
	CheckmarkCircle02Icon,
	Idea01Icon,
	RefreshIcon,
	Target01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { CardMarkdown } from "@/components/card-markdown";
import { Button } from "@/components/ui/button";
import {
	CardAction,
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
	status: "open" | "checking" | "regenerating" | "correct" | "wrong";
	userAnswer?: string;
	explanation?: string;
	error?: string;
}

// A graded verdict, as opposed to the two transient states. Only these two are
// persisted, and only these two count towards the "done" tally.
function isGraded(status: PracticeItem["status"]): boolean {
	return status === "correct" || status === "wrong";
}

export function PracticePanel({
	items,
	onUpdate,
	conceptTitle,
	lessonMaterial,
}: {
	items: PracticeItem[];
	onUpdate: (id: number, patch: Partial<PracticeItem>) => void;
	conceptTitle?: (conceptId?: string) => string | undefined;
	// The lesson text a replacement exercise must be answerable from. Absent
	// when there is no lesson behind the panel, which hides the button.
	lessonMaterial?: (conceptId?: string) => string;
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

	const done = items.filter((item) => isGraded(item.status)).length;

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
					lessonMaterial={lessonMaterial}
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
	lessonMaterial,
	onUpdate,
}: {
	item: PracticeItem;
	index: number;
	concept?: string;
	lessonMaterial?: (conceptId?: string) => string;
	onUpdate: (id: number, patch: Partial<PracticeItem>) => void;
}) {
	const [answer, setAnswer] = useState("");
	const { exercise } = item;
	const solved = item.status === "correct";
	const busy = item.status === "checking" || item.status === "regenerating";

	// Ask for a different exercise on the same concept. An exercise the model
	// got wrong — a blank nobody can fill, an answer the lesson never taught —
	// is otherwise a dead card the learner can only skip.
	async function regenerate() {
		if (!lessonMaterial) return;
		const previousStatus = item.status;
		onUpdate(item.id, { status: "regenerating", error: undefined });
		const result = await bun
			.regenerateExercise({
				exercise,
				material: lessonMaterial(exercise.conceptId),
				concept,
			})
			.catch((error: unknown) => ({
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			}));
		if (result.ok) {
			setAnswer("");
			onUpdate(item.id, {
				exercise: result.exercise,
				status: "open",
				// The verdict belonged to the question that just went away
				userAnswer: undefined,
				explanation: undefined,
			});
		} else {
			onUpdate(item.id, {
				status: previousStatus,
				error: `Couldn't write a new question: ${result.error}`,
			});
		}
	}

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
			onUpdate(item.id, {
				status: "open",
				error: `Checking failed: ${result.error}`,
			});
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
				{lessonMaterial && (
					<CardAction>
						<Button
							variant="ghost"
							size="sm"
							className="rounded-xl text-muted-foreground"
							disabled={busy}
							onClick={() => void regenerate()}
						>
							<HugeiconsIcon icon={RefreshIcon} />
							{item.status === "regenerating" ? "Writing…" : "New question"}
						</Button>
					</CardAction>
				)}
			</CardHeader>
			<CardContent className="[&_.code-block]:my-0">
				<CardMarkdown
					markBlank
					body={`\`\`\`${exercise.code.language}\n${exercise.code.source}\n\`\`\``}
				/>
			</CardContent>
			{item.status === "open" && (
				<CardContent>
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
				</CardContent>
			)}
			{busy && (
				<CardContent className="space-y-2.5">
					<Skeleton className="h-4 w-3/5 rounded-md" />
					<Skeleton className="h-4 w-4/5 rounded-md" />
				</CardContent>
			)}
			{/* Either call can fail, and a regeneration can fail from a state
			    that has no form to hang the message under. */}
			{item.error && !busy && (
				<CardContent>
					<p className="text-sm text-destructive">{item.error}</p>
				</CardContent>
			)}
			{isGraded(item.status) && (
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
