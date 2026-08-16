# Starting further back

Some subjects sit on top of another one. A learner who asks for Pulumi without knowing infrastructure as code, or for Kubernetes operators without knowing Kubernetes, gets a lesson that spends every card explaining the thing underneath. The level question can therefore carry a fourth answer: **start me one step back** — which runs a lesson on the ground first and brings the learner back afterwards.

Two halves, in `prompts/tutor.md` ("Starting further back" and "A lesson that leads somewhere"), `Prerequisite` / `LessonGoal` in `src/shared/types.ts`, `startPrerequisite` / `startGoal` / `PrerequisiteOffer` in `src/mainview/App.tsx`.

## The offer

`Card.prerequisite` is `{ topic, reason }` — two facts, not UI copy. The app writes the button ("Start with *topic*"), the promise ("We'll come back to *X* after"), and the divider; the tutor supplies only the subject and the relationship. That way the offer says the same thing in every lesson and cannot promise something the app does not then do.

**The bar is structural, not a judgement about difficulty.** An early version asked "would the least experienced learner who could still follow this lesson exist?" — and the model answered honestly that they always do, so the offer never fired. What works is anchoring it to something the tutor is already writing: *look at the beginner option's description; if it assumes some other named subject, that subject is the prerequisite.* "I've used Kubernetes but never written an operator" assumes Kubernetes and earns an offer; "I've never written one" assumes nothing and does not. The rest of the prompt fences off the silly answers — a whole discipline, a category, a tool everyone has, or knowledge that merely helps.

`parseReply` keeps a prerequisite **only on a question card**, and only when both fields are non-empty. Taking the offer throws the current lesson away, which is right under an unanswered level question and destructive anywhere else — so a step card that carries one has it dropped rather than rendered.

## Taking it

`startPrerequisite` builds a `LessonGoal` from the lesson being left — its topic, and its project when it had one — and starts a topic lesson on the prerequisite with that goal attached.

**The lesson being left is deleted.** It holds exactly one card, the unanswered level question, so leaving it behind would put a stub in the library that nobody opens again; the way back is not that lesson but the goal, which starts a fresh one. This is the only place the app deletes a lesson the learner did not ask to delete.

**Groundwork is always a topic lesson.** That is in the type: only the `topic` variant of `LessonConfig` has a `goal`. A prerequisite is general knowledge by definition — even for a codebase lesson, where the prerequisite is the *technology* the project uses and not another part of the project (see `prompts/modes/codebase.md`). The goal carries the project instead, so a codebase question answered with a detour through general knowledge lands back in the code.

## Leading somewhere

A lesson with a goal behaves differently, and the config is what makes that survive a resume — nothing depends on the tutor remembering.

- **It skips the level question.** Asking for the groundwork already said where the learner is starting from, so `openingMessage` states it ("I am starting from scratch on X itself") and the tutor plans straight away. It also names the destination, which visibly shapes the outline: a Kubernetes lesson taken as groundwork for operators ends on *Controllers* and *Extending the API*.
- **The sidebar shows the destination for the whole lesson** ("on the way to X"), not only at the end. A detour is easy to mistake for having lost the thread.
- **The recap card carries the way back**, built from the config rather than from anything the tutor wrote, so it is there whether or not the recap remembered to mention it. The prompt tells the tutor *not* to list the destination under `suggestions`, since the app already shows it — the suggestions are for other directions.

## Checking it

`pnpm smoke:prerequisite` runs three first turns: a subject built on another one (must offer), a subject that is its own ground (must not), and a groundwork lesson (must skip the level question, plan an outline, and not offer a prerequisite of its own — never a chain). The subjects are deliberately not the ones the prompt uses as examples; a test the prompt can answer by quoting itself measures nothing.

`?demo` carries an offer on the fixture question card. `?demogoal` pretends the demo lesson was taken as groundwork, so the sidebar line and the recap's way back can be seen without walking the path.
