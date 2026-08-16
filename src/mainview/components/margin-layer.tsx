import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// Anything that hangs in the margin beside a section: a sticky note, a question
// thread. The layer knows only where each one wants to sit — what it looks like
// is the caller's business.
export interface MarginAnchor {
	id: string;
	itemId: number;
	segmentIndex: number;
}

// Vertical breathing room between two items the layout had to push apart
const STACK_GAP = 10;

function sectionOf(itemId: number, segmentIndex: number): HTMLElement | null {
	const card = document.querySelector(`[data-item-id="${itemId}"]`);
	const segments = card?.querySelectorAll("[data-segment]");
	return (segments?.[segmentIndex] as HTMLElement | undefined) ?? null;
}

/**
 * The margin beside the feed, and everything pinned into it.
 *
 * Each item wants to sit level with the section it belongs to, and two items on
 * neighbouring sections would then overlap — so this lays them out: sort by
 * where each one wants to be, then walk down, pushing any item that would
 * collide below the one before it. Positions are written straight to the DOM (a
 * transform per item) rather than held in state, for the same reason the
 * reading highlight is: they are measurements of rendered content, and feeding
 * them back through React would re-render the feed on every observed resize.
 *
 * Re-measured whenever the items change, whenever the feed's own height changes
 * (a diagram or a code block finishing its async render moves every section
 * below it), and whenever an item's own height changes — a note's textarea
 * growing, or a thread being opened into a full conversation.
 *
 * Notes and threads share one layer rather than getting a column each. They are
 * pinned to the same sections, so two columns would leave each with holes where
 * the other's items are, and a note would drift away from the paragraph it
 * belongs to. Sorting them together is what keeps everything level with its own
 * section.
 */
export function MarginLayer<T extends MarginAnchor>({
	items,
	// The element whose height changes mean the anchors have moved
	feedRef,
	className,
	renderItem,
}: {
	items: readonly T[];
	feedRef: React.RefObject<HTMLDivElement | null>;
	className?: string;
	renderItem: (
		item: T,
		register: (el: HTMLDivElement | null) => void,
	) => ReactNode;
}) {
	const layerRef = useRef<HTMLDivElement>(null);
	const itemEls = useRef(new Map<string, HTMLDivElement>());

	const layout = useCallback(() => {
		const layer = layerRef.current;
		if (!layer) return;
		const layerTop = layer.getBoundingClientRect().top;
		const placed = [];
		for (const item of items) {
			const el = itemEls.current.get(item.id);
			if (!el) continue;
			const anchor = sectionOf(item.itemId, item.segmentIndex);
			// An item whose section is not in the DOM has nothing to sit beside.
			// Hiding beats stacking it at the top of the feed under a card it has
			// no relation to.
			if (!anchor) {
				el.style.visibility = "hidden";
				continue;
			}
			el.style.visibility = "";
			placed.push({
				el,
				want: anchor.getBoundingClientRect().top - layerTop,
				height: el.offsetHeight,
			});
		}
		placed.sort((a, b) => a.want - b.want);
		let cursor = Number.NEGATIVE_INFINITY;
		for (const item of placed) {
			const top = Math.max(item.want, cursor);
			item.el.style.transform = `translateY(${Math.round(top)}px)`;
			if (item.el.dataset.placed === undefined) {
				// An item's FIRST placement has to land instantly. The transition
				// (see .margin-item[data-placed]) is for one being nudged by content
				// that grew underneath it; on a new one it would animate down from
				// the top of the feed instead — and while that runs, the item really
				// is up there, which is where focusing it sends the scroll.
				// Reading a layout property commits the transform before the class
				// that would transition it goes on.
				void item.el.offsetHeight;
				item.el.dataset.placed = "";
			}
			cursor = top + item.height + STACK_GAP;
		}
	}, [items]);

	// Runs before paint so a new item never shows up at the top of the layer
	// for a frame before finding its section.
	useLayoutEffect(layout);

	// The feed grows under its own steam: diagrams render, code blocks
	// highlight, cards stream in. Every one of those moves the anchors.
	useEffect(() => {
		const feed = feedRef.current;
		if (!feed) return;
		const observer = new ResizeObserver(layout);
		observer.observe(feed);
		for (const el of itemEls.current.values()) observer.observe(el);
		window.addEventListener("resize", layout);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", layout);
		};
	}, [feedRef, layout]);

	return (
		<aside ref={layerRef} className={cn("margin-layer", className)}>
			{items.map((item) =>
				renderItem(item, (el) => {
					if (el) itemEls.current.set(item.id, el);
					else itemEls.current.delete(item.id);
				}),
			)}
		</aside>
	);
}
