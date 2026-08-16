import { HierarchyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import type { Hierarchy } from "../../shared/types";

/**
 * Where everything the lesson has named sits inside everything else.
 *
 * A learner meeting "project", "stack" and "resource" one card at a time can
 * know all three words and still not be able to say which contains which. This
 * is the answer to that, and the reason it is drawn by the app rather than
 * described in prose: it appears in the same shape every time, so it reads as
 * one picture being added to rather than as three separate explanations.
 *
 * The tutor sends the whole tree whenever it grows, so nothing here accumulates
 * — what arrives is what is drawn.
 */
export function HierarchyNote({ hierarchy }: { hierarchy: Hierarchy }) {
	const current = hierarchy.current?.toLowerCase();
	return (
		<div className="hierarchy" data-segment>
			<p className="hierarchy__label">
				<HugeiconsIcon icon={HierarchyIcon} className="size-3.5 shrink-0" />
				The hierarchy so far
			</p>
			<ol className="hierarchy__tree" data-section-text>
				{hierarchy.levels.map((level, index) => (
					<li
						// Rungs are positional and can legitimately repeat a name at
						// different depths, so the index is the only stable key.
						// biome-ignore lint/suspicious/noArrayIndexKey: see above — the tree is redrawn whole on every change, never reordered in place
						key={`${level.name}-${index}`}
						className={cn(
							"hierarchy__level",
							// A rung one deeper than the one before it is drawn with an
							// elbow into it; a sibling gets a plain tick.
							level.depth > 0 && "hierarchy__level--nested",
							current === level.name.toLowerCase() && "is-current",
						)}
						style={{ "--depth": level.depth } as React.CSSProperties}
					>
						<span className="hierarchy__name">{level.name}</span>
						{level.note && (
							<span className="hierarchy__note">{level.note}</span>
						)}
					</li>
				))}
			</ol>
		</div>
	);
}
