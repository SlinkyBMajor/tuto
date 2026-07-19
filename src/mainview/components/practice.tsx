import {
	CancelCircleIcon,
	CheckmarkCircle02Icon,
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
}: {
	items: PracticeItem[];
	onUpdate: (id: number, patch: Partial<PracticeItem>) => void;
}) {
	if (items.length === 0) {
		return (
			<p className="py-16 text-center text-lg text-muted-foreground">
				Exercises appear here as you complete concepts in the lesson.
			</p>
		);
	}
	return (
		<div className="space-y-5 pb-24">
			{items.map((item) => (
				<ExerciseCard key={item.id} item={item} onUpdate={onUpdate} />
			))}
		</div>
	);
}

function ExerciseCard({
	item,
	onUpdate,
}: {
	item: PracticeItem;
	onUpdate: (id: number, patch: Partial<PracticeItem>) => void;
}) {
	const [answer, setAnswer] = useState("");
	const { exercise } = item;

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
		<UICard className="rounded-3xl shadow-sm">
			<CardHeader>
				<CardTitle className="text-xl">{exercise.question}</CardTitle>
			</CardHeader>
			<CardContent className="prose prose-lg max-w-none dark:prose-invert">
				<CardMarkdown
					body={`\`\`\`${exercise.code.language}\n${exercise.code.source}\n\`\`\``}
				/>
			</CardContent>
			{item.status === "open" && (
				<CardContent className="flex flex-col gap-3">
					<form
						className="flex gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (answer.trim()) void check(answer.trim());
						}}
					>
						<Input
							value={answer}
							onChange={(event) => setAnswer(event.target.value)}
							placeholder="What goes in the blank?"
							className="h-11 flex-1 rounded-xl"
						/>
						<Button
							type="submit"
							className="h-11 rounded-xl px-5"
							disabled={!answer.trim()}
						>
							Check
						</Button>
						<Button
							type="button"
							variant="ghost"
							className="h-11 rounded-xl px-4 text-muted-foreground"
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
				<CardContent className="space-y-2">
					<Skeleton className="h-5 w-3/5" />
					<Skeleton className="h-5 w-4/5" />
				</CardContent>
			)}
			{(item.status === "correct" || item.status === "wrong") && (
				<CardContent className="flex flex-col gap-2">
					<div className="flex items-center gap-2">
						<HugeiconsIcon
							icon={
								item.status === "correct"
									? CheckmarkCircle02Icon
									: CancelCircleIcon
							}
							className={
								item.status === "correct"
									? "size-6 text-green-600 dark:text-green-500"
									: "size-6 text-destructive"
							}
						/>
						<span className="font-semibold">
							{item.status === "correct"
								? "Correct"
								: item.userAnswer
									? `Not quite — you answered "${item.userAnswer}"`
									: "Here's how it works"}
						</span>
					</div>
					{item.explanation && (
						<p className="text-muted-foreground">{item.explanation}</p>
					)}
				</CardContent>
			)}
		</UICard>
	);
}
