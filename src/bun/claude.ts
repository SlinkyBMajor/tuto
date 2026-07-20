import exerciseCheckPrompt from "../../prompts/exercise-check.md";
import explainPrompt from "../../prompts/explain.md";
import mermaidFixPrompt from "../../prompts/mermaid-fix.md";
import tutorPrompt from "../../prompts/tutor.md";
import type { Card, Exercise, OutlineItem } from "../shared/types";

const TURN_TIMEOUT_MS = 180_000;
// Re-asks of a session that replied with something we couldn't parse
const MAX_CARD_REPAIRS = 2;
// Re-runs of a call the CLI itself failed
const MAX_TRANSPORT_RETRIES = 2;
const RETRY_BACKOFF_MS = 1_000;
// Haiku is the fast, cheap tier — ideal for a quick term lookup
const EXPLAIN_MODEL = "claude-haiku-4-5-20251001";

function claudeBinary(): string {
	const found = Bun.which("claude");
	if (found) return found;
	return `${process.env.HOME}/.local/bin/claude`;
}

// The CLI ran and replied, but the reply isn't a card. The raw text is kept so
// the session that produced it can be asked to re-send it — see repairCard.
class CardProtocolError extends Error {
	constructor(
		message: string,
		readonly reply: string,
	) {
		super(message);
		this.name = "CardProtocolError";
	}
}

// The CLI call itself failed, so there is no reply to work with. `retryable` is
// false for a timeout: the model may have finished and persisted its turn in
// the moment before we killed it, and re-running would teach the step twice.
class ClaudeTransportError extends Error {
	constructor(
		message: string,
		readonly retryable: boolean,
	) {
		super(message);
		this.name = "ClaudeTransportError";
	}
}

interface ClaudeResult {
	result: string;
	sessionId: string;
}

async function spawnClaude(args: string[]): Promise<ClaudeResult> {
	const proc = Bun.spawn([claudeBinary(), ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, TURN_TIMEOUT_MS);

	try {
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const exitCode = await proc.exited;
		if (timedOut) {
			throw new ClaudeTransportError(
				`claude timed out after ${TURN_TIMEOUT_MS / 1000}s`,
				false,
			);
		}
		if (exitCode !== 0) {
			throw new ClaudeTransportError(
				`claude exited with code ${exitCode}: ${stderr.slice(0, 500)}`,
				true,
			);
		}
		let envelope: { result: string; session_id: string; is_error?: boolean };
		try {
			envelope = JSON.parse(stdout);
		} catch {
			throw new ClaudeTransportError(
				`claude produced no JSON envelope: ${stdout.slice(0, 300)}`,
				true,
			);
		}
		if (envelope.is_error) {
			throw new ClaudeTransportError(
				`claude returned an error: ${envelope.result}`,
				true,
			);
		}
		return { result: envelope.result, sessionId: envelope.session_id };
	} finally {
		clearTimeout(timeout);
	}
}

// Retry transient CLI failures (an overloaded API, a dropped connection). Safe
// even for session-mutating turns: a call that failed this way never got far
// enough to persist an assistant message, so the re-run starts from the same
// place. Timeouts are excluded — see ClaudeTransportError.
async function withTransportRetry<T>(
	label: string,
	run: () => Promise<T>,
): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await run();
		} catch (error) {
			const retryable =
				error instanceof ClaudeTransportError && error.retryable;
			if (!retryable || attempt >= MAX_TRANSPORT_RETRIES) throw error;
			console.warn(
				`${label} failed (attempt ${attempt + 1}/${MAX_TRANSPORT_RETRIES + 1}), retrying:`,
				error,
			);
			await Bun.sleep(RETRY_BACKOFF_MS * 2 ** attempt);
		}
	}
}

