// Smoke test for exercise regeneration: the learner rejects an exercise and
// gets a usable one back. Run with: pnpm run smoke:exercise
//
// The fixture is a real failure from a saved lesson — the blank sat inside a
// comment, so the only way to answer it was to guess the tutor's own wording.

import {
	blankIsInsideComment,
	hasOneBlank,
	regenerateExercise,
} from "../src/bun/claude";
import type { Exercise } from "../src/shared/types";

const REJECTED: Exercise = {
	conceptId: "augmented-prompt",
	question:
		"The documents say nothing about parking. What does the grounded prompt make the model reply?",
	code: {
		language: "python",
		source:
			'# No chunk mentions parking.\nanswer = ask("Where can I park?")\n\n# With the grounding instruction, the model replies:\n# "____"',
	},
	answer:
		"I don't know — the instruction stops the model from inventing an answer outside the context",
};

const MATERIAL = `## Assemble the augmented prompt

The last piece joins everything. The retrieved passages and the question become one prompt — the augmented prompt that gives RAG its name.

The passages go in first as labelled context, the question after them.

\`\`\`python
# query.py
context = "\\n\\n".join(passages)

prompt = f"""Context:
{context}

Question: Can I get my money back?"""

answer = llm.generate(prompt)
\`\`\`

## Tell the model to stay in the context

One instruction makes the prompt much safer: answer only from the context, and admit when the context does not contain the answer.

Without it, the model falls back on its training data and can hallucinate. With it, a question your documents cannot answer gets an honest "I don't know" instead of an invented policy.

\`\`\`python
# query.py
prompt = f"""Answer using ONLY the context below.
If the context does not contain the answer, say "I don't know".

Context:
{context}

Question: {question}"""
\`\`\`

Keeping answers tied to the retrieved text is called grounding.`;

console.log("Rejected exercise:");
console.log(`  ${REJECTED.question}`);
console.log(`  ${REJECTED.code.source.replace(/\n/g, "\n  ")}\n`);

console.log("Asking for a replacement…");
const written = await regenerateExercise(
	REJECTED,
	MATERIAL,
	"The augmented prompt",
);
console.log(JSON.stringify(written, null, 2));

if (written.conceptId !== REJECTED.conceptId) {
	console.error("FAIL: the replacement left its concept");
	process.exit(1);
}
if (!hasOneBlank(written.code.source)) {
	console.error("FAIL: the snippet does not hold exactly one ____ blank");
	process.exit(1);
}
if (blankIsInsideComment(written.code.source)) {
	console.error(
		"FAIL: the blank is inside a comment, same as the rejected one",
	);
	process.exit(1);
}
if (written.question.trim() === REJECTED.question.trim()) {
	console.error("FAIL: the replacement is the question that was rejected");
	process.exit(1);
}

console.log("\nPASS");
