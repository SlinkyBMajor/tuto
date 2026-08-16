// Cross-references between cards.
//
// A card points back at earlier material by NAME, never by position. The tutor
// has no card index to count from — on resume it sees its own prior turns and
// nothing else — and the feed also holds the learner's own messages, so "card
// 2" and feed[2] are not the same thing. The marker it writes instead carries
// the exact title of an earlier card:
//
//   The handler in [[card:One handler does everything]] returned `full_name`.
//
// The marker has to survive two different renderings, so both live here:
//   - the feed resolves it to a chip that scrolls to that card (card-markdown)
//   - the notes document has no cards, only sections, so it degrades to bold
//     text before the body is filed (src/bun/index.ts)

// Titles are at most 8 plain words, so a marker never spans a line.
const CARD_REF = /\[\[card:[ \t]*([^\]\n]+?)[ \t]*\]\]/g;

// A marker the tutor is still streaming has no closing bracket yet. Dropping
// the tail keeps a half-written reference out of the live preview.
const PARTIAL_CARD_REF = /\[\[(?:c|ca|car|card|card:[^\]\n]*)?$/;

// Card refs travel through the markdown renderer as links under this scheme,
// which is why they must not collide with a href a card could legitimately
// contain.
export const CARD_REF_HREF = "#card-";

// Match on a normalised title rather than an exact string: the tutor copies the
// title back by hand, so case and punctuation drift. Deliberately separate from
// headingId in card-markdown.tsx — that one keys the notes table of contents,
// and the two must stay free to change apart.
export function cardRefSlug(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

// Fenced blocks and inline spans are the card's code samples, and their
// contents are literal — a marker there is text the learner is meant to read as
// typed, not a reference. Rewriting inside one would also corrupt the sample,
// since markdown does not parse links in code.
const CODE = /```[\s\S]*?```|`[^`\n]*`/g;

function rewriteProse(body: string, transform: (prose: string) => string) {
	let out = "";
	let cursor = 0;
	for (const code of body.matchAll(CODE)) {
		out += transform(body.slice(cursor, code.index)) + code[0];
		cursor = code.index + code[0].length;
	}
	return out + transform(body.slice(cursor));
}

// Feed rendering: rewrite markers as markdown links so react-markdown does the
// parsing, and the anchor override turns them into chips. The title is the link
// text, so a reference that fails to resolve still reads as the words the tutor
// wrote.
export function linkCardRefs(body: string): string {
	return rewriteProse(body, (prose) =>
		prose
			.replace(
				CARD_REF,
				(_marker, title: string) =>
					`[${title.replace(/[[\]]/g, "\\$&")}](${CARD_REF_HREF}${cardRefSlug(title)})`,
			)
			.replace(PARTIAL_CARD_REF, ""),
	);
}

// Notes rendering: the document is a section tree with no cards to link to, so
// the reference becomes the plain name of the material it points at.
export function stripCardRefs(body: string): string {
	return rewriteProse(body, (prose) =>
		prose
			.replace(CARD_REF, (_marker, title: string) => `**${title}**`)
			.replace(PARTIAL_CARD_REF, ""),
	);
}
