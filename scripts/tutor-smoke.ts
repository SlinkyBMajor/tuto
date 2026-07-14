// Smoke test for the tutor loop: level question with options, then a step.
// Run with: pnpm run smoke
import { runTutorTurn } from "../src/bun/claude";

console.log("Turn 1: starting a lesson without stating a level…");
const first = await runTutorTurn("I want to learn about: Kafka");
console.log(JSON.stringify(first.card, null, 2));

if (first.card.type !== "question" || first.card.options?.length !== 3) {
	console.error("FAIL: expected a question card with exactly 3 options");
	process.exit(1);
}

const choice = first.card.options[1];
console.log(`\nTurn 2: answering with option "${choice?.label}"…`);
const second = await runTutorTurn(choice?.label ?? "", first.sessionId);
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

const words = second.card.body.split(/\s+/).length;
console.log(`\nsession resumed: ${second.sessionId === first.sessionId}`);
console.log(`turn 2 body word count: ${words}`);
console.log("PASS");
