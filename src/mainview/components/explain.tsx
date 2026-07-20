import { SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { bun } from "@/lib/rpc";

interface Picked {
	term: string;
	context: string;
	top: number;
	bottom: number;
	left: number;
}

interface Panel {
	term: string;
	top: number;
	left: number;
	state: "loading" | "done" | "error";
	text: string;
}

function clampLeft(x: number): number {
	const margin = 180;
	return Math.min(Math.max(x, margin), window.innerWidth - margin);
}

// Select text inside a lesson card to get a quick, context-aware definition
// from the fast model. Mount once inside the lesson view.
export function ExplainSelection({ topic }: { topic: string }) {
	const [picked, setPicked] = useState<Picked | null>(null);
	const [panel, setPanel] = useState<Panel | null>(null);
	const uiRef = useRef<HTMLDivElement>(null);

	// Detect a selection landing inside an explainable card body.
	useEffect(() => {
		function onMouseUp(event: MouseEvent) {
			if (uiRef.current?.contains(event.target as Node)) return;
			// Defer so the browser has finalized the selection
			window.setTimeout(() => {
				const selection = window.getSelection();
				if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
					setPicked(null);
					return;
				}
				const term = selection.toString().trim();
				if (term.length < 2 || term.length > 120) {
					setPicked(null);
					return;
				}
				const range = selection.getRangeAt(0);
				const node = range.startContainer;
				const element =
					node.nodeType === Node.TEXT_NODE
						? node.parentElement
						: (node as HTMLElement);
				const container = element?.closest("[data-explainable]");
				if (!container) {
					setPicked(null);
					return;
				}
				const rect = range.getBoundingClientRect();
				const context = (container.textContent ?? "")
					.replace(/\s+/g, " ")
					.trim()
					.slice(0, 1500);
				setPicked({
					term,
					context,
					top: rect.top,
					bottom: rect.bottom,
					left: rect.left + rect.width / 2,
				});
			}, 0);
		}
		document.addEventListener("mouseup", onMouseUp);
		return () => document.removeEventListener("mouseup", onMouseUp);
	}, []);

	// Dismiss on Escape or scroll (fixed positions go stale on scroll).
	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (event.key === "Escape") {
				setPicked(null);
				setPanel(null);
			}
		}
		function onScroll() {
			setPicked(null);
			setPanel(null);
		}
		document.addEventListener("keydown", onKey);
		window.addEventListener("scroll", onScroll, true);
		return () => {
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("scroll", onScroll, true);
		};
	}, []);

	// A mousedown outside our UI closes the open panel (and starts any new
	// selection, which the mouseup handler then picks up).
	useEffect(() => {
		if (!panel) return;
		function onDown(event: MouseEvent) {
			if (!uiRef.current?.contains(event.target as Node)) setPanel(null);
		}
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [panel]);

	async function explain() {
		if (!picked) return;
		const { term, context, bottom, left } = picked;
		setPanel({ term, top: bottom + 10, left, state: "loading", text: "" });
		setPicked(null);
		const result = await bun
			.explainTerm({ term, context: `Lesson topic: ${topic}\n\n${context}` })
			.catch(() => null);
		setPanel((prev) => {
			if (!prev || prev.term !== term) return prev; // superseded
			if (result?.ok)
				return { ...prev, state: "done", text: result.explanation };
			return {
				...prev,
				state: "error",
				text:
					result && !result.ok
						? result.error
						: "Could not explain that right now.",
			};
		});
	}

	return (
		<div ref={uiRef}>
			{picked && !panel && (
				<button
					type="button"
					onClick={explain}
					style={{
						position: "fixed",
						left: clampLeft(picked.left),
						top: Math.max(picked.top - 44, 8),
						transform: "translateX(-50%)",
					}}
					className="z-50 flex items-center gap-1.5 rounded-full bg-marker px-3.5 py-2 text-sm font-medium text-marker-foreground shadow-lg ring-1 ring-foreground/10 transition-transform hover:scale-[1.03]"
				>
					<HugeiconsIcon icon={SparklesIcon} className="size-4" />
					Explain
				</button>
			)}
			{panel && (
				<div
					style={{
						position: "fixed",
						left: clampLeft(panel.left),
						top: panel.top,
						transform: "translateX(-50%)",
					}}
					className="animate-in fade-in-0 zoom-in-95 z-50 w-80 max-w-[90vw] rounded-2xl bg-popover p-4 text-popover-foreground shadow-xl ring-1 ring-foreground/8 duration-150"
				>
					<p className="mb-2.5 flex items-center gap-1.5 border-b border-border pb-2.5 text-sm font-semibold">
						<HugeiconsIcon
							icon={SparklesIcon}
							className="size-4 shrink-0 text-marker"
						/>
						<span className="truncate">{panel.term}</span>
					</p>
					{panel.state === "loading" ? (
						<div className="space-y-2">
							<Skeleton className="h-4 w-full" />
							<Skeleton className="h-4 w-4/5" />
						</div>
					) : (
						<div
							className={
								panel.state === "error"
									? "text-sm text-destructive"
									: "prose prose-sm max-w-none dark:prose-invert"
							}
						>
							<Markdown>{panel.text}</Markdown>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
