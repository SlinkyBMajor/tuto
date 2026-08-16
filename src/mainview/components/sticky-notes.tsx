import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { MarginAnchor } from "@/components/margin-layer";
import { RAW_TEXT_INPUT } from "@/lib/text-input";
import { cn } from "@/lib/utils";

// The pool a new note picks from. Names, not values: the values are theme
// tokens (see index.css) so a note reads as paper in light mode and as a tinted
// card in dark, and a saved note keeps its identity across both.
export const STICKY_COLORS = [
	"butter",
	"rose",
	"sky",
	"mint",
	"lilac",
] as const;

export type StickyColor = (typeof STICKY_COLORS)[number];

export function randomStickyColor(): StickyColor {
	const index = Math.floor(Math.random() * STICKY_COLORS.length);
	return STICKY_COLORS[index] ?? "butter";
}

// A colour read back off disk, where it is only a string.
export function asStickyColor(value: string): StickyColor {
	return (STICKY_COLORS as readonly string[]).includes(value)
		? (value as StickyColor)
		: "butter";
}

export function newStickyId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// A sticky as the webview holds it: anchored to a live feed item rather than to
// a saved position (see SavedSticky for what goes to disk).
export interface Sticky extends MarginAnchor {
	text: string;
	color: StickyColor;
}

// A note is as tall as what it holds — a textarea with a scrollbar in it is not
// a sticky note.
function fit(el: HTMLTextAreaElement) {
	el.style.height = "auto";
	el.style.height = `${el.scrollHeight}px`;
}

// One note in the margin. Positioning is MarginLayer's job; this is the paper.
export function StickyCard({
	sticky,
	autoFocus,
	onFocused,
	onChange,
	onRemove,
	onDone,
	register,
}: {
	sticky: Sticky;
	autoFocus: boolean;
	onFocused: () => void;
	onChange: (id: string, text: string) => void;
	onRemove: (id: string) => void;
	onDone: (sticky: Sticky) => void;
	register: (el: HTMLDivElement | null) => void;
}) {
	const textRef = useRef<HTMLTextAreaElement>(null);
	// What is being typed stays here. Lifting every keystroke into the lesson's
	// state would re-render the whole feed behind it and rewrite lesson.json
	// once per character; the text reaches the lesson when the learner leaves
	// the note, and on a pause long enough that closing the app would lose it.
	const [draft, setDraft] = useState(sticky.text);

	useLayoutEffect(() => {
		if (textRef.current) fit(textRef.current);
	}, []);

	useEffect(() => {
		if (draft === sticky.text) return;
		const timer = window.setTimeout(() => onChange(sticky.id, draft), 800);
		return () => window.clearTimeout(timer);
	}, [draft, sticky.text, sticky.id, onChange]);

	useEffect(() => {
		if (!autoFocus) return;
		// preventScroll, always. A note is placed with a transform inside a layer
		// whose own box sits at the top of the feed, and the browser scrolls to
		// the box, not to where the note was moved — so letting focus scroll
		// throws the learner back to the first card.
		textRef.current?.focus({ preventScroll: true });
		onFocused();
	}, [autoFocus, onFocused]);

	function commit() {
		// A note nobody wrote anything in is a slip, not a note
		if (!draft.trim()) onRemove(sticky.id);
		else if (draft !== sticky.text) onChange(sticky.id, draft);
	}

	function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
		const done =
			event.key === "Escape" ||
			(event.key === "Enter" && (event.metaKey || event.ctrlKey));
		if (!done) return;
		event.preventDefault();
		// The window-level reading keys ignore anything inside a note, but a
		// stray Escape reaching them would drop the reading position we are
		// about to restore.
		event.stopPropagation();
		textRef.current?.blur();
		onDone(sticky);
	}

	return (
		<div
			ref={register}
			data-sticky
			className={cn("margin-item sticky-note", `sticky-note--${sticky.color}`)}
		>
			<textarea
				ref={textRef}
				value={draft}
				placeholder="Note…"
				rows={1}
				className="sticky-note__text"
				{...RAW_TEXT_INPUT}
				onChange={(event) => {
					fit(event.currentTarget);
					setDraft(event.target.value);
				}}
				onKeyDown={onKeyDown}
				onBlur={commit}
			/>
			<button
				type="button"
				className="sticky-note__remove"
				aria-label="Delete note"
				// Mouse-down would blur the textarea first, and an empty note
				// removes itself on blur — the click would then land on nothing.
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => onRemove(sticky.id)}
			>
				<HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
			</button>
		</div>
	);
}
