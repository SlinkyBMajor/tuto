// Checks the smoke tests run over a card's prose. Both of the things measured
// here were reported from real lessons: sections too long to step through, and
// citations pointing at line numbers the learner cannot see.

// How the app segments a card for reading: the arrow keys land on one paragraph
// or one list item at a time, and highlight it alone. Measuring the same
// segments the learner walks is what makes "the sections are too long" a thing
// a test can catch. Code blocks are not segments and are dropped.
export function segments(body: string): string[] {
	return body
		.replace(/```[\s\S]*?```/g, "")
		.split(/\n\s*\n/)
		.flatMap((block) =>
			/^\s*(?:[-*+]|\d+\.)\s/m.test(block) ? block.split("\n") : [block],
		)
		.map((segment) => segment.trim())
		.filter(Boolean);
}

export function longestSegment(body: string): { text: string; words: number } {
	let worst = { text: "", words: 0 };
	for (const text of segments(body)) {
		const words = text.split(/\s+/).length;
		if (words > worst.words) worst = { text, words };
	}
	return worst;
}

// A takeaway is one line the learner keeps, shown in a panel under the card and
// filed into the notes. It is optional — most cards have none — so the smoke
// tests never require one; they check the shape of the ones that arrive.
const MAX_TAKEAWAY_WORDS = 24;

// Reporting on the lesson instead of stating the claim: "this card explained
// retention" tells the learner nothing they can carry away, and neither does
// "understanding retention is important". Both were what the field produced
// before the prompt spelled the distinction out.
const REPORTS_ON_THE_LESSON =
	/^(?:in )?(?:this|the) (?:card|lesson|section)\b|^(?:you|we) (?:just )?(?:saw|learned|learnt|covered)\b|\bis (?:important|key|essential) to (?:understand|remember|know)\b/i;

export function takeawayProblem(
	takeaway: string,
	cardTitle: string,
): string | undefined {
	const text = takeaway.trim();
	const words = text.split(/\s+/).length;
	if (words > MAX_TAKEAWAY_WORDS) {
		return `runs to ${words} words (max ${MAX_TAKEAWAY_WORDS})`;
	}
	if (text.includes("```")) return "carries a code block";
	if (text.includes("\n")) return "spans more than one line";
	if (text.includes("[[card:")) return "carries a card reference";
	if (REPORTS_ON_THE_LESSON.test(text)) {
		return "reports on the lesson instead of stating the claim";
	}
	// Punctuation and case aside, a takeaway that is the title again has
	// distilled nothing.
	const plain = (value: string) =>
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.trim();
	if (plain(text) === plain(cardTitle)) return "restates the card title";
	return undefined;
}

// A pointer the learner cannot follow: "line 44", or a `path.ts:18-32` citation.
// They are reading a card, not the file, and the number is wrong as soon as
// somebody edits above it.
export function lineNumberReference(body: string): string | undefined {
	return /\b(?:lines?)\s+\d+|\.\w{1,5}:\d+/i.exec(body)?.[0];
}
