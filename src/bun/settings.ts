// The machine settings the webview pushes over, and the Bun process uses.
//
// They live in the webview's localStorage with the rest of Settings, but this
// side is what acts on them: it spawns the CLI, it makes the documentation
// call, and it creates the lesson folder. So they are pushed here on startup
// and on every edit, and held in memory — deliberately not written to disk by
// us, and never part of a LessonConfig, which is persisted with every lesson.
// A lesson taken today and resumed after the setting changes runs at the new
// one, because the runtime is built per turn.

import type { EffortLevel } from "./claude";
import { DEFAULT_LAB_ROOT } from "./paths";

// What a lesson turn may run on. Two tiers, both of which can teach: the
// choice is what the learner is willing to pay per lesson, and Settings is
// where they make it. Haiku is deliberately absent — it runs the side-calls,
// where the answer is handed in and the job is to judge it, and a lesson turn
// is the opposite of that job.
export const MODELS = ["claude-opus-5", "claude-sonnet-5"] as const;
export type LessonModel = (typeof MODELS)[number];

// The scale starts at "high" and there is no way to go under it. `low` was
// measured writing lesson cards and it does not think at all — same prompt
// three ways, no flag spent 48 thinking tokens, `xhigh` spent 23, `low` spent
// zero. A turn that does not think writes a card teaching two new terms in two
// sentences, which is not a saving. See "Model and effort" in
// docs/system/claude-backend.md.
export const EFFORTS = ["high", "xhigh", "max"] as const;

interface MachineSettings {
	// The tier and the thinking depth for every turn of every lesson. One pair,
	// not one per mode: what a lesson costs is the learner's call, and a Model
	// field that only moved one kind of lesson would be a lie.
	model: LessonModel;
	effort: EffortLevel;
	// Blank means keyless, which is how the context7 endpoint works out of the
	// box; a key only raises the rate limit.
	context7Key: string;
	// Where a lab lesson's own folder is created, when it needs one
	labRoot: string;
}

// Opus by default, and not as a flourish. Before Settings existed, only two
// modes pinned a model and the third rode whatever this machine defaulted to —
// which on the machine this was written on meant topic lessons were already
// being taught by Opus. Defaulting here to anything cheaper would have made
// every existing lesson quietly worse on the day the setting shipped.
export const DEFAULT_MODEL: LessonModel = "claude-opus-5";
export const DEFAULT_EFFORT: EffortLevel = "xhigh";

let current: MachineSettings = {
	model: DEFAULT_MODEL,
	effort: DEFAULT_EFFORT,
	context7Key: "",
	labRoot: DEFAULT_LAB_ROOT,
};

// Anything the webview sends that is not on our own list is ignored rather
// than trusted: these two go straight onto a CLI command line, and the set of
// models this app will spawn is our decision, not a string from localStorage.
function readModel(value: unknown): LessonModel | undefined {
	return MODELS.find((model) => model === value);
}

function readEffort(value: unknown): EffortLevel | undefined {
	return EFFORTS.find((effort) => effort === value);
}

// `model` and `effort` come in as unknown on purpose: they arrive from the
// webview's localStorage, which a person can edit, and they end up on a CLI
// command line. Anything not on our list is dropped and the current value
// stands.
export function setSettings(next: {
	model?: unknown;
	effort?: unknown;
	context7Key?: string;
	labRoot?: string;
}): void {
	current = {
		model: readModel(next.model) ?? current.model,
		effort: readEffort(next.effort) ?? current.effort,
		context7Key: (next.context7Key ?? current.context7Key).trim(),
		labRoot: (next.labRoot ?? current.labRoot).trim() || DEFAULT_LAB_ROOT,
	};
}

export function settings(): MachineSettings {
	return current;
}
