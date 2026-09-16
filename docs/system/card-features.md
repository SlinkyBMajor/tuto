# Card features

What a card is allowed to carry, and which lessons may carry it. The registry is `src/bun/card-features.ts`; each feature's prompt section is one file in `prompts/features/`; each mode names the set it wants in `LessonModeSpec.cardFeatures`.

Six today: `requirements`, `diagram`, `hierarchy`, `takeaway`, `caution`, `cost`. All three modes currently have all six.

## What a feature is

An **optional, additive capability**: a field the app renders as its own panel under the card body, or a piece of body content it renders specially. Nothing else in the protocol depends on one, so a mode can have it or not and nothing else changes.

The test for adding one is a question, not a feeling: **can you name a lesson that would want it off?** If not, it is core teaching and belongs in `prompts/tutor.md`.

What is deliberately *not* a feature:

- **`options`, `prerequisite`, `suggestions`** — these belong to a card *type* and drive what the learner does next, not what the card shows.
- **`task`** — a lab step changes the whole key bar, carries a check, and persists its own state across a resume. It is the mode, not a panel on it.
- **Code examples, the sentence rules, one idea per card** — no mode would ever want them off, so listing them would only add a list to read.

## Why it exists

Before this, which lessons got which panel was decided by **the file the prompt text happened to sit in**. Takeaway and hierarchy lived in `tutor.md`, so every mode had them. Caution, cost and requirements lived in `modes/lab.md`, so only lab did. Nothing anywhere stated that, and changing it meant moving prose between files and rewriting it for a different audience.

The runtime half of a mode was already a proper registry — tools, timeouts, model, prefetch, working directory, opening message all sit in one spec and are one line each. The protocol half had nothing. This is that half, in the same place: `cardFeatures` is a field on `LessonModeSpec` beside `tools`, because it is the same kind of statement about what a lesson may do.

## How it works

- **The prompt is assembled per mode.** `systemPromptFor` is `tutor.md` + the enabled features' sections, in registry order + the mode's own section. A mode without a feature never sees its section, so those tokens are not spent and the tutor is never told the field exists.
- **The parser drops what was not enabled.** `parseReply(text, features)` runs `applyCardFeatures` over the card, so a mode cannot render a panel it disabled even if the model emits one anyway. The salvage path goes through the same gate. This is belt and braces to the prompt, in the pattern `verify.ts` already uses for check commands: state the rule to the model, then enforce it in code.
- **A feature with no field is prompt-only.** `diagram` is markdown inside the body, so there is nothing to drop — turning it off stops the prompt asking, and never mutilates a body that has one anyway.
- **Order is deliberate.** The registry order is the order the sections appear in the prompt *and* the order the panels appear under a card: what the lesson needs, the picture, the line to keep, then the two that qualify the doing.

## Shared fragment, mode-specific sharpening

Each fragment is written **mode-neutrally** — it defines the field and the general rule. A mode that wants more says so in its own section, which is allowed to be more specific (see the note at the top of `prompts/tutor.md`). `prompts/features/requirements.md` says most lessons need no list at all; `prompts/modes/lab.md` says a lab always has one, that `install` rows come from the machine report, and that a `workspace` row is what creates the folder. Both are true, and neither belongs in the other's file.

This is the same split `tutor.md` + `modes/*.md` already used. The registry did not invent a layering; it gave the third layer a home.

## Adding one

1. `prompts/features/<id>.md` — the section, mode-neutral, introducing its own field with a JSON example.
2. `CardFeatureId` in `src/shared/types.ts`, and the field on `Card` if it has one.
3. A parser in `claude.ts` and the entry in `FEATURES` (with `field` when it has one).
4. A render block in `App.tsx` and a panel style in `index.css` — the panel carries `[data-segment]` so reading, questions and sticky notes reach it with no new wiring (see `reading.md`).
5. Add the id to the modes that want it, and a case to `testCardFeatures` in `scripts/card-parse-test.ts`.

Nothing about step 5 is automatic on purpose: a mode's set is a decision, and a feature that quietly appears everywhere is how the last arrangement stopped being legible.

## One known rough edge

`hierarchy.md` ends with a rule about the takeaway ("a card carrying a hierarchy usually does not also carry a takeaway"). If a mode ever enables one without the other, that sentence points at something the tutor was never told about. Harmless — it reads as a rule about a field it will not use — and cheaper than a cross-reference mechanism nothing else needs.
