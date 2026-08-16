// Smoke test for the prerequisite path. Three first turns, no full lessons:
// the offer has to fire on a subject built on another one, stay quiet on a
// subject that is itself the ground, and a lesson taken as groundwork has to
// skip the level question and plan straight away.
//
// The subjects are deliberately NOT the ones prompts/tutor.md uses as its
// examples — a test the prompt answers by quoting itself measures nothing.
//
// Run with: pnpm run smoke:prerequisite

import { runTutorTurn } from "../src/bun/claude";
import { openingMessage, runtimeFor } from "../src/bun/lesson-modes";
import type { LessonConfig } from "../src/shared/types";

let failures = 0;

function fail(message: string) {
	failures++;
	console.error(`FAIL: ${message}`);
}

async function firstCard(config: LessonConfig) {
	return runTutorTurn(
		await openingMessage(config),
		undefined,
		runtimeFor(config),
	);
}

// Rests on something: an operator is a Kubernetes controller, so a learner who
// has never met Kubernetes cannot start here.
console.log("1. A subject built on another one…");
const built = await firstCard({ mode: "topic", topic: "Kubernetes operators" });
const offer = built.card.prerequisite;
console.log(
	offer
		? `   offered: ${offer.topic}\n   reason:  ${offer.reason}`
		: "   offered: (none)",
);
if (built.card.type !== "question") {
	fail("expected a level question for a plain topic lesson");
} else if (!offer) {
	fail("no prerequisite offered for Kubernetes operators");
} else if (built.card.options?.length !== 3) {
	fail("the offer must ride on a level question that still has its 3 options");
}

// Ground of its own: nothing below it a lesson should detour through.
console.log("\n2. A subject that is itself the ground…");
const ground = await firstCard({
	mode: "topic",
	topic: "Regular expressions",
});
console.log(
	ground.card.prerequisite
		? `   offered: ${ground.card.prerequisite.topic}`
		: "   offered: (none)",
);
if (ground.card.prerequisite) {
	fail(
		`a detour was offered for a foundational subject: ${ground.card.prerequisite.topic}`,
	);
}

// Taking the detour: asking for the groundwork already says where the learner
// is starting from, so this turn plans instead of asking.
console.log("\n3. The groundwork lesson itself…");
const groundwork = await firstCard({
	mode: "topic",
	topic: "Kubernetes",
	goal: { topic: "Kubernetes operators" },
});
console.log(`   card type: ${groundwork.card.type}`);
console.log(
	`   outline:   ${JSON.stringify(groundwork.outline?.map((i) => i.title))}`,
);
if (groundwork.card.type === "question") {
	fail("a lesson taken as groundwork asked the level question anyway");
}
if (!groundwork.outline || groundwork.outline.length < 3) {
	fail("expected the groundwork lesson to plan an outline on its first turn");
}
if (groundwork.card.prerequisite) {
	fail("a groundwork lesson offered a prerequisite of its own — never a chain");
}

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log("\nPASS");