function runClaude(args: string[]): Promise<ClaudeResult> {
	return withTransportRetry("claude call", () => spawnClaude(args));
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
	const systemPrompt = options.systemPrompt ?? tutorPrompt;
	const args = [
		"-p",
		"--tools",
		"",
		"--output-format",
		"json",
		"--system-prompt",
		systemPrompt,
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
	try {
		return { ...parseReply(turn.result), sessionId: turn.sessionId };
	} catch (error) {
		if (!(error instanceof CardProtocolError)) throw error;
		// Repair against the id this turn returned — for a fork that is the
		// fork's own id, so the base session stays untouched
		return repairCard(turn.sessionId, error, systemPrompt);
	}
}

const CARD_REPAIR_REQUEST =
	"Your last reply could not be parsed as a card. Send that same card again — the same teaching content, not a new step — as a single valid JSON object and nothing else: no code fences, no text before or after it, and every newline and quote inside a string properly escaped.";

// A reply we can't parse is still in the session, so the fix is to ask that
// same session to re-send it. This recovers the step the tutor just taught
// instead of dropping it: a discarded turn is invisible to the learner but the
// session has already moved past it, so the next Continue teaches the NEXT
// step and the failed one is silently skipped. Mirrors the guard-and-repair
// pattern used for broken Mermaid diagrams.
async function repairCard(
	sessionId: string,
	failure: CardProtocolError,
	systemPrompt: string,
): Promise<TutorTurn> {
	let lastFailure = failure;
	for (let attempt = 0; attempt < MAX_CARD_REPAIRS; attempt++) {
		console.warn(
			`unparseable card, repair ${attempt + 1}/${MAX_CARD_REPAIRS}:`,
			lastFailure.message,
		);
		const turn = await runClaude([
			"-p",
			"--tools",
			"",
			"--output-format",
			"json",
			"--system-prompt",
			systemPrompt,
			"--resume",
			sessionId,
			`${CARD_REPAIR_REQUEST}\n\nThe parser reported: ${lastFailure.message}`,
		]);
		try {
			return { ...parseReply(turn.result), sessionId: turn.sessionId };
		} catch (error) {
			if (!(error instanceof CardProtocolError)) throw error;
			lastFailure = error;
		}
	}
	// Out of attempts: the step is lost and the session has already moved past
	// it, so log the reply in full — it is the only copy of what was taught
	console.error(
		"card unrecoverable after repairs; raw tutor reply was:",
		lastFailure.reply,
	);
	throw new Error(
		`the tutor's reply could not be parsed after ${MAX_CARD_REPAIRS} repair attempts: ${lastFailure.message}`,
	);
}

// Foreground turn with live streaming. Reads Claude's stream-json events,
// surfaces a title/body preview from the partial JSON as it arrives, and
// parses the authoritative card from the final result line. Not used for
// prefetch (that runs in the background and is often discarded).
export async function runTutorTurnStreaming(
	userMessage: string,
	sessionId: string | undefined,
	options: {
		systemPrompt?: string;
		onPreview?: (preview: { title: string; body: string }) => void;
	} = {},
): Promise<TutorTurn> {
	const systemPrompt = options.systemPrompt ?? tutorPrompt;
	// Retry covers the spawn only. Parsing and repair sit outside it: once a
	// reply is in hand the turn is committed to the session, and re-running the
	// message would teach a second step rather than recover this one.
	const turn = await withTransportRetry("streaming turn", () =>
		streamTutorTurn(userMessage, sessionId, systemPrompt, options.onPreview),
	);
	try {
		return { ...parseReply(turn.result), sessionId: turn.sessionId };
	} catch (error) {
		if (!(error instanceof CardProtocolError)) throw error;
		return repairCard(turn.sessionId, error, systemPrompt);
	}
}

// One streaming attempt: returns the raw reply, exactly as spawnClaude does for
// the non-streaming path. Card parsing is the caller's job.
async function streamTutorTurn(
	userMessage: string,
	sessionId: string | undefined,
	systemPrompt: string,
	onPreview?: (preview: { title: string; body: string }) => void,
): Promise<ClaudeResult> {
	const args = [
		"-p",
		"--tools",
		"",
		"--output-format",
		"stream-json",
		"--include-partial-messages",
		"--verbose",
		"--system-prompt",
		systemPrompt,
	];
	if (sessionId) {
		args.push("--resume", sessionId);
	}
	args.push(userMessage);

	const proc = Bun.spawn([claudeBinary(), ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, TURN_TIMEOUT_MS);
	// Drain stderr alongside stdout: left unread, a chatty CLI can fill the pipe
	// buffer and stall the process until the turn times out
	const stderrText = new Response(proc.stderr).text().catch(() => "");

	try {
		let raw = ""; // accumulated assistant text (a partial JSON object)
		let resultText: string | undefined;
		let resultSession: string | undefined;
		let isError = false;
		const decoder = new TextDecoder();
		let buffer = "";

		const handleLine = (line: string) => {
			if (!line) return;
			let event: {
				type?: string;
				event?: { type?: string; delta?: { type?: string; text?: string } };
				result?: string;
				session_id?: string;
				is_error?: boolean;
			};
			try {
				event = JSON.parse(line);
			} catch {
				return; // ignore any non-JSON noise
			}
			if (
				event.type === "stream_event" &&
				event.event?.type === "content_block_delta" &&
				event.event.delta?.type === "text_delta"
			) {
				raw += event.event.delta.text ?? "";
				onPreview?.(extractPreview(raw));
			} else if (event.type === "result") {
				resultText = event.result;
				resultSession = event.session_id;
				isError = Boolean(event.is_error);
			}
		};

		for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
			buffer += decoder.decode(chunk, { stream: true });
			let nl = buffer.indexOf("\n");
			while (nl !== -1) {
				handleLine(buffer.slice(0, nl).trim());
				buffer = buffer.slice(nl + 1);
				nl = buffer.indexOf("\n");
			}
		}
		// The whole turn hangs on the final `result` line, which the CLI does not
		// always terminate with a newline — flush whatever is left
		handleLine(buffer.trim());
		await proc.exited;
		if (timedOut) {
			throw new ClaudeTransportError(
				`streaming turn timed out after ${TURN_TIMEOUT_MS / 1000}s`,
				false,
			);
		}
		if (isError || !resultText || !resultSession) {
			throw new ClaudeTransportError(
				`streaming turn failed: ${resultText ?? (await stderrText).slice(0, 300)}`,
				true,
			);
		}
		return { result: resultText, sessionId: resultSession };
	} finally {
		clearTimeout(timeout);
	}
}

// Pull a display preview (card title + body) out of the still-growing JSON.
// Cosmetic only — the final render uses the fully parsed result.
function extractPreview(raw: string): { title: string; body: string } {
	return {
		title: extractJsonString(raw, "title") ?? "",
		body: extractJsonString(raw, "body") ?? "",
	};
}

// Read the (possibly unterminated) value of a "key": "..." pair, unescaping as
// it goes and stopping at the end of the string or the end of what's arrived.
// Whitespace around the colon varies by model, so match it tolerantly.
function extractJsonString(raw: string, key: string): string | undefined {
	const opening = new RegExp(`"${key}"\\s*:\\s*"`).exec(raw);
	if (!opening) return undefined;
	let i = opening.index + opening[0].length;
	let out = "";
	while (i < raw.length) {
		const ch = raw[i];
		if (ch === '"') break; // closing quote
		if (ch === "\\") {
			const next = raw[i + 1];
			if (next === undefined) break; // escape split across chunks
			if (next === "u") {
				const hex = raw.slice(i + 2, i + 6);
				if (hex.length < 4) break; // wait for the rest
				out += String.fromCharCode(Number.parseInt(hex, 16));
				i += 6;
				continue;
			}
			out += UNESCAPE[next] ?? next;
			i += 2;
			continue;
		}
		out += ch;
		i++;
	}
	return out;
}

const UNESCAPE: Record<string, string> = {
	n: "\n",
	t: "\t",
	r: "\r",
	'"': '"',
	"\\": "\\",
	"/": "/",
};

// Explain one highlighted term in its lesson context. Stateless and on the
// fast Haiku tier — a quick lookup that never touches the lesson session.
export async function explainTerm(
	term: string,
	context: string,
): Promise<string> {
	const { result } = await runClaude([
		"-p",
		// Skip CLAUDE.md/skills/hooks/MCP startup — none are needed here and
		// they add latency and (occasionally) multi-second MCP-connect stalls
		"--safe-mode",
		"--tools",
		"",
		"--output-format",
		"json",
		"--no-session-persistence",
		"--model",
		EXPLAIN_MODEL,
		"--system-prompt",
		explainPrompt,
		`Term to explain: ${term}\n\nContext it appeared in:\n${context}`,
	]);
	return result.trim();
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
		throw new CardProtocolError(
			`tutor reply contained no JSON object: ${text.slice(0, 200)}`,
			text,
		);
	}
	let parsed: {
		card?: Record<string, unknown>;
		outline?: unknown;
		exercise?: unknown;
	};
	try {
		parsed = JSON.parse(text.slice(start, end + 1));
	} catch (error) {
		// Usually a raw newline or an unescaped quote inside a body string, or a
		// reply that got cut off before its closing brace
		throw new CardProtocolError(
			`tutor reply was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
			text,
		);
	}
	const card = parsed.card;
	if (
		!card ||
		(card.type !== "step" &&
			card.type !== "question" &&
			card.type !== "recap") ||
		typeof card.title !== "string" ||
		typeof card.body !== "string"
	) {
		throw new CardProtocolError(
			`tutor reply did not match the card protocol: ${text.slice(0, 200)}`,
			text,
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
