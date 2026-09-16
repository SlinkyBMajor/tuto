import { mkdir } from "node:fs/promises";
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
	VerifyResult,
} from "../shared/types";
import {
	checkExerciseAnswer,
	discussSection,
	explainTerm,
	fixMermaidDiagram,
	judgeVerify,
	regenerateExercise,
	runTutorTurn,
	runTutorTurnStreaming,
	type TurnPreview,
	type TutorRuntime,
	type TutorTurn,
} from "./claude";
import {
	type MachineProbe,
	machineWarnings,
	probeDrift,
	probeMachine,
} from "./env-probe";
import {
	modeOf,
	NOTES_ENABLED,
	openingMessage,
	openingRuntimeFor,
	runtimeFor,
} from "./lesson-modes";
import { installApplicationMenu } from "./menu";
import { NotesDoc } from "./notes";
import { labDir, makeLessonId } from "./paths";
import { describeProject, pickProject } from "./project";
import { setSettings, settings } from "./settings";
import * as store from "./store";
import { runCheck, setLabFolder } from "./verify";

const DEV_SERVER_URL = "http://localhost:28173";

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

// One lesson open at a time. Its config says what kind of lesson it is, and
// every turn's runtime is derived from that config at the moment the turn runs
// — so a model or effort changed in Settings mid-lesson takes effect on the
// next card. The Claude session carries the conversation.
interface ActiveLesson {
	id: string;
	// Fixed for the lesson's life, with one exception: a lab lesson gains its
	// folder when its plan card asks for one (see openLabFolder), and every
	// runtime built after that has it.
	config: LessonConfig;
	// Absent until the first turn comes back with a session to resume
	sessionId?: string;
	// Lab lessons: what this machine looked like while the lesson was open. Set
	// when it starts and again on every resume, saved with the lesson, and
	// compared on the next resume to say what has moved (see probeDrift).
	probe?: MachineProbe;
	// A line to put in front of the next turn's message. The folder is created
	// mid-lesson, after the opening message has been sent, so the session has
	// to be told about it — a runtime that quietly grows a working directory
	// and two read tools is a tutor that does not know it has them.
	announce?: string;
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
	const promise = runTutorTurn(
		"continue",
		sessionId,
		runtimeFor(lesson.config),
		{
			fork: true,
		},
	);
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
	const parts = [stripCardRefs(card.body)];
	if (card.hierarchy) parts.push(hierarchyMarkdown(card.hierarchy));
	// A lab card's command belongs in the document, not only on the card: the
	// notes are what the learner re-reads, and with every command in them under
	// its own phase they re-read as a runbook for doing the whole thing again.
	if (card.task?.command) {
		parts.push(`\`\`\`sh\n${card.task.command}\n\`\`\``);
	}
	// Money survives into the document for the same reason it gets its own panel
	// on the card: a learner coming back weeks later needs to find what is still
	// billing without re-reading the lesson.
	if (card.cost) parts.push(`> **Cost** — ${stripCardRefs(card.cost)}`);
	if (card.takeaway) {
		parts.push(`> **Key takeaway** — ${stripCardRefs(card.takeaway)}`);
	}
	return parts.join("\n\n");
}

// The tree as a nested list. The feed draws it with connectors; the notes are a
// markdown document, where an indented list IS how a hierarchy is written.
function hierarchyMarkdown(hierarchy: TutorTurn["card"]["hierarchy"]): string {
	if (!hierarchy) return "";
	const rows = hierarchy.levels.map((level) => {
		const indent = "  ".repeat(level.depth);
		const note = level.note ? ` — ${level.note}` : "";
		return `${indent}- **${level.name}**${note}`;
	});
	return `**The hierarchy so far**\n\n${rows.join("\n")}`;
}

// A lab lesson asks for a folder by putting a "workspace" requirement on its
// plan card, and this is where it gets one: created on the spot and written
// into the lesson's config, so every runtime built after this one carries the
// folder and the two read tools that come with it. At most once per lesson — a
// lesson that already has a folder keeps it, whatever a later card asks for.
//
// This is the one thing about a lesson's config that is not fixed when it
// starts, and it is deliberate: nothing knows whether a lesson needs a folder
// until it has planned itself.
async function openLabFolder(
	lesson: ActiveLesson,
	turn: TutorTurn,
): Promise<string | undefined> {
	const config = lesson.config;
	if (config.mode !== "lab" || config.labDir) return undefined;
	if (!turn.card.requirements?.some((row) => row.kind === "workspace")) {
		return undefined;
	}
	const dir = labDir(settings().labRoot, lesson.id);
	try {
		await mkdir(dir, { recursive: true });
	} catch (error) {
		// A folder we cannot create is not a lesson we cannot teach: the tutor
		// carries on without one, and the learner works wherever they like.
		console.error("could not create the lab folder:", error);
		return undefined;
	}
	lesson.config = { ...config, labDir: dir };
	setLabFolder(dir);
	lesson.announce = `The app has made the folder for this lesson's files: ${dir}. It is mine — you can read what is in it and search it, and I write it.`;
	console.log(`lab folder: ${dir}`);
	return dir;
}

