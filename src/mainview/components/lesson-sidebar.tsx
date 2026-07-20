import {
	ArrowLeft01Icon,
	BookOpen01Icon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OutlineItem } from "../../shared/types";

export interface LessonStats {
	cards: number;
	practiceDone: number;
	practiceTotal: number;
}

// Everything *about* the lesson: where you are in it, how much is left, and
// the outline as a navigable list. The feed itself stays on the right.
export function LessonSidebar({
	topic,
	outline,
	currentIndex,
	stats,
	lessonEnded,
	feedConcepts,
	onSelectConcept,
	onCollapse,
}: {
	topic: string;
	outline: OutlineItem[] | null;
	currentIndex: number;
	stats: LessonStats;
	lessonEnded: boolean;
	// Concepts the feed actually has a card for — the outline can name a
	// concept before any card teaches it, and a revised outline can drop one.
	feedConcepts: ReadonlySet<string>;
	onSelectConcept: (conceptId: string) => void;
	onCollapse: () => void;
}) {
	const total = outline?.length ?? 0;
	// A finished lesson has covered its last concept, not currentIndex + 1 of them
	const covered = lessonEnded ? total : Math.max(currentIndex + 1, 0);
	const fraction = total > 0 ? covered / total : 0;

	return (
		<aside className="flex w-[20rem] shrink-0 flex-col border-r border-border bg-foreground/3">
			<div className="flex items-start gap-3 px-4 pt-4 pb-3">
				<span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
					<HugeiconsIcon icon={BookOpen01Icon} className="size-4.5" />
				</span>
				<div className="min-w-0 flex-1 pt-0.5">
					<p className="text-xs text-muted-foreground">Lesson</p>
					<h2 className="text-[0.95rem] leading-snug font-[560] tracking-[-0.012em]">
						{topic || "Untitled lesson"}
					</h2>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="-mr-1 size-8 shrink-0 rounded-lg text-muted-foreground"
					aria-label="Hide lesson panel"
					onClick={onCollapse}
				>
					<HugeiconsIcon icon={ArrowLeft01Icon} className="size-4.5" />
				</Button>
			</div>

			<div className="px-5 pb-5">
				<div>
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
					<div className="mt-4 grid grid-cols-2 gap-3">
						<Stat label="Cards" value={String(stats.cards)} />
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
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
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
		</aside>
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
