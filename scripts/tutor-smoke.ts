// Smoke test for the tutor loop: level question with options, then a step.
// Run with: pnpm run smoke

import { runTutorTurn } from "../src/bun/claude";
import {
	NOTES_ENABLED,
	openingMessage,
	openingRuntimeFor,
	runtimeFor,
} from "../src/bun/lesson-modes";
import type { LessonConfig } from "../src/shared/types";
import { longestSegment, takeawayProblem } from "./card-prose";

// Two sentences of at most 25 words each, plus slack
const MAX_SEGMENT_WORDS = 60;

const config: LessonConfig = { mode: "topic", topic: "Kafka" };
const runtime = runtimeFor(config);

console.log("Turn 1: starting a lesson without stating a level…");
const first = await runTutorTurn(
	await openingMessage(config),
	undefined,
	// The level question runs with no tools in every mode — see openingRuntimeFor
	openingRuntimeFor(config),
);
console.log(JSON.stringify(first.card, null, 2));

if (first.card.type !== "question" || first.card.options?.length !== 3) {
	console.error("FAIL: expected a question card with exactly 3 options");
	process.exit(1);
}

const choice = first.card.options[1];
console.log(`\nTurn 2: answering with option "${choice?.label}"…`);
const second = await runTutorTurn(
	choice?.label ?? "",
	first.sessionId,
	runtime,
);
console.log(JSON.stringify(second.card, null, 2));
console.log("outline:", JSON.stringify(second.outline));

if (second.card.type !== "step") {
	console.error("FAIL: expected a step card after answering the level");
	process.exit(1);
}
if (!second.outline || second.outline.length < 4) {
	console.error("FAIL: expected an outline of at least 4 concepts");
	process.exit(1);
}
if (!second.card.conceptId) {
	console.error("FAIL: expected the step card to carry a conceptId");
	process.exit(1);
}
if (!second.outline.some((item) => item.id === second.card.conceptId)) {
	console.error("FAIL: step conceptId does not match any outline item");
	process.exit(1);
}
// Notes routing is only asked for when the notes document is switched on —
// see NOTES_ENABLED in src/bun/lesson-modes.ts.
if (NOTES_ENABLED && !second.card.notes?.sectionPath?.length) {
	console.error("FAIL: expected the step card to carry notes routing");
	process.exit(1);
}
console.log(
	"notes sectionPath:",
	NOTES_ENABLED
		? JSON.stringify(second.card.notes?.sectionPath)
		: "(notes are switched off)",
);

// The learner steps through a card one section at a time, so a section that
// runs long is as much a failure as a card that runs long
const longest = longestSegment(second.card.body);
if (longest.words > MAX_SEGMENT_WORDS) {
	console.error(
		`FAIL: a section runs to ${longest.words} words (max ${MAX_SEGMENT_WORDS}):\n  ${longest.text}`,
	);
	process.exit(1);
}

// A takeaway is optional by design, so its absence is not a failure — but one
// that arrives has to be the single line it promises to be.
const takeaway = second.card.takeaway;
if (takeaway) {
	const problem = takeawayProblem(takeaway, second.card.title);
	if (problem) {
		console.error(`FAIL: the takeaway ${problem}:\n  ${takeaway}`);
		process.exit(1);
	}
}

const words = second.card.body.split(/\s+/).length;
console.log(`\nsession resumed: ${second.sessionId === first.sessionId}`);
console.log(`turn 2 body word count: ${words}`);
console.log(`longest section: ${longest.words} words`);
console.log(
	`takeaway: ${takeaway ?? "(none — the card had nothing to distil)"}`,
);
console.log("PASS");
