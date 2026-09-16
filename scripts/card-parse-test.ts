// Deterministic, token-free tests for the card-protocol recovery path:
// tolerant parsing (parseReply escaping raw control chars) and last-resort
// salvage (salvageCard pulling title/body from an unparseable reply). Run with:
// pnpm run test:parse

import { ALL_CARD_FEATURES } from "../src/bun/card-features";
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

// The costliest shape of the unescaped-quote failure, and one a real lesson
// produced: the quote is inside a task's command, so the whole reply is
// unparseable and salvage returns a card whose body still talks about a command
// that is no longer attached to it. The learner reads "this command" and is
// shown nothing to type. Pinned here because the blast radius is the point —
// salvage is doing what it was built to do, and the card is still unusable, so
// the fix belongs in whatever made the model emit the quote.
function testQuoteInTaskCommand() {
	const reply = `{"card":{"type":"step","title":"Write the Dockerfile","body":"This command writes the file.","task":{"kind":"edit","command":"CMD ["echo", "hi"]","expect":"Two lines."}}}`;
	expectThrows("a quote inside a task command fails parseReply", () =>
		parseReply(reply),
	);
	const salvaged = salvageCard(reply);
	check("it still salvages a card", salvaged !== undefined);
	check(
		"the body survives, still referring to the command",
		salvaged?.body.includes("This command") ?? false,
	);
	check("and the task is gone with it", salvaged?.task === undefined);
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

// The hierarchy drives an indent and a tree of elbows, so a rung with a silly
// depth or a structure with only one rung has to be turned away rather than
// drawn.
function testHierarchy() {
	const good = `{"card":{"type":"step","title":"Stacks","body":"b","hierarchy":{"levels":[{"name":"Project","depth":0,"note":"a folder"},{"name":"Stack","depth":1},{"name":"Resource","depth":2}],"current":"Stack"}}}`;
	const parsed = parseReply(good).card.hierarchy;
	check("hierarchy parses", parsed?.levels.length === 3);
	check("hierarchy keeps depth", parsed?.levels[2]?.depth === 2);
	check("hierarchy keeps current", parsed?.current === "Stack");
	check("a rung without a note is fine", parsed?.levels[1]?.note === undefined);

	const oneRung = `{"card":{"type":"step","title":"T","body":"b","hierarchy":{"levels":[{"name":"Project","depth":0}]}}}`;
	check(
		"a hierarchy of one rung is not one",
		parseReply(oneRung).card.hierarchy === undefined,
	);

	const runaway = `{"card":{"type":"step","title":"T","body":"b","hierarchy":{"levels":[{"name":"A","depth":0},{"name":"B","depth":40}]}}}`;
	check(
		"a runaway depth is clamped",
		parseReply(runaway).card.hierarchy?.levels[1]?.depth === 5,
	);

	const junk = `{"card":{"type":"step","title":"T","body":"b","hierarchy":{"levels":[{"name":"A","depth":0},{"depth":1},{"name":"  ","depth":1},{"name":"B","depth":1}]}}}`;
	check(
		"nameless rungs are dropped",
		parseReply(junk).card.hierarchy?.levels.length === 2,
	);

	const notAList = `{"card":{"type":"step","title":"T","body":"b","hierarchy":{"levels":"Project > Stack"}}}`;
	check(
		"a hierarchy that is not a list is dropped",
		parseReply(notAList).card.hierarchy === undefined,
	);
}

// The lab fields. A task is what the learner does, so a "run" task with nothing
// to type is worse than no task at all — the card would say "run this" and show
// no command — and an unknown kind would render a step the app cannot label.
function testTask() {
	const withTask = `{"card":{"type":"step","title":"Start Grafana","body":"b","task":{"kind":"run","command":"docker run -d -p 3000:3000 grafana/grafana-oss","expect":"Docker prints a container id."}}}`;
	const task = parseReply(withTask).card.task;
	check("a run task parses", task?.kind === "run");
	check(
		"a run task keeps its command",
		task?.command?.startsWith("docker run") ?? false,
	);
	check(
		"a run task keeps what success looks like",
		task?.expect === "Docker prints a container id.",
	);

	const uiTask = `{"card":{"type":"step","title":"Add a data source","body":"b","task":{"kind":"ui","expect":"The data source page shows a green tick."}}}`;
	check(
		"a ui task needs no command",
		parseReply(uiTask).card.task?.kind === "ui",
	);

	const noCommand = `{"card":{"type":"step","title":"T","body":"b","task":{"kind":"run","expect":"Something happens."}}}`;
	check(
		"a run task with nothing to type is dropped",
		parseReply(noCommand).card.task === undefined,
	);

	const badKind = `{"card":{"type":"step","title":"T","body":"b","task":{"kind":"think","command":"ls"}}}`;
	check(
		"a task of an unknown kind is dropped",
		parseReply(badKind).card.task === undefined,
	);

	const noExpect = `{"card":{"type":"step","title":"T","body":"b","task":{"kind":"run","command":"docker ps"}}}`;
	const bare = parseReply(noExpect).card.task;
	check(
		"a task without an expectation still runs",
		bare?.command === "docker ps",
	);
	check("...and simply has none to draw", bare?.expect === undefined);

	const noTask = `{"card":{"type":"step","title":"T","body":"b"}}`;
	check(
		"a teaching card has no task",
		parseReply(noTask).card.task === undefined,
	);
}

// A check the app is unwilling to run must vanish at parse time, so the card
// falls back to the learner saying how it went. It must never reach the webview
// and never become a question about whether to permit it.
function testVerify() {
	const good = `{"card":{"type":"step","title":"T","body":"b","task":{"kind":"run","command":"docker run -d --name=grafana grafana/grafana-oss","expect":"An id.","verify":{"argv":["docker","ps","--filter","name=grafana"],"expect":"One line starting with Up."}}}}`;
	const verify = parseReply(good).card.task?.verify;
	check("an allowed check parses", verify?.argv[0] === "docker");
	check(
		"it keeps what the output should show",
		verify?.expect?.startsWith("One line") ?? false,
	);

	const mutating = `{"card":{"type":"step","title":"T","body":"b","task":{"kind":"run","command":"x","expect":"y","verify":{"argv":["docker","rm","-f","grafana"],"expect":"gone"}}}}`;
	const dropped = parseReply(mutating).card.task;
	check("a mutating check is dropped", dropped?.verify === undefined);
	check("...and the task itself survives", dropped?.command === "x");

	const shell = `{"card":{"type":"step","title":"T","body":"b","task":{"kind":"run","command":"x","expect":"y","verify":{"argv":["bash","-c","docker ps"],"expect":"z"}}}}`;
	check(
		"a shell is dropped",
		parseReply(shell).card.task?.verify === undefined,
	);

	const remote = `{"card":{"type":"step","title":"T","body":"b","task":{"kind":"run","command":"x","expect":"y","verify":{"argv":["curl","-s","https://example.com"],"expect":"z"}}}}`;
	check(
		"a request to another host is dropped",
		parseReply(remote).card.task?.verify === undefined,
	);

	const shellString = `{"card":{"type":"step","title":"T","body":"b","task":{"kind":"run","command":"x","expect":"y","verify":{"argv":"docker ps | grep grafana","expect":"z"}}}}`;
	check(
		"a command line rather than an argv array is dropped",
		parseReply(shellString).card.task?.verify === undefined,
	);

	const noExpect = `{"card":{"type":"step","title":"T","body":"b","task":{"kind":"run","command":"x","expect":"y","verify":{"argv":["docker","ps"]}}}}`;
	check(
		"a check with nothing to judge it against is dropped",
		parseReply(noExpect).card.task?.verify === undefined,
	);

	const plain = `{"card":{"type":"step","title":"T","body":"b","task":{"kind":"run","command":"x","expect":"y"}}}`;
	check(
		"a task without a check simply has none",
		parseReply(plain).card.task?.verify === undefined,
	);
}

// Caution and cost are single lines the app draws as panels of their own, on
// the same terms as a takeaway: usable text or nothing at all.
function testCautionAndCost() {
	const both = `{"card":{"type":"step","title":"T","body":"b","caution":"Check your kubectl context first.","cost":"Free. The cluster bills ~$0.10/hour if left running."}}`;
	const card = parseReply(both).card;
	check("caution parses", card.caution === "Check your kubectl context first.");
	check("cost parses", card.cost?.startsWith("Free.") ?? false);

	const blank = `{"card":{"type":"step","title":"T","body":"b","caution":"  ","cost":42}}`;
	const empty = parseReply(blank).card;
	check("a whitespace-only caution is dropped", empty.caution === undefined);
	check("a non-string cost is dropped", empty.cost === undefined);
}

// The requirements checklist is read before the lesson starts, so a row the app
// cannot draw an icon for is dropped rather than rendered blank.
function testRequirements() {
	const plan = `{"card":{"type":"step","title":"What we will build","body":"b","requirements":[{"name":"Docker Desktop","kind":"install","detail":"Free for personal use","cost":"free"},{"name":"Time","kind":"time","detail":"About 45 minutes"}]}}`;
	const rows = parseReply(plan).card.requirements;
	check("requirements parse", rows?.length === 2);
	check("a requirement keeps its kind", rows?.[0]?.kind === "install");
	check("a requirement keeps its cost badge", rows?.[0]?.cost === "free");
	check("a requirement without a cost has none", rows?.[1]?.cost === undefined);

	const junk = `{"card":{"type":"step","title":"T","body":"b","requirements":[{"name":"A","kind":"install"},{"name":"B","kind":"vibes"},{"kind":"time"}]}}`;
	check(
		"a requirement of an unknown kind is dropped",
		parseReply(junk).card.requirements?.length === 1,
	);

	const notAList = `{"card":{"type":"step","title":"T","body":"b","requirements":"Docker"}}`;
	check(
		"requirements that are not a list are dropped",
		parseReply(notAList).card.requirements === undefined,
	);

	const allJunk = `{"card":{"type":"step","title":"T","body":"b","requirements":[{"name":"B","kind":"vibes"}]}}`;
	check(
		"a checklist with nothing drawable in it is dropped",
		parseReply(allJunk).card.requirements === undefined,
	);
}

// A mode says what a card of its lessons may carry (LessonModeSpec.cardFeatures).
// The prompt asks for exactly those, and the parser drops the rest — so a mode
// cannot render a panel it disabled, however the model replies.
function testCardFeatures() {
	const everything = `{"card":{"type":"step","title":"T","body":"b","takeaway":"One line worth keeping.","hierarchy":{"levels":[{"name":"A","depth":0},{"name":"B","depth":1}]},"caution":"Check first.","cost":"Free.","requirements":[{"name":"Time","kind":"time"}]}}`;

	const all = parseReply(everything, ALL_CARD_FEATURES).card;
	check(
		"with every feature on, every panel survives",
		Boolean(
			all.takeaway &&
				all.hierarchy &&
				all.caution &&
				all.cost &&
				all.requirements,
		),
	);

	const spare = parseReply(everything, ["takeaway"]).card;
	check("a mode with only takeaway keeps it", spare.takeaway !== undefined);
	check("...and loses the hierarchy", spare.hierarchy === undefined);
	check("...and the caution", spare.caution === undefined);
	check("...and the cost", spare.cost === undefined);
	check("...and the requirements", spare.requirements === undefined);

	const none = parseReply(everything, []).card;
	check(
		"a mode with no features keeps the card itself",
		none.title === "T" && none.body === "b",
	);
	check(
		"...and none of the panels",
		none.takeaway === undefined &&
			none.hierarchy === undefined &&
			none.caution === undefined &&
			none.cost === undefined &&
			none.requirements === undefined,
	);

	// A diagram is markdown inside the body, not a field: turning the feature
	// off stops the prompt asking for one, and never mutilates a body that has
	// one anyway.
	const withDiagram = `{"card":{"type":"step","title":"T","body":"before\n\n\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\`\n\nafter"}}`;
	check(
		"a body keeps its diagram even with the feature off",
		parseReply(withDiagram, []).card.body.includes("mermaid"),
	);

	// The default is everything, so a caller with no lesson in hand (this file)
	// sees the whole protocol.
	check(
		"the default is every feature",
		parseReply(everything).card.takeaway !== undefined,
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
testQuoteInTaskCommand();
testTruncated();
testTakeaway();
testPrerequisite();
testHierarchy();
testTask();
testVerify();
testCardFeatures();
testCautionAndCost();
testRequirements();
testProseOnly();

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log("\nPASS");
