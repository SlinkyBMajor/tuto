import {
	ArrowLeft01Icon,
	ArrowRight01Icon,
	CompassIcon,
	Plant01Icon,
	RocketIcon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { CardMarkdown } from "@/components/card-markdown";
import { ExplainSelection } from "@/components/explain";
import { LessonLibrary } from "@/components/home";
import { NotesPanel } from "@/components/notes";
import { type PracticeItem, PracticePanel } from "@/components/practice";
import { loadSettings, SettingsButton } from "@/components/settings";
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

interface FeedItem {
	id: number;
	kind: "card" | "user" | "error";
	card?: Card;
	text?: string;
	selectedOption?: string;
}

let nextId = 0;

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
	const [topic, setTopic] = useState("");
	// Bumped when returning home so the lesson library re-fetches
	const [homeRefresh, setHomeRefresh] = useState(0);
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
	// Keyboard reading position: which segment of which card is highlighted
	const [highlight, setHighlight] = useState<{
		itemId: number;
		index: number;
	} | null>(null);
	const bottomRef = useRef<HTMLDivElement>(null);
	// True while the newest card was requested via keyboard reading — its
	// first section gets highlighted and positions the view instead of the
	// default scroll-to-bottom
	const keyboardFlowRef = useRef(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: items/loading/streaming are intentional triggers — scroll to bottom as the feed grows, the skeleton appears, or the streaming preview extends
	useEffect(() => {
		if (keyboardFlowRef.current) return;
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [items, loading, streaming]);

	// Opening the Lesson tab lands on the latest card (the panel may have been
	// unmounted while another tab was active, so wait a frame for it to render).
	// Scroll the window fully down so the last card clears the fixed input bar.
	useEffect(() => {
		if (tab !== "lesson") return;
		const frame = requestAnimationFrame(() => {
			window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
		});
		return () => cancelAnimationFrame(frame);
	}, [tab]);

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
			setHighlight({ itemId: id, index: 0 });
		} else {
			keyboardFlowRef.current = false;
			setHighlight(null);
		}
	}

	async function runTurn(
		request: Promise<TurnResult>,
		options: { highlightNew?: boolean } = {},
	) {
		setLoading(true);
		turnActiveRef.current = true;
		setStreaming(null);
		try {
			const result = await request;
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
				append({ kind: "error", text: result.error });
			}
		} catch (error) {
			append({
				kind: "error",
				text: error instanceof Error ? error.message : String(error),
			});
		} finally {
			turnActiveRef.current = false;
			setStreaming(null);
			setLoading(false);
		}
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
		void runTurn(
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
		void runTurn(bun.sendMessage({ text }));
	}

	function continueLesson(options: { highlightNew?: boolean } = {}) {
		if (loading) return;
		void runTurn(bun.continueLesson({}), options);
	}

	function chooseOption(itemId: number, option: CardOption) {
		if (loading) return;
		setItems((prev) =>
			prev.map((item) =>
				item.id === itemId ? { ...item, selectedOption: option.id } : item,
			),
		);
		void runTurn(bun.sendMessage({ text: option.label }));
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
			segment.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	}, [highlight]);

	// ArrowDown steps through the latest card section by section; past the
	// last one it acts as Continue. ArrowUp steps back.
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (tab !== "lesson") return;
			if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
			const target = event.target as HTMLElement | null;
			if (
				target?.closest("textarea, select, [contenteditable=true]") ||
				(target instanceof HTMLInputElement && target.value !== "")
			) {
				return;
			}
			const lastCard = items.findLast((item) => item.kind === "card");
			if (!lastCard) return;
			event.preventDefault();

			const cardEl = document.querySelector(`[data-item-id="${lastCard.id}"]`);
			const count = cardEl?.querySelectorAll("[data-segment]").length ?? 0;
			if (count === 0) return;

			if (event.key === "ArrowUp") {
				if (highlight?.itemId === lastCard.id && highlight.index > 0) {
					setHighlight({ itemId: lastCard.id, index: highlight.index - 1 });
				} else {
					setHighlight(null);
				}
				return;
			}

			if (highlight?.itemId !== lastCard.id) {
				setHighlight({ itemId: lastCard.id, index: 0 });
			} else if (highlight.index + 1 < count) {
				setHighlight({ itemId: lastCard.id, index: highlight.index + 1 });
			} else if (
				!loading &&
				lastCard.card?.type !== "recap" &&
				!(lastCard.card?.type === "question" && !lastCard.selectedOption)
			) {
				// Past the last section: advance the lesson (unanswered question
				// cards want an answer, not a continue). The highlight stays on
				// the current section while the next card loads, then moves to
				// the new card's first section.
				continueLesson({ highlightNew: true });
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	});

	if (!started) {
		return (
			<main className="flex min-h-screen flex-col items-center justify-center gap-10 p-8">
				<SettingsButton floating />
				<div className="text-center">
					<h1 className="font-heading text-5xl font-bold">Tuto</h1>
					<p className="mt-3 text-xl text-muted-foreground">
						What would you like to learn?
					</p>
				</div>
				<form
					className="flex w-full max-w-xl gap-3"
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
						className="h-14 rounded-2xl px-5 text-lg"
					/>
					<Button
						type="submit"
						size="lg"
						className="h-14 rounded-2xl px-8 text-lg"
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

	return (
		<main className="mx-auto flex min-h-screen w-full max-w-[50rem] flex-col p-6">
			<ExplainSelection topic={topic} />
			<Tabs
				value={tab}
				onValueChange={(value) => setTab(String(value))}
				className="flex-1"
			>
				<div className="sticky top-0 z-10 -mx-6 mb-2 border-b bg-background/95 px-6 py-2 backdrop-blur">
					<div className="mx-auto flex w-full max-w-[50rem] items-center gap-3">
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-9 shrink-0 rounded-xl"
							aria-label="Back to lessons"
							onClick={goHome}
						>
							<HugeiconsIcon icon={ArrowLeft01Icon} className="size-5" />
						</Button>
						{outline ? (
							<>
								<div className="flex shrink-0 items-center gap-1.5">
									{outline.map((item, index) => (
										<span
											key={item.id}
											title={item.title}
											className={cn(
												"size-2.5 rounded-full transition-colors",
												index < currentIndex && "bg-primary/40",
												index === currentIndex && "bg-primary",
												index > currentIndex &&
													"border border-muted-foreground/40",
											)}
										/>
									))}
								</div>
								<span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
									{currentIndex >= 0
										? `${outline[currentIndex]?.title} — ${currentIndex + 1} of ${outline.length}`
										: `${outline.length} concepts`}
								</span>
							</>
						) : (
							<div className="flex-1" />
						)}
						<TabsList>
							<TabsTrigger value="lesson">Lesson</TabsTrigger>
							<TabsTrigger value="practice">
								Practice
								{openExercises > 0 && (
									<span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] leading-none text-primary-foreground">
										{openExercises}
									</span>
								)}
							</TabsTrigger>
							<TabsTrigger value="notes">Notes</TabsTrigger>
						</TabsList>
						<SettingsButton />
					</div>
				</div>
				<TabsContent value="practice" className="text-base">
					<PracticePanel items={practice} onUpdate={updatePractice} />
				</TabsContent>
				<TabsContent value="notes" className="text-base">
					<NotesPanel demoMarkdown={demoMode ? DEMO_NOTES : undefined} />
				</TabsContent>
				<TabsContent value="lesson" className="text-base">
					<div className="flex-1 space-y-5 pb-40">
						{items.map((item) => {
							if (item.kind === "user") {
								return (
									<p
										key={item.id}
										className="ml-auto w-fit max-w-md rounded-2xl bg-secondary px-4 py-2 text-secondary-foreground"
									>
										{item.text}
									</p>
								);
							}
							if (item.kind === "error") {
								return (
									<UICard key={item.id} className="border-destructive">
										<CardHeader>
											<CardTitle className="text-destructive">
												Something went wrong
											</CardTitle>
										</CardHeader>
										<CardContent className="text-sm text-muted-foreground">
											{item.text}
										</CardContent>
									</UICard>
								);
							}
							const options = item.card?.options;
							const suggestions = item.card?.suggestions;
							return (
								<UICard
									key={item.id}
									data-item-id={item.id}
									className={cn(
										"rounded-3xl shadow-sm",
										item.card?.type === "recap" && "border-primary/40",
									)}
								>
									<CardHeader>
										<CardTitle className="text-2xl">
											{item.card?.title}
										</CardTitle>
									</CardHeader>
									<CardContent
										data-explainable
										className="prose prose-lg max-w-none dark:prose-invert"
									>
										<CardMarkdown body={item.card?.body ?? ""} />
									</CardContent>
									{suggestions && suggestions.length > 0 && (
										<CardContent className="flex flex-col gap-3">
											<p className="text-sm text-muted-foreground">
												Keep learning:
											</p>
											{suggestions.map((topic) => (
												<Button
													key={topic}
													type="button"
													variant="outline"
													className="h-auto justify-start gap-4 whitespace-normal rounded-2xl p-4 text-left"
													disabled={loading}
													onClick={() => startLesson(topic)}
												>
													<HugeiconsIcon
														icon={ArrowRight01Icon}
														className="size-5 shrink-0"
													/>
													<span className="text-base font-semibold">
														{topic}
													</span>
												</Button>
											))}
										</CardContent>
									)}
									{options && (
										<CardContent className="flex flex-col gap-3">
											{options.map((option) => {
												const selected = item.selectedOption === option.id;
												const answered = item.selectedOption !== undefined;
												return (
													<Button
														key={option.id}
														type="button"
														variant={selected ? "default" : "outline"}
														className="h-auto justify-start gap-4 whitespace-normal rounded-2xl p-4 text-left"
														disabled={loading || (answered && !selected)}
														onClick={() => {
															if (!answered) chooseOption(item.id, option);
														}}
													>
														<HugeiconsIcon
															icon={
																selected
																	? Tick02Icon
																	: (OPTION_ICONS[option.id] ?? CompassIcon)
															}
															className="size-6 shrink-0"
														/>
														<span className="flex flex-col gap-0.5">
															<span className="text-base font-semibold">
																{option.label}
															</span>
															{option.description && (
																<span
																	className={
																		selected
																			? "text-sm text-primary-foreground/80"
																			: "text-sm text-muted-foreground"
																	}
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
							<UICard className="rounded-3xl shadow-sm">
								{streaming.title && (
									<CardHeader>
										<CardTitle className="text-2xl">
											{streaming.title}
										</CardTitle>
									</CardHeader>
								)}
								<CardContent className="prose prose-lg max-w-none dark:prose-invert">
									<Markdown>{streaming.body}</Markdown>
									<span className="ml-0.5 inline-block h-5 w-2 translate-y-0.5 animate-pulse bg-primary align-baseline" />
								</CardContent>
							</UICard>
						) : (
							loading && (
								<UICard className="rounded-3xl">
									<CardHeader>
										<Skeleton className="h-7 w-2/5" />
									</CardHeader>
									<CardContent className="space-y-3">
										<Skeleton className="h-5 w-full" />
										<Skeleton className="h-5 w-4/5" />
									</CardContent>
								</UICard>
							)
						)}
						<div ref={bottomRef} />
					</div>

					<div className="fixed inset-x-0 bottom-0 border-t bg-background/95 p-4 backdrop-blur">
						<form
							className="mx-auto flex w-full max-w-[50rem] gap-3"
							onSubmit={(event) => {
								event.preventDefault();
								sendMessage();
							}}
						>
							<Input
								value={input}
								onChange={(event) => setInput(event.target.value)}
								placeholder="Ask a question…"
								className="h-12 rounded-2xl px-4"
								disabled={loading}
							/>
							{input.trim() ? (
								<Button
									type="submit"
									className="h-12 rounded-2xl px-6"
									disabled={loading}
								>
									Send
								</Button>
							) : lessonEnded ? (
								<Button
									type="button"
									className="h-12 rounded-2xl px-6"
									disabled={loading}
									onClick={goHome}
								>
									New lesson
								</Button>
							) : (
								<Button
									type="button"
									className="h-12 rounded-2xl px-6"
									disabled={loading}
									onClick={() => continueLesson()}
								>
									Continue
								</Button>
							)}
						</form>
					</div>
				</TabsContent>
			</Tabs>
		</main>
	);
}
