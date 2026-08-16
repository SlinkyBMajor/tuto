import { BookOpen01Icon, FolderCodeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { ProjectRef } from "../../shared/types";

// Which part of getting started the lesson is in. Both happen before the
// outline exists, and both can keep the learner waiting long enough to wonder
// whether anything is happening.
export type PlanningStage = "level" | "outline";

// The trail of lookups is the most reassuring thing on screen, but a long one
// pushes everything else off; keep the last few.
const TRAIL_LENGTH = 4;
// A clock on a five-second wait is noise. On a two-minute one it is the
// difference between waiting and wondering if it has hung.
const CLOCK_AFTER_MS = 8_000;

function elapsedLabel(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function useElapsed(): number {
	const [seconds, setSeconds] = useState(0);
	useEffect(() => {
		const started = Date.now();
		const timer = window.setInterval(
			() => setSeconds(Math.round((Date.now() - started) / 1000)),
			1000,
		);
		return () => window.clearInterval(timer);
	}, []);
	return seconds;
}

// The accent wash behind the planning panel — the same one the home screen
// uses, so starting a lesson belongs to the same moment as asking for one.
//
// It is painted on the content pane rather than inside the panel, because the
// panel lives in the scrolling reading column: in there the gradient stopped
// dead at the column's edges and its brightest part scrolled up under the
// header. As pane chrome it spans the full width and stays put.
export function PlanningWash() {
	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklch,var(--marker)_12%,transparent),transparent_72%)]"
		/>
	);
}

// Shown while a lesson is being set up: the tutor is deciding where to start,
// or planning the outline and writing the first card. This is the longest wait
// in the app — minutes, when it reads a large project — so it gets a screen of
// its own rather than the skeleton card a mid-lesson turn gets, and it shows
// the real signals: what is being read, and how long it has been going.
export function LessonPlanning({
	topic,
	project,
	stage,
	activity,
	trail,
}: {
	topic: string;
	// Set when the lesson is being taught from a project on this machine
	project?: ProjectRef;
	stage: PlanningStage;
	// What the tutor is doing right now, when it has tools to do it with
	activity?: string;
	// Everything it has opened so far this turn
	trail: string[];
}) {
	const seconds = useElapsed();
	const planning = stage === "outline";
	// The last few lookups before the current one. The trail only ever grows, so
	// a line's position in it is a stable key even when the same file is opened
	// twice.
	const from = Math.max(trail.length - TRAIL_LENGTH - 1, 0);
	const recent = trail
		.slice(from, -1)
		.map((line, offset) => ({ line, id: from + offset }));

	return (
		<div
			data-planning
			className="relative flex flex-col items-center px-6 py-14 text-center animate-in fade-in-0 duration-500"
		>
			<span className="relative mb-7 grid size-14 place-items-center">
				{/* Two rings out of phase: a slow pulse that reads as working
				    rather than as a progress bar we cannot honestly draw */}
				<span
					aria-hidden
					className="absolute size-14 animate-ping rounded-full bg-marker/15 [animation-duration:2.8s]"
				/>
				<span
					aria-hidden
					className="absolute size-11 animate-ping rounded-full bg-marker/20 [animation-duration:2.8s] [animation-delay:0.9s]"
				/>
				<span className="relative grid size-12 place-items-center rounded-2xl bg-card shadow-sm ring-1 ring-border">
					<HugeiconsIcon
						icon={project ? FolderCodeIcon : BookOpen01Icon}
						className="size-6 text-marker"
					/>
				</span>
			</span>

			<h2 className="relative text-[1.6rem] leading-tight font-[560] tracking-[-0.022em]">
				<span className="shimmer">
					{planning ? "Planning your lesson" : "Sizing up the lesson"}
				</span>
			</h2>

			<p className="relative mt-2.5 max-w-md text-[0.95rem] text-muted-foreground">
				{planning
					? project
						? `Reading ${project.name}, picking the concepts to teach, and writing the first card.`
						: "Picking the concepts to teach and writing the first card."
					: "Working out where to start, so the lesson lands at the right level."}
			</p>

			<p className="relative mt-5 max-w-lg text-[0.95rem] text-foreground/80 italic">
				“{topic}”
			</p>

			{/* What it is actually doing. Only a lesson with tools has this, and
			    only while a lookup is in flight. */}
			{activity && (
				<div className="relative mt-8 flex w-full max-w-md flex-col items-center gap-1.5">
					{recent.map((entry, index) => (
						<p
							key={entry.id}
							className={cn(
								"max-w-full truncate text-xs text-muted-foreground/70 tabular-nums",
								// The oldest line fades out rather than vanishing
								index === 0 && recent.length > 2 && "opacity-40",
							)}
						>
							{entry.line}
						</p>
					))}
					<p className="flex max-w-full items-center gap-2 text-sm text-muted-foreground animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
						<span className="relative flex size-1.5 shrink-0">
							<span className="absolute inline-flex size-full animate-ping rounded-full bg-marker/60" />
							<span className="relative inline-flex size-1.5 rounded-full bg-marker" />
						</span>
						<span className="truncate">{activity}</span>
					</p>
				</div>
			)}

			{seconds * 1000 >= CLOCK_AFTER_MS && (
				<p className="relative mt-8 text-xs text-muted-foreground/70 tabular-nums animate-in fade-in-0 duration-700">
					{elapsedLabel(seconds)} · this one takes a while
				</p>
			)}
		</div>
	);
}
