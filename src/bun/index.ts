import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import type {
	CheckResult,
	ExplainResult,
	MermaidFixResult,
	TurnResult,
	TutoRPC,
} from "../shared/types";
import {
	checkExerciseAnswer,
	composeSystemPrompt,
	explainTerm,
	fixMermaidDiagram,
	runTutorTurn,
	runTutorTurnStreaming,
	type TutorTurn,
} from "./claude";
import { NotesDoc } from "./notes";
import { makeLessonId } from "./paths";
import * as store from "./store";

const DEV_SERVER_URL = "http://localhost:5173";

// HMR is opt-in (pnpm dev sets TUTO_HMR=1): auto-detecting a dev server is a
// trap — the app would bind to a server whose lifecycle it doesn't control,
// and dynamic imports break as soon as that server goes away.
async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev" && process.env.TUTO_HMR === "1") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			return DEV_SERVER_URL;
		} catch {
			console.log("TUTO_HMR set but Vite is not running; using bundled views.");
		}
	}
	return "views://mainview/index.html";
}

// One lesson active at a time. The Claude session carries the conversation;
// lessonId/notes/language are the persistence-facing state for save/resume.
let lessonId: string | undefined;
let lessonSessionId: string | undefined;
let lessonLanguage: string | undefined;
let lessonSystemPrompt = composeSystemPrompt();
const notes = new NotesDoc();

// Push a streaming card preview to the webview. Defined against the typed rpc
// object below; safe to call once the window has wired up its transport.
function sendPreview(preview: { title: string; body: string }) {
	rpc.send.streamCard(preview);
}

// Speculative prefetch: after each step card we immediately ask for the next
// one in a FORKED session. Continue adopts the fork (instant card); any other
// user turn runs against the untouched base session and the fork is discarded.
let prefetch:
	| { baseSessionId: string; promise: Promise<TutorTurn> }
	| undefined;

function startPrefetch() {
	if (!lessonSessionId) return;
	const promise = runTutorTurn("continue", lessonSessionId, {
		fork: true,
		systemPrompt: lessonSystemPrompt,
	});
	// Errors are handled at adoption time; this avoids an unhandled rejection
	promise.catch(() => {});
	prefetch = { baseSessionId: lessonSessionId, promise };
}

function finishTurn(turn: TutorTurn): TurnResult {
	lessonSessionId = turn.sessionId;
	// File the card body into the notes document at adoption time — a
	// discarded prefetch fork must never write notes
	if (turn.card.notes) {
		notes.insert(turn.card.notes.sectionPath, turn.card.body);
	}
	// Only step cards lead to "continue" — after a question card the next
	// input is an answer, and a recap ends the lesson
	if (turn.card.type === "step") {
		startPrefetch();
	}
	return {
		ok: true,
		card: turn.card,
		outline: turn.outline,
		exercise: turn.exercise,
		lessonId,
	};
}

function turnError(error: unknown): TurnResult {
	console.error("tutor turn failed:", error);
	return {
		ok: false,
		error: error instanceof Error ? error.message : String(error),
	};
}

async function tutorTurn(
	message: string,
	options: { newLesson?: boolean; language?: string; topic?: string } = {},
): Promise<TurnResult> {
	if (options.newLesson) {
		const topic = options.topic ?? message;
		lessonSessionId = undefined;
		lessonLanguage = options.language;
		lessonSystemPrompt = composeSystemPrompt(options.language);
		lessonId = makeLessonId(topic);
		notes.startLesson(lessonId, topic);
	}
	// An explicit user turn advances the base session; a pending fork would
	// no longer contain this exchange, so drop it
	prefetch = undefined;
	try {
		// Foreground turns stream a live preview to the webview; prefetch
		// (startPrefetch) stays non-streaming since it runs in the background.
		// Fork whenever we're resuming: as with prefetch, the lesson session is
		// advanced (finishTurn) only once a card is successfully adopted, so a
		// reply we can't use can't skip the next step. The first turn of a
		// lesson has no session to fork.
		return finishTurn(
			await runTutorTurnStreaming(message, lessonSessionId, {
				systemPrompt: lessonSystemPrompt,
				fork: Boolean(lessonSessionId),
				onPreview: sendPreview,
			}),
		);
	} catch (error) {
		return turnError(error);
	}
}

async function continueTurn(): Promise<TurnResult> {
	const pending = prefetch;
	prefetch = undefined;
	if (pending && pending.baseSessionId === lessonSessionId) {
		try {
			return finishTurn(await pending.promise);
		} catch (error) {
			console.error("prefetched turn failed, running a fresh one:", error);
		}
	}
	return tutorTurn("continue");
}

const rpc = BrowserView.defineRPC<TutoRPC>({
	maxRequestTime: 300_000,
	handlers: {
		requests: {
			startLesson: ({ topic, language }) =>
				tutorTurn(`I want to learn about: ${topic}`, {
					newLesson: true,
					language,
					topic,
				}),
			sendMessage: ({ text }) => tutorTurn(text),
			continueLesson: () => continueTurn(),
			getNotes: () => ({ markdown: notes.render() }),
			saveLesson: async ({ snapshot }) => {
				await store.saveLesson(snapshot, {
					sessionId: lessonSessionId,
					language: lessonLanguage,
				});
				return { ok: true };
			},
			listLessons: async () => ({ lessons: await store.listLessons() }),
			resumeLesson: async ({ id }) => {
				const record = await store.loadLesson(id);
				if (!record) return { ok: false, error: "Lesson not found" };
				lessonId = record.id;
				lessonSessionId = record.sessionId;
				lessonLanguage = record.language;
				lessonSystemPrompt = composeSystemPrompt(record.language);
				// A prefetch fork from another lesson must not leak into this one
				prefetch = undefined;
				await notes.resume(record.id, record.topic);
				return { ok: true, record };
			},
			deleteLesson: async ({ id }) => {
				await store.deleteLesson(id);
				if (lessonId === id) {
					lessonId = undefined;
					lessonSessionId = undefined;
				}
				return { ok: true };
			},
			checkAnswer: async ({ exercise, userAnswer }): Promise<CheckResult> => {
				try {
					const graded = await checkExerciseAnswer(exercise, userAnswer);
					return { ok: true, ...graded };
				} catch (checkError) {
					console.error("answer check failed:", checkError);
					return {
						ok: false,
						error:
							checkError instanceof Error
								? checkError.message
								: String(checkError),
					};
				}
			},
			explainTerm: async ({ term, context }): Promise<ExplainResult> => {
				try {
					return { ok: true, explanation: await explainTerm(term, context) };
				} catch (explainError) {
					console.error("explain term failed:", explainError);
					return {
						ok: false,
						error:
							explainError instanceof Error
								? explainError.message
								: String(explainError),
					};
				}
			},
			fixMermaid: async ({ code, error }): Promise<MermaidFixResult> => {
				try {
					return { ok: true, code: await fixMermaidDiagram(code, error) };
				} catch (fixError) {
					console.error("mermaid fix failed:", fixError);
					return {
						ok: false,
						error:
							fixError instanceof Error ? fixError.message : String(fixError),
					};
				}
			},
		},
		messages: {
			logToBun: ({ msg }) => {
				console.log(`[view] ${msg}`);
			},
		},
	},
});

const url = await getMainViewUrl();

new BrowserWindow({
	title: "Tuto",
	url,
	frame: {
		width: 1100,
		height: 800,
		x: 200,
		y: 100,
	},
	rpc,
});
