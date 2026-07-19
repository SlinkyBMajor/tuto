import exerciseCheckPrompt from "../../prompts/exercise-check.md";
import mermaidFixPrompt from "../../prompts/mermaid-fix.md";
import tutorPrompt from "../../prompts/tutor.md";
import type { Card, Exercise, OutlineItem } from "../shared/types";

const TURN_TIMEOUT_MS = 180_000;

function claudeBinary(): string {
	const found = Bun.which("claude");
	if (found) return found;
	return `${process.env.HOME}/.local/bin/claude`;
}

interface ClaudeResult {
	result: string;
	sessionId: string;
}

async function runClaude(args: string[]): Promise<ClaudeResult> {
	const proc = Bun.spawn([claudeBinary(), ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const timeout = setTimeout(() => proc.kill(), TURN_TIMEOUT_MS);

	try {
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			throw new Error(
				`claude exited with code ${exitCode}: ${stderr.slice(0, 500)}`,
			);
		}
		const envelope = JSON.parse(stdout);
		if (envelope.is_error) {
			throw new Error(`claude returned an error: ${envelope.result}`);
		}
		return { result: envelope.result, sessionId: envelope.session_id };
	} finally {
		clearTimeout(timeout);
	}
}

export interface TutorTurn {
	card: Card;
	outline?: OutlineItem[];
	exercise?: Exercise;
	sessionId: string;
}

// Per-lesson system prompt: the base tutor instructions plus the learner's
// preferred code language (the topic wins when it implies its own language)
export function composeSystemPrompt(language?: string): string {
	if (!language?.trim()) return tutorPrompt;
	return `${tutorPrompt}\n# Learner preferences\n\nWhen a code example or exercise fits and the topic does not imply a specific language, write it in ${language.trim()}.\n`;
}

export async function runTutorTurn(
	userMessage: string,
	sessionId?: string,
	options: { fork?: boolean; systemPrompt?: string } = {},
): Promise<TutorTurn> {
	const args = [
		"-p",
		"--tools",
		"",
		"--output-format",
		"json",
		"--system-prompt",
		options.systemPrompt ?? tutorPrompt,
	];
	if (sessionId) {
		args.push("--resume", sessionId);
		// Forked turns get a fresh session id and leave the base session
		// untouched — used for speculative prefetch that may be discarded
		if (options.fork) {
			args.push("--fork-session");
		}
	}
	args.push(userMessage);

	const turn = await runClaude(args);
	const reply = parseReply(turn.result);
	return { ...reply, sessionId: turn.sessionId };
}

// Stateless one-shot repair of a Mermaid diagram that failed to parse.
export async function fixMermaidDiagram(
	code: string,
	error: string,
): Promise<string> {
	const { result } = await runClaude([
		"-p",
		"--tools",
		"",
		"--output-format",
		"json",
		"--no-session-persistence",
		"--system-prompt",
		mermaidFixPrompt,
		`This Mermaid diagram fails to parse.\n\nParser error:\n${error}\n\nDiagram:\n${code}`,
	]);
	return result
		.trim()
		.replace(/^```(?:mermaid)?\s*/i, "")
		.replace(/```\s*$/, "")
		.trim();
}

// Grade an exercise answer in a stateless one-shot call so the lesson
// session (and any in-flight prefetch fork) stays untouched.
export async function checkExerciseAnswer(
	exercise: Exercise,
	userAnswer: string | null,
): Promise<{ correct: boolean; explanation: string }> {
	const learnerPart =
		userAnswer === null
			? 'The learner pressed "I don\'t know".'
			: `Learner's answer: ${userAnswer}`;
	const { result } = await runClaude([
		"-p",
		"--tools",
		"",
		"--output-format",
		"json",
		"--no-session-persistence",
		"--system-prompt",
		exerciseCheckPrompt,
		`Question: ${exercise.question}\n\nSnippet (${exercise.code.language}):\n${exercise.code.source}\n\nExpected answer: ${exercise.answer}\n\n${learnerPart}`,
	]);
	const start = result.indexOf("{");
	const end = result.lastIndexOf("}");
	if (start === -1 || end <= start) {
		throw new Error(`check reply contained no JSON: ${result.slice(0, 200)}`);
	}
	const parsed = JSON.parse(result.slice(start, end + 1));
	if (
		typeof parsed.correct !== "boolean" ||
		typeof parsed.explanation !== "string"
	) {
		throw new Error(`check reply malformed: ${result.slice(0, 200)}`);
	}
	return { correct: parsed.correct, explanation: parsed.explanation };
}

// The tutor is instructed to reply with bare JSON, but models occasionally
// wrap it in code fences or stray prose — extract the outermost object.
function parseReply(text: string): {
	card: Card;
	outline?: OutlineItem[];
	exercise?: Exercise;
} {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end <= start) {
		throw new Error(
			`tutor reply contained no JSON object: ${text.slice(0, 200)}`,
		);
	}
	const parsed = JSON.parse(text.slice(start, end + 1));
	const card = parsed.card;
	if (
		!card ||
		(card.type !== "step" &&
			card.type !== "question" &&
			card.type !== "recap") ||
		typeof card.title !== "string" ||
		typeof card.body !== "string"
	) {
		throw new Error(
			`tutor reply did not match the card protocol: ${text.slice(0, 200)}`,
		);
	}
	return {
		card: {
			type: card.type,
			title: card.title,
			body: card.body,
			conceptId:
				typeof card.conceptId === "string" ? card.conceptId : undefined,
			options: parseOptions(card.options),
			suggestions: parseSuggestions(card.suggestions),
			notes: parseNotes(card.notes),
		},
		outline: parseOutline(parsed.outline),
		exercise: parseExercise(parsed.exercise),
	};
}

