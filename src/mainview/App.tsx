import {
	ArrowRight01Icon,
	Award01Icon,
	CompassIcon,
	Plant01Icon,
	RefreshIcon,
	RocketIcon,
	SentIcon,
	SidebarLeft01Icon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
	type MouseEvent as ReactMouseEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import Markdown from "react-markdown";
import textLogo from "@/assets/text-logo.png";
import { AppRail } from "@/components/app-rail";
import { CardMarkdown } from "@/components/card-markdown";
import { ExplainSelection } from "@/components/explain";
import { LessonLibrary } from "@/components/home";
import { LessonSidebar } from "@/components/lesson-sidebar";
import { NotesPanel } from "@/components/notes";
import { type PracticeItem, PracticePanel } from "@/components/practice";
import { loadSettings } from "@/components/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	CardContent,
	CardHeader,
	CardTitle,
	Card as UICard,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	DEMO_CARDS,
	DEMO_EXERCISES,
	DEMO_LESSONS,
	DEMO_NOTES,
	DEMO_OUTLINE,
	DEMO_TOPIC,
} from "@/lib/demo";
import { bun, onStreamCard } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import type {
	Card,
	CardOption,
	LessonSnapshot,
	OutlineItem,
	SavedFeedItem,
	SavedPracticeItem,
	TurnResult,
} from "../shared/types";

const params = new URLSearchParams(window.location.search);
const demoMode = params.has("demo");
// ?demohome renders the home screen with fixture lessons for UI verification
const homeDemoMode = params.has("demohome");

const OPTION_ICONS: Record<string, IconSvgElement> = {
	beginner: Plant01Icon,
	intermediate: CompassIcon,
	advanced: RocketIcon,
};

// The reading column inside the content pane. Header, feed, and composer all
// line up on it so the page has one left edge.
const COLUMN = "mx-auto w-full max-w-[52rem] px-8";

interface TurnOptions {
	highlightNew?: boolean;
	pinTop?: boolean;
}

interface FeedItem {
	id: number;
	kind: "card" | "user" | "error";
	card?: Card;
	text?: string;
	selectedOption?: string;
	// Error items only: replay the turn that produced this panel. Takes the
	// item's own id so the panel can clear itself before the card lands.
	retry?: (itemId: number) => void;
}

let nextId = 0;

// Reading sections are read from the DOM rather than tracked in React state, so
// markdown internals stay presentation-only — see the highlight effect.
function segmentsOf(itemId: number): Element[] {
	const card = document.querySelector(`[data-item-id="${itemId}"]`);
	return card ? Array.from(card.querySelectorAll("[data-segment]")) : [];
}

