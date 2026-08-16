// Smoke test for a codebase lesson: point it at a project and watch the tutor
// read its way to a level question, then to an outline of that project's real
// parts. Checks the things the mode exists for — that the tutor actually opens
// files, and that its cards cite them.
//
// Run with: pnpm run smoke:codebase /path/to/project
import { runTutorTurnStreaming, type TurnCost } from "../src/bun/claude";
import { openingMessage, runtimeFor } from "../src/bun/lesson-modes";
import { describeProject } from "../src/bun/project";
import type { LessonConfig } from "../src/shared/types";
import {
	lineNumberReference,
	longestSegment,
	takeawayProblem,
} from "./card-prose";

// Two sentences of at most 25 words each, plus slack. A section longer than
// this is one the learner cannot take in a step at a time.
const MAX_SEGMENT_WORDS = 60;

const [pathArg, ...questionWords] = process.argv.slice(2);
if (!pathArg) {
	console.error("usage: pnpm run smoke:codebase <project-path> [question…]");
	process.exit(1);
}

const found = await describeProject(pathArg);
if (!found.project) {
	console.error(`FAIL: ${found.error}`);
	process.exit(1);
}

const config: LessonConfig = {
	mode: "codebase",
	topic: questionWords.join(" ") || "how authentication works",
	project: found.project,
};
const runtime = runtimeFor(config);
console.log(`project: ${found.project.path}`);
console.log(`question: ${config.topic}\n`);

// What the app shows while it waits; here it doubles as proof the tutor is
// reading the project rather than answering from memory.
const activity: string[] = [];
function trace(preview: { activity?: string }) {
	const line = preview.activity;
	if (line && line !== activity.at(-1)) {
		activity.push(line);
		console.log(`  · ${line}`);
	}
}

// A takeaway is optional — most cards have none — so this never fails a run for
// its absence, only for a takeaway that is not the one line it promises.
function checkTakeaway(
	label: string,
	card: { title: string; takeaway?: string },
) {
	if (!card.takeaway) {
		console.log(`  ${label} takeaway: (none)`);
		return;
	}
	const problem = takeawayProblem(card.takeaway, card.title);
	if (problem) {
		console.error(
			`FAIL: the ${label} takeaway ${problem}:\n  ${card.takeaway}`,
		);
		process.exit(1);
	}
	console.log(`  ${label} takeaway: ${card.takeaway}`);
}

// A codebase turn costs real money and real minutes. Print both per turn, so a
// change to the mode can be judged rather than guessed at.
const ledger: TurnCost[] = [];
function report(label: string, turn: { cost?: TurnCost }) {
	if (!turn.cost) return;
	ledger.push(turn.cost);
	const { usd, ms, steps } = turn.cost;
	console.log(
		`\n  ${label}: $${usd.toFixed(3)} · ${(ms / 1000).toFixed(0)}s · ${steps} model steps`,
	);
}

console.log("Turn 1: opening the lesson…");
const first = await runTutorTurnStreaming(
	await openingMessage(config),
	undefined,
	runtime,
	{ onPreview: trace },
);
report("turn 1", first);
console.log(JSON.stringify(first.card, null, 2));

// The level question is answerable from the project map alone. Reading for it
// is the expensive mistake this mode is tuned against, so say so loudly rather
// than failing — model behaviour varies, and a lesson that reads a file here
// is wasteful, not broken.
if (activity.length > 2) {
	console.warn(
		`\n  ! turn 1 opened ${activity.length} files to ask a level question; the map should have been enough`,
	);
}
if (first.card.type !== "question" || first.card.options?.length !== 3) {
	console.error("FAIL: expected a question card with exactly 3 options");
	process.exit(1);
}

const choice = first.card.options[1];
console.log(`\nTurn 2: answering with option "${choice?.label}"…`);
const second = await runTutorTurnStreaming(
	choice?.label ?? "",
	first.sessionId,
	runtime,
	{ fork: true, onPreview: trace },
);
report("turn 2", second);
console.log(JSON.stringify(second.card, null, 2));
console.log("outline:", JSON.stringify(second.outline));

if (activity.length === 0) {
	console.error("FAIL: the tutor never opened a file");
	process.exit(1);
}
if (second.card.type !== "step") {
	console.error("FAIL: expected a step card after answering the level");
	process.exit(1);
}
if (!second.outline || second.outline.length < 4) {
	console.error("FAIL: expected an outline of at least 4 concepts");
	process.exit(1);
}
// The point of the mode: a claim the learner can check against their own tree
if (!/[\w./-]+\.\w+/.test(second.card.body)) {
	console.error("FAIL: the step card cites no file from the project");
	process.exit(1);
}
// A card is read one segment at a time. Both of these were reported from real
// lessons, so they fail the run rather than warn.
const pointer = lineNumberReference(second.card.body);
if (pointer) {
	console.error(
		`FAIL: the card points at "${pointer}" — a line the learner cannot see`,
	);
	process.exit(1);
}
const longest = longestSegment(second.card.body);
if (longest.words > MAX_SEGMENT_WORDS) {
	console.error(
		`FAIL: a section runs to ${longest.words} words (max ${MAX_SEGMENT_WORDS}):\n  ${longest.text}`,
	);
	process.exit(1);
}
console.log(`longest section: ${longest.words} words`);
checkTakeaway("turn 2", second.card);

// The third turn is the one that matters for what a lesson costs. Turn 2 plans
// the whole outline and is the expensive one by design; every Continue after it
// teaches one more step from a session that already holds the research. A
// twenty-card lesson is one of turn 2 and nineteen of these.
const planningLookups = activity.length;
console.log("\nTurn 3: Continue — the steady state…");
const third = await runTutorTurnStreaming(
	"continue",
	second.sessionId,
	runtime,
	{
		fork: true,
		onPreview: trace,
	},
);
report("turn 3", third);
console.log(JSON.stringify(third.card, null, 2));

if (third.card.type !== "step") {
	console.error("FAIL: expected another step card on Continue");
	process.exit(1);
}
const laterPointer = lineNumberReference(third.card.body);
if (laterPointer) {
	console.error(
		`FAIL: the card points at "${laterPointer}" — a line the learner cannot see`,
	);
	process.exit(1);
}
const laterLongest = longestSegment(third.card.body);
if (laterLongest.words > MAX_SEGMENT_WORDS) {
	console.error(
		`FAIL: a section runs to ${laterLongest.words} words (max ${MAX_SEGMENT_WORDS}):\n  ${laterLongest.text}`,
	);
	process.exit(1);
}

checkTakeaway("turn 3", third.card);

const usd = ledger.reduce((sum, entry) => sum + entry.usd, 0);
const seconds = ledger.reduce((sum, entry) => sum + entry.ms, 0) / 1000;
console.log(
	`\nlookups: ${planningLookups} to plan, ${activity.length - planningLookups} for the next card`,
);
console.log(
	`three turns: $${usd.toFixed(2)} · ${seconds.toFixed(0)}s — steady state is turn 3: $${(ledger.at(-1)?.usd ?? 0).toFixed(2)} · ${((ledger.at(-1)?.ms ?? 0) / 1000).toFixed(0)}s`,
);
console.log("PASS");
