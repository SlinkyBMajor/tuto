// What a lesson mode is: where its material comes from, how its turns run, and
// what opens it. The rest of the app is mode-blind — it carries a LessonConfig
// around and asks here for the runtime — so a new mode is a prompt section and
// one spec in this file.

import codebasePrompt from "../../prompts/modes/codebase.md";
import labPrompt from "../../prompts/modes/lab.md";
import topicPrompt from "../../prompts/modes/topic.md";
import notesPrompt from "../../prompts/notes.md";
import tutorPrompt from "../../prompts/tutor.md";
import type {
	CardFeatureId,
	LessonConfig,
	LessonModeId,
} from "../shared/types";
import { ALL_CARD_FEATURES, cardFeaturePrompts } from "./card-features";
import type { TutorRuntime } from "./claude";
import { describeDocs } from "./context7";
import { describeMachine } from "./env-probe";
import { describeRepo } from "./repo-map";
import { settings } from "./settings";

// The notes document is switched off: it is a section of prompt in every turn
// and a routing field on every card, for a document that was not being read.
// Flip this to true to bring it back — it re-attaches prompts/notes.md to the
// system prompt and starts the Bun process filing cards again (see index.ts).
// Two things do NOT come back with it, and have to be restored by hand from
// git: the "notes" JSON in the examples in prompts/modes/lab.md, and the Notes
// tab in src/mainview/App.tsx.
export const NOTES_ENABLED = false;

// Enough to follow the code and nothing that can change it, run it, or reach
// the network. A lesson only ever reads.
const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"] as const;

// The one place a lesson reaches the network, and only in lab mode. A lab
// lesson is the kind where reality answers back — a step fails, the learner
// pastes an error, and the fix turns on a version or a flag no briefing
// anticipated. Neither tool can touch this machine. See
// docs/adr/0002-fetch-documentation-in-the-app-not-through-mcp.md.
const WEB_TOOLS = ["WebSearch", "WebFetch"] as const;

const TOPIC_TURN_TIMEOUT_MS = 180_000;
// A codebase turn reads its way to an answer before it writes a word, and the
// opening turn plans an outline over a repo it has never seen.
const CODEBASE_TURN_TIMEOUT_MS = 420_000;

// Backstop only: a healthy turn lands far under this. It exists so a turn that
// decides to read the whole repository fails instead of quietly billing for it.
const CODEBASE_TURN_BUDGET_USD = 2;

// A lab turn plans a sequence of real commands and, from the moment this mode
// looks documentation up, waits on the network to do it. Sized for that; a
// timeout is a ceiling, so it costs nothing while there is nothing to wait for.
const LAB_TURN_TIMEOUT_MS = 420_000;
const LAB_TURN_BUDGET_USD = 2;
interface LessonModeSpec {
	id: LessonModeId;
	// Appended to the core tutor prompt; says what kind of lesson this is
	prompt: string;
	// Built-in CLI tools the tutor may use; empty disables all of them
	tools: readonly string[];
	// Tools for the FIRST turn only, which asks the level question. Its own
	// field, and a required one, because both prompts already tell the tutor not
	// to look anything up before it knows who it is teaching — and both were
	// measured ignoring it. Codebase mode once opened 30 files to ask how well
	// somebody knew a repository; lab mode ran 30 web searches and timed out.
	// A rule the model can talk itself out of is not a budget.
	openingTools: readonly string[];
	turnTimeoutMs: number;
	// Speculatively fetch the next card while the learner reads this one
	prefetch: boolean;
	// Whether the learner's preferred code language applies. It does not when
	// the code in the cards is the project's own.
	usesLanguagePreference: boolean;
	// What a card in this mode may carry. Each one contributes a section to the
	// system prompt and is dropped from the card if it is not listed, so this is
	// the whole answer to "can a lesson of this kind have a cost panel?" — see
	// card-features.ts.
	cardFeatures: readonly CardFeatureId[];
	// A hard per-turn cost ceiling, where one is warranted. The model and the
	// effort are NOT here: they are one pair in Settings, the same for every
	// mode, because what a lesson costs is the learner's call and not a
	// property of the kind of lesson it is. See settings.ts.
	maxBudgetUsd?: number;
	// Where the CLI runs. Takes the whole config and narrows here, so callers
	// never have to know which modes have a project.
	cwd(config: LessonConfig): string | undefined;
	// The message that opens the lesson. Async because a mode may gather
	// context from disk first — see repo-map.ts.
	opening(config: LessonConfig): Promise<string>;
}

