import {
	Cancel01Icon,
	MessageQuestionIcon,
	SentIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import Markdown from "react-markdown";
import type { MarginAnchor } from "@/components/margin-layer";
import { Skeleton } from "@/components/ui/skeleton";
import { RAW_TEXT_INPUT } from "@/lib/text-input";
import { cn } from "@/lib/utils";
import { stripCardRefs } from "../../shared/card-refs";
import type { ThreadMessage } from "../../shared/types";

// A conversation about one section, as the webview holds it. Anchored to a live
// feed item rather than to a saved position — see SavedThread for what goes to
// disk.
export interface Thread extends MarginAnchor {
	messages: ThreadMessage[];
	// An answer is in flight for the last question
	pending?: boolean;
	// The last question failed; it stays in `messages` so it can be retried
	error?: string;
}

export function newThreadId(): string {
	return `q${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// How many questions this section has asked — the number the gutter marker
// shows. Answers are not counted: the learner is looking for how many things
// they wondered about here, not how many paragraphs came back.
export function questionCount(thread: Thread): number {
	return thread.messages.filter((message) => message.role === "user").length;
}

/**
 * One question thread in the margin.
 *
 * Closed, it is a card: the opening question and the beginning of its answer,
 * so a lesson with several threads still reads as a lesson with margin notes on
 * it. Open, the same card becomes the conversation — every message, and a box
 * to send the next one. Only one thread is open at a time, which is what keeps
 * the margin from turning into a wall of chat.
 *
 * The reading keys deliberately do not reach inside it. Stepping through
 * sections is how you read the lesson; a thread is where you stop reading and
 * talk, so it takes the keyboard for itself while it is open.
 */
export function ThreadCard({
	thread,
	open,
	sectionText,
	onOpen,
	onClose,
	onAsk,
	onRemove,
	register,
}: {
	thread: Thread;
	open: boolean;
	// The passage this thread hangs off, for the header when it is open
	sectionText: string;
	onOpen: () => void;
	onClose: () => void;
	onAsk: (question: string) => void;
	onRemove: () => void;
	register: (el: HTMLDivElement | null) => void;
}) {
	const [draft, setDraft] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const endRef = useRef<HTMLDivElement>(null);
	const first = thread.messages[0];
	const answer = thread.messages.find((message) => message.role === "tutor");

	// Opening puts the cursor in the box: a thread is opened to say something.
	// preventScroll for the same reason a note focuses that way — this card is
	// placed with a transform inside a layer whose own box sits at the top of
	// the feed, and the browser would scroll to the box.
	useEffect(() => {
		if (open) inputRef.current?.focus({ preventScroll: true });
	}, [open]);

	// Follow the conversation as it grows, inside the thread's own scroller
	useLayoutEffect(() => {
		if (open) endRef.current?.scrollIntoView({ block: "nearest" });
	}, [open]);

	function send() {
		const question = draft.trim();
		if (!question || thread.pending) return;
		setDraft("");
		onAsk(question);
	}

	function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
		// Enter sends, Shift+Enter breaks the line — the chat convention, and the
		// opposite of the note, where the text IS the point and Enter is a newline.
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			event.stopPropagation();
			send();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			// The window-level reading keys ignore anything inside a thread, but a
			// stray Escape reaching them would also drop the reading position.
			event.stopPropagation();
			onClose();
		}
	}

	if (!open) {
		return (
			<div ref={register} data-thread className="margin-item thread">
				<button
					type="button"
					className="thread__preview"
					onClick={onOpen}
					aria-label={`Open the conversation about "${first?.text ?? "this section"}"`}
				>
					<span className="thread__question">{first?.text}</span>
					{thread.pending ? (
						<span className="thread__answer">
							<Skeleton className="mt-1 h-2.5 w-full rounded" />
							<Skeleton className="mt-1.5 h-2.5 w-4/5 rounded" />
						</span>
					) : (
						answer && <span className="thread__answer">{answer.text}</span>
					)}
					<span className="thread__count">
						<HugeiconsIcon icon={MessageQuestionIcon} className="size-3" />
						{questionCount(thread)}
					</span>
				</button>
			</div>
		);
	}

	return (
		<div ref={register} data-thread data-open className="margin-item thread">
			<div className="thread__bar">
				<p className="thread__about" title={sectionText}>
					{sectionText}
				</p>
				<button
					type="button"
					className="thread__close"
					aria-label="Close this conversation"
					onClick={onClose}
				>
					<HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
				</button>
			</div>
			<div className="thread__log">
				{thread.messages.map((message, index) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: a thread's messages are append-only and never reordered or removed, so the index IS the identity — and two identical questions in one thread would collide on any key derived from the text
						key={`${message.role}-${index}`}
						className={cn(
							"thread__message",
							message.role === "user"
								? "thread__message--user"
								: "thread__message--tutor",
						)}
					>
						{message.role === "user" ? (
							message.text
						) : (
							// A thread answer has no card to link back to, so a reference
							// reads as the plain words it names.
							<Markdown>{stripCardRefs(message.text)}</Markdown>
						)}
					</div>
				))}
				{thread.pending && (
					<div className="thread__message thread__message--tutor">
						<Skeleton className="h-3 w-4/5 rounded" />
						<Skeleton className="mt-2 h-3 w-3/5 rounded" />
					</div>
				)}
				{thread.error && <p className="thread__error">{thread.error}</p>}
				<div ref={endRef} />
			</div>
			<div className="thread__composer">
				<textarea
					ref={inputRef}
					rows={1}
					value={draft}
					placeholder="Ask about this…"
					className="thread__input"
					{...RAW_TEXT_INPUT}
					onChange={(event) => {
						const el = event.currentTarget;
						el.style.height = "auto";
						el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
						setDraft(el.value);
					}}
					onKeyDown={onKeyDown}
				/>
				<button
					type="button"
					className="thread__send"
					aria-label="Send"
					disabled={!draft.trim() || thread.pending}
					onClick={send}
				>
					<HugeiconsIcon icon={SentIcon} className="size-3.5" />
				</button>
			</div>
			{thread.messages.length === 0 && (
				<button type="button" className="thread__discard" onClick={onRemove}>
					Discard
				</button>
			)}
		</div>
	);
}
