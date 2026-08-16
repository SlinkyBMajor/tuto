// What a lesson mode is: where its material comes from, how its turns run, and
// what opens it. The rest of the app is mode-blind — it carries a LessonConfig
// around and asks here for the runtime — so a new mode is a prompt section and
// one spec in this file.

import codebasePrompt from "../../prompts/modes/codebase.md";
import topicPrompt from "../../prompts/modes/topic.md";
import tutorPrompt from "../../prompts/tutor.md";
import type { LessonConfig, LessonModeId } from "../shared/types";
import type { TutorRuntime } from "./claude";
import { describeRepo } from "./repo-map";

// Enough to follow the code and nothing that can change it, run it, or reach
// the network. A lesson only ever reads.
const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"] as const;

const TOPIC_TURN_TIMEOUT_MS = 180_000;
// A codebase turn reads its way to an answer before it writes a word, and the
// opening turn plans an outline over a repo it has never seen.
const CODEBASE_TURN_TIMEOUT_MS = 420_000;

// Reading code and turning it into a short card is squarely Sonnet's work, and
// a codebase turn is the expensive kind — several tool results per card, every
// card. Pinning it also side-steps whatever tier this machine defaults to.
const CODEBASE_MODEL = "claude-sonnet-5";
// Backstop only: a healthy turn lands far under this. It exists so a turn that
// decides to read the whole repository fails instead of quietly billing for it.
const CODEBASE_TURN_BUDGET_USD = 2;

interface LessonModeSpec {
	id: LessonModeId;
	// Appended to the core tutor prompt; says what kind of lesson this is
	prompt: string;
	// Built-in CLI tools the tutor may use; empty disables all of them
	tools: readonly string[];
	turnTimeoutMs: number;
	// Speculatively fetch the next card while the learner reads this one
	prefetch: boolean;
	// Whether the learner's preferred code language applies. It does not when
	// the code in the cards is the project's own.
	usesLanguagePreference: boolean;
	// Pinned model, and a hard per-turn cost ceiling where one is warranted
	model?: string;
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
	turnTimeoutMs: TOPIC_TURN_TIMEOUT_MS,
	prefetch: true,
	usesLanguagePreference: true,
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
	turnTimeoutMs: CODEBASE_TURN_TIMEOUT_MS,
	// Worth the discarded forks: without it every Continue waits out a fresh
	// round of file reading.
	prefetch: true,
	usesLanguagePreference: false,
	model: CODEBASE_MODEL,
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

const MODES: Record<LessonModeId, LessonModeSpec> = {
	topic: TOPIC_MODE,
	codebase: CODEBASE_MODE,
};

export function modeOf(config: LessonConfig): LessonModeSpec {
	return MODES[config.mode];
}

// The system prompt for a lesson: core tutor instructions, the mode's section,
// then the learner's preferences. Later sections are allowed to be more
// specific than earlier ones — see the note at the top of prompts/tutor.md.
function systemPromptFor(config: LessonConfig): string {
	const mode = modeOf(config);
	const language = config.language?.trim();
	const preferences =
		mode.usesLanguagePreference && language
			? `# Learner preferences\n\nWhen a code example or exercise fits and the topic does not imply a specific language, write it in ${language}.\n`
			: "";
	return [tutorPrompt, mode.prompt, preferences].filter(Boolean).join("\n");
}

// Everything claude.ts needs to run a turn of this lesson.
export function runtimeFor(config: LessonConfig): TutorRuntime {
	const mode = modeOf(config);
	return {
		systemPrompt: systemPromptFor(config),
		tools: mode.tools,
		cwd: mode.cwd(config),
		timeoutMs: mode.turnTimeoutMs,
		model: mode.model,
		maxBudgetUsd: mode.maxBudgetUsd,
	};
}

export function openingMessage(config: LessonConfig): Promise<string> {
	return modeOf(config).opening(config);
}
