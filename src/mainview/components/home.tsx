import {
	BookOpen01Icon,
	CheckmarkCircle02Icon,
	Delete02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { bun } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import type { LessonSummary } from "../../shared/types";

function relativeTime(iso: string): string {
	const then = new Date(iso).getTime();
	const mins = Math.round((Date.now() - then) / 60000);
	if (Number.isNaN(mins)) return "";
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	return days === 1 ? "yesterday" : `${days}d ago`;
}

function progressLabel(lesson: LessonSummary): string {
	if (lesson.ended) return "Completed";
	if (lesson.conceptCount === 0) return "Just started";
	const position = lesson.currentIndex >= 0 ? lesson.currentIndex + 1 : 1;
	return `${position} of ${lesson.conceptCount} concepts`;
}

// 0–1 along the outline; a fresh lesson still shows a sliver so the bar
// never reads as "nothing here".
function progressFraction(lesson: LessonSummary): number {
	if (lesson.ended) return 1;
	if (lesson.conceptCount === 0) return 0.06;
	const position = lesson.currentIndex >= 0 ? lesson.currentIndex + 1 : 1;
	return Math.max(position / lesson.conceptCount, 0.06);
}

export function LessonLibrary({
	onResume,
	demoLessons,
	refreshKey,
}: {
	onResume: (id: string) => void;
	demoLessons?: LessonSummary[];
	refreshKey?: number;
}) {
	const [lessons, setLessons] = useState<LessonSummary[] | null>(
		demoLessons ?? null,
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is an intentional trigger — re-fetch the list when returning home
	useEffect(() => {
		if (demoLessons) return;
		bun
			.listLessons({})
			.then((result) => setLessons(result.lessons))
			.catch(() => setLessons([]));
	}, [demoLessons, refreshKey]);

	async function remove(id: string) {
		if (!demoLessons) await bun.deleteLesson({ id }).catch(() => {});
		setLessons((prev) => prev?.filter((lesson) => lesson.id !== id) ?? null);
	}

	if (!lessons || lessons.length === 0) return null;

	return (
		<div className="relative w-full max-w-xl space-y-2.5">
			<p className="px-1 pb-1 text-sm text-muted-foreground">
				Continue a lesson
			</p>
			{lessons.map((lesson) => (
				// The full-card resume button sits under the content as an overlay;
				// the content is click-through so only the delete button competes.
				<div
					key={lesson.id}
					className="group relative flex items-center gap-3.5 rounded-2xl border border-border bg-card p-3.5 shadow-xs transition-all hover:border-foreground/15 hover:shadow-md"
				>
					<button
						type="button"
						onClick={() => onResume(lesson.id)}
						aria-label={`Resume ${lesson.topic}`}
						className="absolute inset-0 rounded-2xl"
					/>
					<span
						className={cn(
							"pointer-events-none relative grid size-10 shrink-0 place-items-center rounded-xl transition-colors",
							lesson.ended
								? "bg-success/12 text-success"
								: "bg-muted text-muted-foreground group-hover:bg-accent group-hover:text-foreground",
						)}
					>
						<HugeiconsIcon
							icon={lesson.ended ? CheckmarkCircle02Icon : BookOpen01Icon}
							className="size-5"
						/>
					</span>
					<span className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-1.5">
						<span className="truncate text-[0.95rem] font-semibold">
							{lesson.topic}
						</span>
						<span className="text-xs text-muted-foreground tabular-nums">
							{progressLabel(lesson)} · {relativeTime(lesson.updatedAt)}
						</span>
						<span className="h-1 w-full overflow-hidden rounded-full bg-border">
							<span
								className={cn(
									"block h-full rounded-full transition-all",
									lesson.ended ? "bg-success/55" : "bg-foreground/45",
								)}
								style={{ width: `${progressFraction(lesson) * 100}%` }}
							/>
						</span>
					</span>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="relative z-10 size-9 shrink-0 rounded-xl text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
						aria-label={`Delete ${lesson.topic}`}
						onClick={() => void remove(lesson.id)}
					>
						<HugeiconsIcon icon={Delete02Icon} className="size-4.5" />
					</Button>
				</div>
			))}
		</div>
	);
}
