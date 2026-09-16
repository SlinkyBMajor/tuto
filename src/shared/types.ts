import type { RPCSchema } from "electrobun/view";

export type CardType = "step" | "question" | "recap";

// The optional things a card may carry, each rendered as its own panel under
// the body — or, for "diagram", as part of it. Which ones a lesson may use is a
// property of its mode (LessonModeSpec.cardFeatures); the registry, and the
// rule for what belongs in it, is src/bun/card-features.ts.
export type CardFeatureId =
	| "requirements"
	| "diagram"
	| "hierarchy"
	| "takeaway"
	| "caution"
	| "cost";

// Where a lesson's material comes from. Each mode owns a prompt section, a CLI
// runtime, and an opening message — see src/bun/lesson-modes.ts.
export type LessonModeId = "topic" | "codebase" | "lab";

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
	  }
	| {
			// A hands-on lesson: the learner installs the thing, runs it, and uses
			// it on this machine, one explained step at a time. No language
			// preference — the commands are the tool's own language.
			mode: "lab";
			topic: string;
			// The folder this lesson's own files live in, when it has any. The one
			// part of a config that is not fixed at the start: a lesson only knows
			// it needs a folder when its plan card asks for one, and it is set at
			// most once, there. Many labs never have one — the work is in a
			// browser or a cloud console. See docs/system/lab-mode.md.
			labDir?: string;
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

// The doing on a lab card: the one thing the learner performs before the lesson
// goes on. The app never runs it — see docs/adr/0001-the-learner-executes-the-app-only-verifies.md.
// A read-only check the app may run to see whether a step worked. An argv
// array and never a shell string, validated against an allowlist in
// src/bun/verify.ts before it is ever offered — a check that fails validation
// is dropped at parse time and the card falls back to manual confirmation.
export interface CardVerify {
	argv: string[];
	// What the output should show, in the tutor's words. The judge is handed
	// this and the real output, and decides whether they agree.
	expect: string;
}

export interface CardTask {
	// "run" is a terminal command, "ui" a click through a browser or app, "edit"
	// a file the learner writes. What changes is where the learner does it, so
	// the app labels the step rather than making three kinds of card.
	kind: "run" | "ui" | "edit";
	// The exact text to type or paste, shown as a copyable block. A "run" task
	// always has one; a "ui" task usually has none.
	command?: string;
	// What success looks like, in something the learner can observe
	expect?: string;
	// Optional: a command the APP may run to check, once the learner clicks
	// Check. Absent on most tasks, and absent on every task whose proposed
	// command the allowlist refused.
	verify?: CardVerify;
}

// Where a task card has got to. "done" is the learner's own word for it;
// "verified" and "failed" come from a check the app ran (P3).
export type TaskStatus = "open" | "done" | "verified" | "failed";

// What a lab lesson needs before it can start: a tool to install, an account to
// hold, disk, time, a folder to work in. Kinds are fixed so the app can pick an
// icon and pre-check what the machine already has.
export type RequirementKind =
	| "install"
	| "account"
	| "payment"
	| "disk"
	| "time"
	| "workspace";

export interface Requirement {
	name: string;
	kind: RequirementKind;
	// One line on what it is or why the lesson needs it
	detail?: string;
	// What it costs, in the tutor's own words — "free", "free tier", "~$0.10/hour".
	// Shown as a badge, so the learner reads the money before the setup.
	cost?: string;
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
	// Lab lessons: the step the learner performs on their own machine. The body
	// still teaches — this is what they do once they have read it.
	task?: CardTask;
	// A judgement call the tutor made about this machine: a step that could
	// touch the wrong environment, so check first. Rendered as its own panel,
	// never buried in the prose.
	caution?: string;
	// Money. On any step that can bill, and on the plan card when the lesson
	// needs an account or a card. Its own panel for the same reason: a learner
	// who skims must not be able to skim past the cost.
	cost?: string;
	// Lab lessons, on the plan card: everything the learner needs before the
	// setup begins, disclosed while backing out is still free.
	requirements?: Requirement[];
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
			// Present only on the turn where a lab lesson's plan asked for a
			// folder and the app made one, so the feed can say so
			labDir?: string;
	  }
	| { ok: false; error: string };

// Something the APP says in the feed, in its own voice rather than the
// tutor's: one line, about the lesson's own state. Distinct from the machine
// notice, which is a structured panel about this machine and is re-derived on
// every resume — a notification records something that happened once, so it is
// saved with the lesson and read back in place.
export interface FeedNotification {
	text: string;
	// Where the thing it is about lives, when it is somewhere to go
	action?: "practice";
}

// Serializable mirror of the webview's feed (errors are not persisted)
export interface SavedFeedItem {
	kind: "card" | "user" | "notification";
	card?: Card;
	text?: string;
	selectedOption?: string;
	// Notification items only
	notification?: FeedNotification;
	// This card answered a follow-up question asked after the recap, rather
	// than continuing the outline
	followUp?: boolean;
	// How far the learner got with this card's task. Persisted so the ticks
	// survive a resume — a lab lesson is a sequence of things already done, and
	// coming back to it with every step open again would lose the lesson.
	taskStatus?: TaskStatus;
	// The last check this card ran: what the app ran, what it printed, and the
	// judge's line about it. Kept so a resumed lesson still shows why a step is
	// marked failed, which is the thing worth coming back to.
	check?: { command: string; output: string; note: string };
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
	// Lab lessons: whether the learner allowed the app to run this lesson's
	// read-only checks. Undefined means they have not been asked yet.
	checksAllowed?: boolean;
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
	// Lab lessons: what this machine looked like while the lesson was open. Read
	// on resume to say what has changed since. Shape is bun-owned (MachineProbe
	// in src/bun/env-probe.ts); the webview never looks inside it.
	probe?: unknown;
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

// What came back from running a task's check: what was run, what it printed,
// and the judge's verdict on whether that is what the card promised.
export type VerifyResult =
	| {
			ok: true;
			pass: boolean;
			// One line for the learner: why it passed, or what the output says
			// went wrong. Never a lecture — the diagnosis card is the lecture.
			note: string;
			command: string;
			output: string;
	  }
	| { ok: false; error: string };

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
			// What the app itself found on this Mac, for the notice a lab lesson
			// opens with. Only the warnings: whether this machine points at a
			// real cluster or a logged-in cloud account is what the learner has
			// to see before a lesson starts creating things. On a resumed lesson
			// `drift` says what has moved since it was last open.
			probeMachine: {
				params: Record<string, never>;
				response: { warnings: string[]; drift: string[] };
			};
			// The machine settings the webview owns but the Bun process acts on:
			// pushed on startup and whenever they change. `model` and `effort`
			// go on the CLI command line of every lesson turn, and the Bun side
			// checks both against its own lists before spawning anything — the
			// webview is not the authority on what this app may run. The
			// context7 key is blank by default (the endpoint is keyless; a key
			// only raises rate limits). None of them is written into a lesson
			// record, so a lesson resumed after a change runs at the new one.
			setSettings: {
				params: {
					model: string;
					effort: string;
					context7Key: string;
					labRoot: string;
				};
				response: { ok: boolean };
			};
			// Run one task card's check and have it judged. The command is
			// re-validated here before it is spawned: the webview is not the
			// authority on what this app may run.
			runVerify: {
				params: { verify: CardVerify; taskExpect?: string };
				response: VerifyResult;
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
