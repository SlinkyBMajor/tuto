// Smoke test for a lab lesson: the tutor gets a report of this machine, asks a
// level question, plans a hands-on lesson with a requirements list, and starts
// handing out steps the learner performs. Checks the things the mode exists for
// — that it plans around what is installed, discloses what the lesson needs
// before the setup starts, and writes cards that explain before they command.
//
// Run with: pnpm run smoke:lab ["topic…"]
import { runTutorTurnStreaming, type TurnCost } from "../src/bun/claude";
import { fetchDocs } from "../src/bun/context7";
import {
	machineWarnings,
	probeMachine,
	renderMachine,
} from "../src/bun/env-probe";
import {
	openingMessage,
	openingRuntimeFor,
	runtimeFor,
} from "../src/bun/lesson-modes";
import type { Card, LessonConfig } from "../src/shared/types";
import { longestSegment, takeawayProblem } from "./card-prose";

// Two sentences of at most 25 words each, plus slack — the same bar the other
// smoke tests hold cards to.
const MAX_SEGMENT_WORDS = 60;

// A lab lesson has to end where it started: everything it switches on, it
// switches off. Both ends of the outline are checked by name.
const SETUP_WORDS =
	/instal|setup|set up|prepare|prerequisit|get ready|running/i;
const CLEANUP_WORDS = /clean|tear ?down|remove|stop|delete|shut ?down|tidy/i;

const config: LessonConfig = {
	mode: "lab",
	topic: process.argv.slice(2).join(" ") || "Grafana, hands-on",
};

// Whether this topic can put something on a bill, guessed from its own words.
// Crude on purpose: it decides which way the cost check runs, and it prints
// what it decided so a wrong guess is visible rather than silent.
const PAID_WORDS =
	/\b(azure|aws|amazon|gcp|google cloud|cloud|vercel|netlify|heroku|render|fly\.io|railway|supabase|planetscale|databricks|snowflake|openai|anthropic)\b/i;
const paidTopic = PAID_WORDS.test(config.topic);
// The same two runtimes the app builds: one for the opening turn, which has no
// tools, and one for every turn after it. Model and effort come from settings.ts
// — here that means its defaults, since nothing pushes settings to a script.
const openingRuntime = openingRuntimeFor(config);
const runtime = runtimeFor(config);

// The probe is the whole opening move of this mode, so show it before anything
// costs money — a wrong machine report is a wrong lesson.
const probe = await probeMachine();
console.log(`topic: ${config.topic}`);
console.log(
	`reading this as a ${paidTopic ? "topic that can bill — it must disclose cost" : "free, local topic — it must not cry wolf about cost"}\n`,
);
console.log(renderMachine(probe));
const warnings = machineWarnings(probe);
console.log(
	`\nwarnings the app would show: ${warnings.length === 0 ? "(none)" : ""}`,
);
for (const warning of warnings) console.log(`  ! ${warning}`);

// The other half of the opening message, and the half that decides whether the
// lesson's commands are current. It costs no tokens, so check it before paying
// for anything: a briefing about the wrong library is worse than none.
const briefing = await fetchDocs(config.topic);
console.log(
	`\ndocumentation: ${briefing ? `${briefing.libraryId} — ${briefing.text.length} chars` : "(none found; the lesson runs on the model's own knowledge)"}`,
);
console.log();

// What the tutor looked up while it wrote a card, in the order it did. A lab
// turn is meant to search rarely — the briefing is already in the session — so
// this is counted per turn rather than summed.
let lookups: string[] = [];
function trace(preview: { activity?: string }) {
	const line = preview.activity;
	if (line && line !== lookups.at(-1)) {
		lookups.push(line);
		console.log(`  · ${line}`);
	}
}
function lookupsThisTurn(): string[] {
	const seen = lookups;
	lookups = [];
	return seen;
}

const ledger: TurnCost[] = [];
// The effort a turn ran at is printed with what it cost, because the two are
// the whole point of the phases: a plan turn that is not dearer than a step
// turn means the split is not doing anything.
function report(
	label: string,
	turn: { cost?: TurnCost },
	runtime: { effort?: string },
) {
	const seen = lookupsThisTurn();
	if (!turn.cost) return;
	ledger.push(turn.cost);
	const { usd, ms, steps } = turn.cost;
	console.log(
		`\n  ${label} (effort ${runtime.effort ?? "cli default"}): $${usd.toFixed(3)} · ${(ms / 1000).toFixed(0)}s · ${steps} model steps · ${seen.length} lookup(s)`,
	);
	return seen;
}

