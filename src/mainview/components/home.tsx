import { BookOpen01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { bun } from "@/lib/rpc";
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
		<div className="w-full max-w-xl space-y-3">
			<p className="px-1 text-sm font-medium text-muted-foreground">
				Continue a lesson
			</p>
			{lessons.map((lesson) => (
				// The full-card resume button sits under the content as an overlay;
				// the content is click-through so only the delete button competes.
				<div
					key={lesson.id}
					className="relative flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:bg-accent"
				>
					<button
						type="button"
						onClick={() => onResume(lesson.id)}
						aria-label={`Resume ${lesson.topic}`}
						className="absolute inset-0 rounded-2xl"
					/>
					<HugeiconsIcon
						icon={BookOpen01Icon}
						className="pointer-events-none relative size-6 shrink-0 text-muted-foreground"
					/>
					<span className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="truncate font-semibold">{lesson.topic}</span>
						<span className="text-sm text-muted-foreground">
							{progressLabel(lesson)} · {relativeTime(lesson.updatedAt)}
						</span>
					</span>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="relative z-10 size-9 shrink-0 rounded-xl text-muted-foreground hover:text-destructive"
						aria-label={`Delete ${lesson.topic}`}
						onClick={() => void remove(lesson.id)}
					>
						<HugeiconsIcon icon={Delete02Icon} className="size-5" />
					</Button>
				</div>
			))}
		</div>
	);
}
