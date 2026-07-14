import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import type { MermaidFixResult, TurnResult, TutoRPC } from "../shared/types";
import { fixMermaidDiagram, runTutorTurn, type TutorTurn } from "./claude";

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

// One lesson at a time in the walking skeleton; the session id is the lesson.
let lessonSessionId: string | undefined;

// Speculative prefetch: after each step card we immediately ask for the next
// one in a FORKED session. Continue adopts the fork (instant card); any other
// user turn runs against the untouched base session and the fork is discarded.
let prefetch:
	| { baseSessionId: string; promise: Promise<TutorTurn> }
	| undefined;

function startPrefetch() {
	if (!lessonSessionId) return;
	const promise = runTutorTurn("continue", lessonSessionId, { fork: true });
	// Errors are handled at adoption time; this avoids an unhandled rejection
	promise.catch(() => {});
	prefetch = { baseSessionId: lessonSessionId, promise };
}

function finishTurn(turn: TutorTurn): TurnResult {
	lessonSessionId = turn.sessionId;
	// Only step cards lead to "continue" — after a question card the next
	// input is an answer, and a recap ends the lesson
	if (turn.card.type === "step") {
		startPrefetch();
	}
	return { ok: true, card: turn.card, outline: turn.outline };
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
	options: { newLesson?: boolean } = {},
): Promise<TurnResult> {
	if (options.newLesson) {
		lessonSessionId = undefined;
	}
	// An explicit user turn advances the base session; a pending fork would
	// no longer contain this exchange, so drop it
	prefetch = undefined;
	try {
		return finishTurn(await runTutorTurn(message, lessonSessionId));
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
			startLesson: ({ topic }) =>
				tutorTurn(`I want to learn about: ${topic}`, { newLesson: true }),
			sendMessage: ({ text }) => tutorTurn(text),
			continueLesson: () => continueTurn(),
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