const TOPIC_MODE: LessonModeSpec = {
	id: "topic",
	prompt: topicPrompt,
	tools: [],
	openingTools: [],
	turnTimeoutMs: TOPIC_TURN_TIMEOUT_MS,
	prefetch: true,
	usesLanguagePreference: true,
	cardFeatures: ALL_CARD_FEATURES,
	cwd: () => undefined,
	// A lesson taken as groundwork says so in its opening message, which is
	// also where the level comes from: asking for the groundwork is itself the
	// statement that the learner is new to it, so the tutor skips the level
	// question and plans straight away (see "A lesson that leads somewhere").
	opening: async (config) =>
		config.mode === "topic" && config.goal
			? `I want to learn about: ${config.topic}\n\nI am learning this as the groundwork for ${config.goal.topic}, which I will go on to next. I am starting from scratch on ${config.topic} itself.`
			: `I want to learn about: ${config.topic}`,
};

const CODEBASE_MODE: LessonModeSpec = {
	id: "codebase",
	prompt: codebasePrompt,
	tools: READ_ONLY_TOOLS,
	// The project map is already in the opening message, which is everything
	// the level question needs.
	openingTools: [],
	turnTimeoutMs: CODEBASE_TURN_TIMEOUT_MS,
	// Worth the discarded forks: without it every Continue waits out a fresh
	// round of file reading.
	prefetch: true,
	usesLanguagePreference: false,
	cardFeatures: ALL_CARD_FEATURES,
	maxBudgetUsd: CODEBASE_TURN_BUDGET_USD,
	cwd: (config) =>
		config.mode === "codebase" ? config.project.path : undefined,
	// The lesson opens with a map of the project read off disk: its index file
	// and every documentation file it keeps. Assembling that here costs nothing
	// and saves the tutor a round of searching in every single lesson.
	opening: async (config) =>
		config.mode === "codebase"
			? `${await describeRepo(config.project)}\n\nWhat I want to understand: ${config.topic}`
			: config.topic,
};

const LAB_MODE: LessonModeSpec = {
	id: "lab",
	prompt: labPrompt,
	// The learner runs every command themselves, in their own terminal. The app
	// executes nothing that changes this machine, and the tutor has no way to —
	// see docs/adr/0001-the-learner-executes-the-app-only-verifies.md. What the
	// tutor can do is look something up when a step goes wrong, and — once the
	// lesson has a folder of its own — read what the learner wrote in it. Both
	// read; neither can change anything. Measured on CLI 2.1.234: with a working
	// directory set, Read and Grep succeed inside it and are refused by the
	// permission system outside it, including through `..` and `~`, so the read
	// tools reach the lesson's folder and nothing else on this machine.
	tools: WEB_TOOLS,
	// The machine report and the documentation excerpt are already in the
	// opening message. Nothing about "how much do you know about Grafana?"
	// is answered by a web search.
	openingTools: [],
	turnTimeoutMs: LAB_TURN_TIMEOUT_MS,
	// Off, and not as a cost saving. The next card depends on how the step
	// actually went, so a speculative one is usually the wrong card — and the
	// learner is away doing the step anyway, which is where the latency hides.
	prefetch: false,
	// The commands are the tool's own language; a preference for Python does
	// not make `docker run` anything else.
	usesLanguagePreference: false,
	// All of them, including the two this mode invented: `caution` and `cost`
	// started here and are now shared, because a topic lesson that tells the
	// learner to try something has the same two things to say.
	cardFeatures: ALL_CARD_FEATURES,
	maxBudgetUsd: LAB_TURN_BUDGET_USD,
	// The lesson's own folder, once its plan asked for one. Many labs never do —
	// the work is in a browser or a cloud console — and those run with no
	// working directory at all.
	cwd: (config) => (config.mode === "lab" ? config.labDir : undefined),
	// The lesson opens with two things read before the first turn: what this
	// machine already has, and the current documentation for what is being
	// learned. The same trade repo-map.ts makes — a few hundred tokens once,
	// against a tutor that would otherwise plan setup blind, write install cards
	// at somebody who has the tool, and teach last year's flags. Both are
	// fetched at once, so the lesson waits for the slower of the two rather than
	// for their sum, and a doc lookup that fails is simply absent.
	opening: async (config) => {
		const [machine, docs] = await Promise.all([
			describeMachine(),
			describeDocs(config.topic),
		]);
		return [machine, docs, `What I want to learn, hands-on: ${config.topic}`]
			.filter(Boolean)
			.join("\n\n");
	},
};

