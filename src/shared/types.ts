import type { RPCSchema } from "electrobun/view";

export type CardType = "step" | "question" | "recap";

// Fixed ids so the UI can map icons deterministically; labels stay model-authored
export type LevelId = "beginner" | "intermediate" | "advanced";

export interface CardOption {
	id: string;
	label: string;
	description?: string;
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
	options?: CardOption[];
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
}

export interface SavedPracticeItem {
	exercise: Exercise;
	status: "open" | "correct" | "wrong";
	userAnswer?: string;
	explanation?: string;
}

// What the webview sends to persist a lesson's display state
export interface LessonSnapshot {
	id: string;
	topic: string;
	outline: OutlineItem[] | null;
	currentConceptId: string | null;
	feed: SavedFeedItem[];
	practice: SavedPracticeItem[];
}

// The saved lesson on disk: snapshot plus bun-owned metadata
export interface LessonRecord extends LessonSnapshot {
	sessionId?: string;
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
}

export type CheckResult =
	| { ok: true; correct: boolean; explanation: string }
	| { ok: false; error: string };

export type ExplainResult =
	| { ok: true; explanation: string }
	| { ok: false; error: string };

export type MermaidFixResult =
	| { ok: true; code: string }
	| { ok: false; error: string };

export type TutoRPC = {
	bun: RPCSchema<{
		requests: {
			startLesson: {
				params: { topic: string; language?: string };
				response: TurnResult;
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
			explainTerm: {
				params: { term: string; context: string };
				response: ExplainResult;
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
			// Live preview of the card being generated, pushed as it streams
			streamCard: { title: string; body: string };
		};
	}>;
};
