import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import { stripCardRefs } from "../shared/card-refs";
import type {
	AskResult,
	CheckResult,
	ExerciseResult,
	ExplainResult,
	LessonConfig,
	MermaidFixResult,
	TurnResult,
	TutoRPC,
} from "../shared/types";
import {
	checkExerciseAnswer,
	discussSection,
	explainTerm,
	fixMermaidDiagram,
	regenerateExercise,
	runTutorTurn,
	runTutorTurnStreaming,
	type TurnPreview,
	type TutorRuntime,
	type TutorTurn,
} from "./claude";
import { modeOf, openingMessage, runtimeFor } from "./lesson-modes";
import { NotesDoc } from "./notes";
import { makeLessonId } from "./paths";
import { describeProject, pickProject } from "./project";
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

// One lesson open at a time. Its config says what kind of lesson it is and the
// runtime is derived from that once, at the start, so every turn of a lesson
// runs exactly the same way. The Claude session carries the conversation.
interface ActiveLesson {
	id: string;
	config: LessonConfig;
	runtime: TutorRuntime;
	// Absent until the first turn comes back with a session to resume
	sessionId?: string;
}

let active: ActiveLesson | undefined;
const notes = new NotesDoc();

// Push a streaming card preview to the webview. Defined against the typed rpc
// object below; safe to call once the window has wired up its transport.
function sendPreview(preview: TurnPreview) {
	rpc.send.streamCard(preview);
}

// Speculative prefetch: after each step card we immediately ask for the next
// one in a FORKED session. Continue adopts the fork (instant card); any other
// user turn runs against the untouched base session and the fork is discarded.
let prefetch:
	| { baseSessionId: string; promise: Promise<TutorTurn> }
	| undefined;

function startPrefetch(lesson: ActiveLesson) {
	const sessionId = lesson.sessionId;
	if (!sessionId || !modeOf(lesson.config).prefetch) return;
	const promise = runTutorTurn("continue", sessionId, lesson.runtime, {
		fork: true,
	});
	// Errors are handled at adoption time; this avoids an unhandled rejection
	promise.catch(() => {});
	prefetch = { baseSessionId: sessionId, promise };
}

// What a card contributes to the notes document: its body, and under it the
// takeaway as a pull quote when the card has one. Card references are flattened
// on the way in — the notes are a tree of sections with no cards to link to.
// The notes are what the learner re-reads, and a takeaway per concept is what
// makes that document scannable rather than something to read end to end.
function notesEntry(card: TutorTurn["card"]): string {
	const body = stripCardRefs(card.body);
	if (!card.takeaway) return body;
	return `${body}\n\n> **Key takeaway** — ${stripCardRefs(card.takeaway)}`;
}

function finishTurn(lesson: ActiveLesson, turn: TutorTurn): TurnResult {
	lesson.sessionId = turn.sessionId;
	// A turn can land after the learner has already opened another lesson. Its
	// session still belongs to its own lesson, but the notes document and the
	// prefetch slot belong to whichever lesson is open now.
	if (lesson === active) {
		// File the card body into the notes document at adoption time — a
		// discarded prefetch fork must never write notes. Card references are
		// flattened to plain names on the way in: the notes document is a tree
		// of sections with no cards to link to.
		if (turn.card.notes) {
			notes.insert(turn.card.notes.sectionPath, notesEntry(turn.card));
		}
		// Only step cards lead to "continue" — after a question card the next
		// input is an answer, and a recap ends the lesson
		if (turn.card.type === "step") {
			startPrefetch(lesson);
		}
	}
	return {
		ok: true,
		card: turn.card,
		outline: turn.outline,
		exercise: turn.exercise,
		lessonId: lesson.id,
	};
}

function turnError(error: unknown): TurnResult {
	console.error("tutor turn failed:", error);
	return {
		ok: false,
		error: error instanceof Error ? error.message : String(error),
	};
}

// Foreground turns stream a live preview to the webview; prefetch
// (startPrefetch) stays non-streaming since it runs in the background. Fork
// whenever we're resuming: the lesson session is advanced (finishTurn) only
// once a card is successfully adopted, so a reply we can't use can't skip the
// next step. The first turn of a lesson has no session to fork.
async function runForegroundTurn(
	lesson: ActiveLesson,
	message: string,
): Promise<TurnResult> {
	try {
		return finishTurn(
			lesson,
			await runTutorTurnStreaming(message, lesson.sessionId, lesson.runtime, {
				fork: Boolean(lesson.sessionId),
				onPreview: sendPreview,
			}),
		);
	} catch (error) {
		return turnError(error);
	}
}