// What a lab lesson may do once it has a folder: read the learner's own files
// in it, on top of the web pair. Never write — a file the lesson wants changed
// is a task card, like every other change to this machine.
const LAB_FOLDER_TOOLS = [...WEB_TOOLS, ...READ_ONLY_TOOLS] as const;

const MODES: Record<LessonModeId, LessonModeSpec> = {
	topic: TOPIC_MODE,
	codebase: CODEBASE_MODE,
	lab: LAB_MODE,
};

export function modeOf(config: LessonConfig): LessonModeSpec {
	return MODES[config.mode];
}

// The system prompt for a lesson: core tutor instructions, the mode's section,
// then the learner's preferences. Later sections are allowed to be more
// specific than earlier ones — see the note at the top of prompts/tutor.md.
function systemPromptFor(config: LessonConfig): string {
	const mode = modeOf(config);
	// Not every mode's config has one — a lab lesson has no code language to
	// prefer — and the mode says whether it would use it anyway.
	const language = "language" in config ? config.language?.trim() : undefined;
	const preferences =
		mode.usesLanguagePreference && language
			? `# Learner preferences\n\nWhen a code example or exercise fits and the topic does not imply a specific language, write it in ${language}.\n`
			: "";
	return [
		tutorPrompt,
		// What a card of this kind may carry. Before the mode's own section, so
		// a mode is free to be more specific about a feature it cares about —
		// lab mode insisting on a requirements list, for instance.
		...cardFeaturePrompts(mode.cardFeatures),
		NOTES_ENABLED ? notesPrompt : "",
		mode.prompt,
		preferences,
	]
		.filter(Boolean)
		.join("\n");
}

// Everything claude.ts needs to run one turn of this lesson. Built per turn
// rather than once per lesson, so a model or effort changed in Settings takes
// effect on the next card instead of the next lesson.
export function runtimeFor(config: LessonConfig): TutorRuntime {
	const mode = modeOf(config);
	const machine = settings();
	return {
		systemPrompt: systemPromptFor(config),
		// A lab lesson with a folder of its own can also read what is in it
		tools:
			config.mode === "lab" && config.labDir ? LAB_FOLDER_TOOLS : mode.tools,
		cardFeatures: mode.cardFeatures,
		cwd: mode.cwd(config),
		timeoutMs: mode.turnTimeoutMs,
		// The same pair for every mode and every turn — see settings.ts
		model: machine.model,
		effort: machine.effort,
		maxBudgetUsd: mode.maxBudgetUsd,
	};
}

// The runtime for the first turn of a lesson, which asks the level question and
// nothing else. Everything that turn could want to look up is already in the
// message it was handed — the project map, the machine report, the
// documentation excerpt — so the tools come off rather than being asked to stay
// unused. It is the same runtime in every other respect, so the lesson's own
// runtime is what runs every turn after it.
export function openingRuntimeFor(config: LessonConfig): TutorRuntime {
	return { ...runtimeFor(config), tools: modeOf(config).openingTools };
}

export function openingMessage(config: LessonConfig): Promise<string> {
	return modeOf(config).opening(config);
}
