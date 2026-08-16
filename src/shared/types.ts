import type { RPCSchema } from "electrobun/view";

export type CardType = "step" | "question" | "recap";

// Where a lesson's material comes from. Each mode owns a prompt section, a CLI
// runtime, and an opening message — see src/bun/lesson-modes.ts.
export type LessonModeId = "topic" | "codebase";

// A project directory the tutor teaches from. The folder's basename is carried
// alongside the path so the UI can label a lesson without touching the disk.
export interface ProjectRef {
	path: string;
	name: string;
}

// Where a lesson is headed once it is done: the subject the learner actually
// asked for, put off while they take the ground it rests on first. Carried on
// the stepping-stone lesson's config, so the way back survives a resume and the
// app can offer it without the tutor having to remember anything.
export interface LessonGoal {
	topic: string;
	// Set when the lesson being returned to reads a project. The detour itself
	// is always taught from general knowledge, so it has no project of its own.
	project?: ProjectRef;
}

// Everything the tutor needs to run a lesson, fixed when the lesson starts and
// unchanged for its lifetime. A union rather than optional fields, so a mode's
// requirements are part of the type: a codebase lesson cannot exist without a
// project, and adding a mode means adding a variant.
export type LessonConfig =
	| {
			mode: "topic";
			topic: string;
			language?: string;
			// Groundwork is general knowledge by definition, so only a topic
			// lesson is ever a stepping stone — though the goal it leads back to
			// may well be a codebase lesson, which is why LessonGoal has a project.
			goal?: LessonGoal;
	  }
	| {
			mode: "codebase";
			topic: string;
			language?: string;
			project: ProjectRef;
	  };

// A cancelled folder dialog is `{ project: null }` with no error — the UI
// leaves the field as it was instead of reporting a failure.
export type PickProjectResult = { project: ProjectRef | null; error?: string };

// Fixed ids so the UI can map icons deterministically; labels stay model-authored
export type LevelId = "beginner" | "intermediate" | "advanced";

export interface CardOption {
	id: string;
	label: string;
	description?: string;
}

// One rung of a structure the lesson is teaching: a named thing, how far inside
// the structure it sits, and a line on what it is.
export interface HierarchyLevel {
	name: string;
	// 0 is the outermost thing, and each step in is one deeper. Rungs at the
	// same depth are siblings, which is what lets this describe a tree and not
	// only a chain.
	depth: number;
	note?: string;
}

// "The hierarchy so far" — where everything the lesson has named sits inside
// everything else. Sent whole each time it grows, never as a diff, for the same
// reason the outline is: the app holds no memory of the last one.
export interface Hierarchy {
	levels: HierarchyLevel[];
	// The rung this card just taught, by name, so the picture can say where the
	// learner has got to
	current?: string;
}

// An offer, made on the level question, to teach the ground this subject rests
// on before teaching the subject itself. The app composes the button and the
// promise to come back, so the tutor writes two facts rather than UI copy.
export interface Prerequisite {
	// The detour: a lesson someone could have asked for on its own
	topic: string;
	// One sentence on what this subject rests on it for
	reason: string;
}

// The tutor's plan for the lesson; ids are stable across revisions so
// progress, exercises, and notes can key off them
export interface OutlineItem {
	id: string;
	title: string;
}

export interface Card {
	type: CardType;
	title: string;
	body: string;
	// Which outline concept a step card belongs to
	conceptId?: string;
	// The one line worth keeping from this card, shown as a small accented
	// panel under it and filed into the notes. Most cards have none — see the
	// bar in prompts/tutor.md, and docs/system/takeaways.md.
	takeaway?: string;
	// Where the concepts named so far sit inside one another, redrawn on the
	// card that adds a rung — see docs/system/hierarchy.md.
	hierarchy?: Hierarchy;
	options?: CardOption[];
	// Question cards only: an offer to start one step further back. Taking it
	// replaces this lesson with one on the ground it rests on — see
	// docs/system/prerequisites.md.
	prerequisite?: Prerequisite;
	// Recap cards: follow-on topics that can seed a new lesson
	suggestions?: string[];
	// Where this card's body files into the notes document (content is
	// written once — the card body IS the notes content)
	notes?: { sectionPath: string[] };
}

// A fill-in-the-blank exercise; source contains exactly one ____ blank
export interface Exercise {
	conceptId?: string;
	question: string;
	code: { language: string; source: string };
	answer: string;
}

export type TurnResult =
	| {
			ok: true;
			card: Card;
			outline?: OutlineItem[];
			exercise?: Exercise;
			// Present only on the first turn of a new lesson — the id under
			// which the lesson is saved; the webview echoes it back to persist.
			lessonId?: string;
	  }
	| { ok: false; error: string };

// Serializable mirror of the webview's feed (errors are not persisted)
export interface SavedFeedItem {
	kind: "card" | "user";
	card?: Card;
	text?: string;
	selectedOption?: string;
	// This card answered a follow-up question asked after the recap, rather
	// than continuing the outline
	followUp?: boolean;
}

export interface SavedPracticeItem {
	exercise: Exercise;
	status: "open" | "correct" | "wrong";
	userAnswer?: string;
	explanation?: string;
}