function fail(message: string): never {
	console.error(`FAIL: ${message}`);
	process.exit(1);
}

// Cards are read one section at a time, and a lab card carries a command the
// learner has to act on — so a wall of text is worse here than anywhere else.
function checkProse(label: string, card: Card) {
	const longest = longestSegment(card.body);
	if (longest.words > MAX_SEGMENT_WORDS) {
		fail(
			`a section of the ${label} runs to ${longest.words} words (max ${MAX_SEGMENT_WORDS}):\n  ${longest.text}`,
		);
	}
	console.log(`  ${label}: longest section ${longest.words} words`);
	if (card.takeaway) {
		const problem = takeawayProblem(card.takeaway, card.title);
		if (problem) fail(`the ${label} takeaway ${problem}:\n  ${card.takeaway}`);
	}
}

console.log("Turn 1: opening the lesson…");
const first = await runTutorTurnStreaming(
	await openingMessage(config),
	undefined,
	// The level question runs with no tools at all — the app does not ask the
	// tutor to leave them alone, it takes them away. See openingRuntimeFor.
	openingRuntime,
	{ onPreview: trace },
);
const openingLookups = report("turn 1", first, openingRuntime) ?? [];
console.log(JSON.stringify(first.card, null, 2));

if (first.card.type !== "question" || first.card.options?.length !== 3) {
	fail("expected a level question with exactly 3 options");
}
// The offer to start one step back replaces the lesson with a topic lesson,
// which would quietly drop the hands-on part — the mode prompt forbids it here.
if (first.card.prerequisite) {
	fail(
		`a lab lesson offered a prerequisite detour ("${first.card.prerequisite.topic}"), which would leave the lab behind`,
	);
}

const choice = first.card.options?.[0];
console.log(`\nTurn 2: answering with option "${choice?.label}"…`);
const second = await runTutorTurnStreaming(
	choice?.label ?? "",
	first.sessionId,
	runtime,
	{ fork: true, onPreview: trace },
);
const planLookups = report("turn 2", second, runtime) ?? [];
console.log(JSON.stringify(second.card, null, 2));
console.log("outline:", JSON.stringify(second.outline));

const outline = second.outline;
if (!outline || outline.length < 4) {
	fail("expected an outline of at least 4 concepts");
}
// Everything the lesson starts, the lesson stops. Both ends are a mode rule,
// not a nicety: a lab that leaves a container running has left a mess, and one
// that leaves a cloud resource running has left a bill.
if (!outline.some((item) => SETUP_WORDS.test(item.title))) {
	fail(
		`the outline has no setup concept: ${outline.map((i) => i.title).join(", ")}`,
	);
}
if (!CLEANUP_WORDS.test(outline.at(-1)?.title ?? "")) {
	fail(
		`the outline does not end with a clean-up concept: ${outline.at(-1)?.title}`,
	);
}
// The requirements list is the promise the mode makes before the learner has
// spent anything: this is what you need, and this is what it costs.
const requirements = second.card.requirements;
if (!requirements || requirements.length === 0) {
	fail("the plan card carries no requirements list");
}
console.log(
	`\nrequirements: ${requirements.map((row) => `${row.name} (${row.kind}${row.cost ? `, ${row.cost}` : ""})`).join("; ")}`,
);
if (!requirements.some((row) => row.kind === "time")) {
	console.warn("  ! no estimate of how long the lesson takes");
}
checkProse("plan card", second.card);

// Then the lesson starts handing out steps. A card or two of framing before the
// first task is fine, so this walks until it finds one rather than demanding it
// immediately — but a lab lesson that never asks the learner to do anything is
// not a lab lesson. The tolerance was sized when the prompt mandated a block of
// teaching cards after setup; that block is gone, so a task should now arrive
// sooner than this allows.
const MAX_STEPS_TO_FIRST_TASK = 4;
let sessionId = second.sessionId;
let taskCard: Card | undefined;
const steps: Card[] = [];
for (let step = 1; step <= MAX_STEPS_TO_FIRST_TASK && !taskCard; step++) {
	console.log(`\nTurn ${step + 2}: Continue…`);
	const turn = await runTutorTurnStreaming("continue", sessionId, runtime, {
		fork: true,
		onPreview: trace,
	});
	report(`turn ${step + 2}`, turn, runtime);
	console.log(JSON.stringify(turn.card, null, 2));
	sessionId = turn.sessionId;
	steps.push(turn.card);
	checkProse(`turn ${step + 2} card`, turn.card);
	if (turn.card.task) taskCard = turn.card;
}

