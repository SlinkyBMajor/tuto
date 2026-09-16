import {
	Alert02Icon,
	ArrowRight01Icon,
	Award01Icon,
	CompassIcon,
	Flag01Icon,
	Idea01Icon,
	MessageQuestionIcon,
	Plant01Icon,
	PlusSignCircleIcon,
	RefreshIcon,
	RocketIcon,
	SentIcon,
	Stairs01Icon,
	StickyNote01Icon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import Markdown from "react-markdown";
import textLogo from "@/assets/text-logo.png";
import { AppRail } from "@/components/app-rail";
import { CardMarkdown } from "@/components/card-markdown";
import { ExplainSelection } from "@/components/explain";
import { HierarchyNote } from "@/components/hierarchy";
import { LessonLibrary } from "@/components/home";
import {
	CautionNote,
	ChecksConsent,
	CostNote,
	MachineNotice,
	RequirementsPanel,
	type TaskCheck,
	TaskPanel,
	TeardownNotice,
} from "@/components/lab-panels";
import {
	LessonPlanning,
	type PlanningStage,
	PlanningWash,
} from "@/components/lesson-planning";
import { LessonProgress } from "@/components/lesson-progress";
import { MarginLayer } from "@/components/margin-layer";
// Notes are switched off — see NOTES_ENABLED in src/bun/lesson-modes.ts.
// import { NotesPanel } from "@/components/notes";
import { type PracticeItem, PracticePanel } from "@/components/practice";
import { LabField, ProjectField, shortPath } from "@/components/project-picker";
import {
	newThreadId,
	questionCount,
	type Thread,
	ThreadCard,
} from "@/components/question-threads";
import { loadSettings, pushSettings } from "@/components/settings";
import {
	asStickyColor,
	newStickyId,
	randomStickyColor,
	type Sticky,
	StickyCard,
} from "@/components/sticky-notes";
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
	DEMO_ACTIVITY,
	DEMO_CARDS,
	DEMO_EXERCISES,
	DEMO_LAB_CARDS,
	DEMO_LAB_CHECK,
	DEMO_LAB_DRIFT,
	DEMO_LAB_OUTLINE,
	DEMO_LAB_TOPIC,
	DEMO_LAB_WARNINGS,
	DEMO_LESSONS,
	DEMO_OUTLINE,
	DEMO_PROJECT,
	DEMO_THREADS,
	DEMO_TOPIC,
} from "@/lib/demo";
import { bun, onStreamCard } from "@/lib/rpc";
import { RAW_TEXT_INPUT } from "@/lib/text-input";
import { cn } from "@/lib/utils";
import { cardRefSlug, stripCardRefs } from "../shared/card-refs";
import type {
	Card,
	CardOption,
	CardTask,
	FeedNotification,
	LessonConfig,
	LessonGoal,
	LessonSnapshot,
	OutlineItem,
	Prerequisite,
	ProjectRef,
	SavedFeedItem,
	SavedPracticeItem,
	SavedSticky,
	SavedThread,
	TaskStatus,
	TurnResult,
	VerifyResult,
} from "../shared/types";

const params = new URLSearchParams(window.location.search);
const demoMode = params.has("demo");
// ?demolab renders a hands-on lesson from fixtures: the plan card's
// requirements, a task card, and the caution/cost pair — plus the app-authored
// notice a machine pointed at something real would open with. ?demolab=ask
// renders it before the learner has said whether the app may run checks.
const demoLab = params.has("demolab");
// ?demohome renders the home screen with fixture lessons for UI verification
const homeDemoMode = params.has("demohome");
// ?demoproject pretends a project was picked, so the project chip and the
// lesson panel's project line can be seen without a real folder (and without
// the OS dialog, which only exists inside the app shell)
const demoProject = params.has("demoproject") ? DEMO_PROJECT : null;
// ?demoplanning[=level] holds the planning screen open. Add &demoproject for
// the codebase version, which is the one with lookups to show.
const demoPlanning: PlanningStage | null = params.has("demoplanning")
	? params.get("demoplanning") === "level"
		? "level"
		: "outline"
	: null;
// What a demo lesson is about: the fixture topic, or a question worth asking of
// the fixture project when one is pretended in
const demoTopic = demoProject
	? "how identity and org-scoped tokens work"
	: DEMO_TOPIC;
// ?demogoal pretends this lesson was taken as groundwork, so the destination
// line beside the pill and the recap's way back can be seen without walking
// the whole prerequisite path
const demoGoal: LessonGoal | undefined = params.has("demogoal")
	? { topic: "Event-driven architecture" }
	: undefined;
const demoLessonConfig: LessonConfig = demoLab
	? { mode: "lab", topic: DEMO_LAB_TOPIC }
	: demoProject
		? { mode: "codebase", topic: demoTopic, project: demoProject }
		: { mode: "topic", topic: demoTopic, goal: demoGoal };

const OPTION_ICONS: Record<string, IconSvgElement> = {
	beginner: Plant01Icon,
	intermediate: CompassIcon,
	advanced: RocketIcon,
};

// The reading column inside the content pane. Header, feed, panels and key bar
// all line up on it, so the page has one left edge — and when the margin opens
// they all move together. The geometry is in `.reading-column` (index.css),
// driven by the shell's data-margin; nothing here may go back to `mx-auto`,
// which would centre each row over its own margin instead of beside it.
const COLUMN = "reading-column px-8";

interface TurnOptions {
	highlightNew?: boolean;
	pinTop?: boolean;
	// This card answers a follow-up question rather than continuing the outline
	followUp?: boolean;
}

interface FeedItem {
	id: number;
	// Two of these are the app's own voice rather than the tutor's. "notice" is
	// the structured panel about this machine, re-derived from a fresh probe on
	// every resume and never persisted. "notification" is one line about the
	// lesson's own state — a practice item added, a folder made — which
	// happened once and is saved with the lesson.
	kind: "card" | "user" | "error" | "notice" | "notification";
	card?: Card;
	text?: string;
	selectedOption?: string;
	// Notice items only: the app-authored warnings, and — on a resumed lesson —
	// what has changed on this machine since it was last open
	notice?: { warnings: string[]; drift: string[] };
	// Notification items only
	notification?: FeedNotification;
	// Task cards only: how far the learner got with the step. Persisted, so a
	// lesson resumed tomorrow does not present ten finished steps as open ones.
	taskStatus?: TaskStatus;
	// The last check this card's task ran, and its verdict
	check?: TaskCheck;
	// Set on the card that answered a follow-up, so it labels itself as one
	followUp?: boolean;
	// Error items only: replay the turn that produced this panel. Takes the
	// item's own id so the panel can clear itself before the card lands.
	retry?: (itemId: number) => void;
}

let nextId = 0;

// While a lesson is being set up the planning panel IS the view, so put its top
// under the header rather than scrolling past it to the newest card. Reported
// so both scroll effects can defer to it — they would otherwise fight over the
// pane and the loser's position is the one that sticks.
function scrollToPlanning(): boolean {
	const planning = document.querySelector("[data-planning]");
	if (!planning) return false;
	planning.scrollIntoView({ behavior: "auto", block: "start" });
	return true;
}

// Reading sections are read from the DOM rather than tracked in React state, so
// markdown internals stay presentation-only — see the highlight effect.
function segmentsOf(itemId: number): Element[] {
	const card = document.querySelector(`[data-item-id="${itemId}"]`);
	return card ? Array.from(card.querySelectorAll("[data-segment]")) : [];
}

// The words of one section, for a question asked about it. Read out of the DOM
// like the sections themselves, so a code block or a diagram's rendered labels
// arrive as the learner sees them rather than as markdown source.
// How far past a section's own box still counts as its row: the pointer sitting
// in the blank line between two paragraphs belongs to one of them, not to
// neither. Roughly the paragraph spacing, so the gaps are covered and the card's
// header and footer padding are not.
const ROW_SLACK = 22;
// Breathing room left below an open thread when the lesson has to scroll to fit
// one — enough that it does not sit flush against the key bar.
const THREAD_FIT_GAP = 16;
// Used only for the frame before the rail has been measured — after that its
// real height is read off the element.
const RAIL_HEIGHT_FALLBACK = 62;

// Which section the pointer's height puts it on, and how tall that section is.
// Sections nest — a paragraph inside a list item — and the innermost is the one
// the reading position lands on, so the smallest box containing the pointer
// wins. A pointer in the gap between two sections takes the nearer one.
interface SectionRow {
	index: number;
	top: number;
	bottom: number;
	// How far the pointer is outside the section, and how tall it is — used only
	// to choose between candidates
	gap: number;
	height: number;
}

function sectionRowAt(itemId: number, clientY: number): SectionRow | null {
	let inside: SectionRow | null = null;
	let nearest: SectionRow | null = null;
	const segments = segmentsOf(itemId);
	for (let index = 0; index < segments.length; index++) {
		const box = segments[index]?.getBoundingClientRect();
		if (!box) continue;
		const gap =
			clientY < box.top
				? box.top - clientY
				: clientY > box.bottom
					? clientY - box.bottom
					: 0;
		const row: SectionRow = {
			index,
			top: box.top,
			bottom: box.bottom,
			gap,
			height: box.height,
		};
		if (gap === 0) {
			if (!inside || row.height < inside.height) inside = row;
		} else if (!nearest || gap < nearest.gap) {
			nearest = row;
		}
	}
	if (inside) return inside;
	return nearest && nearest.gap <= ROW_SLACK ? nearest : null;
}