async function beginLesson(config: LessonConfig): Promise<TurnResult> {
	const id = makeLessonId(config.topic);
	const lesson: ActiveLesson = { id, config, runtime: runtimeFor(config) };
	active = lesson;
	notes.startLesson(id, config.topic);
	prefetch = undefined;
	// The opening message can involve reading the project from disk
	return runForegroundTurn(lesson, await openingMessage(config));
}

function tutorTurn(message: string): Promise<TurnResult> {
	if (!active) {
		return Promise.resolve({ ok: false, error: "No lesson is open" });
	}
	// An explicit user turn advances the base session; a pending fork would
	// no longer contain this exchange, so drop it
	prefetch = undefined;
	return runForegroundTurn(active, message);
}

async function continueTurn(): Promise<TurnResult> {
	const lesson = active;
	if (!lesson) return { ok: false, error: "No lesson is open" };
	const pending = prefetch;
	prefetch = undefined;
	if (pending && pending.baseSessionId === lesson.sessionId) {
		try {
			return finishTurn(lesson, await pending.promise);
		} catch (error) {
			console.error("prefetched turn failed, running a fresh one:", error);
		}
	}
	return runForegroundTurn(lesson, "continue");
}

const rpc = BrowserView.defineRPC<TutoRPC>({
	// Long enough to cover the slowest mode's turn plus its repair attempts —
	// a codebase turn can spend minutes reading before it writes a card
	maxRequestTime: 900_000,
	handlers: {
		requests: {
			startLesson: ({ config }) => beginLesson(config),
			sendMessage: ({ text }) => tutorTurn(text),
			continueLesson: () => continueTurn(),
			pickProject: () => pickProject(),
			getNotes: () => ({ markdown: notes.render() }),
			saveLesson: async ({ snapshot }) => {
				// Metadata belongs to the open lesson. A save for any other one
				// (a late write as the learner switches away) carries none, and
				// the store keeps what is already on disk.
				const lesson = active?.id === snapshot.id ? active : undefined;
				await store.saveLesson(snapshot, {
					sessionId: lesson?.sessionId,
					config: lesson?.config,
				});
				return { ok: true };
			},
			listLessons: async () => ({ lessons: await store.listLessons() }),
			resumeLesson: async ({ id }) => {
				const record = await store.loadLesson(id);
				if (!record) return { ok: false, error: "Lesson not found" };
				const config = store.configOf(record);
				// A lesson that teaches from a project can outlive the folder it
				// points at. Catch that here rather than letting the first turn
				// fail inside the CLI with a working-directory error.
				if (config.mode === "codebase") {
					const found = await describeProject(config.project.path);
					if (!found.project) {
						return {
							ok: false,
							error: `This lesson reads from ${config.project.path}, which is no longer there.`,
						};
					}
				}
				active = {
					id: record.id,
					config,
					runtime: runtimeFor(config),
					sessionId: record.sessionId,
				};
				// A prefetch fork from another lesson must not leak into this one
				prefetch = undefined;
				await notes.resume(record.id, record.topic);
				// Hand back the resolved config, so the webview never has to
				// work out what a pre-modes record meant
				return { ok: true, record: { ...record, config } };
			},
			deleteLesson: async ({ id }) => {
				await store.deleteLesson(id);
				if (active?.id === id) {
					active = undefined;
					prefetch = undefined;
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
			regenerateExercise: async ({
				exercise,
				material,
				concept,
			}): Promise<ExerciseResult> => {
				try {
					return {
						ok: true,
						exercise: await regenerateExercise(exercise, material, concept),
					};
				} catch (regenError) {
					console.error("exercise regeneration failed:", regenError);
					return {
						ok: false,
						error:
							regenError instanceof Error
								? regenError.message
								: String(regenError),
					};
				}
			},
			askAboutSection: async (input): Promise<AskResult> => {
				try {
					return { ok: true, answer: await discussSection(input) };
				} catch (askError) {
					console.error("section question failed:", askError);
					return {
						ok: false,
						error:
							askError instanceof Error ? askError.message : String(askError),
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
