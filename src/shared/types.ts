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
}

export type TurnResult =
	| { ok: true; card: Card; outline?: OutlineItem[] }
	| { ok: false; error: string };

export type MermaidFixResult =
	| { ok: true; code: string }
	| { ok: false; error: string };

export type TutoRPC = {
	bun: RPCSchema<{
		requests: {
			startLesson: {
				params: { topic: string };
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
		};
		messages: {
			logToBun: { msg: string };
		};
	}>;
	webview: RPCSchema<{
		requests: Record<string, never>;
		messages: Record<string, never>;
	}>;
};