export default function App() {
	const [items, setItems] = useState<FeedItem[]>(() =>
		demoMode
			? DEMO_CARDS.map((card) => ({
					id: nextId++,
					kind: "card" as const,
					card,
				}))
			: [],
	);
	const [loading, setLoading] = useState(false);
	const [started, setStarted] = useState(demoMode || params.has("demostream"));
	const [input, setInput] = useState("");
	const [outline, setOutline] = useState<OutlineItem[] | null>(
		demoMode ? DEMO_OUTLINE : null,
	);
	const [currentConceptId, setCurrentConceptId] = useState<string | null>(
		demoMode ? (DEMO_OUTLINE[1]?.id ?? null) : null,
	);
	const [tab, setTab] = useState("lesson");
	const [practice, setPractice] = useState<PracticeItem[]>(() =>
		demoMode
			? DEMO_EXERCISES.map((exercise) => ({
					id: nextId++,
					exercise,
					status: "open" as const,
				}))
			: [],
	);
	// Persistence: the saved-lesson id (from the first turn or a resume) and
	// the lesson topic, used to build the save snapshot.
	const [lessonId, setLessonId] = useState<string | null>(null);
	const [topic, setTopic] = useState(demoMode ? DEMO_TOPIC : "");
	// Bumped when returning home so the lesson library re-fetches
	const [homeRefresh, setHomeRefresh] = useState(0);
	// The lesson panel can be folded away to widen the reading column
	const [sidebarOpen, setSidebarOpen] = useState(true);
	// A requested jump to a concept's first card. The nonce makes repeat
	// selections of the same concept distinct so the effect re-runs.
	const [conceptJump, setConceptJump] = useState<{
		id: string;
		nonce: number;
	} | null>(null);
	// Live preview of the card currently being generated (streaming)
	const [streaming, setStreaming] = useState<{
		title: string;
		body: string;
	} | null>(
		params.has("demostream")
			? {
					title: "Kafka is a log, not a queue",
					body: "A traditional queue **deletes** a message once it's read. Kafka keeps every message for a set time, so many consumers can read the same stream at their own pace.\n\nEach consumer just remembers its own position",
				}
			: null,
	);
	// True only while a foreground turn is in flight, so late stream
	// messages can't resurrect a preview after the real card lands
	const turnActiveRef = useRef(false);
	// Reading position: which segment of which card is highlighted
	const [highlight, setHighlight] = useState<{
		itemId: number;
		index: number;
	} | null>(null);
	// Bumped each time reading mode is entered from nothing, to flash the
	// arrow-key hint
	const [hintNonce, setHintNonce] = useState(0);
	const bottomRef = useRef<HTMLDivElement>(null);
	// The content pane scrolls, not the window — every scroll position in
	// this file is relative to this element.
	const feedRef = useRef<HTMLDivElement>(null);
	// True while the newest card was requested via keyboard reading — its
	// first section gets highlighted and positions the view instead of the
	// default scroll-to-bottom
	const keyboardFlowRef = useRef(false);
	// Continue pins the new card's top just below the header and holds it
	// there while content streams in below, instead of following the text.
	const pinActiveRef = useRef(false);
	const pinAnchorRef = useRef(0);
	// Set when a card's first section is highlighted on arrival, so that one
	// highlight doesn't scroll (the card is already pinned at the top).
	const skipHighlightScrollRef = useRef(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: items/loading/streaming are intentional triggers — reposition as the feed grows, the skeleton appears, or the streaming preview extends
	useEffect(() => {
		// Continue: keep the new card's top fixed near the top of the pane while
		// its content streams in below (the anchor is a fixed scroll offset, so
		// re-applying it on each update holds position without following text).
		if (pinActiveRef.current) {
			feedRef.current?.scrollTo({
				top: Math.max(pinAnchorRef.current - 16, 0),
				behavior: "auto",
			});
			return;
		}
		if (keyboardFlowRef.current) return;
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [items, loading, streaming]);

	// The panes share one scroll container, so each tab has to claim its own
	// position: Lesson lands on the latest card, the others start at the top.
	// This runs after the newly mounted panel is in the DOM, and reading
	// scrollHeight forces the layout needed to measure it.
	useEffect(() => {
		const pane = feedRef.current;
		if (!pane) return;
		pane.scrollTo({
			top: tab === "lesson" ? pane.scrollHeight : 0,
			behavior: "auto",
		});
	}, [tab]);

	// Jump to a concept once the lesson panel is committed to the DOM
	useEffect(() => {
		if (!conceptJump) return;
		document
			.querySelector(`[data-concept-id="${conceptJump.id}"]`)
			?.scrollIntoView({ behavior: "smooth", block: "start" });
	}, [conceptJump]);

	// Auto-save the lesson snapshot whenever persistable state changes. The
	// bun process merges session id, language, and timestamps; errors and the
	// in-flight "checking" status are not persisted.
	useEffect(() => {
		if (demoMode || !started || !lessonId) return;
		const snapshot: LessonSnapshot = {
			id: lessonId,
			topic,
			outline,
			currentConceptId,
			feed: items
				.filter((item) => item.kind !== "error")
				.map(
					(item): SavedFeedItem => ({
						kind: item.kind === "user" ? "user" : "card",
						card: item.card,
						text: item.text,
						selectedOption: item.selectedOption,
					}),
				),
			practice: practice.map(
				(item): SavedPracticeItem => ({
					exercise: item.exercise,
					status: item.status === "checking" ? "open" : item.status,
					userAnswer: item.userAnswer,
					explanation: item.explanation,
				}),
			),
		};
		void bun.saveLesson({ snapshot }).catch(() => {});
	}, [lessonId, started, topic, outline, currentConceptId, items, practice]);

	// Receive streaming card previews from the bun process. Ignore any that
	// arrive outside a live turn so a stale delta can't reappear after the
	// finished card has been appended.
	useEffect(() => {
		onStreamCard((preview) => {
			if (turnActiveRef.current) setStreaming(preview);
		});
		return () => onStreamCard(null);
	}, []);

	function append(
		item: Omit<FeedItem, "id">,
		options: { highlightNew?: boolean } = {},
	) {
		const id = nextId++;
		setItems((prev) => [...prev, { ...item, id }]);
		if (options.highlightNew && item.kind === "card") {
			keyboardFlowRef.current = true;
			// The card is pinned at the top; don't let this highlight scroll it
			skipHighlightScrollRef.current = true;
			setHighlight({ itemId: id, index: 0 });
		} else {
			keyboardFlowRef.current = false;
			setHighlight(null);
		}
	}

	// Takes a thunk rather than a promise so a failed turn can be replayed from
	// its error panel — see retryTurn.
	async function runTurn(
		send: () => Promise<TurnResult>,
		options: TurnOptions = {},
	) {
		if (options.pinTop) {
			// Capture where the new card will start before any re-render, so it
			// can be pinned near the top of the pane as content streams in.
			const pane = feedRef.current;
			pinActiveRef.current = true;
			pinAnchorRef.current =
				pane && bottomRef.current
					? bottomRef.current.getBoundingClientRect().top -
						pane.getBoundingClientRect().top +
						pane.scrollTop
					: 0;
		} else {
			pinActiveRef.current = false;
		}
		setLoading(true);
		turnActiveRef.current = true;
		keyboardFlowRef.current = false;
		setStreaming(null);
		try {
			const result = await send();
			if (result.ok) {
				if (result.lessonId) setLessonId(result.lessonId);
				if (result.outline) setOutline(result.outline);
				if (result.card.conceptId) setCurrentConceptId(result.card.conceptId);
				const exercise = result.exercise;
				if (exercise) {
					setPractice((prev) => [
						...prev,
						{ id: nextId++, exercise, status: "open" },
					]);
				}
				append({ kind: "card", card: result.card }, options);
			} else {
				append({
					kind: "error",
					text: result.error,
					retry: (itemId) => retryTurn(itemId, send, options),
				});
			}
		} catch (error) {
			append({
				kind: "error",
				text: error instanceof Error ? error.message : String(error),
				retry: (itemId) => retryTurn(itemId, send, options),
			});
		} finally {
			turnActiveRef.current = false;
			setStreaming(null);
			setLoading(false);
		}
	}

	// Replay a failed turn. Foreground turns run against a forked session that
	// the bun process adopts only on a card it can use, so a failed turn leaves
	// the lesson session where it was — re-sending the same message re-teaches
	// this step rather than skipping ahead to the next one.
	function retryTurn(
		itemId: number,
		send: () => Promise<TurnResult>,
		options: TurnOptions,
	) {
		if (loading) return;
		// Drop the panel first so the card lands where the failed one would have
		setItems((prev) => prev.filter((item) => item.id !== itemId));
		void runTurn(send, options);
	}

	function startLesson(topicArg?: string) {
		const nextTopic = (topicArg ?? input).trim();
		if (!nextTopic || loading) return;
		// Fully reset so a new lesson never inherits the previous one's state
		setItems([]);
		setPractice([]);
		setOutline(null);
		setCurrentConceptId(null);
		setHighlight(null);
		setLessonId(null);
		setTopic(nextTopic);
		setInput("");
		setTab("lesson");
		setStarted(true);
		append({ kind: "user", text: nextTopic });
		void runTurn(() =>
			bun.startLesson({
				topic: nextTopic,
				language: loadSettings().codeLanguage.trim() || undefined,
			}),
		);
	}

	async function resumeLesson(id: string) {
		if (loading) return;
		const result = await bun.resumeLesson({ id }).catch(() => null);
		if (!result?.ok) return;
		const record = result.record;
		setItems(record.feed.map((item) => ({ ...item, id: nextId++ })));
		setPractice(record.practice.map((item) => ({ ...item, id: nextId++ })));
		setOutline(record.outline);
		setCurrentConceptId(record.currentConceptId);
		setLessonId(record.id);
		setTopic(record.topic);
		setHighlight(null);
		setInput("");
		setTab("lesson");
		setStarted(true);
	}

	function goHome() {
		setStarted(false);
		setHomeRefresh((n) => n + 1);
	}

	function sendMessage() {
		const text = input.trim();
		if (!text || loading) return;
		setInput("");
		append({ kind: "user", text });
		void runTurn(() => bun.sendMessage({ text }));
	}

	function continueLesson(options: { highlightNew?: boolean } = {}) {
		if (loading) return;
		void runTurn(() => bun.continueLesson({}), { ...options, pinTop: true });
	}

	function chooseOption(itemId: number, option: CardOption) {
		if (loading) return;
		setItems((prev) =>
			prev.map((item) =>
				item.id === itemId ? { ...item, selectedOption: option.id } : item,
			),
		);
		void runTurn(() => bun.sendMessage({ text: option.label }));
	}

	// Move the reading position. Entering reading mode from nothing flashes the
	// arrow-key hint; stepping once inside it does not. Reading also pins the
	// view: the feed must not yank back to the bottom under someone who has
	// stepped up into an earlier card.
	function moveHighlight(
		itemId: number,
		index: number,
		options: { scroll?: boolean } = {},
	) {
		if (!highlight) setHintNonce((nonce) => nonce + 1);
		if (options.scroll === false) skipHighlightScrollRef.current = true;
		keyboardFlowRef.current = true;
		setHighlight({ itemId, index });
	}

	// Click a section to put the reading position there and step on from it with
	// the arrow keys. Skipped while text is selected, so picking out a phrase to
	// explain doesn't also move the marker.
	function selectSegment(
		itemId: number,
		event: ReactMouseEvent<HTMLDivElement>,
	) {
		if (window.getSelection()?.isCollapsed === false) return;
		const target = event.target as HTMLElement;
		if (target.closest("button, a")) return;
		const segment = target.closest("[data-segment]");
		if (!segment) return;
		const index = segmentsOf(itemId).indexOf(segment);
		// The section is already under the cursor, so don't scroll to it
		if (index >= 0) moveHighlight(itemId, index, { scroll: false });
	}

	// Apply the highlight class to the active segment in the DOM. Segments are
	// queried rather than tracked in React state so markdown internals stay
	// presentation-only.
	useEffect(() => {
		for (const el of document.querySelectorAll(".segment-active")) {
			el.classList.remove("segment-active");
		}
		if (!highlight) return;
		const card = document.querySelector(`[data-item-id="${highlight.itemId}"]`);
		const segment = card?.querySelectorAll("[data-segment]")[highlight.index];
		if (segment) {
			segment.classList.add("segment-active");
			// Arrival highlight (pinned card) sets position once without scrolling;
			// user-driven stepping scrolls the active section into view.
			if (skipHighlightScrollRef.current) {
				skipHighlightScrollRef.current = false;
			} else {
				segment.scrollIntoView({ behavior: "smooth", block: "center" });
			}
		}
	}, [highlight]);

	// The arrow keys walk the whole feed section by section, crossing card
	// boundaries in both directions; past the last section of the newest card
	// ArrowDown acts as Continue. Escape leaves reading mode.
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (tab !== "lesson") return;
			if (event.key === "Escape") {
				setHighlight(null);
				return;
			}
			if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
			const target = event.target as HTMLElement | null;
			if (
				target?.closest("textarea, select, [contenteditable=true]") ||
				(target instanceof HTMLInputElement && target.value !== "")
			) {
				return;
			}
			const cards = items.filter((item) => item.kind === "card");
			if (cards.length === 0) return;
			event.preventDefault();

			const cardIndex = highlight
				? cards.findIndex((card) => card.id === highlight.itemId)
				: -1;

			// Not reading yet (or the highlighted card is gone): enter on the
			// newest card, at the end of it when arriving from below.
			if (!highlight || cardIndex < 0) {
				const newest = cards[cards.length - 1];
				const count = newest ? segmentsOf(newest.id).length : 0;
				if (!newest || count === 0) return;
				moveHighlight(newest.id, event.key === "ArrowUp" ? count - 1 : 0);
				return;
			}

			const current = cards[cardIndex];
			if (!current) return;
			const count = segmentsOf(current.id).length;
			if (count === 0) return;

			if (event.key === "ArrowUp") {
				if (highlight.index > 0) {
					moveHighlight(current.id, highlight.index - 1);
					return;
				}
				// At the top of a card: continue into the end of the one before
				// it. On the very first card there is nowhere left to go, so the
				// position stays where it is.
				const previous = cards[cardIndex - 1];
				const previousCount = previous ? segmentsOf(previous.id).length : 0;
				if (previous && previousCount > 0) {
					moveHighlight(previous.id, previousCount - 1);
				}
				return;
			}

			if (highlight.index + 1 < count) {
				moveHighlight(current.id, highlight.index + 1);
				return;
			}

			// Past a card's last section: step into the next card if the feed
			// already holds one...
			const next = cards[cardIndex + 1];
			if (next) {
				if (segmentsOf(next.id).length > 0) moveHighlight(next.id, 0);
				return;
			}

			// ...otherwise advance the lesson (unanswered question cards want an
			// answer, not a continue). The highlight stays on the current section
			// while the next card loads, then moves to its first section.
			if (
				!loading &&
				current.card?.type !== "recap" &&
				!(current.card?.type === "question" && !current.selectedOption)
			) {
				continueLesson({ highlightNew: true });
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	});

	if (!started) {
		return (
			<div className="flex h-dvh overflow-hidden">
				<AppRail active="home" onHome={goHome} />
				<main className="relative flex flex-1 flex-col items-center justify-center gap-12 overflow-y-auto px-6 py-16">
					{/* A soft accent wash gives the empty screen some depth */}
					<div
						aria-hidden
						className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-[radial-gradient(58%_100%_at_50%_0%,color-mix(in_oklch,var(--marker)_10%,transparent),transparent_72%)]"
					/>
					<div className="relative text-center">
						{/* The wordmark is white ASCII art on an opaque near-black
						    plate. Rather than edit the asset, contrast() drives the
						    plate to pure black and the art to pure white, which makes
						    the blend a clean knockout: screen drops black on dark,
						    and invert+multiply drops the flipped white on light.
						    object-position crops the asset's empty lower third. */}
						<img
							src={textLogo}
							alt="Tuto"
							className="wordmark mx-auto mb-6 w-[24rem] max-w-full object-cover object-[center_25%] mix-blend-multiply select-none dark:mix-blend-screen"
							style={{
								aspectRatio: "1174 / 425",
								filter: "contrast(1.2) invert(1)",
							}}
						/>
						<p className="text-lg text-muted-foreground">
							What would you like to learn?
						</p>
					</div>
					<form
						className="relative w-full max-w-xl"
						onSubmit={(event) => {
							event.preventDefault();
							startLesson();
						}}
					>
						<Input
							autoFocus
							value={input}
							onChange={(event) => setInput(event.target.value)}
							placeholder="e.g. Kubernetes, from the basics"
							className="h-15 rounded-3xl border-border bg-card pr-28 pl-5 text-lg shadow-md"
						/>
						<Button
							type="submit"
							className="absolute top-2 right-2 h-11 rounded-2xl px-6"
							disabled={!input.trim()}
						>
							Start
						</Button>
					</form>
					<LessonLibrary
						onResume={resumeLesson}
						refreshKey={homeRefresh}
						demoLessons={homeDemoMode ? DEMO_LESSONS : undefined}
					/>
				</main>
			</div>
		);
	}

	const currentIndex = outline
		? outline.findIndex((item) => item.id === currentConceptId)
		: -1;
	const lessonEnded =
		items.findLast((item) => item.kind === "card")?.card?.type === "recap";

	function updatePractice(id: number, patch: Partial<PracticeItem>) {
		setPractice((prev) =>
			prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
		);
	}

	const openExercises = practice.filter(
		(item) => item.status === "open",
	).length;

	function conceptTitle(conceptId?: string) {
		if (!conceptId) return undefined;
		return outline?.find((item) => item.id === conceptId)?.title;
	}

	// The sidebar's outline is navigation: selecting a concept jumps the feed
	// to the first card that taught it. Both updates land in one commit, so
	// the panel is mounted by the time the jump effect runs.
	function goToConcept(conceptId: string) {
		setTab("lesson");
		setConceptJump((prev) => ({
			id: conceptId,
			nonce: (prev?.nonce ?? 0) + 1,
		}));
	}

	const feedConcepts = new Set(
		items
			.map((item) => item.card?.conceptId)
			.filter((id): id is string => Boolean(id)),
	);

	// The content pane is titled by what it is showing, with the lesson's
	// position above it — the topic itself lives in the sidebar.
	const paneTitle =
		tab === "practice"
			? "Practice"
			: tab === "notes"
				? "Notes"
				: (outline?.[currentIndex]?.title ?? topic ?? "Lesson");
	const paneKicker =
		tab === "lesson" && outline && currentIndex >= 0
			? `Concept ${currentIndex + 1} of ${outline.length}`
			: topic || "Lesson";

	return (
		<Tabs
			value={tab}
			onValueChange={(value) => setTab(String(value))}
			className="flex h-dvh gap-0 overflow-hidden data-horizontal:flex-row"
		>
			<ExplainSelection topic={topic} />
			<AppRail active="lesson" onHome={goHome} />
			{sidebarOpen && (
				<LessonSidebar
					topic={topic}
					outline={outline}
					currentIndex={currentIndex}
					lessonEnded={lessonEnded}
					feedConcepts={feedConcepts}
					stats={{
						cards: items.filter((item) => item.kind === "card").length,
						practiceDone: practice.length - openExercises,
						practiceTotal: practice.length,
					}}
					onSelectConcept={goToConcept}
					onCollapse={() => setSidebarOpen(false)}
				/>
			)}
			<main className="flex min-w-0 flex-1 flex-col">
				{/* Title and tabs share one row: the tabs sitting beside the title
				    rather than under it gives the feed back a band of height. */}
				<header className="shrink-0 border-b border-border/70 bg-background">
					<div className={cn(COLUMN, "flex items-center gap-6 py-4")}>
						{!sidebarOpen && (
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-9 shrink-0 rounded-xl text-muted-foreground"
								aria-label="Show lesson panel"
								onClick={() => setSidebarOpen(true)}
							>
								<HugeiconsIcon icon={SidebarLeft01Icon} className="size-5" />
							</Button>
						)}
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm text-muted-foreground tabular-nums">
								{paneKicker}
							</p>
							<h1 className="truncate text-[1.7rem] leading-tight font-[560] tracking-[-0.024em]">
								{paneTitle}
							</h1>
						</div>
						<TabsList className="shrink-0">
							<TabsTrigger value="lesson">Lesson</TabsTrigger>
							<TabsTrigger value="practice">
								Practice
								{openExercises > 0 && (
									<Badge variant="default" size="sm">
										{openExercises}
									</Badge>
								)}
							</TabsTrigger>
							<TabsTrigger value="notes">Notes</TabsTrigger>
						</TabsList>
					</div>
				</header>

				<div className="relative min-h-0 flex-1">
					<div
						ref={feedRef}
						data-scroll-pane
						className="h-full overflow-y-auto"
					>
						<TabsContent
							value="practice"
							className={cn(COLUMN, "pt-6 text-base")}
						>
							<PracticePanel
								items={practice}
								onUpdate={updatePractice}
								conceptTitle={conceptTitle}
							/>
						</TabsContent>
						<TabsContent value="notes" className={cn(COLUMN, "pt-6 text-base")}>
							<NotesPanel demoMarkdown={demoMode ? DEMO_NOTES : undefined} />
						</TabsContent>
						<TabsContent
							value="lesson"
							className={cn(COLUMN, "pt-7 text-base")}
						>
							<div className="space-y-5 pb-10">
								{items.map((item, index) => {
									if (item.kind === "user") {
										return (
											<p
												key={item.id}
												className="ml-auto w-fit max-w-md rounded-3xl rounded-br-lg bg-accent px-4 py-2.5 text-[0.95rem] text-accent-foreground"
											>
												{item.text}
											</p>
										);
									}
									if (item.kind === "error") {
										const retry = item.retry;
										return (
											<UICard
												key={item.id}
												className="bg-destructive/5 ring-destructive/25"
											>
												<CardHeader className="gap-2">
													<div className="text-sm font-medium text-destructive">
														Something went wrong
													</div>
													<CardTitle className="text-base font-normal text-muted-foreground">
														{item.text}
													</CardTitle>
												</CardHeader>
												{retry && (
													<CardContent>
														<Button
															type="button"
															variant="destructive"
															size="sm"
															disabled={loading}
															onClick={() => retry(item.id)}
														>
															<HugeiconsIcon
																icon={RefreshIcon}
																data-icon="inline-start"
															/>
															Try again
														</Button>
													</CardContent>
												)}
											</UICard>
										);
									}
									const card = item.card;
									const options = card?.options;
									const suggestions = card?.suggestions;
									const isRecap = card?.type === "recap";
									const concept = conceptTitle(card?.conceptId);
									// The header already names the current concept, so a card
									// only labels itself when the concept changes — a run of
									// cards on one concept reads as a block, not as a stutter.
									const previousCard = items
										.slice(0, index)
										.findLast((earlier) => earlier.kind === "card");
									const showConcept =
										!!concept &&
										concept !== conceptTitle(previousCard?.card?.conceptId);
									return (
										<UICard
											key={item.id}
											data-item-id={item.id}
											data-concept-id={card?.conceptId}
											className={cn(
												"scroll-mt-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-500",
												isRecap && "bg-accent/60",
											)}
										>
											<CardHeader className="gap-2">
												{(isRecap || showConcept) && (
													<div className="flex items-center gap-1.5 text-sm text-muted-foreground">
														{isRecap && (
															<HugeiconsIcon
																icon={Award01Icon}
																className="size-4 shrink-0"
															/>
														)}
														<span className="truncate">
															{isRecap ? "Recap" : concept}
														</span>
													</div>
												)}
												<CardTitle className="text-[1.5rem] leading-[1.3] font-[560] tracking-[-0.022em]">
													{card?.title}
												</CardTitle>
											</CardHeader>
											{/* Clicking a section is a shortcut into keyboard reading;
											    the arrow keys drive the same thing without it. */}
											<CardContent
												data-explainable
												className="reading prose prose-lg max-w-none dark:prose-invert"
												onClick={(event) => selectSegment(item.id, event)}
											>
												<CardMarkdown body={card?.body ?? ""} />
											</CardContent>
											{suggestions && suggestions.length > 0 && (
												<CardContent className="flex flex-col gap-2">
													<p className="mb-1 text-sm text-muted-foreground">
														Keep learning
													</p>
													{suggestions.map((suggestion) => (
														<button
															key={suggestion}
															type="button"
															disabled={loading}
															onClick={() => startLesson(suggestion)}
															className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 text-left transition-all hover:border-foreground/15 hover:shadow-sm disabled:pointer-events-none disabled:opacity-50"
														>
															<span className="flex-1 text-[0.95rem] font-medium">
																{suggestion}
															</span>
															<span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
																<HugeiconsIcon
																	icon={ArrowRight01Icon}
																	className="size-4.5"
																/>
															</span>
														</button>
													))}
												</CardContent>
											)}
											{options && (
												<CardContent className="flex flex-col gap-2.5">
													{options.map((option) => {
														const selected = item.selectedOption === option.id;
														const answered = item.selectedOption !== undefined;
														return (
															<Button
																key={option.id}
																type="button"
																variant={selected ? "default" : "outline"}
																className={cn(
																	"h-auto justify-start gap-3.5 rounded-2xl p-3.5 text-left whitespace-normal",
																	!selected && "hover:border-primary/35",
																)}
																disabled={loading || (answered && !selected)}
																onClick={() => {
																	if (!answered) chooseOption(item.id, option);
																}}
															>
																<span
																	className={cn(
																		"grid size-9 shrink-0 place-items-center rounded-xl",
																		selected
																			? "bg-primary-foreground/15"
																			: "bg-card text-muted-foreground shadow-xs ring-1 ring-border",
																	)}
																>
																	<HugeiconsIcon
																		icon={
																			selected
																				? Tick02Icon
																				: (OPTION_ICONS[option.id] ??
																					CompassIcon)
																		}
																		className="size-4.5"
																	/>
																</span>
																<span className="flex flex-col gap-0.5">
																	<span className="text-[0.95rem] font-semibold">
																		{option.label}
																	</span>
																	{option.description && (
																		<span
																			className={cn(
																				"text-sm font-normal",
																				selected
																					? "text-primary-foreground/75"
																					: "text-muted-foreground",
																			)}
																		>
																			{option.description}
																		</span>
																	)}
																</span>
															</Button>
														);
													})}
												</CardContent>
											)}
										</UICard>
									);
								})}
								{streaming ? (
									<UICard className="animate-in fade-in-0 duration-300">
										<CardHeader>
											<div className="flex items-center gap-2 text-sm text-muted-foreground">
												<PulseDot />
												Writing
											</div>
											{streaming.title && (
												<CardTitle className="text-[1.45rem] leading-[1.25] font-semibold tracking-[-0.02em]">
													{streaming.title}
												</CardTitle>
											)}
										</CardHeader>
										<CardContent className="reading prose prose-lg max-w-none dark:prose-invert">
											<Markdown>{streaming.body}</Markdown>
											<span className="ml-0.5 inline-block h-5 w-[3px] translate-y-0.5 animate-pulse rounded-full bg-marker align-baseline" />
										</CardContent>
									</UICard>
								) : (
									loading && (
										<UICard className="animate-in fade-in-0 duration-300">
											<CardHeader>
												<div className="flex items-center gap-2 text-sm text-muted-foreground">
													<PulseDot />
													<span className="shimmer">Thinking</span>
												</div>
												<Skeleton className="mt-1 h-7 w-2/5 rounded-lg" />
											</CardHeader>
											<CardContent className="space-y-2.5">
												<Skeleton className="h-4 w-full rounded-md" />
												<Skeleton className="h-4 w-11/12 rounded-md" />
												<Skeleton className="h-4 w-3/5 rounded-md" />
											</CardContent>
										</UICard>
									)
								)}
								<div ref={bottomRef} />
							</div>
						</TabsContent>
					</div>
					{/* Content dissolves at the pane edge instead of being cut off */}
					<div
						aria-hidden
						className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent"
					/>
					<ReadingHint trigger={hintNonce} />
				</div>

				{tab === "lesson" && (
					<div className="shrink-0 border-t border-border/70 bg-background py-3.5">
						<form
							className={cn(COLUMN, "flex gap-2.5")}
							onSubmit={(event) => {
								event.preventDefault();
								sendMessage();
							}}
						>
							<Input
								value={input}
								onChange={(event) => setInput(event.target.value)}
								placeholder="Ask a question…"
								className="h-12 rounded-2xl border-border bg-card px-4 shadow-xs"
								disabled={loading}
							/>
							{input.trim() ? (
								<Button
									type="submit"
									className="h-12 shrink-0 gap-2 rounded-2xl px-5"
									disabled={loading}
								>
									Send
									<HugeiconsIcon icon={SentIcon} className="size-4.5" />
								</Button>
							) : lessonEnded ? (
								<Button
									type="button"
									className="h-12 shrink-0 rounded-2xl px-5"
									disabled={loading}
									onClick={goHome}
								>
									New lesson
								</Button>
							) : (
								<Button
									type="button"
									className="h-12 shrink-0 gap-2.5 rounded-2xl pr-3 pl-5"
									disabled={loading}
									onClick={() => continueLesson()}
								>
									Continue
									<kbd className="grid h-6 w-6 place-items-center rounded-lg bg-primary-foreground/15 text-xs">
										↓
									</kbd>
								</Button>
							)}
						</form>
					</div>
				)}
			</main>
		</Tabs>
	);
}

// Entering reading mode is quiet — a click, or one arrow key — so say once,
// briefly, what the keys now do. Re-triggering restarts the countdown.
function ReadingHint({ trigger }: { trigger: number }) {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		if (trigger === 0) return;
		setVisible(true);
		const timer = window.setTimeout(() => setVisible(false), 2600);
		return () => window.clearTimeout(timer);
	}, [trigger]);

	if (!visible) return null;
	return (
		<div className="animate-in fade-in-0 slide-in-from-bottom-2 pointer-events-none absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-popover py-2 pr-2.5 pl-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/8 duration-200">
			Use arrow keys to step through
			<span className="flex gap-1 text-muted-foreground">
				<kbd className="grid size-6 place-items-center rounded-lg bg-foreground/8 text-xs">
					↑
				</kbd>
				<kbd className="grid size-6 place-items-center rounded-lg bg-foreground/8 text-xs">
					↓
				</kbd>
			</span>
		</div>
	);
}

function PulseDot() {
	return (
		<span className="relative flex size-2">
			<span className="absolute inline-flex size-full animate-ping rounded-full bg-marker/60" />
			<span className="relative inline-flex size-2 rounded-full bg-marker" />
		</span>
	);
}