function parseNotes(raw: unknown): Card["notes"] {
	const notes = raw as { sectionPath?: unknown } | null;
	if (!notes || !Array.isArray(notes.sectionPath)) return undefined;
	const sectionPath = notes.sectionPath.filter(
		(part): part is string => typeof part === "string" && part.trim() !== "",
	);
	return sectionPath.length > 0 ? { sectionPath } : undefined;
}

function parseExercise(raw: unknown): Exercise | undefined {
	const exercise = raw as {
		conceptId?: unknown;
		question?: unknown;
		code?: { language?: unknown; source?: unknown };
		answer?: unknown;
	} | null;
	if (
		!exercise ||
		typeof exercise.question !== "string" ||
		typeof exercise.answer !== "string" ||
		typeof exercise.code?.language !== "string" ||
		typeof exercise.code?.source !== "string"
	) {
		return undefined;
	}
	return {
		conceptId:
			typeof exercise.conceptId === "string" ? exercise.conceptId : undefined,
		question: exercise.question,
		code: { language: exercise.code.language, source: exercise.code.source },
		answer: exercise.answer,
	};
}

function parseOutline(raw: unknown): OutlineItem[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const items = raw.filter(
		(item): item is { id: string; title: string } =>
			typeof item?.id === "string" && typeof item?.title === "string",
	);
	if (items.length === 0) return undefined;
	return items.map((item) => ({ id: item.id, title: item.title }));
}

function parseSuggestions(raw: unknown): string[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const suggestions = raw.filter(
		(topic): topic is string => typeof topic === "string",
	);
	return suggestions.length > 0 ? suggestions : undefined;
}

function parseOptions(raw: unknown): Card["options"] {
	if (!Array.isArray(raw)) return undefined;
	const options = raw.filter(
		(option): option is { id: string; label: string; description?: unknown } =>
			typeof option?.id === "string" && typeof option?.label === "string",
	);
	if (options.length === 0) return undefined;
	return options.map((option) => ({
		id: option.id,
		label: option.label,
		description:
			typeof option.description === "string" ? option.description : undefined,
	}));
}
