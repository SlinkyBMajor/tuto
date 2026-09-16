// What a card is allowed to carry, and which lessons may carry it.
//
// A card feature is an OPTIONAL, ADDITIVE capability: a field the app renders
// as its own panel under the card body, or a piece of body content the app
// renders specially. Nothing else in the protocol depends on one, so a mode can
// have it or not without anything else changing.
//
// Before this existed, which lessons got which panel was decided by the file
// the prompt text happened to sit in — takeaway and hierarchy lived in
// tutor.md so every mode had them, caution and cost lived in modes/lab.md so
// only lab did, and nothing anywhere said so. Each feature now owns one
// mode-neutral fragment, and each mode names the ones it wants
// (LessonModeSpec.cardFeatures). Turning one off removes its prompt section AND
// drops the field at parse time, so a mode cannot render a panel it disabled
// even if the model emits one.
//
// What is NOT a feature, and why the line is here:
//   - `options`, `prerequisite`, `suggestions` — these belong to a card TYPE
//     and drive what the learner does next, not what the card shows.
//   - `task` — a lab step changes the whole bottom bar, carries a check, and
//     persists its own state. It is the mode, not a panel on it.
//   - Code examples, sentence rules, one idea per card — core teaching. No
//     mode would ever want them off, so putting them here would only add a
//     list to read.
// The test for adding one: can you name a lesson that would want it off?

import cautionPrompt from "../../prompts/features/caution.md";
import costPrompt from "../../prompts/features/cost.md";
import diagramPrompt from "../../prompts/features/diagram.md";
import hierarchyPrompt from "../../prompts/features/hierarchy.md";
import requirementsPrompt from "../../prompts/features/requirements.md";
import takeawayPrompt from "../../prompts/features/takeaway.md";
import type { Card, CardFeatureId } from "../shared/types";

interface CardFeature {
	id: CardFeatureId;
	// The mode-neutral prompt section. A mode that wants to sharpen it says so
	// in its own prompt, which is allowed to be more specific — see the note at
	// the top of prompts/tutor.md.
	prompt: string;
	// The card field this feature adds, where it adds one. A feature without a
	// field is guidance about the body itself (a diagram is markdown inside it),
	// and there is nothing to drop when the feature is off — the prompt simply
	// never asks for it.
	field?: "takeaway" | "hierarchy" | "requirements" | "caution" | "cost";
}

// Order is the order the sections appear in the system prompt, and it is the
// order the panels appear under a card: what the lesson needs, the picture, the
// line to keep, then the two that qualify the doing. Reading the prompt in the
// same order the learner reads the card is worth keeping.
const FEATURES: readonly CardFeature[] = [
	{ id: "requirements", prompt: requirementsPrompt, field: "requirements" },
	{ id: "diagram", prompt: diagramPrompt },
	{ id: "hierarchy", prompt: hierarchyPrompt, field: "hierarchy" },
	{ id: "takeaway", prompt: takeawayPrompt, field: "takeaway" },
	{ id: "caution", prompt: cautionPrompt, field: "caution" },
	{ id: "cost", prompt: costPrompt, field: "cost" },
];

// Every feature there is. A mode wanting all of them says so with this rather
// than by listing them, so a feature added later reaches every mode that did
// not deliberately narrow its set.
export const ALL_CARD_FEATURES: readonly CardFeatureId[] = FEATURES.map(
	(feature) => feature.id,
);

// The prompt sections for one mode's set, in registry order.
export function cardFeaturePrompts(
	enabled: readonly CardFeatureId[],
): string[] {
	const wanted = new Set(enabled);
	return FEATURES.filter((feature) => wanted.has(feature.id)).map(
		(feature) => feature.prompt,
	);
}

// Drop what this lesson never asked for. Belt and braces to the prompt: a model
// that emits a `cost` in a mode without it would otherwise get a panel the
// lesson does not know how to mean.
export function applyCardFeatures(
	card: Card,
	enabled: readonly CardFeatureId[],
): Card {
	const wanted = new Set(enabled);
	const kept = { ...card };
	for (const feature of FEATURES) {
		if (feature.field && !wanted.has(feature.id)) {
			kept[feature.field] = undefined;
		}
	}
	return kept;
}