async function finishTurn(
	lesson: ActiveLesson,
	turn: TutorTurn,
): Promise<TurnResult> {
	lesson.sessionId = turn.sessionId;
	// Set when this turn is the one that made the lesson its folder
	let labDir: string | undefined;
	// A turn can land after the learner has already opened another lesson. Its
	// session still belongs to its own lesson, but the notes document and the
	// prefetch slot belong to whichever lesson is open now.
	if (lesson === active) {
		// File the card body into the notes document at adoption time — a
		// discarded prefetch fork must never write notes. Card references are
		// flattened to plain names on the way in: the notes document is a tree
		// of sections with no cards to link to.
		if (NOTES_ENABLED && turn.card.notes) {
			notes.insert(turn.card.notes.sectionPath, notesEntry(turn.card));
		}
		// The plan card is where a lesson says it needs a folder to work in
		labDir = await openLabFolder(lesson, turn);
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
		labDir,
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
	// The opening turn runs on a runtime of its own — same lesson, no tools;
	// see openingRuntimeFor. Every other turn builds one from the lesson.
	// Evaluated per call, so it picks up the current Settings and, in a lab
	// lesson, the folder the plan card asked for.
	runtime: TutorRuntime = runtimeFor(lesson.config),
): Promise<TurnResult> {
	// Anything the app did between turns rides in front of what the learner
	// said, in their voice, since it happened on their machine
	const announce = lesson.announce;
	lesson.announce = undefined;
	const text = announce ? `${announce}\n\n${message}` : message;
	try {
		return await finishTurn(
			lesson,
			await runTutorTurnStreaming(text, lesson.sessionId, runtime, {
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
	const lesson: ActiveLesson = { id, config };
	active = lesson;
	notes.startLesson(id, config.topic);
	prefetch = undefined;
	// A fresh lesson has no folder yet; a check may not read the last one's
	setLabFolder(config.mode === "lab" ? config.labDir : undefined);
	// Kept so the next resume can say what has moved. The probe is memoised, so
	// this is the same read the opening message is built from.
	if (config.mode === "lab") lesson.probe = await probeMachine();
	// The opening message can involve reading the project from disk
	return runForegroundTurn(
		lesson,
		await openingMessage(config),
		openingRuntimeFor(config),
	);
}

function tutorTurn(message: string): Promise<TurnResult> {
	const lesson = active;
	if (!lesson) {
		return Promise.resolve({ ok: false, error: "No lesson is open" });
	}
	// An explicit user turn advances the base session; a pending fork would
	// no longer contain this exchange, so drop it
	prefetch = undefined;
	return runForegroundTurn(lesson, message);
}

async function continueTurn(): Promise<TurnResult> {
	const lesson = active;
	if (!lesson) return { ok: false, error: "No lesson is open" };
	const pending = prefetch;
	prefetch = undefined;
	if (pending && pending.baseSessionId === lesson.sessionId) {
		try {
			return await finishTurn(lesson, await pending.promise);
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
			// The learner clicked Check. The command is validated again here
			// before it is spawned — it was validated at parse time, but the
			// webview is not the authority on what this app may run.
			runVerify: async ({ verify, taskExpect }): Promise<VerifyResult> => {
				const run = await runCheck(verify);
				if (run.refused) {
					console.error("refused a verify command:", run.command);
					return { ok: false, error: "This check cannot be run." };
				}
				try {
					const verdict = await judgeVerify(run, verify.expect, taskExpect);
					return {
						ok: true,
						...verdict,
						command: run.command,
						output: run.output,
					};
				} catch (judgeError) {
					console.error("verify judge failed:", judgeError);
					return {
						ok: false,
						error:
							judgeError instanceof Error
								? judgeError.message
								: String(judgeError),
					};
				}
			},
			setSettings: (next) => {
				setSettings(next);
				return { ok: true };
			},
			// Read-only, and the same probe the lesson's opening message is built
			// from — see env-probe.ts for what it looks at and what it does not.
			// On a resumed lesson this is also where drift is reported: the probe
			// saved with the lesson against the machine as it is now.
			probeMachine: async () => {
				const probe = await probeMachine();
				const before = active?.probe;
				const lesson = active;
				// The lesson now compares against today, not against the day it
				// was started
				if (lesson) lesson.probe = probe;
				return {
					warnings: machineWarnings(probe),
					drift: before ? probeDrift(before, probe) : [],
				};
			},
			getNotes: () => ({ markdown: notes.render() }),
			saveLesson: async ({ snapshot }) => {
				// Metadata belongs to the open lesson. A save for any other one
				// (a late write as the learner switches away) carries none, and
				// the store keeps what is already on disk.
				const lesson = active?.id === snapshot.id ? active : undefined;
				await store.saveLesson(snapshot, {
					sessionId: lesson?.sessionId,
					config: lesson?.config,
					probe: lesson?.probe,
				});
				return { ok: true };
			},
			listLessons: async () => ({ lessons: await store.listLessons() }),
			resumeLesson: async ({ id }) => {
				const record = await store.loadLesson(id);
				if (!record) return { ok: false, error: "Lesson not found" };
				let config = store.configOf(record);
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
				// A lab folder is the app's own doing, so a missing one is remade
				// rather than reported: the learner asked to continue the lesson,
				// not to be told about a directory. Only if that fails does the
				// lesson go on without one.
				if (config.mode === "lab" && config.labDir) {
					try {
						await mkdir(config.labDir, { recursive: true });
					} catch (error) {
						console.error("lab folder is gone and cannot be remade:", error);
						config = { ...config, labDir: undefined };
					}
				}
				active = {
					id: record.id,
					config,
					sessionId: record.sessionId,
					// Compared against a fresh probe when the webview asks for one
					probe: record.probe as MachineProbe | undefined,
				};
				// A prefetch fork from another lesson must not leak into this one
				prefetch = undefined;
				setLabFolder(config.mode === "lab" ? config.labDir : undefined);
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

// After the window, not before: the menu set before one exists is the one the
// native layer then replaces with its default, and the app comes up with no
// Edit menu — which on macOS means no ⌘C and no ⌘V anywhere in it.
installApplicationMenu();