if (!taskCard?.task) {
	fail(
		`no task card in the first ${MAX_STEPS_TO_FIRST_TASK} steps — the learner has nothing to do`,
	);
}
const task = taskCard.task;
if (task.kind === "run" && !task.command) {
	fail("a run task arrived with no command to type");
}
if (!task.expect) {
	fail("the task does not say what success looks like");
}
// Explain before you command: the body has to teach the step, not just frame it
if (taskCard.body.trim().split(/\s+/).length < 20) {
	fail(`the task card barely explains itself:\n  ${taskCard.body}`);
}
console.log(`\nfirst task (${task.kind}): ${task.command ?? "(no command)"}`);
console.log(`expects: ${task.expect}`);

// Checks are optional, so their absence is never a failure — but a lab lesson
// whose steps can never be checked has given up the loop the mode exists for.
// Anything that arrives HAS passed the allowlist: parseVerify drops the rest.
const checked = [second.card, ...steps].filter((card) => card.task?.verify);
console.log(
	`\nchecks the app would run: ${checked.length === 0 ? "(none yet)" : ""}`,
);
for (const card of checked) {
	console.log(`  $ ${card.task?.verify?.argv.join(" ")}`);
	console.log(`    expecting: ${card.task?.verify?.expect}`);
}
if (checked.length === 0) {
	console.warn(
		"  ! no step so far carries a check — either none was offered, or every one was refused by the allowlist",
	);
}

// The budget the mode prompt sets: no searching to plan the lesson, because the
// briefing and what the model knows are enough for that. A lesson that opens
// with five searches has spent the learner's first minute on nothing they see.
if (openingLookups.length > 0) {
	console.warn(
		`\n  ! turn 1 searched ${openingLookups.length} time(s) to ask a level question`,
	);
}
if (planLookups.length > 2) {
	console.warn(
		`  ! turn 2 searched ${planLookups.length} times to plan the outline; the briefing should have carried it`,
	);
}

// Money honesty, both ways round. A lesson that can bill has to say so before
// the learner starts; a free local one that warns about cost has cried wolf,
// and the next warning is worth less for it.
const cards = [second.card, ...steps];
const costs = cards.filter((card) => card.cost).map((card) => card.cost);
console.log(`\ncost fields on ${costs.length} of ${cards.length} cards:`);
for (const line of costs) console.log(`  $ ${line}`);
if (paidTopic && costs.length === 0) {
	fail(
		"a lesson on a paid service went this far without one word about what it costs",
	);
}
if (!paidTopic && costs.length > 0) {
	console.warn(
		"  ! a free, local lesson carries cost warnings — check they are not crying wolf",
	);
}

// The turn the whole mode is built around: a step went wrong, and the lesson
// reacts to what actually happened instead of restarting its plan. The failure
// is canned so the check is about the tutor, not about this machine's Docker.
console.log("\nTurn: a failed check goes back into the lesson…");
const failureMessage = task.verify
	? `That step did not work. The app ran \`${task.verify.argv.join(" ")}\` and it printed:\n\n(nothing at all)\n\nThe container is not running; nothing matched the filter.`
	: 'That step did not work. Here is what happened:\n\ndocker: Error response from daemon: Conflict. The container name "/grafana" is already in use.';
const diagnosis = await runTutorTurnStreaming(
	failureMessage,
	sessionId,
	runtime,
	{
		fork: true,
		onPreview: trace,
	},
);
report("diagnosis", diagnosis, runtime);
console.log(JSON.stringify(diagnosis.card, null, 2));

if (diagnosis.card.type !== "step") {
	fail("a failed step did not get a card back");
}
// Restarting the lesson is the failure mode here: one step went wrong, and the
// outline still stands.
if (diagnosis.outline) {
	fail("the tutor rewrote the outline over a single failed step");
}
if (diagnosis.card.requirements) {
	fail("the tutor started the lesson over instead of diagnosing the step");
}
checkProse("diagnosis card", diagnosis.card);
console.log(
	diagnosis.card.task
		? `  it answers with something to do: ${diagnosis.card.task.command ?? diagnosis.card.task.kind}`
		: "  it answers with an explanation and no new command",
);

const usd = ledger.reduce((sum, entry) => sum + entry.usd, 0);
const seconds = ledger.reduce((sum, entry) => sum + entry.ms, 0) / 1000;
console.log(
	`\n${ledger.length} turns: $${usd.toFixed(2)} · ${seconds.toFixed(0)}s — steady state is the last: $${(ledger.at(-1)?.usd ?? 0).toFixed(2)} · ${((ledger.at(-1)?.ms ?? 0) / 1000).toFixed(0)}s`,
);
console.log("PASS");
