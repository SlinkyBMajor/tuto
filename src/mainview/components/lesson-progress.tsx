import {
	ArrowDown01Icon,
	BookOpen01Icon,
	Flag01Icon,
	FolderCodeIcon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { shortPath } from "@/components/project-picker";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { LessonGoal, OutlineItem, ProjectRef } from "../../shared/types";

export interface LessonStats {
	cards: number;
	practiceDone: number;
	practiceTotal: number;
	// Lab lessons only: steps the learner has done, out of the steps handed out
	// so far. Absent in every other mode, where there is nothing to do.
	stepsDone?: number;
	stepsTotal?: number;
}

const RING_RADIUS = 8;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Everything *about* the lesson — where you are in it, how much is left, and
 * the outline as a navigable list — folded into one pill in the top-left
 * corner, where the panel it opens used to be docked.
 *
 * It is a pill and not a 20rem column because the margin now competes for the
 * same width: a thread beside the feed wants 24rem, and a permanent sidebar
 * meant the reading column paid for it on any normal window. What that column
 * showed at all times was a progress bar and a list you consult a few times a
 * lesson — so the bar becomes a ring you can read at a glance, the current
 * chapter stays spelled out beside it, and the list is one click away.
 *
 * The panel floats over the feed rather than pushing it: a lesson you are
 * mid-sentence in must not slide sideways because you wanted to check how far
 * along you are.
 */
export function LessonProgress({
	topic,
	project,
	goal,
	outline,
	currentIndex,
	stats,
	lessonEnded,
	feedConcepts,
	onSelectConcept,
}: {
	topic: string;
	// Set when the lesson is being taught from a project on this machine
	project?: ProjectRef;
	// Set when this lesson is groundwork for another subject
	goal?: LessonGoal;
	outline: OutlineItem[] | null;
	currentIndex: number;
	stats: LessonStats;
	lessonEnded: boolean;
	// Concepts the feed actually has a card for — the outline can name a
	// concept before any card teaches it, and a revised outline can drop one.
	feedConcepts: ReadonlySet<string>;
	onSelectConcept: (conceptId: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const total = outline?.length ?? 0;
	// A finished lesson has covered its last concept, not currentIndex + 1 of them
	const covered = lessonEnded ? total : Math.max(currentIndex + 1, 0);
	const fraction = total > 0 ? covered / total : 0;
	// A finished lesson has no current chapter, and naming the last one taught
	// beside a full ring reads as being stuck on it.
	const chapter = lessonEnded
		? "Lesson complete"
		: (outline?.[currentIndex]?.title ?? "Getting started");
	const lesson = topic || "Untitled lesson";

	return (
		<div className="flex min-w-0 items-center gap-3">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger
					render={
						<button
							type="button"
							title={`${lesson} — ${chapter}`}
							className="flex h-11 min-w-0 max-w-[22rem] items-center gap-2.5 rounded-full pr-2 pl-2.5 text-left transition-colors hover:bg-muted data-popup-open:bg-muted"
						/>
					}
				>
					<ProgressRing
						className="size-7"
						fraction={fraction}
						done={lessonEnded}
					/>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-xs text-muted-foreground">
							{lesson}
						</span>
						<span className="block truncate text-sm leading-snug font-[560] tracking-[-0.012em]">
							{chapter}
						</span>
					</span>
					<HugeiconsIcon
						icon={ArrowDown01Icon}
						className="size-4 shrink-0 text-muted-foreground"
					/>
				</PopoverTrigger>
				<PopoverContent
					align="start"
					sideOffset={6}
					className="w-[21rem] gap-0 p-0"
				>
					<LessonPanel
						topic={lesson}
						project={project}
						goal={goal}
						outline={outline}
						currentIndex={currentIndex}
						covered={covered}
						total={total}
						fraction={fraction}
						stats={stats}
						lessonEnded={lessonEnded}
						feedConcepts={feedConcepts}
						onSelectConcept={(conceptId) => {
							setOpen(false);
							onSelectConcept(conceptId);
						}}
					/>
				</PopoverContent>
			</Popover>
			{goal && (
				// A detour is easy to mistake for having lost the thread, so the
				// destination stays on screen for the whole of it — not behind a
				// click, and not only on the recap card at the end.
				<p
					className="hidden min-w-0 items-center gap-1 text-xs text-marker sm:flex"
					title={`This lesson is groundwork for ${goal.topic}`}
				>
					<HugeiconsIcon
						icon={Flag01Icon}
						className="size-3 shrink-0"
						strokeWidth={2}
					/>
					<span className="truncate">on the way to {goal.topic}</span>
				</p>
			)}
		</div>
	);
}

// The ring the pill wears: the same fraction the panel's bar shows, in the
// space a bar could not fit. Drawn from 12 o'clock — hence the rotation.
function ProgressRing({
	fraction,
	done,
	className,
}: {
	fraction: number;
	done: boolean;
	className?: string;
}) {
	return (
		<svg
			viewBox="0 0 20 20"
			aria-hidden="true"
			className={cn("shrink-0 -rotate-90", className)}
		>
			<circle
				cx="10"
				cy="10"
				r={RING_RADIUS}
				fill="none"
				strokeWidth="2.5"
				className="stroke-border"
			/>
			{/* At zero a round cap would still draw a dot at 12 o'clock, which
			    reads as progress nobody has made yet. */}
			{fraction > 0 && (
				<circle
					cx="10"
					cy="10"
					r={RING_RADIUS}
					fill="none"
					strokeWidth="2.5"
					strokeLinecap="round"
					strokeDasharray={`${(RING_LENGTH * fraction).toFixed(2)} ${RING_LENGTH.toFixed(2)}`}
					className={cn(
						"transition-[stroke-dasharray] duration-500",
						done ? "stroke-success/70" : "stroke-foreground/60",
					)}
				/>
			)}
		</svg>
	);
}

function LessonPanel({
	topic,
	project,
	goal,
	outline,
	currentIndex,
	covered,
	total,
	fraction,
	stats,
	lessonEnded,
	feedConcepts,
	onSelectConcept,
}: {
	topic: string;
	project?: ProjectRef;
	goal?: LessonGoal;
	outline: OutlineItem[] | null;
	currentIndex: number;
	covered: number;
	total: number;
	fraction: number;
	stats: LessonStats;
	lessonEnded: boolean;
	feedConcepts: ReadonlySet<string>;
	onSelectConcept: (conceptId: string) => void;
}) {
	return (
		<>
			<div className="flex items-start gap-3 px-4 pt-4 pb-3">
				<span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
					<HugeiconsIcon
						icon={project ? FolderCodeIcon : BookOpen01Icon}
						className="size-4.5"
					/>
				</span>
				<div className="min-w-0 flex-1 pt-0.5">
					<p className="text-xs text-muted-foreground">Lesson</p>
					<h2 className="text-[0.95rem] leading-snug font-[560] tracking-[-0.012em]">
						{topic}
					</h2>
					{project && (
						// The lesson is only as true as the code it was read from, so
						// name that folder where the learner can always find it
						<p
							className="mt-1 truncate text-xs text-muted-foreground"
							title={project.path}
						>
							{shortPath(project.path)}
						</p>
					)}
					{goal && (
						<p className="mt-1 flex items-center gap-1 text-xs text-marker">
							<HugeiconsIcon
								icon={Flag01Icon}
								className="size-3 shrink-0"
								strokeWidth={2}
							/>
							<span className="truncate">on the way to {goal.topic}</span>
						</p>
					)}
				</div>
			</div>

			<div className="px-5 pb-5">
				<div className="flex items-baseline justify-between gap-2">
					<span className="text-sm text-muted-foreground">
						{lessonEnded ? "Completed" : "Progress"}
					</span>
					<span className="text-sm font-medium tabular-nums">
						{total > 0 ? `${covered} of ${total}` : "—"}
					</span>
				</div>
				<span className="mt-2.5 block h-1.5 w-full overflow-hidden rounded-full bg-border">
					<span
						className={cn(
							"block h-full rounded-full transition-all duration-500",
							lessonEnded ? "bg-success/60" : "bg-foreground/55",
						)}
						style={{ width: `${Math.round(fraction * 100)}%` }}
					/>
				</span>
				<div
					className={cn(
						"mt-4 grid gap-3",
						stats.stepsTotal ? "grid-cols-3" : "grid-cols-2",
					)}
				>
					<Stat label="Cards" value={String(stats.cards)} />
					{/* A lab lesson is measured in steps taken, not only in cards
					    read — and the count is the learner's own tally, since the
					    app checked none of them. */}
					{stats.stepsTotal ? (
						<Stat
							label="Steps"
							value={`${stats.stepsDone ?? 0}/${stats.stepsTotal}`}
						/>
					) : null}
					<Stat
						label="Exercises"
						value={
							stats.practiceTotal > 0
								? `${stats.practiceDone}/${stats.practiceTotal}`
								: "—"
						}
					/>
				</div>
			</div>

			{/* The list scrolls inside the panel: a long outline must not push the
			    popover past the bottom of the window. */}
			<div className="max-h-[min(20rem,45vh)] min-h-0 overflow-y-auto px-4 pb-4">
				<p className="px-1 pb-2 text-sm text-muted-foreground">Concepts</p>
				{outline && outline.length > 0 ? (
					<ol className="space-y-0.5">
						{outline.map((item, index) => (
							<ConceptRow
								key={item.id}
								index={index}
								title={item.title}
								state={conceptState(index, currentIndex, lessonEnded)}
								reachable={feedConcepts.has(item.id)}
								onSelect={() => onSelectConcept(item.id)}
							/>
						))}
					</ol>
				) : (
					<p className="px-1 text-sm text-muted-foreground">
						The tutor drafts the outline on the first card.
					</p>
				)}
			</div>
		</>
	);
}

type ConceptState = "covered" | "current" | "upcoming";

function conceptState(
	index: number,
	currentIndex: number,
	lessonEnded: boolean,
): ConceptState {
	if (lessonEnded) return "covered";
	if (index < currentIndex) return "covered";
	if (index === currentIndex) return "current";
	return "upcoming";
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<p className="truncate text-xs text-muted-foreground">{label}</p>
			<p className="text-base font-[560] tabular-nums">{value}</p>
		</div>
	);
}

function ConceptRow({
	index,
	title,
	state,
	reachable,
	onSelect,
}: {
	index: number;
	title: string;
	state: ConceptState;
	reachable: boolean;
	onSelect: () => void;
}) {
	return (
		<li>
			<button
				type="button"
				disabled={!reachable}
				onClick={onSelect}
				className={cn(
					"flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors",
					state === "current" && "bg-accent",
					reachable && state !== "current" && "hover:bg-muted",
					!reachable && "cursor-default",
				)}
			>
				<span
					className={cn(
						"grid size-6 shrink-0 place-items-center rounded-full text-[0.7rem] font-medium tabular-nums",
						state === "covered" && "bg-success/12 text-success",
						state === "current" && "bg-foreground text-background",
						state === "upcoming" && "bg-muted text-muted-foreground",
					)}
				>
					{state === "covered" ? (
						<HugeiconsIcon icon={Tick02Icon} className="size-3.5" />
					) : (
						index + 1
					)}
				</span>
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-sm",
						state === "upcoming" ? "text-muted-foreground" : "text-foreground",
						state === "current" && "font-medium",
					)}
				>
					{title}
				</span>
			</button>
		</li>
	);
}