// A note the learner pinned beside one section of one card.
//
// Anchored by POSITION, not by id: the webview's feed item ids are per-session
// counters handed out on load, so they mean nothing on disk. `cardIndex` is the
// card's index among the feed's cards — cards are only ever appended, so it is
// stable — and `segmentIndex` is the section's index within that card, in the
// same DOM order keyboard reading walks.
export interface SavedSticky {
	id: string;
	cardIndex: number;
	segmentIndex: number;
	text: string;
	// One of the sticky palette's names; an unknown one falls back on load
	color: string;
}

// One turn of a side conversation about a section. "tutor" rather than
// "assistant": these are answers in the lesson's voice, not chat messages.
export interface ThreadMessage {
	role: "user" | "tutor";
	text: string;
}

// A conversation hanging off one section of one card — the learner asked
// something about that passage and kept talking about it. Anchored by POSITION
// for the same reason a sticky note is: feed item ids are per-session counters
// that mean nothing on disk.
export interface SavedThread {
	id: string;
	cardIndex: number;
	segmentIndex: number;
	messages: ThreadMessage[];
}

// What the webview sends to persist a lesson's display state
export interface LessonSnapshot {
	id: string;
	topic: string;
	outline: OutlineItem[] | null;
	currentConceptId: string | null;
	feed: SavedFeedItem[];
	practice: SavedPracticeItem[];
	// Absent on lessons saved before sticky notes existed
	stickies?: SavedSticky[];
	// Absent on lessons saved before question threads existed
	threads?: SavedThread[];
}

// The saved lesson on disk: snapshot plus bun-owned metadata
export interface LessonRecord extends LessonSnapshot {
	sessionId?: string;
	// How this lesson was started. Absent on lessons saved before lesson modes
	// existed; store.configOf reads those as topic lessons.
	config?: LessonConfig;
	// Legacy: the code language of a pre-modes lesson. Read on resume, never
	// written — new records carry it inside `config`.
	language?: string;
	createdAt: string;
	updatedAt: string;
}

// Compact entry for the home-screen lesson list
export interface LessonSummary {
	id: string;
	topic: string;
	updatedAt: string;
	conceptCount: number;
	currentIndex: number;
	ended: boolean;
	mode: LessonModeId;
	// Codebase lessons only: the project folder's name, for the list row
	project?: string;
}

export type CheckResult =
	| { ok: true; correct: boolean; explanation: string }
	| { ok: false; error: string };

export type ExerciseResult =
	| { ok: true; exercise: Exercise }
	| { ok: false; error: string };

export type ExplainResult =
	| { ok: true; explanation: string }
	| { ok: false; error: string };

export type AskResult =
	| { ok: true; answer: string }
	| { ok: false; error: string };

export type MermaidFixResult =
	| { ok: true; code: string }
	| { ok: false; error: string };

export type TutoRPC = {
	bun: RPCSchema<{
		requests: {
			startLesson: {
				params: { config: LessonConfig };
				response: TurnResult;
			};
			// Opens the OS folder dialog and validates what comes back
			pickProject: {
				params: Record<string, never>;
				response: PickProjectResult;
			};
			sendMessage: {
				params: { text: string };
				response: TurnResult;
			};
			continueLesson: {
				params: Record<string, never>;
				response: TurnResult;
			};
			fixMermaid: {
				params: { code: string; error: string };
				response: MermaidFixResult;
			};
			checkAnswer: {
				params: { exercise: Exercise; userAnswer: string | null };
				response: CheckResult;
			};
			// Replace an exercise the learner rejected. `material` is the lesson
			// text the new one must be answerable from — the webview owns the
			// cards, so it sends them rather than the bun process guessing.
			regenerateExercise: {
				params: { exercise: Exercise; material: string; concept?: string };
				response: ExerciseResult;
			};
			explainTerm: {
				params: { term: string; context: string };
				response: ExplainResult;
			};
			// A question about one section of one card, answered beside it rather
			// than in the lesson. Runs as a stateless side-call, so everything it
			// knows arrives here: the webview holds the cards and the thread, so
			// it sends them — the same split exercise regeneration uses.
			askAboutSection: {
				params: {
					topic: string;
					// The card the section sits in, and the section itself
					cardTitle: string;
					section: string;
					// Every card the learner has read, flattened
					material: string;
					// Earlier turns of this thread, oldest first
					history: ThreadMessage[];
					question: string;
				};
				response: AskResult;
			};
			getNotes: {
				params: Record<string, never>;
				response: { markdown: string };
			};
			saveLesson: {
				params: { snapshot: LessonSnapshot };
				response: { ok: boolean };
			};
			listLessons: {
				params: Record<string, never>;
				response: { lessons: LessonSummary[] };
			};
			resumeLesson: {
				params: { id: string };
				response:
					| { ok: true; record: LessonRecord }
					| { ok: false; error: string };
			};
			deleteLesson: {
				params: { id: string };
				response: { ok: boolean };
			};
		};
		messages: {
			logToBun: { msg: string };
		};
	}>;
	webview: RPCSchema<{
		requests: Record<string, never>;
		messages: {
			// Live preview of the card being generated, pushed as it streams.
			// `activity` describes what the tutor is doing between text — a file
			// it is reading, a search it is running — and is empty when it is
			// writing the card itself.
			streamCard: { title: string; body: string; activity?: string };
		};
	}>;
};