function sectionTextOf(itemId: number, index: number): string {
	const segment = segmentsOf(itemId)[index];
	// A section can carry chrome that is not part of the passage: a code block's
	// language label and Copy button, the takeaway's "Key takeaway". Those mark
	// where their words actually start, so prefer that when it is there —
	// otherwise a question about a snippet arrives asking about "JavaScriptCopy".
	const source = segment?.querySelector("[data-section-text]") ?? segment;
	const text = source?.textContent ?? "";
	return text.replace(/\s+/g, " ").trim().slice(0, 1200);
}

export default function App() {
	const [items, setItems] = useState<FeedItem[]>(() => {
		if (demoLab) {
			return [
				{
					id: nextId++,
					kind: "notice" as const,
					notice: {
						warnings: DEMO_LAB_WARNINGS,
						drift: params.get("demolab") === "resume" ? DEMO_LAB_DRIFT : [],
					},
				},
				...DEMO_LAB_CARDS.map((card, index) => ({
					id: nextId++,
					kind: "card" as const,
					card,
					// One step verified and one failed, so every state of the task
					// panel is on screen at once: done, checked, and disagreed with.
					taskStatus:
						index === 1
							? ("verified" as const)
							: index === 2
								? ("failed" as const)
								: undefined,
					check: index === 2 ? DEMO_LAB_CHECK : undefined,
				})),
			];
		}
		if (demoMode) {
			return [
				...DEMO_CARDS.slice(0, 2).map((card) => ({
					id: nextId++,
					kind: "card" as const,
					card,
				})),
				{
					id: nextId++,
					kind: "notification" as const,
					notification: {
						text: "New exercise in Practice — Consuming messages",
						action: "practice" as const,
					},
				},
				...DEMO_CARDS.slice(2).map((card) => ({
					id: nextId++,
					kind: "card" as const,
					card,
				})),
			];
		}
		return [];
	});
	const [loading, setLoading] = useState(false);
	const [started, setStarted] = useState(
		demoMode || demoLab || params.has("demostream") || demoPlanning !== null,
	);
	const [input, setInput] = useState("");
	const [outline, setOutline] = useState<OutlineItem[] | null>(
		demoLab ? DEMO_LAB_OUTLINE : demoMode ? DEMO_OUTLINE : null,
	);
	const [currentConceptId, setCurrentConceptId] = useState<string | null>(
		demoLab
			? (DEMO_LAB_OUTLINE[0]?.id ?? null)
			: demoMode
				? (DEMO_OUTLINE[1]?.id ?? null)
				: null,
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
	const [topic, setTopic] = useState(
		demoLab ? DEMO_LAB_TOPIC : demoMode || demoPlanning ? demoTopic : "",
	);
	// How the open lesson was started. The bun process owns the authoritative
	// copy; this one lets the UI label the lesson and carry the project over
	// when a recap suggestion starts the next one.
	const [lessonConfig, setLessonConfig] = useState<LessonConfig | null>(
		demoMode || demoLab || demoPlanning ? demoLessonConfig : null,
	);
	// The project chosen on the home screen, before a lesson exists
	const [project, setProject] = useState<ProjectRef | null>(demoProject);
	// Whether the app may run this lesson's read-only checks. Undefined until
	// the learner is asked, which happens on the plan card and again on the
	// first step that actually has one. Persisted with the lesson.
	const [checksAllowed, setChecksAllowed] = useState<boolean | undefined>(
		// ?demolab renders a lesson that already allowed checks; ?demolab=ask
		// renders the moment it is asked for
		demoLab && params.get("demolab") !== "ask" ? true : undefined,
	);
	// The feed item whose check is running, so its panel can say so
	const [checking, setChecking] = useState<number | null>(null);
	// The home screen's other choice: teach this by having me build it. Mutually
	// exclusive with a project — a lab lesson has no repository to read, and
	// picking either one clears the other.
	const [labChosen, setLabChosen] = useState(false);
	// Bumped when returning home so the lesson library re-fetches
	const [homeRefresh, setHomeRefresh] = useState(0);
	// A requested jump to a concept's first card. The nonce makes repeat
	// selections of the same concept distinct so the effect re-runs.
	const [conceptJump, setConceptJump] = useState<{
		id: string;
		nonce: number;
	} | null>(null);
	// The same, for a card referring back to an earlier card by name
	const [cardJump, setCardJump] = useState<{
		slug: string;
		nonce: number;
	} | null>(null);
	// Live preview of the card currently being generated (streaming)
	const [streaming, setStreaming] = useState<{
		title: string;
		body: string;
		activity?: string;
	} | null>(
		params.has("demostream")
			? {
					title: "Kafka is a log, not a queue",
					body: "A traditional queue **deletes** a message once it's read. Kafka keeps every message for a set time, so many consumers can read the same stream at their own pace.\n\nEach consumer just remembers its own position",
				}
			: null,
	);
	// Every lookup this turn has made, oldest first. The planning screen shows
	// the tail of it; a mid-lesson turn only ever shows the latest line.
	const [activityTrail, setActivityTrail] = useState<string[]>([]);
	// True only while a foreground turn is in flight, so late stream
	// messages can't resurrect a preview after the real card lands
	const turnActiveRef = useRef(false);
	// Reading position: which segment of which card is highlighted
	const [highlight, setHighlight] = useState<{
		itemId: number;
		index: number;
	} | null>(null);
	// Notes pinned beside sections, and the one just created that wants focus
	const [stickies, setStickies] = useState<Sticky[]>([]);
	const [focusSticky, setFocusSticky] = useState<string | null>(null);
	// Conversations hanging off sections, and the one currently open as a chat.
	// At most one section's thread is open — the margin is not a second feed.
	// The open one carries the section's words so its header can name the
	// passage without re-reading the DOM on every render.
	const [threads, setThreads] = useState<Thread[]>(() =>
		demoMode
			? DEMO_THREADS.map((thread) => ({
					id: thread.id,
					// The demo feed is built in this same render, from id 0 upwards and
					// with nothing but cards in it, so a fixture's card index and the
					// item id it lands on are the same number.
					itemId: thread.cardIndex,
					segmentIndex: thread.segmentIndex,
					messages: thread.messages,
				}))
			: [],
	);
	const [openThread, setOpenThread] = useState<{
		id: string;
		section: string;
	} | null>(null);
	// The two moments a lesson still takes free text: a follow-up question after
	// the recap, and a lab step that did not go the way the card said it would.
	// One slot rather than two flags — the composer is one box, and only ever
	// open for one reason.
	const [composer, setComposer] = useState<
		{ kind: "follow-up" } | { kind: "trouble"; itemId: number } | null
	>(null);
	// The section under the pointer. Only which one — where its action rail is
	// drawn changes with every mouse move and is written to the DOM instead, the
	// same way the reading highlight and the margin's positions are: a re-render
	// of the whole feed per pixel of pointer travel is not affordable.
	const [hoverSection, setHoverSection] = useState<{
		itemId: number;
		index: number;
	} | null>(null);
	const railRef = useRef<HTMLDivElement>(null);
	const railTopRef = useRef(0);
	// Bumped each time reading mode is entered from nothing, to flash the
	// arrow-key hint
	const [hintNonce, setHintNonce] = useState(0);
	const bottomRef = useRef<HTMLDivElement>(null);
	// The feed list itself. Sticky notes are positioned against the sections
	// inside it, so its height changing means they all have to be re-placed.
	const feedListRef = useRef<HTMLDivElement>(null);
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
		if (scrollToPlanning()) return;
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [items, loading, streaming]);

	// The panes share one scroll container, so each tab has to claim its own
	// position: Lesson lands on the latest card, the others start at the top.
	// This runs after the newly mounted panel is in the DOM, and reading
	// scrollHeight forces the layout needed to measure it.
	useEffect(() => {
		const pane = feedRef.current;
		if (!pane) return;
		if (tab === "lesson" && scrollToPlanning()) return;
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

	// Following a card reference. The learner is reading further down the feed,
	// so the referenced card is above them: put its top under the header rather
	// than centring it, matching what selecting a concept does.
	useEffect(() => {
		if (!cardJump) return;
		document
			.querySelector(`[data-card-ref="${cardJump.slug}"]`)
			?.scrollIntoView({ behavior: "smooth", block: "start" });
	}, [cardJump]);

	// Every card a reference can address, keyed by its slugged title.
	const cardAnchors = useMemo(
		() =>
			new Set(
				items
					.filter((item) => item.kind === "card" && item.card?.title)
					.map((item) => cardRefSlug(item.card?.title ?? "")),
			),
		[items],
	);
	// Read through a ref so the resolver below can be identity-stable while
	// still seeing the current feed. It cannot simply close over cardAnchors:
	// that set changes with every card, the new identity would rebuild
	// CardMarkdown's component map, and remounting the markdown tree resets
	// every diagram to its loading skeleton (see card-markdown.tsx). Writing a
	// derived value during render is safe — the same input always writes the
	// same set, so StrictMode's second pass is a no-op.
	const cardAnchorsRef = useRef(cardAnchors);
	cardAnchorsRef.current = cardAnchors;

	const resolveCardRef = useCallback(
		(slug: string) => cardAnchorsRef.current.has(slug),
		[],
	);

	// A reference only ever points backwards, so the target is already mounted
	// and the jump needs no tab switch — unlike selecting a concept.
	const goToCard = useCallback((slug: string) => {
		setCardJump((prev) => ({ slug, nonce: (prev?.nonce ?? 0) + 1 }));
	}, []);

	// Auto-save the lesson snapshot whenever persistable state changes. The
	// bun process merges session id, language, and timestamps; errors and the
	// in-flight "checking" status are not persisted.
	useEffect(() => {
		if (demoMode || !started || !lessonId) return;
		// Notes travel by position, so they are written against the same list of
		// cards the feed below is: an id handed out this session means nothing on
		// disk. A note nobody has typed in yet is not worth saving.
		const cardIds = items
			.filter((item) => item.kind === "card")
			.map((item) => item.id);
		const snapshot: LessonSnapshot = {
			id: lessonId,
			topic,
			outline,
			currentConceptId,
			// A consent given once holds for the lesson, including after a resume
			checksAllowed,
			stickies: stickies.flatMap((sticky): SavedSticky[] => {
				const cardIndex = cardIds.indexOf(sticky.itemId);
				if (cardIndex < 0 || !sticky.text.trim()) return [];
				return [
					{
						id: sticky.id,
						cardIndex,
						segmentIndex: sticky.segmentIndex,
						text: sticky.text,
						color: sticky.color,
					},
				];
			}),
			// Same positional anchor as a note, and the same rule: a thread nobody
			// asked anything in is a slip, not a conversation. In-flight and failed
			// state is not persisted — only what was actually said.
			threads: threads.flatMap((thread): SavedThread[] => {
				const cardIndex = cardIds.indexOf(thread.itemId);
				if (cardIndex < 0 || thread.messages.length === 0) return [];
				return [
					{
						id: thread.id,
						cardIndex,
						segmentIndex: thread.segmentIndex,
						messages: thread.messages,
					},
				];
			}),
			// Only what the lesson itself said. An error panel is transient, and
			// the machine notice is the app's own voice about a machine that may
			// have changed by the time this lesson is opened again — it is
			// re-derived from a fresh probe on resume, never restored from disk.
			feed: items
				.filter(
					(item) =>
						item.kind === "card" ||
						item.kind === "user" ||
						item.kind === "notification",
				)
				.map(
					(item): SavedFeedItem => ({
						kind:
							item.kind === "user"
								? "user"
								: item.kind === "notification"
									? "notification"
									: "card",
						card: item.card,
						text: item.text,
						notification: item.notification,
						selectedOption: item.selectedOption,
						followUp: item.followUp,
						taskStatus: item.taskStatus,
						check: item.check,
					}),
				),
			practice: practice.map(
				(item): SavedPracticeItem => ({
					exercise: item.exercise,
					// Checking and regenerating are in-flight, not verdicts
					status:
						item.status === "correct" || item.status === "wrong"
							? item.status
							: "open",
					userAnswer: item.userAnswer,
					explanation: item.explanation,
				}),
			),
		};
		void bun.saveLesson({ snapshot }).catch(() => {});
	}, [
		lessonId,
		started,
		topic,
		outline,
		currentConceptId,
		items,
		practice,
		stickies,
		threads,
		checksAllowed,
	]);

	// The bun process spawns the CLI, makes the documentation call a lab lesson
	// opens with, and creates its folder — but Settings live in this side's
	// localStorage. So hand them over once the bridge exists, and again
	// whenever they are edited (see settings.tsx). Until this lands, the bun
	// side runs on its own defaults, which are the same ones.
	useEffect(() => {
		const settings = loadSettings();
		pushSettings({
			context7Key: settings.context7Key,
			labRoot: settings.labRoot,
			model: settings.model,
			effort: settings.effort,
		});
	}, []);

	// Receive streaming card previews from the bun process. Ignore any that
	// arrive outside a live turn so a stale delta can't reappear after the
	// finished card has been appended.
	useEffect(() => {
		onStreamCard((preview) => {
			if (!turnActiveRef.current) return;
			setStreaming(preview);
			const line = preview.activity;
			if (!line) return;
			// The same lookup is pushed with every text delta that follows it
			setActivityTrail((prev) =>
				prev.at(-1) === line ? prev : [...prev, line],
			);
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
		setActivityTrail([]);
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
				append(
					{ kind: "card", card: result.card, followUp: options.followUp },
					options,
				);
				// The app's own voice, under the card that caused it. Practice used
				// to fill up silently behind a tab badge, and a folder appeared on
				// disk with only the tutor to mention it.
				if (exercise) {
					notify(
						`New exercise in Practice${
							conceptTitle(exercise.conceptId)
								? ` — ${conceptTitle(exercise.conceptId)}`
								: ""
						}`,
						"practice",
					);
				}
				if (result.labDir) {
					notify(`This lesson's files go in ${shortPath(result.labDir)}`);
				}
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

	// `from` is the project the lesson reads: the home-screen pick for a fresh
	// lesson (which is what leaving it out means), and the current lesson's
	// project when a recap suggestion starts the next one — following a
	// suggestion should not silently leave the code. `goal` marks the new lesson
	// as groundwork for a subject the learner is coming back to.
	function startLesson(
		topicArg?: string,
		options: {
			from?: ProjectRef | null;
			goal?: LessonGoal;
			// Hands-on. Left out means the home screen's choice, the same way
			// `from` means the project picked there.
			lab?: boolean;
		} = {},
	) {
		const nextTopic = (topicArg ?? input).trim();
		if (!nextTopic || loading) return;
		const chosen = options.from === undefined ? project : options.from;
		const lab = options.lab ?? labChosen;
		const language = loadSettings().codeLanguage.trim() || undefined;
		// Groundwork is general knowledge by definition, so a lesson with a goal
		// never reads a project. The lesson it leads back to may well — that
		// project travels in the goal, not here.
		const config: LessonConfig = options.goal
			? { mode: "topic", topic: nextTopic, language, goal: options.goal }
			: lab
				? { mode: "lab", topic: nextTopic }
				: chosen
					? { mode: "codebase", topic: nextTopic, language, project: chosen }
					: { mode: "topic", topic: nextTopic, language };
		// Fully reset so a new lesson never inherits the previous one's state
		setItems([]);
		setPractice([]);
		setStickies([]);
		setThreads([]);
		setOpenThread(null);
		setComposer(null);
		setChecksAllowed(undefined);
		setChecking(null);
		setOutline(null);
		setCurrentConceptId(null);
		setHighlight(null);
		setLessonId(null);
		setTopic(nextTopic);
		setLessonConfig(config);
		setInput("");
		setTab("lesson");
		setStarted(true);
		append({ kind: "user", text: nextTopic });
		// The machine notice comes from the app, not the tutor, so it does not
		// wait on the turn — it lands seconds in, while the lesson is still
		// being planned, which is the whole point of it.
		if (config.mode === "lab") void showMachineNotice();
		void runTurn(() => bun.startLesson({ config }));
	}

	// What the app found on this Mac, in its own voice, before the lesson says
	// anything. Only ever warnings: a machine with nothing to warn about gets no
	// panel, and a probe that fails gets none either — this is a heads-up, and
	// it never becomes an error of its own.
	async function showMachineNotice() {
		const result = await bun.probeMachine({}).catch(() => null);
		if (result?.warnings.length) {
			append({
				kind: "notice",
				notice: { warnings: result.warnings, drift: [] },
			});
		}
	}

	// Take the groundwork first. The lesson being left has exactly one card in
	// it — the unanswered level question this offer sits under — so it is
	// deleted rather than left in the library as a stub nobody will open again:
	// the way back is the goal carried by the lesson that replaces it, which
	// starts a fresh lesson on the subject rather than resuming this one.
	async function startPrerequisite(prerequisite: Prerequisite) {
		if (loading) return;
		const goal: LessonGoal = {
			topic,
			project:
				lessonConfig?.mode === "codebase" ? lessonConfig.project : undefined,
		};
		if (lessonId) await bun.deleteLesson({ id: lessonId }).catch(() => {});
		startLesson(prerequisite.topic, { from: null, goal });
	}

	// Back to what the learner came for, once the groundwork is done. A fresh
	// lesson, on the project the goal remembers — a codebase question answered
	// with a detour through general knowledge has to land back in the code.
	function startGoal(goal: LessonGoal) {
		startLesson(goal.topic, { from: goal.project ?? null });
	}

	async function resumeLesson(id: string) {
		if (loading) return;
		const result = await bun.resumeLesson({ id }).catch(() => null);
		if (!result?.ok) return;
		const record = result.record;
		const feed = record.feed.map((item) => ({ ...item, id: nextId++ }));
		setItems(feed);
		setPractice(record.practice.map((item) => ({ ...item, id: nextId++ })));
		// Notes are saved against the card's position in the feed; give them
		// back the runtime id that card just received. One pointing past the end
		// of the feed has no section left to sit beside, so it is dropped.
		const cardIds = feed
			.filter((item) => item.kind === "card")
			.map((item) => item.id);
		setStickies(
			(record.stickies ?? []).flatMap((sticky): Sticky[] => {
				const itemId = cardIds[sticky.cardIndex];
				if (itemId === undefined) return [];
				return [
					{
						id: sticky.id,
						itemId,
						segmentIndex: sticky.segmentIndex,
						text: sticky.text,
						color: asStickyColor(sticky.color),
					},
				];
			}),
		);
		setThreads(
			(record.threads ?? []).flatMap((thread): Thread[] => {
				const itemId = cardIds[thread.cardIndex];
				if (itemId === undefined) return [];
				return [
					{
						id: thread.id,
						itemId,
						segmentIndex: thread.segmentIndex,
						messages: thread.messages,
					},
				];
			}),
		);
		setOpenThread(null);
		setComposer(null);
		setChecksAllowed(record.checksAllowed);
		setChecking(null);
		setOutline(record.outline);
		setCurrentConceptId(record.currentConceptId);
		setLessonId(record.id);
		setTopic(record.topic);
		// Resolved by the bun process before it replies, including for lessons
		// saved before modes existed
		setLessonConfig(record.config ?? null);
		setHighlight(null);
		setInput("");
		setTab("lesson");
		setStarted(true);
		// A lab lesson is re-checked against the machine it is coming back to,
		// not against the machine it left: the work cluster may have become the
		// current context since, and the warning has to be true today. It goes
		// to the top of the feed, above the lesson it applies to.
		if (record.config?.mode === "lab") {
			void bun
				.probeMachine({})
				.then((result) => {
					if (!result.warnings.length && !result.drift.length) return;
					setItems((prev) => [
						{
							id: nextId++,
							kind: "notice",
							notice: { warnings: result.warnings, drift: result.drift },
						},
						...prev,
					]);
				})
				.catch(() => {});
		}
	}

	function goHome() {
		setStarted(false);
		setHomeRefresh((n) => n + 1);
	}

	// Free text reaching the lesson itself, from either of the two places that
	// still open a box: a follow-up after the recap, and a lab step that did not
	// do what the card said. The learner's own words go into the feed either
	// way; what the tutor receives says which of the two this was, since a
	// pasted error means nothing without "that step failed" in front of it.
	function sendComposer() {
		const text = input.trim();
		const open = composer;
		if (!text || !open || loading) return;
		setInput("");
		setComposer(null);
		append({ kind: "user", text });
		if (open.kind === "trouble") {
			setItems((prev) =>
				prev.map((item) =>
					item.id === open.itemId ? { ...item, taskStatus: "failed" } : item,
				),
			);
			void runTurn(() =>
				bun.sendMessage({
					text: `That step did not work. Here is what happened:\n\n${text}`,
				}),
			);
			return;
		}
		void runTurn(() => bun.sendMessage({ text }), { followUp: true });
	}

	// One line from the app, in the feed, about something it just did. Appended
	// after the card that caused it, so the feed reads in the order things
	// happened.
	function notify(text: string, action?: FeedNotification["action"]) {
		append({ kind: "notification", notification: { text, action } });
	}

	function continueLesson(options: { highlightNew?: boolean } = {}) {
		if (loading) return;
		void runTurn(() => bun.continueLesson({}), { ...options, pinTop: true });
	}

	// The learner says the step is done. Their word for it and nothing else —
	// the app ran no command and checked no output, and it must not imply that
	// it did (see docs/adr/0001-the-learner-executes-the-app-only-verifies.md).
	// Sent as a message rather than a plain "continue" so the lesson's own
	// session records that the step happened.
	function confirmTask(
		itemId: number,
		options: { highlightNew?: boolean } = {},
	) {
		if (loading) return;
		setItems((prev) =>
			prev.map((item) =>
				item.id === itemId ? { ...item, taskStatus: "done" } : item,
			),
		);
		// A verified step says so, and says what the check saw: the session then
		// knows the outcome without anybody spending a turn to tell it.
		const item = items.find((entry) => entry.id === itemId);
		const passed = item?.taskStatus === "verified" && item.check;
		void runTurn(
			() =>
				bun.sendMessage({
					text: passed
						? `I did that step and the check passed: ${passed.note} Continue.`
						: "I did that step, and it did what you said it would. Continue.",
				}),
			{ ...options, pinTop: true },
		);
	}

	// A failed check already holds everything a diagnosis needs — the command,
	// the output, the verdict — so the learner is not asked to paste what the
	// app is already holding. This is where the mode earns its keep.
	function askAboutFailure(itemId: number) {
		if (loading) return;
		const item = items.find((entry) => entry.id === itemId);
		const check = item?.check;
		if (!check) return;
		append({ kind: "user", text: "That did not work — what now?" });
		void runTurn(() =>
			bun.sendMessage({
				text: `That step did not work. The app ran \`${check.command}\` and it printed:\n\n${check.output || "(nothing at all)"}\n\n${check.note}`,
			}),
		);
	}

	// Run this card's check. The app spawns the command itself — the only thing
	// it ever runs on the learner's behalf, read-only and allowlisted before it
	// was even offered (src/bun/verify.ts). A pass marks the step verified,
	// which is a stronger claim than "I did it" and is the one case where the
	// app, not the learner, says the step worked.
	async function runCheck(itemId: number, task: CardTask) {
		const verify = task.verify;
		if (!verify || checking !== null || loading) return;
		setChecking(itemId);
		const result = await bun
			.runVerify({ verify, taskExpect: task.expect })
			.catch(
				(error): VerifyResult => ({
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		setChecking(null);
		setItems((prev) =>
			prev.map((item) => {
				if (item.id !== itemId) return item;
				// A check that could not run is not a step that failed. The card
				// stays where it was and the learner still has "I did it".
				if (!result.ok) {
					return {
						...item,
						check: {
							command: verify.argv.join(" "),
							output: "",
							note: "The check could not be run — say how it went yourself.",
						},
					};
				}
				return {
					...item,
					taskStatus: result.pass ? "verified" : "failed",
					check: {
						command: result.command,
						output: result.output,
						note: result.note,
					},
				};
			}),
		);
	}

	// The card at the end of the feed, when it is still waiting on the learner
	// to do something. It is the only card that can be acted on: everything
	// above it has already been answered or moved past.
	function openTaskItem(): FeedItem | undefined {
		const last = items.findLast((item) => item.kind === "card");
		if (!last?.card?.task) return undefined;
		// A step the learner said they did, or that the app checked, is finished:
		// the bar goes back to Continue. "failed" is not finished — that is the
		// one the lesson has to hear about.
		return last.taskStatus === "done" || last.taskStatus === "verified"
			? undefined
			: last;
	}

	// What the primary action means on the card in front of the learner: on a
	// task card it is "I did it", everywhere else it is Continue. One function,
	// so the button and the ArrowDown key can never disagree.
	function advanceLesson(options: { highlightNew?: boolean } = {}) {
		if (loading) return;
		const pending = openTaskItem();
		if (!pending) {
			continueLesson(options);
			return;
		}
		// A failed check makes the primary action "ask the tutor", not "I did
		// it": the step demonstrably did not work, and saying it did would teach
		// the next card on a false footing.
		if (pending.taskStatus === "failed") askAboutFailure(pending.id);
		else confirmTask(pending.id, options);
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

	// Point at a card and the section under the pointer offers its two actions.
	//
	// The section is resolved by the pointer's HEIGHT, not by what is underneath
	// it. Asking `closest("[data-segment]")` only ever matches inside the words,
	// so the whole gutter — the very direction you move in to reach the buttons —
	// resolved to nothing, and coming at a card from the right showed you
	// nothing at all. Every y inside the card's run of sections now belongs to
	// one, text or not.
	function trackSection(
		itemId: number,
		event: ReactMouseEvent<HTMLDivElement>,
	) {
		const row = sectionRowAt(itemId, event.clientY);
		if (!row) {
			// Above the first section or below the last — the title, the options,
			// the padding at the foot of the card. Nothing to offer there.
			setHoverSection((prev) => (prev?.itemId === itemId ? null : prev));
			return;
		}
		// The rail rides at the pointer's own height, held inside the section, so
		// reaching it is a straight move sideways — not a diagonal up to the top
		// of a paragraph you happen to be reading the last line of. Once the
		// pointer is on the rail, the rail is centred on the pointer, so it can't
		// slide out from under it.
		const railHeight = railRef.current?.offsetHeight || RAIL_HEIGHT_FALLBACK;
		const lowest = Math.max(row.bottom - railHeight, row.top);
		const top = Math.round(
			Math.min(Math.max(event.clientY - railHeight / 2, row.top), lowest) -
				event.currentTarget.getBoundingClientRect().top,
		);
		railTopRef.current = top;
		if (railRef.current) railRef.current.style.top = `${top}px`;
		setHoverSection((prev) =>
			prev?.itemId === itemId && prev.index === row.index
				? prev
				: { itemId, index: row.index },
		);
	}

	// A note is pinned to one section, in the same coordinates the reading
	// position uses: the card it sits in, and the section's index within it.
	function addSticky(itemId: number, segmentIndex: number) {
		const sticky: Sticky = {
			id: newStickyId(),
			itemId,
			segmentIndex,
			text: "",
			color: randomStickyColor(),
		};
		setStickies((prev) => [...prev, sticky]);
		setFocusSticky(sticky.id);
	}

	// Ask about a section. One thread per section, always: a second conversation
	// beside the same paragraph would sit on top of the first, and "what I asked
	// about this passage" is one thread of thought however many questions it
	// took. So this opens the section's thread when it already has one.
	function openQuestion(itemId: number, segmentIndex: number) {
		const section = sectionTextOf(itemId, segmentIndex);
		const existing = threads.find(
			(thread) =>
				thread.itemId === itemId && thread.segmentIndex === segmentIndex,
		);
		if (existing) {
			setOpenThread({ id: existing.id, section });
			return;
		}
		const thread: Thread = {
			id: newThreadId(),
			itemId,
			segmentIndex,
			messages: [],
		};
		setThreads((prev) => [...prev, thread]);
		setOpenThread({ id: thread.id, section });
	}

	// Send a question and hang the answer under it. The bun process is stateless
	// here, so everything the answer is built from goes out with the question:
	// the lesson read so far, the card, the section, and what this thread has
	// already said.
	async function askInThread(threadId: string, question: string) {
		const thread = threads.find((item) => item.id === threadId);
		if (!thread) return;
		const history = thread.messages;
		const item = items.find((entry) => entry.id === thread.itemId);
		const card = item?.card;
		// A question about a step the app checked should arrive with the check.
		// The panel's own words are the command and what to expect; the output
		// lives outside them (it would swamp a 1200-character section), so it is
		// appended here, trimmed to the part somebody would actually read.
		const check = item?.check;
		const section = check
			? `${sectionTextOf(thread.itemId, thread.segmentIndex)}\n\nThe app then ran \`${check.command}\`, which printed:\n${check.output.slice(0, 800) || "(nothing at all)"}\n\n${check.note}`
			: sectionTextOf(thread.itemId, thread.segmentIndex);
		setThreads((prev) =>
			prev.map((item) =>
				item.id === threadId
					? {
							...item,
							messages: [...item.messages, { role: "user", text: question }],
							pending: true,
							error: undefined,
						}
					: item,
			),
		);
		const result = await bun
			.askAboutSection({
				topic,
				cardTitle: card?.title ?? "",
				section,
				material: lessonMaterial(),
				history,
				question,
			})
			.catch((error: unknown) => ({
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			}));
		setThreads((prev) =>
			prev.map((item) => {
				if (item.id !== threadId) return item;
				if (!result.ok) return { ...item, pending: false, error: result.error };
				return {
					...item,
					pending: false,
					error: undefined,
					messages: [
						...item.messages,
						{ role: "tutor" as const, text: result.answer },
					],
				};
			}),
		);
	}

	// Leaving a thread. One nobody asked anything in is a slip — the same rule
	// an empty note follows — so it goes rather than sitting in the margin as an
	// empty card. The reading position goes back to the section it belongs to.
	function closeThread(thread: Thread) {
		setOpenThread(null);
		if (thread.messages.length === 0) {
			setThreads((prev) => prev.filter((item) => item.id !== thread.id));
		}
		moveHighlight(thread.itemId, thread.segmentIndex, { scroll: false });
	}

	function removeThread(id: string) {
		setThreads((prev) => prev.filter((item) => item.id !== id));
		setOpenThread(null);
	}

	// Both are stable: a note debounces its text against them, and a callback
	// that changed identity on every feed render would keep restarting that.
	const updateSticky = useCallback((id: string, text: string) => {
		setStickies((prev) =>
			prev.map((sticky) => (sticky.id === id ? { ...sticky, text } : sticky)),
		);
	}, []);

	const removeSticky = useCallback((id: string) => {
		setStickies((prev) => prev.filter((sticky) => sticky.id !== id));
	}, []);

	const clearStickyFocus = useCallback(() => setFocusSticky(null), []);

	// Done writing: hand the reading position back to the section the note
	// belongs to, so the arrow keys carry on from where they left off. No
	// scroll — the note is beside the section, so both are already on screen.
	function finishSticky(sticky: Sticky) {
		moveHighlight(sticky.itemId, sticky.segmentIndex, { scroll: false });
	}

	// Notes and threads hang in the same margin, sorted together by where each
	// wants to sit — see MarginLayer for why they don't get a column each.
	const marginItems = useMemo(
		() => [
			...stickies.map((sticky) => ({ kind: "note" as const, ...sticky })),
			...threads.map((thread) => ({ kind: "thread" as const, ...thread })),
		],
		[stickies, threads],
	);

	// Mark the sections that have a conversation hanging off them, and with how
	// many questions, so the count is visible while reading even when a busy
	// margin has pushed the thread card away from its own paragraph. Written
	// straight to the DOM for the same reason the reading highlight is: sections
	// are markdown internals, and threading a count through them would rebuild
	// the markdown tree on every answer.
	// biome-ignore lint/correctness/useExhaustiveDependencies: items is an intentional trigger — a resumed lesson mounts its cards and its threads in the same commit, and the marker has to be re-applied once the sections exist
	useEffect(() => {
		for (const el of document.querySelectorAll("[data-questions]")) {
			el.removeAttribute("data-questions");
		}
		for (const thread of threads) {
			const asked = questionCount(thread);
			if (asked === 0) continue;
			segmentsOf(thread.itemId)[thread.segmentIndex]?.setAttribute(
				"data-questions",
				String(asked),
			);
		}
	}, [threads, items]);

	// An open thread grows downwards from the section it hangs off, so the end of
	// the conversation — and the box for adding to it — can fall past the bottom
	// of the pane. This is the ONLY thing allowed to scroll the lesson when a
	// thread opens, and it does the least it can: nothing at all when the thread
	// is already on screen, and otherwise exactly enough to bring its bottom
	// into view. Opening a thread should leave the passage you were reading
	// where you left it.
	//
	// Capped so the scroll can never push the thread's own top out of the pane:
	// on a window too short to hold the whole thread, seeing where it starts
	// beats seeing where it ends.
	// biome-ignore lint/correctness/useExhaustiveDependencies: threads is an intentional trigger — each answer makes the open thread taller, so the room it needs has to be found again
	useEffect(() => {
		if (!openThread) return;
		const pane = feedRef.current;
		const thread = document.querySelector("[data-thread][data-open]");
		if (!pane || !thread) return;
		const paneBox = pane.getBoundingClientRect();
		const threadBox = thread.getBoundingClientRect();
		const needed = threadBox.bottom - paneBox.bottom + THREAD_FIT_GAP;
		if (needed <= 0) return;
		const available = Math.max(threadBox.top - paneBox.top - THREAD_FIT_GAP, 0);
		const delta = Math.min(needed, available);
		if (delta > 0) {
			pane.scrollTo({ top: pane.scrollTop + delta, behavior: "smooth" });
		}
	}, [openThread, threads]);

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
			const target = event.target as HTMLElement | null;
			// A note being written, or a thread being talked in, owns every key
			// that reaches it — Escape included. A thread is where you stop
			// reading, so the reading keys must not reach inside one.
			if (target?.closest("[data-sticky], [data-thread]")) return;
			// A panel opened over the feed — the lesson panel, settings — owns the
			// keys while it is up, Escape included: reading on under it would
			// scroll the lesson away behind the thing you opened. The check is on
			// the popup existing rather than on focus, because a popover opened by
			// pointer can leave focus on its trigger out here in the chrome.
			if (document.querySelector("[data-slot=popover-content]")) return;
			if (event.key === "Escape") {
				setHighlight(null);
				return;
			}
			const typing =
				!!target?.closest("textarea, select, [contenteditable=true]") ||
				(target instanceof HTMLInputElement && target.value !== "");
			// The two things you can hang off the section you are reading, one key
			// each: ArrowRight opens a question about it, ArrowLeft pins a quiet
			// note. Both are the keyboard twins of the buttons that appear in the
			// card's right padding when a section is pointed at.
			if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
				if (typing || !highlight) return;
				event.preventDefault();
				if (event.key === "ArrowRight") {
					openQuestion(highlight.itemId, highlight.index);
				} else {
					addSticky(highlight.itemId, highlight.index);
				}
				return;
			}
			if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
			if (typing) return;
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
				advanceLesson({ highlightNew: true });
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
							{project
								? `What do you want to understand about ${project.name}?`
								: labChosen
									? "What would you like to build?"
									: "What would you like to learn?"}
						</p>
					</div>
					<div className="relative flex w-full max-w-xl flex-col gap-3.5">
						<form
							className="relative w-full"
							onSubmit={(event) => {
								event.preventDefault();
								startLesson();
							}}
						>
							<Input
								autoFocus
								value={input}
								onChange={(event) => setInput(event.target.value)}
								placeholder={
									project
										? "e.g. how identity and org-scoped tokens work"
										: labChosen
											? "e.g. Grafana, running on this Mac"
											: "e.g. Kubernetes, from the basics"
								}
								className="h-15 rounded-3xl border-border bg-card pr-28 pl-5 text-lg shadow-md"
								{...RAW_TEXT_INPUT}
							/>
							<Button
								type="submit"
								className="absolute top-2 right-2 h-11 rounded-2xl px-6"
								disabled={!input.trim()}
							>
								Start
							</Button>
						</form>
						{/* Where the lesson comes from: a project to read, or a thing
						    to build. One or the other — a lab has no repository, so
						    choosing either hides the other. */}
						<div className="flex flex-wrap items-center justify-center gap-2">
							{!labChosen && (
								<ProjectField project={project} onChange={setProject} />
							)}
							{!project && (
								<LabField chosen={labChosen} onChange={setLabChosen} />
							)}
						</div>
					</div>
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
	// The recap has been reached — not "the last card is the recap". Follow-up
	// answers land after it as ordinary cards, and the lesson does not become
	// unfinished again because one of them did.
	const lessonEnded = items.some((item) => item.card?.type === "recap");
	// The step the learner is standing in front of, when there is one. Drives
	// the bar at the bottom and the ArrowDown key alike.
	const pendingTask = openTaskItem();
	// How many steps this lesson has handed out, and how many the learner says
	// they have done. Left off entirely when no card has a task, so the progress
	// pill grows a third figure only in the mode that has one.
	// Steps that were handed out and never marked done. Only meaningful once the
	// lesson has ended, which is the one place it is used.
	const unfinishedSteps = items
		.filter(
			(item) =>
				item.card?.task &&
				item.taskStatus !== "done" &&
				item.taskStatus !== "verified",
		)
		.map((item) => ({
			title: item.card?.title ?? "",
			command: item.card?.task?.command,
		}));
	const taskItems = items.filter((item) => item.card?.task);
	const stepStats =
		taskItems.length > 0
			? {
					stepsTotal: taskItems.length,
					stepsDone: taskItems.filter(
						(item) =>
							item.taskStatus === "done" || item.taskStatus === "verified",
					).length,
				}
			: {};
	// The subject this lesson is groundwork for, when it is one. Read off the
	// config rather than remembered by the tutor, so it survives a resume and
	// says the same thing on the recap card as it does in the top bar.
	const goal = lessonConfig?.mode === "topic" ? lessonConfig.goal : undefined;

	// Setting a lesson up is the longest wait in the app, and until the outline
	// exists there is nothing on screen to show for it — so it gets a screen of
	// its own rather than the skeleton card a mid-lesson turn gets. Which half
	// of the setup we are in is readable from the feed: a question card in it
	// means the level has been asked and the outline is what's coming.
	//
	// It gives way the moment the card starts arriving. Watching a card write
	// itself is better than any placeholder, including this one.
	const planningStage: PlanningStage | null =
		demoPlanning ??
		(loading && !outline && !streaming?.title && !streaming?.body
			? items.some((item) => item.card?.type === "question")
				? "outline"
				: "level"
			: null);
	// Only a lesson with tools has lookups to show
	const showDemoLookups = Boolean(demoPlanning && demoProject);

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

	// The lesson text a replacement exercise has to be answerable from: the
	// cards that taught the concept, falling back to the whole lesson when the
	// exercise names no concept or its cards were salvaged without one. Card
	// references are flattened — an exercise is not a card and has nothing to
	// link back to.
	function lessonMaterial(conceptId?: string) {
		const cards = items.filter(
			(item) => item.kind === "card" && item.card?.type === "step",
		);
		const scoped = conceptId
			? cards.filter((item) => item.card?.conceptId === conceptId)
			: [];
		const chosen = scoped.length > 0 ? scoped : cards;
		return chosen
			.map((item) => {
				if (!item.card) return "";
				// The takeaway is material the learner read too, so a replacement
				// exercise may fairly blank a term the card only spelled out there.
				const takeaway = item.card.takeaway
					? `\n\nKey takeaway: ${stripCardRefs(item.card.takeaway)}`
					: "";
				return `## ${item.card.title}\n\n${stripCardRefs(item.card.body)}${takeaway}`;
			})
			.join("\n\n");
	}

	// The panel's outline is navigation: selecting a concept jumps the feed
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

	return (
		<Tabs
			value={tab}
			onValueChange={(value) => setTab(String(value))}
			className="flex h-dvh gap-0 overflow-hidden data-horizontal:flex-row"
		>
			<ExplainSelection topic={topic} />
			<AppRail active="lesson" onHome={goHome} />
			{/* What is pinned beside the lesson decides the whole pane's geometry,
			    not just the feed's — so it is declared here, above the header, the
			    feed and the key bar alike. A thread being OPEN is a state of its
			    own, ahead of the other three: talking is not reading, so the
			    lesson steps further aside and dims for as long as it lasts. */}
			<main
				className="lesson-shell flex min-w-0 flex-1 flex-col"
				data-margin={
					openThread
						? "thread-open"
						: threads.length > 0
							? "threads"
							: stickies.length > 0
								? "notes"
								: undefined
				}
			>
				{/* The one row that does NOT carry the reading column. It is chrome,
				    not content: the pill sits at the pane's left edge — where the
				    panel it opens used to be docked — and the tabs at the right, so
				    the column underneath is free to centre itself and its margin
				    without dragging the window's furniture along. Where the tab you
				    are on is said by the tab itself; no title repeats it. */}
				<header className="flex shrink-0 items-center gap-4 border-b border-border/70 bg-background px-3 py-2">
					<LessonProgress
						topic={topic}
						project={
							lessonConfig?.mode === "codebase"
								? lessonConfig.project
								: undefined
						}
						goal={goal}
						outline={outline}
						currentIndex={currentIndex}
						lessonEnded={lessonEnded}
						feedConcepts={feedConcepts}
						stats={{
							cards: items.filter((item) => item.kind === "card").length,
							practiceDone: practice.length - openExercises,
							practiceTotal: practice.length,
							...stepStats,
						}}
						onSelectConcept={goToConcept}
					/>
					<div className="flex-1" />
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
						{/* Notes are switched off — see NOTES_ENABLED in
						    src/bun/lesson-modes.ts for what has to come back with it. */}
						{/* <TabsTrigger value="notes">Notes</TabsTrigger> */}
					</TabsList>
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
								lessonMaterial={lessonMaterial}
							/>
						</TabsContent>
						{/* <TabsContent value="notes" className={cn(COLUMN, "pt-6 text-base")}>
							<NotesPanel demoMarkdown={demoMode ? DEMO_NOTES : undefined} />
						</TabsContent> */}
						<TabsContent
							value="lesson"
							className="reading-column feed-column px-8 pt-7 text-base"
						>
							<MarginLayer
								items={marginItems}
								feedRef={feedListRef}
								renderItem={(entry, register) =>
									entry.kind === "note" ? (
										<StickyCard
											key={entry.id}
											sticky={entry}
											autoFocus={entry.id === focusSticky}
											onFocused={clearStickyFocus}
											onChange={updateSticky}
											onRemove={removeSticky}
											onDone={finishSticky}
											register={register}
										/>
									) : (
										<ThreadCard
											key={entry.id}
											thread={entry}
											open={openThread?.id === entry.id}
											sectionText={openThread?.section ?? ""}
											onOpen={() =>
												openQuestion(entry.itemId, entry.segmentIndex)
											}
											onClose={() => closeThread(entry)}
											onAsk={(question) => void askInThread(entry.id, question)}
											onRemove={() => removeThread(entry.id)}
											register={register}
										/>
									)
								}
							/>
							{/* The cards alone, named so an open thread can dim them. The
							    margin is a sibling inside .feed-column, so dimming the
							    column itself would dim the conversation with them. */}
							<div ref={feedListRef} className="feed-list space-y-5 pb-10">
								{items.map((item, index) => {
									// The app's own voice, not the tutor's — see MachineNotice
									if (item.kind === "notice") {
										return (
											<MachineNotice
												key={item.id}
												warnings={item.notice?.warnings ?? []}
												drift={item.notice?.drift}
											/>
										);
									}
									if (item.kind === "notification" && item.notification) {
										return (
											<FeedNote
												key={item.id}
												notification={item.notification}
												onOpen={
													item.notification.action === "practice"
														? () => setTab("practice")
														: undefined
												}
											/>
										);
									}
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
										// The feed ITEM, not the card: a takeaway rides under the
										// card as a second element, and both belong to one item.
										// Every section coordinate in the app — the reading
										// position, the dimming rules in index.css, a sticky
										// note's anchor — is (item id, section index), so
										// data-item-id has to sit above both of them.
										// biome-ignore lint/a11y/useKeyWithClickEvents: clicking a section is a pointer shortcut into keyboard reading; the arrow keys already drive the same thing from a window-level handler (see the reading effect above)
										// biome-ignore lint/a11y/noStaticElementInteractions: as above — the click adds nothing that is not already on the keyboard
										<div
											key={item.id}
											data-item-id={item.id}
											data-concept-id={card?.conceptId}
											data-card-ref={
												card?.title ? cardRefSlug(card.title) : undefined
											}
											className="relative scroll-mt-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-500"
											// Clicking a section puts the reading position there.
											// Bound here rather than on the card body so the
											// takeaway panel below the card answers to it too.
											onClick={(event) => selectSegment(item.id, event)}
											// Tracked on the whole item for the same reason: every
											// section of it can be pointed at, takeaway included,
											// and the rail lives out here where the card's own
											// overflow cannot clip it.
											onMouseMove={(event) => trackSection(item.id, event)}
											onMouseLeave={() => setHoverSection(null)}
										>
											<UICard
												className={cn("relative", isRecap && "bg-accent/60")}
											>
												<CardHeader className="gap-2">
													{(isRecap || item.followUp || showConcept) && (
														<div className="flex items-center gap-1.5 text-sm text-muted-foreground">
															{(isRecap || item.followUp) && (
																<HugeiconsIcon
																	icon={
																		isRecap ? Award01Icon : MessageQuestionIcon
																	}
																	className="size-4 shrink-0"
																/>
															)}
															<span className="truncate">
																{isRecap
																	? "Recap"
																	: item.followUp
																		? "Follow-up"
																		: concept}
															</span>
														</div>
													)}
													<CardTitle className="text-[1.5rem] leading-[1.3] font-[560] tracking-[-0.022em]">
														{card?.title}
													</CardTitle>
												</CardHeader>
												<CardContent
													data-explainable
													className="reading prose prose-lg max-w-none dark:prose-invert"
												>
													<CardMarkdown
														body={card?.body ?? ""}
														onCardRef={goToCard}
														resolveCardRef={resolveCardRef}
													/>
												</CardContent>
												{/* The way back, on the card that ends the detour. Built
												    from the lesson's own config and not from anything the
												    tutor wrote, so it is there whether or not the recap
												    remembered to mention where the learner was heading. */}
												{isRecap && goal && (
													<CardContent className="flex flex-col gap-2">
														<p className="mb-1 text-sm text-muted-foreground">
															What you came for
														</p>
														<button
															type="button"
															disabled={loading}
															onClick={() => startGoal(goal)}
															className="group flex items-center gap-3 rounded-2xl bg-marker/8 p-3.5 text-left ring-1 ring-marker/25 transition-all hover:shadow-sm hover:ring-marker/45 disabled:pointer-events-none disabled:opacity-50"
														>
															<span className="grid size-8 shrink-0 place-items-center rounded-full bg-marker/12 text-marker">
																<HugeiconsIcon
																	icon={Flag01Icon}
																	className="size-4"
																/>
															</span>
															<span className="flex-1 text-[0.95rem] font-medium">
																{goal.topic}
															</span>
															<span className="grid size-8 shrink-0 place-items-center rounded-full bg-marker text-marker-foreground">
																<HugeiconsIcon
																	icon={ArrowRight01Icon}
																	className="size-4.5"
																/>
															</span>
														</button>
													</CardContent>
												)}
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
																onClick={() =>
																	startLesson(suggestion, {
																		from:
																			lessonConfig?.mode === "codebase"
																				? lessonConfig.project
																				: null,
																		// Following a suggestion should not
																		// quietly stop being hands-on
																		lab: lessonConfig?.mode === "lab",
																	})
																}
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
															const selected =
																item.selectedOption === option.id;
															const answered =
																item.selectedOption !== undefined;
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
																		if (!answered)
																			chooseOption(item.id, option);
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
												{/* A fourth answer to the level question: none of the
												    above, start me one step back. Disabled once a level
												    has been picked — by then the lesson it would throw
												    away is a lesson in progress. */}
												{card?.prerequisite && (
													<CardContent>
														<PrerequisiteOffer
															prerequisite={card.prerequisite}
															goalTopic={topic}
															disabled={
																loading || item.selectedOption !== undefined
															}
															onStart={startPrerequisite}
														/>
													</CardContent>
												)}
											</UICard>
											{/* The structure first, then the line to keep: the map
											    tells you where you are, the takeaway is what you
											    leave with. */}
											{/* What the lesson needs before it starts, on the card
											    that plans it — while backing out is still free. */}
											{card?.requirements && (
												<RequirementsPanel requirements={card.requirements}>
													{/* The lesson asks once, here, before any step has
													    run — and again on the first step that actually
													    has a check, in case this was skipped past. */}
													{lessonConfig?.mode === "lab" &&
														checksAllowed === undefined && (
															<ChecksConsent onDecide={setChecksAllowed} />
														)}
												</RequirementsPanel>
											)}
											{card?.hierarchy && (
												<HierarchyNote hierarchy={card.hierarchy} />
											)}
											{card?.takeaway && <TakeawayNote text={card.takeaway} />}
											{/* Then the doing, in the order the learner needs it:
											    check this, it costs this, now run it. The task is
											    last on the card, directly above the button that
											    says they did it. */}
											{card?.caution && <CautionNote text={card.caution} />}
											{card?.cost && <CostNote text={card.cost} />}
											{/* On the recap of a lab lesson: what was started and
											    never stopped, counted by the app rather than
											    remembered by the tutor. */}
											{isRecap && unfinishedSteps.length > 0 && (
												<TeardownNotice steps={unfinishedSteps} />
											)}
											{card?.task && (
												<TaskPanel
													task={card.task}
													status={item.taskStatus}
													check={item.check}
													checksAllowed={checksAllowed}
													checking={checking === item.id}
													onCheck={() =>
														card.task && void runCheck(item.id, card.task)
													}
													onDecideChecks={setChecksAllowed}
												/>
											)}
											{/* The two things you can hang off a section — the same
											    pair ArrowRight and ArrowLeft do by keyboard. Out here
											    with the takeaway rather than inside the card: the card
											    clips its own overflow, and a rail that belongs to the
											    whole item can serve the takeaway's section too. */}
											{hoverSection?.itemId === item.id && (
												<div
													ref={railRef}
													className="section-actions animate-in fade-in-0 duration-150"
													style={{ top: railTopRef.current }}
												>
													<button
														type="button"
														title="Ask about this section  →"
														aria-label="Ask about this section"
														onClick={() =>
															openQuestion(item.id, hoverSection.index)
														}
													>
														<HugeiconsIcon
															icon={MessageQuestionIcon}
															className="size-3.5"
														/>
													</button>
													<button
														type="button"
														title="Pin a note to this section  ←"
														aria-label="Pin a note to this section"
														onClick={() =>
															addSticky(item.id, hoverSection.index)
														}
													>
														<HugeiconsIcon
															icon={StickyNote01Icon}
															className="size-3.5"
														/>
													</button>
												</div>
											)}
										</div>
									);
								})}
								{planningStage ? (
									<LessonPlanning
										topic={topic}
										project={
											lessonConfig?.mode === "codebase"
												? lessonConfig.project
												: undefined
										}
										stage={planningStage}
										activity={
											showDemoLookups
												? DEMO_ACTIVITY.at(-1)
												: streaming?.activity
										}
										trail={showDemoLookups ? DEMO_ACTIVITY : activityTrail}
									/>
								) : streaming ? (
									<PendingCard
										label={streaming.activity || "Writing"}
										title={streaming.title}
										body={streaming.body}
									/>
								) : (
									loading && <PendingCard label="Thinking" />
								)}
								<div ref={bottomRef} />
							</div>
						</TabsContent>
					</div>
					{tab === "lesson" && planningStage && <PlanningWash />}
					{/* Content dissolves at the pane edge instead of being cut off */}
					<div
						aria-hidden
						className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent"
					/>
					<ReadingHint trigger={hintNonce} />
				</div>

				{/* No composer while the lesson runs. A question about the material
				    belongs beside the passage that raised it, not in a box at the
				    bottom that has forgotten which one that was — so the bar spends
				    its width saying which keys do what instead, and free text comes
				    back only at the end, for follow-ups. */}
				{tab === "lesson" && (
					<div className="shrink-0 border-t border-border/70 bg-background py-3.5">
						{composer ? (
							<form
								className={cn(COLUMN, "flex gap-2.5")}
								onSubmit={(event) => {
									event.preventDefault();
									sendComposer();
								}}
							>
								<Input
									autoFocus
									value={input}
									onChange={(event) => setInput(event.target.value)}
									// Escape is the way out of a box opened by mistake —
									// without it a mis-click would hide Continue for good.
									onKeyDown={(event) => {
										if (event.key === "Escape") setComposer(null);
									}}
									placeholder={
										composer.kind === "trouble"
											? "What happened? Paste what your terminal printed."
											: "What else would you like to know?"
									}
									{...RAW_TEXT_INPUT}
									className="h-12 rounded-2xl border-border bg-card px-4 shadow-xs"
									disabled={loading}
								/>
								<Button
									type="submit"
									className="h-12 shrink-0 gap-2 rounded-2xl px-5"
									disabled={loading || !input.trim()}
								>
									{composer.kind === "trouble" ? "Send" : "Ask"}
									<HugeiconsIcon icon={SentIcon} className="size-4.5" />
								</Button>
							</form>
						) : (
							<div className={cn(COLUMN, "flex items-center gap-2.5")}>
								<ReadingKeys />
								{lessonEnded ? (
									<>
										<Button
											type="button"
											variant="outline"
											className="h-12 shrink-0 gap-2 rounded-2xl px-5"
											disabled={loading}
											onClick={() => setComposer({ kind: "follow-up" })}
										>
											<HugeiconsIcon
												icon={MessageQuestionIcon}
												className="size-4.5"
											/>
											Ask a follow-up
										</Button>
										<Button
											type="button"
											className="h-12 shrink-0 rounded-2xl px-5"
											disabled={loading}
											onClick={goHome}
										>
											New lesson
										</Button>
									</>
								) : pendingTask?.taskStatus === "failed" ? (
									// The app already holds the command, the output and the
									// verdict, so the tutor gets them without the learner
									// retyping anything. The other answer is theirs: the check
									// can be wrong, and a learner who can see it worked should
									// not be held up by it.
									<>
										<Button
											type="button"
											variant="outline"
											className="h-12 shrink-0 gap-2 rounded-2xl px-5"
											disabled={loading}
											onClick={() => confirmTask(pendingTask.id)}
										>
											Mark done anyway
										</Button>
										<Button
											type="button"
											className="h-12 shrink-0 gap-2.5 rounded-2xl pr-3 pl-5"
											disabled={loading}
											onClick={() => askAboutFailure(pendingTask.id)}
										>
											Ask the tutor
											<kbd className="grid h-6 w-6 place-items-center rounded-lg bg-primary-foreground/15 text-xs">
												↓
											</kbd>
										</Button>
									</>
								) : pendingTask ? (
									// A task card asks for the learner's hands, so the bar
									// asks how it went instead of offering Continue. Both
									// answers move the lesson on; only one of them claims the
									// step worked, and neither is the app checking anything.
									<>
										<Button
											type="button"
											variant="outline"
											className="h-12 shrink-0 gap-2 rounded-2xl px-5"
											disabled={loading}
											onClick={() =>
												setComposer({
													kind: "trouble",
													itemId: pendingTask.id,
												})
											}
										>
											<HugeiconsIcon icon={Alert02Icon} className="size-4.5" />
											Something went wrong
										</Button>
										<Button
											type="button"
											className="h-12 shrink-0 gap-2.5 rounded-2xl pr-3 pl-5"
											disabled={loading}
											onClick={() => confirmTask(pendingTask.id)}
										>
											I did it
											<kbd className="grid h-6 w-6 place-items-center rounded-lg bg-primary-foreground/15 text-xs">
												↓
											</kbd>
										</Button>
									</>
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
							</div>
						)}
					</div>
				)}
			</main>
		</Tabs>
	);
}

// The app saying one thing in the feed. Deliberately not a card and not a
// panel: it is a line of chrome in the reading column, so it reads as the app
// speaking rather than as another thing to study. Clickable when what it is
// about is somewhere to go.
function FeedNote({
	notification,
	onOpen,
}: {
	notification: FeedNotification;
	onOpen?: () => void;
}) {
	const content = (
		<>
			<HugeiconsIcon
				icon={PlusSignCircleIcon}
				className="size-3.5 shrink-0 text-marker"
			/>
			<span className="min-w-0 truncate">{notification.text}</span>
			{onOpen && (
				<HugeiconsIcon
					icon={ArrowRight01Icon}
					className="size-3.5 shrink-0 opacity-60"
				/>
			)}
		</>
	);
	if (!onOpen) {
		return <p className="feed-note">{content}</p>;
	}
	return (
		<button
			type="button"
			className="feed-note feed-note--action"
			onClick={onOpen}
		>
			{content}
		</button>
	);
}

// The card in the making: the same frame the finished card lands in, filled
// with whatever exists yet. The label says what the tutor is doing — thinking,
// writing, or, when it teaches from a project, which file it is reading.
function PendingCard({
	label,
	title,
	body,
}: {
	label: string;
	title?: string;
	body?: string;
}) {
	const empty = !title && !body;
	return (
		<UICard className="animate-in fade-in-0 duration-300">
			<CardHeader>
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<PulseDot />
					<span className={cn("min-w-0 truncate", empty && "shimmer")}>
						{label}
					</span>
				</div>
				{title ? (
					<CardTitle className="text-[1.45rem] leading-[1.25] font-semibold tracking-[-0.02em]">
						{title}
					</CardTitle>
				) : (
					<Skeleton className="mt-1 h-7 w-2/5 rounded-lg" />
				)}
			</CardHeader>
			{body ? (
				<CardContent className="reading prose prose-lg max-w-none dark:prose-invert">
					{/* The preview is transient and has no card to jump to yet, so a
					    reference reads as the plain name here — and a marker still
					    half-streamed is dropped rather than shown as syntax. */}
					<Markdown>{stripCardRefs(body)}</Markdown>
					<span className="ml-0.5 inline-block h-5 w-[3px] translate-y-0.5 animate-pulse rounded-full bg-marker align-baseline" />
				</CardContent>
			) : (
				<CardContent className="space-y-2.5">
					<Skeleton className="h-4 w-full rounded-md" />
					<Skeleton className="h-4 w-11/12 rounded-md" />
					<Skeleton className="h-4 w-3/5 rounded-md" />
				</CardContent>
			)}
		</UICard>
	);
}

// "Actually, start me one step back." Sits under the level options as a fourth
// answer to the same question, so it is built like one — but dashed and
// marker-accented, because it does something different from the three above it:
// it replaces this lesson rather than starting it.
//
// The tutor supplies two facts, the subject and why this one rests on it; the
// button and the promise to come back are the app's words, so the offer says
// the same thing in every lesson and cannot promise something the app does not
// then do.
function PrerequisiteOffer({
	prerequisite,
	goalTopic,
	disabled,
	onStart,
}: {
	prerequisite: Prerequisite;
	// What the learner asked for, and will be brought back to
	goalTopic: string;
	disabled: boolean;
	onStart: (prerequisite: Prerequisite) => void;
}) {
	return (
		<>
			<div className="flex items-center gap-3 pb-3">
				<span className="h-px flex-1 bg-border" />
				<span className="text-xs text-muted-foreground">or</span>
				<span className="h-px flex-1 bg-border" />
			</div>
			<Button
				type="button"
				variant="outline"
				className="h-auto w-full justify-start gap-3.5 rounded-2xl border-dashed p-3.5 text-left whitespace-normal hover:border-marker/45"
				disabled={disabled}
				onClick={() => onStart(prerequisite)}
			>
				<span className="grid size-9 shrink-0 place-items-center rounded-xl bg-marker/12 text-marker">
					<HugeiconsIcon icon={Stairs01Icon} className="size-4.5" />
				</span>
				<span className="flex flex-col gap-0.5">
					<span className="text-[0.95rem] font-semibold">
						Start with {prerequisite.topic}
					</span>
					<span className="text-sm font-normal text-muted-foreground">
						{prerequisite.reason} We'll come back to {goalTopic} after.
					</span>
				</span>
			</Button>
		</>
	);
}

// The one line worth keeping from the card above it. Smaller than a card — no
// title, a line or two of text — and louder: the marker tint is the same accent
// the reading position and the practice blank use, so it reads as a moment
// inside the lesson rather than as a second card competing with the first.
//
// It is a reading section of its own, and the last one of its card, so stepping
// through with the arrow keys ends here and the next ArrowDown is Continue. The
// panel itself carries [data-segment] rather than the paragraph inside it: the
// whole panel then dims with the rest of the card while another section is
// being read, and its position bar lands in the same gutter column as the
// body's — which is what the inset in `.takeaway` is measured against.
function TakeawayNote({ text }: { text: string }) {
	return (
		<div className="takeaway" data-segment>
			<p className="takeaway__label">
				<HugeiconsIcon icon={Idea01Icon} className="size-3.5 shrink-0" />
				Key takeaway
			</p>
			{/* One sentence, at most a name in backticks (see prompts/tutor.md), and
			    nothing to link back to — a reference here reads as plain words. */}
			<div className="takeaway__text" data-explainable data-section-text>
				<Markdown>{stripCardRefs(text)}</Markdown>
			</div>
		</div>
	);
}

// What the composer used to be. The keys are the whole interface to a lesson
// now, and none of them announce themselves, so the bar that had a text box in
// it says what they do instead — quietly, and in the same place every time.
function ReadingKeys() {
	return (
		<p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
			<KeyHint keys={["↑", "↓"]} label="read" />
			<KeyHint keys={["→"]} label="ask about a section" />
			<KeyHint keys={["←"]} label="pin a note" />
		</p>
	);
}

function KeyHint({ keys, label }: { keys: string[]; label: string }) {
	return (
		<span className="flex items-center gap-1.5">
			<span className="flex gap-0.5">
				{keys.map((key) => (
					<kbd
						key={key}
						className="grid size-5 place-items-center rounded-md bg-foreground/7 text-[0.7rem]"
					>
						{key}
					</kbd>
				))}
			</span>
			{label}
		</span>
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
