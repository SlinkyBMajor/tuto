// Deterministic, token-free tests for the card-protocol recovery path:
// tolerant parsing (parseReply escaping raw control chars) and last-resort
// salvage (salvageCard pulling title/body from an unparseable reply). Run with:
// pnpm run test:parse
import { parseReply, salvageCard } from "../src/bun/claude";

let failures = 0;

function check(name: string, cond: boolean, detail?: string) {
	if (cond) {
		console.log(`  ok  ${name}`);
	} else {
		failures++;
		console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

function expectThrows(name: string, fn: () => unknown) {
	try {
		fn();
		failures++;
		console.error(`FAIL  ${name} — expected it to throw`);
	} catch {
		console.log(`  ok  ${name}`);
	}
}

// A well-formed card parses (baseline).
function testValidCard() {
	const valid = `{"card":{"type":"step","conceptId":"x","title":"Valid","body":"line1\\nline2","notes":{"sectionPath":["A","B"]}}}`;
	const { card } = parseReply(valid);
	check("valid card parses", card.title === "Valid");
	check("valid card keeps escaped newline", card.body === "line1\nline2");
	check(
		"valid card keeps notes routing",
		JSON.stringify(card.notes?.sectionPath) === JSON.stringify(["A", "B"]),
	);
}

// A RAW newline left unescaped inside the body is the most common break.
// Tolerant parse must recover the whole card, not just a fragment.
function testRawNewline() {
	const rawNewline = `{"card":{"type":"step","conceptId":"pods","title":"Pods hold containers","body":"A pod groups containers.
They share one network.","notes":{"sectionPath":["Pods"]}}}`;
	expectThrows("raw newline is not valid strict JSON", () =>
		JSON.parse(rawNewline),
	);
	const { card } = parseReply(rawNewline);
	check("raw newline recovers title", card.title === "Pods hold containers");
	check(
		"raw newline recovers full body",
		card.body.includes("A pod groups containers.") &&
			card.body.includes("They share one network."),
	);
	check("raw newline body keeps the break", card.body.includes("\n"));
	check("raw newline recovers conceptId", card.conceptId === "pods");
	check(
		"raw newline recovers notes routing",
		JSON.stringify(card.notes?.sectionPath) === JSON.stringify(["Pods"]),
	);
}

// Tolerant parse keeps every structured extra (outline + exercise), not just
// the card, even when the body carries a raw newline.
function testExtrasSurvive() {
	const withExtras = `{"card":{"type":"step","conceptId":"pods","title":"T","body":"para one.
para two.","notes":{"sectionPath":["Pods"]}},"outline":[{"id":"pods","title":"Pods"},{"id":"svc","title":"Services"}],"exercise":{"conceptId":"pods","question":"Q?","code":{"language":"js","source":"a ____ b"},"answer":"x"}}`;
	const { outline, exercise } = parseReply(withExtras);
	check("extras: outline survives", outline?.length === 2);
	check("extras: exercise survives", exercise?.answer === "x");
}

// A raw tab inside the body is escaped too.
function testRawTab() {
	const rawTab = `{"card":{"type":"step","title":"Tabs","body":"before\tafter"}}`;
	const { card } = parseReply(rawTab);
	check("raw tab recovers body", card.body.includes("before"));
	check("raw tab keeps the tab", card.body.includes("\t"));
}

// A card wrapped in a ```json fence still parses (outermost braces).
function testFenced() {
	const fenced =
		'```json\n{"card":{"type":"step","title":"Fenced","body":"ok"}}\n```';
	const { card } = parseReply(fenced);
	check("fenced card parses", card.title === "Fenced");
}

// An unescaped inner quote can't be placed, so parseReply gives up — but
// salvage still rescues the title.
function testInnerQuote() {
	const innerQuote = `{"card":{"type":"step","title":"Quoting","body":"He said "hi" loudly."}}`;
	expectThrows("unescaped quote fails parseReply", () =>
		parseReply(innerQuote),
	);
	const salvaged = salvageCard(innerQuote);
	check("unescaped quote salvages a card", salvaged !== undefined);
	check("unescaped quote salvages the title", salvaged?.title === "Quoting");
	check("salvaged card defaults to step", salvaged?.type === "step");
}

// A truncated reply (no closing brace) — parseReply can't, salvage keeps the
// partial content the learner watched stream in.
function testTruncated() {
	const truncated = `{"card":{"type":"step","title":"Cut off","body":"This got cut before the`;
	expectThrows("truncated reply fails parseReply", () => parseReply(truncated));
	const salvaged = salvageCard(truncated);
	check("truncated reply salvages a card", salvaged !== undefined);
	check("truncated reply salvages the title", salvaged?.title === "Cut off");
	check(
		"truncated reply salvages the partial body",
		salvaged?.body.startsWith("This got cut") ?? false,
	);
}

// The takeaway is a plain string on the card, so it must survive the tolerant
// parse and the salvage the same way the title and body do — and a card without
// one (the normal case) must not grow an empty panel.
function testTakeaway() {
	const withTakeaway = `{"card":{"type":"step","title":"Protobuf schemas","body":"para one.
para two.","takeaway":"A \`.proto\` file describes the shape of the data, not how it travels."}}`;
	const { card } = parseReply(withTakeaway);
	check(
		"takeaway survives the tolerant parse",
		card.takeaway?.startsWith("A `.proto` file describes") ?? false,
		card.takeaway,
	);

	const noTakeaway = `{"card":{"type":"step","title":"T","body":"b"}}`;
	check(
		"a card without a takeaway has none",
		parseReply(noTakeaway).card.takeaway === undefined,
	);

	const blank = `{"card":{"type":"step","title":"T","body":"b","takeaway":"   "}}`;
	check(
		"a whitespace-only takeaway is dropped",
		parseReply(blank).card.takeaway === undefined,
	);

	const wrongType = `{"card":{"type":"step","title":"T","body":"b","takeaway":["a","b"]}}`;
	check(
		"a non-string takeaway is dropped",
		parseReply(wrongType).card.takeaway === undefined,
	);

	const truncated = `{"card":{"type":"step","title":"Cut off","body":"body text","takeaway":"The broker keeps the message`;
	const salvaged = salvageCard(truncated);
	check(
		"salvage recovers a partial takeaway",
		salvaged?.takeaway === "The broker keeps the message",
		salvaged?.takeaway,
	);
}

// The prerequisite offer replaces the lesson, so it is honoured only on the
// question card it belongs to, and only when it carries both of its fields.
function testPrerequisite() {
	const onQuestion = `{"card":{"type":"question","title":"Where are you starting from?","body":"So I can pitch this right:","options":[{"id":"beginner","label":"New to it"}],"prerequisite":{"topic":"Infrastructure as code","reason":"Pulumi is one way of writing it."}}}`;
	check(
		"a question card keeps its prerequisite",
		parseReply(onQuestion).card.prerequisite?.topic ===
			"Infrastructure as code",
	);

	const onStep = `{"card":{"type":"step","title":"T","body":"b","prerequisite":{"topic":"X","reason":"Y"}}}`;
	check(
		"a step card drops a prerequisite",
		parseReply(onStep).card.prerequisite === undefined,
	);

	const halfOffer = `{"card":{"type":"question","title":"T","body":"b","prerequisite":{"topic":"X"}}}`;
	check(
		"a prerequisite missing its reason is dropped",
		parseReply(halfOffer).card.prerequisite === undefined,
	);

	const blankOffer = `{"card":{"type":"question","title":"T","body":"b","prerequisite":{"topic":"  ","reason":"Y"}}}`;
	check(
		"a prerequisite with a blank topic is dropped",
		parseReply(blankOffer).card.prerequisite === undefined,
	);
}

// A reply with no card at all yields no salvage.
function testProseOnly() {
	check(
		"prose-only reply salvages nothing",
		salvageCard("Sorry, I can't do that right now.") === undefined,
	);
}

testValidCard();
testRawNewline();
testExtrasSurvive();
testRawTab();
testFenced();
testInnerQuote();
testTruncated();
testTakeaway();
testPrerequisite();
testProseOnly();

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log("\nPASS");
