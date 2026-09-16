import discussPrompt from "../../prompts/discuss.md";
import exerciseCheckPrompt from "../../prompts/exercise-check.md";
import exerciseRegenPrompt from "../../prompts/exercise-regen.md";
import explainPrompt from "../../prompts/explain.md";
import mermaidFixPrompt from "../../prompts/mermaid-fix.md";
import verifyCheckPrompt from "../../prompts/verify-check.md";
import type {
	Card,
	CardFeatureId,
	CardTask,
	CardVerify,
	Exercise,
	Hierarchy,
	HierarchyLevel,
	OutlineItem,
	Prerequisite,
	Requirement,
	RequirementKind,
	ThreadMessage,
} from "../shared/types";
import { ALL_CARD_FEATURES, applyCardFeatures } from "./card-features";
import { isAllowed, type VerifyRun } from "./verify";

// The CLI's `--effort` levels, cheapest first. Effort buys thinking, not a
// bigger model: the tier is a separate decision, made by the mode.
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

// How one turn of a lesson is executed. Built from its mode (see
// lesson-modes.ts) and passed to the turn, so this file knows how to run the
// CLI without knowing what kinds of lesson exist.
export interface TutorRuntime {
	// The full system prompt: core tutor instructions plus the mode's section
	systemPrompt: string;
	// Built-in CLI tools the tutor may use; empty disables all of them
	tools: readonly string[];
	// What a card of this lesson may carry. Prompt sections come from the same
	// list, so this is also what the tutor was told it could use — see
	// card-features.ts.
	cardFeatures: readonly CardFeatureId[];
	// Working directory for the CLI — the project root when the lesson teaches
	// from one, so relative paths in the tutor's citations mean something
	cwd?: string;
	// Wall clock budget for one turn. A turn that reads its way around a
	// codebase needs far longer than one answered from the model's own
	// knowledge, so this is per-mode rather than a global constant.
	timeoutMs: number;
	// From Settings, the same for every mode, so a lesson costs what the
	// learner chose instead of following whatever this machine defaults to
	model?: string;
	// How hard the model works on this turn. Comes from Settings with the
	// model, and the floor is "high" — see settings.ts for what `low` did.
	effort?: EffortLevel;
	// Hard ceiling for one turn — a backstop against a turn that reads forever,
	// not a budget the tutor is meant to work within
	maxBudgetUsd?: number;
}

const TURN_TIMEOUT_MS = 180_000;
// Re-asks of a session that replied with something we couldn't parse
const MAX_CARD_REPAIRS = 2;
// Re-runs of a call the CLI itself failed
const MAX_TRANSPORT_RETRIES = 2;
const RETRY_BACKOFF_MS = 1_000;
// Haiku is the fast, cheap tier, and every stateless side-call belongs on it:
// looking a term up, grading an answer against one that's already known, fixing
// diagram syntax. Each is a small bounded job with a short reply and no reading
// to do — the teaching judgement lives in the lesson turn, which is where the
// bigger model earns its keep. These are also the calls the learner waits on
// with the UI blocked, so latency matters more here than anywhere else.
const SIDE_CALL_MODEL = "claude-haiku-4-5-20251001";
// The one side-call that writes teaching material instead of judging something
// it was handed the answer to, so it gets the tier a lesson turn would use.
// Thinking stays off with the others: the rules are explicit and the lesson
// material is in the prompt, so reasoning tokens buy little and the learner
// waits through every one of them with the exercise card blocked.
const EXERCISE_MODEL = "claude-sonnet-5";
// Re-asks of a regeneration that came back with a blank we can't use
const MAX_EXERCISE_ATTEMPTS = 2;
// A one-shot with no tools answers in seconds. This is a backstop against a
// hung call, not a budget: it fails visibly instead of blocking a learner mid-
// exercise for the three minutes a lesson turn is allowed.
const SIDE_CALL_TIMEOUT_MS = 60_000;
// Thinking off is the single biggest win here, and a much larger one than the
// model tier. These jobs are judgement-light — the expected answer is handed
// in, the parser error names the fault — so the reasoning tokens buy nothing
// and are pure latency: measured on a grading call, Haiku spent ~875 output
// tokens and 12.7s with thinking on versus ~76 tokens and 4.4s with it off,
// same verdict. Scoped to side-calls; a lesson turn still thinks.
const SIDE_CALL_ENV = { MAX_THINKING_TOKENS: "0" };

// Every call this app makes runs hermetically, lesson turns and side-calls
// alike: none of the machine's customizations — CLAUDE.md, skills, plugins,
// hooks, MCP servers, custom agents, output styles — reach it. The app gives a
// call its context on purpose (the mode's prompt, and for a codebase lesson the
// map from repo-map.ts); inheriting whatever the developer happens to have
// configured would put tens of thousands of tokens into every turn and slow
// each one down with their hooks. It is a correctness matter too: what a lesson
// teaches shouldn't depend on whose machine it runs on.
//
// --strict-mcp-config is kept alongside --safe-mode rather than left to it:
// --tools filters the built-in set only, so MCP servers would otherwise still
// be handed to a call, and the tool set is a security boundary that shouldn't
// depend on another flag's scope.
//
// Deliberately not --bare, which looks like a stronger version of the same idea
// but takes auth strictly from ANTHROPIC_API_KEY or an apiKeyHelper, never the
// keychain or OAuth. This app runs on the CLI's own logged-in session.
const HERMETIC_ARGS = ["--safe-mode", "--strict-mcp-config"] as const;

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

// What one CLI call actually cost, read off the result envelope. A codebase
// turn can spend minutes and real money reading, so this is worth carrying:
// the smoke scripts report it, and it is the only honest way to tell whether
// a change to the mode made things cheaper.
export interface TurnCost {
	usd: number;
	ms: number;
	// Agentic iterations inside the turn — how much reading it did
	steps: number;
}

interface ClaudeResult {
	result: string;
	sessionId: string;
	cost?: TurnCost;
}

// The envelope carries these on both the json and stream-json paths
function readCost(envelope: {
	total_cost_usd?: unknown;
	duration_ms?: unknown;
	num_turns?: unknown;
}): TurnCost | undefined {
	if (typeof envelope.total_cost_usd !== "number") return undefined;
	return {
		usd: envelope.total_cost_usd,
		ms: typeof envelope.duration_ms === "number" ? envelope.duration_ms : 0,
		steps: typeof envelope.num_turns === "number" ? envelope.num_turns : 0,
	};
}

interface SpawnOptions {
	cwd?: string;
	timeoutMs?: number;
	// Extra environment for the CLI process, merged over the app's own
	env?: Record<string, string>;
}

async function spawnClaude(
	args: string[],
	options: SpawnOptions = {},
): Promise<ClaudeResult> {
	const timeoutMs = options.timeoutMs ?? TURN_TIMEOUT_MS;
	const proc = Bun.spawn([claudeBinary(), ...args], {
		cwd: options.cwd,
		env: options.env ? { ...process.env, ...options.env } : undefined,
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, timeoutMs);

	try {
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const exitCode = await proc.exited;
		if (timedOut) {
			throw new ClaudeTransportError(
				`claude timed out after ${timeoutMs / 1000}s`,
				false,
			);
		}
		if (exitCode !== 0) {
			throw new ClaudeTransportError(
				`claude exited with code ${exitCode}: ${stderr.slice(0, 500)}`,
				true,
			);
		}
		let envelope: {
			result: string;
			session_id: string;
			is_error?: boolean;
			total_cost_usd?: number;
			duration_ms?: number;
			num_turns?: number;
		};
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
		return {
			result: envelope.result,
			sessionId: envelope.session_id,
			cost: readCost(envelope),
		};
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

function runClaude(
	args: string[],
	options: SpawnOptions = {},
): Promise<ClaudeResult> {
	return withTransportRetry("claude call", () => spawnClaude(args, options));
}

export interface TutorTurn {
	card: Card;
	outline?: OutlineItem[];
	exercise?: Exercise;
	sessionId: string;
	cost?: TurnCost;
}

// The CLI flags every turn of a lesson shares. Everything that varies between
// lesson modes comes from the runtime, so adding a mode never touches this.
function tutorArgs(
	runtime: TutorRuntime,
	format: "json" | "stream-json",
): string[] {
	const args = [
		"-p",
		"--tools",
		runtime.tools.join(","),
		"--output-format",
		format,
	];
	if (format === "stream-json") {
		args.push("--include-partial-messages", "--verbose");
	}
	args.push(...HERMETIC_ARGS);
	if (runtime.model) args.push("--model", runtime.model);
	if (runtime.effort) args.push("--effort", runtime.effort);
	if (runtime.maxBudgetUsd) {
		args.push("--max-budget-usd", String(runtime.maxBudgetUsd));
	}
	args.push("--system-prompt", runtime.systemPrompt);
	return args;
}

export async function runTutorTurn(
	userMessage: string,
	sessionId: string | undefined,
	runtime: TutorRuntime,
	options: { fork?: boolean } = {},
): Promise<TutorTurn> {
	const args = tutorArgs(runtime, "json");
	if (sessionId) {
		args.push("--resume", sessionId);
		// Forked turns get a fresh session id and leave the base session
		// untouched — used for speculative prefetch that may be discarded
		if (options.fork) {
			args.push("--fork-session");
		}
	}
	args.push(userMessage);

	const turn = await runClaude(args, {
		cwd: runtime.cwd,
		timeoutMs: runtime.timeoutMs,
	});
	try {
		return {
			...parseReply(turn.result, runtime.cardFeatures),
			sessionId: turn.sessionId,
			cost: turn.cost,
		};
	} catch (error) {
		if (!(error instanceof CardProtocolError)) throw error;
		// Repair against the id this turn returned — for a fork that is the
		// fork's own id, so the base session stays untouched
		return repairCard(turn.sessionId, error, runtime);
	}
}

const CARD_REPAIR_REQUEST =
	"Your last reply could not be parsed as a card. Send that same card again — the same teaching content, not a new step — as a single valid JSON object and nothing else: no code fences, no text before or after it, and every newline and quote inside a string properly escaped.";

// A reply we can't parse is still in the (forked) session, so the first fix is
// to ask that same session to re-send it — recovering the step the tutor just
// taught rather than dropping it. If the re-sends still never parse, salvage
// the title and body from the raw reply instead of losing the step (see the
// tail of this function). The caller forks the turn, so even an unrecoverable
// reply advances only the throwaway branch and a retry re-teaches this step.
// Mirrors the guard-and-repair pattern used for broken Mermaid diagrams.
async function repairCard(
	sessionId: string,
	failure: CardProtocolError,
	runtime: TutorRuntime,
): Promise<TutorTurn> {
	let lastFailure = failure;
	for (let attempt = 0; attempt < MAX_CARD_REPAIRS; attempt++) {
		console.warn(
			`unparseable card, repair ${attempt + 1}/${MAX_CARD_REPAIRS}:`,
			lastFailure.message,
		);
		const turn = await runClaude(
			[
				...tutorArgs(runtime, "json"),
				"--resume",
				sessionId,
				`${CARD_REPAIR_REQUEST}\n\nThe parser reported: ${lastFailure.message}`,
			],
			{ cwd: runtime.cwd, timeoutMs: runtime.timeoutMs },
		);
		try {
			return {
				...parseReply(turn.result, runtime.cardFeatures),
				sessionId: turn.sessionId,
				cost: turn.cost,
			};
		} catch (error) {
			if (!(error instanceof CardProtocolError)) throw error;
			lastFailure = error;
		}
	}
	// Out of clean re-sends. Rather than drop the step, salvage its title and
	// body straight from the raw reply (the same tolerant read the streaming
	// preview uses) and adopt that. The learner keeps the content they watched
	// stream in, and since the session really did teach this step, the next
	// Continue still advances correctly. Structured extras (notes routing,
	// exercise) can't be recovered this way and are left off the salvaged card.
	const salvaged = salvageCard(failure.reply) ?? salvageCard(lastFailure.reply);
	if (salvaged) {
		console.warn(
			"card unparseable after repairs; salvaged title and body from the raw reply",
		);
		// A salvaged card goes through the same gate as a parsed one: it can
		// carry a takeaway, and a mode without that feature must not get one.
		return {
			card: applyCardFeatures(salvaged, runtime.cardFeatures),
			sessionId,
		};
	}
	// Nothing recoverable — not even a title and body. Log the reply in full;
	// it is the only copy of what was taught, and the turn surfaces as an error.
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
// What the webview shows while a turn is in flight: the card as it is written,
// plus what the tutor is doing in between when it has tools to work with.
export interface TurnPreview {
	title: string;
	body: string;
	activity?: string;
}

export async function runTutorTurnStreaming(
	userMessage: string,
	sessionId: string | undefined,
	runtime: TutorRuntime,
	options: {
		// Fork the resumed session so this turn advances only a throwaway branch;
		// the caller adopts the branch (finishTurn) only on a card it can use.
		fork?: boolean;
		onPreview?: (preview: TurnPreview) => void;
	} = {},
): Promise<TutorTurn> {
	// Retry covers the spawn only. Parsing and repair sit outside it: once a
	// reply is in hand the turn is committed to the session, and re-running the
	// message would teach a second step rather than recover this one.
	const turn = await withTransportRetry("streaming turn", () =>
		streamTutorTurn(
			userMessage,
			sessionId,
			runtime,
			Boolean(options.fork),
			options.onPreview,
		),
	);
	try {
		return {
			...parseReply(turn.result, runtime.cardFeatures),
			sessionId: turn.sessionId,
			cost: turn.cost,
		};
	} catch (error) {
		if (!(error instanceof CardProtocolError)) throw error;
		return repairCard(turn.sessionId, error, runtime);
	}
}

// One streaming attempt: returns the raw reply, exactly as spawnClaude does for
// the non-streaming path. Card parsing is the caller's job.
async function streamTutorTurn(
	userMessage: string,
	sessionId: string | undefined,
	runtime: TutorRuntime,
	fork: boolean,
	onPreview?: (preview: TurnPreview) => void,
): Promise<ClaudeResult> {
	const args = tutorArgs(runtime, "stream-json");
	if (sessionId) {
		args.push("--resume", sessionId);
		// Fork a foreground turn the same way prefetch does: an unrecoverable
		// reply then advances only the throwaway branch, so the lesson session
		// stays put and a retry re-teaches this step instead of skipping it.
		if (fork) args.push("--fork-session");
	}
	args.push(userMessage);

	const proc = Bun.spawn([claudeBinary(), ...args], {
		cwd: runtime.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, runtime.timeoutMs);
	// Drain stderr alongside stdout: left unread, a chatty CLI can fill the pipe
	// buffer and stall the process until the turn times out
	const stderrText = new Response(proc.stderr).text().catch(() => "");

	try {
		let raw = ""; // accumulated assistant text (a partial JSON object)
		let activity: string | undefined; // what the tutor is doing between text
		let resultText: string | undefined;
		let resultSession: string | undefined;
		let resultCost: TurnCost | undefined;
		let isError = false;
		const decoder = new TextDecoder();
		let buffer = "";

		const handleLine = (line: string) => {
			if (!line) return;
			let event: {
				type?: string;
				event?: { type?: string; delta?: { type?: string; text?: string } };
				message?: { content?: unknown };
				result?: string;
				session_id?: string;
				is_error?: boolean;
				total_cost_usd?: number;
				duration_ms?: number;
				num_turns?: number;
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
				onPreview?.({ ...extractPreview(raw), activity });
			} else if (event.type === "assistant") {
				// A tool call means the card hasn't started yet: whatever text came
				// before it was the tutor talking to itself, not the reply. Drop it
				// so the preview can't show a fragment that isn't in the card, and
				// report the lookup instead — with tools this is most of the wait.
				const use = lastToolUse(event.message?.content);
				if (use) {
					raw = "";
					activity = describeToolUse(use, runtime.cwd);
					onPreview?.({ title: "", body: "", activity });
				}
			} else if (event.type === "result") {
				resultText = event.result;
				resultSession = event.session_id;
				resultCost = readCost(event);
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
				`streaming turn timed out after ${runtime.timeoutMs / 1000}s`,
				false,
			);
		}
		if (isError || !resultText || !resultSession) {
			throw new ClaudeTransportError(
				`streaming turn failed: ${resultText ?? (await stderrText).slice(0, 300)}`,
				true,
			);
		}
		return {
			result: resultText,
			sessionId: resultSession,
			cost: resultCost,
		};
	} finally {
		clearTimeout(timeout);
	}
}

interface ToolUse {
	name: string;
	input: Record<string, unknown>;
}

// The last tool call in an assistant message, or undefined if it was plain
// text. A message can carry several; the last one is the freshest thing to
// show, and they all complete before the next message arrives anyway.
//
// A read of /dev/null is skipped: the CLI opens each turn with one, and
// reporting it would flash a nonsense path at the learner and inflate every
// count of what the tutor actually looked at.
function lastToolUse(content: unknown): ToolUse | undefined {
	if (!Array.isArray(content)) return undefined;
	let found: ToolUse | undefined;
	for (const block of content) {
		if (block?.type !== "tool_use" || typeof block.name !== "string") continue;
		const input =
			block.input && typeof block.input === "object"
				? (block.input as Record<string, unknown>)
				: {};
		if (input.file_path === "/dev/null") continue;
		found = { name: block.name, input };
	}
	return found;
}

// One short line about a lookup in progress, for the streaming card. Paths come
// back absolute; inside a project they read better cut down to the part the
// learner would recognise.
// A search query is cut from the END, unlike a file path, which is cut from the
// front — a path's meaning is its filename and a query's is its first few words.
function head(query: string): string {
	const text = query.trim();
	return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

// A page being read is named by its site, not its full URL: the line sits in
// one row of the planning screen, and a documentation URL is mostly path.
function hostOf(url: string): string {
	try {
		return new URL(url).host.replace(/^www\./, "");
	} catch {
		return url.slice(0, 60);
	}
}

function describeToolUse(use: ToolUse, cwd?: string): string {
	const relative = (value: unknown): string => {
		const text = typeof value === "string" ? value : "";
		const trimmed =
			cwd && text.startsWith(`${cwd}/`) ? text.slice(cwd.length + 1) : text;
		return trimmed.length > 60 ? `…${trimmed.slice(-59)}` : trimmed;
	};
	const file = relative(use.input.file_path);
	const pattern = relative(use.input.pattern);
	switch (use.name) {
		case "Read":
			return file ? `Reading ${file}` : "Reading a file";
		case "Grep":
			return pattern ? `Searching for ${pattern}` : "Searching the project";
		case "Glob":
			return pattern ? `Looking for ${pattern}` : "Looking through the files";
		// A lab lesson looks things up on the web, and the line the learner
		// watches has to say so — "Looking through the project" during a Grafana
		// lesson names a project that does not exist.
		case "WebSearch":
			return typeof use.input.query === "string"
				? `Searching the web for ${head(use.input.query)}`
				: "Searching the web";
		case "WebFetch":
			return typeof use.input.url === "string"
				? `Reading ${hostOf(use.input.url)}`
				: "Reading a page";
		default:
			return "Looking something up";
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

// Re-escape raw control characters that appear inside JSON string literals. An
// unescaped newline in a card body is the most common reason a reply fails to
// parse; only characters inside strings are rewritten, so already-valid JSON is
// returned byte-for-byte unchanged. Cannot fix an unescaped quote (it hides
// where the string ends) — those replies still fail and are left to repair.
function escapeControlCharsInStrings(json: string): string {
	let out = "";
	let inString = false;
	let escaped = false;
	for (const ch of json) {
		if (escaped) {
			out += ch;
			escaped = false;
		} else if (ch === "\\") {
			out += ch;
			escaped = true;
		} else if (ch === '"') {
			inString = !inString;
			out += ch;
		} else if (inString && ch.charCodeAt(0) < 0x20) {
			const code = ch.charCodeAt(0);
			out +=
				ch === "\n"
					? "\\n"
					: ch === "\r"
						? "\\r"
						: ch === "\t"
							? "\\t"
							: `\\u${code.toString(16).padStart(4, "0")}`;
		} else {
			out += ch;
		}
	}
	return out;
}

// Last-resort recovery once strict parse, tolerant parse, and repair have all
// failed: pull the card's title and body out of the raw reply with the same
// tolerant reader the streaming preview uses. A reply too broken to yield even
// those returns undefined and becomes a surfaced error.
export function salvageCard(raw: string): Card | undefined {
	const title = extractJsonString(raw, "title")?.trim();
	const body = extractJsonString(raw, "body")?.trim();
	if (!title || !body) return undefined;
	const type = extractJsonString(raw, "type");
	const conceptId = extractJsonString(raw, "conceptId")?.trim();
	return {
		type: type === "question" || type === "recap" ? type : "step",
		title,
		body,
		conceptId: conceptId || undefined,
		// A plain string on the card, so it comes back the same tolerant way the
		// title and body do — unlike the structured extras below.
		takeaway: extractJsonString(raw, "takeaway")?.trim() || undefined,
	};
}

// Answer a question about one section of one card, for the conversation that
// hangs beside it. Stateless like the other side-calls: everything it knows
// comes in from the webview, which holds the cards and the thread. It writes
// teaching prose rather than judging something it was handed the answer to, so
// it sits on the same tier exercise regeneration does.
export async function discussSection(input: {
	topic: string;
	cardTitle: string;
	section: string;
	material: string;
	history: readonly ThreadMessage[];
	question: string;
}): Promise<string> {
	// The thread is replayed as text rather than as real conversation turns:
	// a side-call is one -p invocation with no session, so this is the only way
	// the earlier exchange reaches the model at all.
	const conversation = input.history
		.map((message) =>
			message.role === "user"
				? `Learner asked: ${message.text}`
				: `You answered: ${message.text}`,
		)
		.join("\n\n");
	const { result } = await runSideCall(
		discussPrompt,
		[
			`Lesson topic: ${input.topic}`,
			// Labelled as context rather than as the answer set: handed a block
			// of material and a question, a model reads it as "answer from this"
			// and starts declining anything the material is silent about.
			`What the learner has read so far — their context and their vocabulary, not the limit of what you may say:\n\n${input.material}`,
			`The card the learner is on: ${input.cardTitle}`,
			`The section they stopped on:\n\n${input.section}`,
			conversation ? `Earlier in this conversation:\n\n${conversation}` : "",
			`Their question: ${input.question}`,
		]
			.filter(Boolean)
			.join("\n\n---\n\n"),
		{ model: EXERCISE_MODEL },
	);
	return result.trim();
}

// One stateless side-call: no session, no tools, none of the machine's
// customizations, and the fast model. Everything the three callers below share
// lives here, so a side-call can't drift onto a slower or costlier footing by
// being written slightly differently from its neighbours.
function runSideCall(
	systemPrompt: string,
	userMessage: string,
	// A call that generates rather than judges can raise the tier; everything
	// else about the footing stays shared.
	options: { model?: string } = {},
): Promise<ClaudeResult> {
	return runClaude(
		[
			"-p",
			...HERMETIC_ARGS,
			"--tools",
			"",
			"--output-format",
			"json",
			// Never touch the lesson session or its in-flight prefetch fork
			"--no-session-persistence",
			"--model",
			options.model ?? SIDE_CALL_MODEL,
			"--system-prompt",
			systemPrompt,
			userMessage,
		],
		{ timeoutMs: SIDE_CALL_TIMEOUT_MS, env: SIDE_CALL_ENV },
	);
}

// Explain one highlighted term in its lesson context.
export async function explainTerm(
	term: string,
	context: string,
): Promise<string> {
	const { result } = await runSideCall(
		explainPrompt,
		`Term to explain: ${term}\n\nContext it appeared in:\n${context}`,
	);
	return result.trim();
}

// One-shot repair of a Mermaid diagram that failed to parse. Mechanical work
// against a parser error, and it degrades safely: a fix that still doesn't
// parse leaves the diagram hidden rather than showing something wrong.
export async function fixMermaidDiagram(
	code: string,
	error: string,
): Promise<string> {
	const { result } = await runSideCall(
		mermaidFixPrompt,
		`This Mermaid diagram fails to parse.\n\nParser error:\n${error}\n\nDiagram:\n${code}`,
	);
	return result
		.trim()
		.replace(/^```(?:mermaid)?\s*/i, "")
		.replace(/```\s*$/, "")
		.trim();
}

// Grade an exercise answer. The learner is sitting in front of a submitted
// answer waiting for this one, and the call is given the expected answer up
// front — it judges one short reply against it rather than working the problem
// out, which is why it sits on the fast tier with the other side-calls.
export async function checkExerciseAnswer(
	exercise: Exercise,
	userAnswer: string | null,
): Promise<{ correct: boolean; explanation: string }> {
	const learnerPart =
		userAnswer === null
			? 'The learner pressed "I don\'t know".'
			: `Learner's answer: ${userAnswer}`;
	const { result } = await runSideCall(
		exerciseCheckPrompt,
		`Question: ${exercise.question}\n\nSnippet (${exercise.code.language}):\n${exercise.code.source}\n\nExpected answer: ${exercise.answer}\n\n${learnerPart}`,
	);
	const { correct, explanation } = readJsonObject(result, "check") as {
		correct?: unknown;
		explanation?: unknown;
	};
	if (typeof correct !== "boolean" || typeof explanation !== "string") {
		throw new Error(`check reply malformed: ${result.slice(0, 200)}`);
	}
	return { correct, explanation };
}

// Write a replacement for an exercise the learner rejected as unclear, unfair,
// or impossible. `material` is the lesson text the new exercise has to be
// answerable from — the webview holds the cards, so it sends them rather than
// this process guessing which ones taught the concept.
// Did the step work? A judgement handed the expected answer, exactly like
// grading an exercise — which is why it belongs on the cheap tier with the
// other side-calls. About a cent.
export async function judgeVerify(
	run: VerifyRun,
	expect: string,
	taskExpect?: string,
): Promise<{ pass: boolean; note: string }> {
	const asked = taskExpect
		? `What the learner was asked to do, and what the card said they would see: ${taskExpect}`
		: "The card did not say what the learner would see.";
	const { result } = await runSideCall(
		verifyCheckPrompt,
		[
			asked,
			`What the tutor said this check's output should show: ${expect}`,
			`Command the app ran: ${run.command}`,
			`Exit code: ${run.exitCode}`,
			`Output:\n${run.output || "(nothing at all)"}`,
		].join("\n\n"),
	);
	const { pass, note } = readJsonObject(result, "verify") as {
		pass?: unknown;
		note?: unknown;
	};
	if (typeof pass !== "boolean" || typeof note !== "string") {
		throw new Error(`verify reply malformed: ${result.slice(0, 200)}`);
	}
	return { pass, note };
}

export async function regenerateExercise(
	previous: Exercise,
	material: string,
	concept?: string,
): Promise<Exercise> {
	const request = [
		concept ? `Concept: ${concept}` : undefined,
		`Lesson material for this concept:\n\n${material}`,
		`Rejected exercise:\nQuestion: ${previous.question}\nSnippet (${previous.code.language}):\n${previous.code.source}\nAnswer: ${previous.answer}`,
	]
		.filter(Boolean)
		.join("\n\n");

	// An exercise that blanks a comment is the failure this feature exists to
	// undo, so it is worth one re-ask — but a second one that still does it is
	// kept rather than surfaced as an error: a mediocre exercise the learner can
	// reject again beats a card that shows them a failure message.
	let fallback: Exercise | undefined;
	let note = "";
	for (let attempt = 0; attempt < MAX_EXERCISE_ATTEMPTS; attempt++) {
		const { result } = await runSideCall(
			exerciseRegenPrompt,
			note ? `${request}\n\n${note}` : request,
			{ model: EXERCISE_MODEL },
		);
		const written = parseExercise(readJsonObject(result, "exercise"));
		if (!written || !hasOneBlank(written.code.source)) {
			note = `Your last reply was unusable: the snippet must contain exactly one ${BLANK} blank. Write the exercise again.`;
			continue;
		}
		// The concept is the app's, not the model's — the practice panel groups
		// exercises by it and a regenerated one must stay where it was.
		const exercise = { ...written, conceptId: previous.conceptId };
		if (!blankIsInsideComment(exercise.code.source)) return exercise;
		fallback ??= exercise;
		note = `Your last reply put the blank inside a comment, where the learner can only guess your wording. Move it onto a line of real code and write the exercise again.`;
	}
	if (fallback) {
		console.warn("regenerated exercise still blanks a comment; using it");
		return fallback;
	}
	throw new Error("the tutor did not write a usable exercise");
}

// The blank a learner fills in. Four underscores, the same marker the tutor
// prompt asks for and the practice panel highlights.
const BLANK = "____";

export function hasOneBlank(source: string): boolean {
	return source.split(BLANK).length === 2;
}

// Line-comment markers, matched only at a line start or after whitespace so a
// URL's `//` and a shell flag's `--` don't read as one. Block comments and
// docstrings are deliberately not covered: this check exists to catch the
// common failure cheaply, and a false negative just means a mediocre exercise
// the learner can reject again.
const LINE_COMMENT = /(?:^|\s)(?:#|\/\/)/;

// Is the blank inside a comment? Then the learner is being asked to guess the
// tutor's wording rather than what the code does — the exact shape of question
// this app kept producing, and the reason a rejected exercise is re-asked.
export function blankIsInsideComment(source: string): boolean {
	const line = source.split("\n").find((text) => text.includes(BLANK));
	if (!line) return false;
	return LINE_COMMENT.test(line.slice(0, line.indexOf(BLANK)));
}

// Pull the one JSON object out of a side-call reply. Each prompt asks for bare
// JSON; a reply that arrives wrapped in a fence or a sentence still parses.
function readJsonObject(result: string, label: string): unknown {
	const start = result.indexOf("{");
	const end = result.lastIndexOf("}");
	if (start === -1 || end <= start) {
		throw new Error(
			`${label} reply contained no JSON: ${result.slice(0, 200)}`,
		);
	}
	try {
		return JSON.parse(result.slice(start, end + 1));
	} catch (error) {
		// Usually a raw newline or an unescaped quote inside a string, or a reply
		// that got cut off before its closing brace
		throw new Error(
			`${label} reply was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

// The tutor is instructed to reply with bare JSON, but models occasionally
// wrap it in code fences or stray prose — extract the outermost object.
export function parseReply(
	text: string,
	// What this lesson's mode allows a card to carry. Anything else is dropped
	// here rather than trusted to the prompt. Defaults to everything, which is
	// what a caller with no lesson in hand (the parse tests) wants.
	features: readonly CardFeatureId[] = ALL_CARD_FEATURES,
): {
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
	const slice = text.slice(start, end + 1);
	let parsed: {
		card?: Record<string, unknown>;
		outline?: unknown;
		exercise?: unknown;
	};
	try {
		parsed = JSON.parse(slice);
	} catch (strictError) {
		// The usual break is a raw newline or tab left unescaped inside the body
		// string; re-escaping control characters inside string literals recovers
		// the whole card here, with full fidelity and no model round-trip. A
		// genuinely truncated reply, or an unescaped quote we can't place, still
		// fails and falls through to repairCard.
		try {
			parsed = JSON.parse(escapeControlCharsInStrings(slice));
		} catch {
			throw new CardProtocolError(
				`tutor reply was not valid JSON: ${strictError instanceof Error ? strictError.message : String(strictError)}`,
				text,
			);
		}
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
		card: applyCardFeatures(
			{
				type: card.type,
				title: card.title,
				body: card.body,
				conceptId:
					typeof card.conceptId === "string" ? card.conceptId : undefined,
				takeaway: parseLine(card.takeaway),
				hierarchy: parseHierarchy(card.hierarchy),
				options: parseOptions(card.options),
				// Honoured only on the card it belongs to. Taking the offer throws
				// this lesson away and starts another, which is the right thing under
				// an unanswered level question and destructive anywhere else.
				prerequisite:
					card.type === "question"
						? parsePrerequisite(card.prerequisite)
						: undefined,
				suggestions: parseSuggestions(card.suggestions),
				task: parseTask(card.task),
				caution: parseLine(card.caution),
				cost: parseLine(card.cost),
				requirements: parseRequirements(card.requirements),
				notes: parseNotes(card.notes),
			},
			features,
		),
		outline: parseOutline(parsed.outline),
		exercise: parseExercise(parsed.exercise),
	};
}

// One line of model text the app draws as a panel of its own: the takeaway, and
// a lab card's caution and cost. All three are optional by design — most cards
// carry none — so anything that isn't usable text is dropped rather than
// surfaced as an empty panel under the card.
function parseLine(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	return raw.trim() || undefined;
}

const TASK_KINDS = new Set<CardTask["kind"]>(["run", "ui", "edit"]);

// The step the learner performs. A "run" task with nothing to type is not a
// task — the card would tell the learner to run something and show no command —
// so it is dropped, and the body still teaches on its own. What success looks
// like is kept when it is there and simply not drawn when it is not.
function parseTask(raw: unknown): CardTask | undefined {
	const value = raw as
		| { kind?: unknown; command?: unknown; expect?: unknown }
		| null
		| undefined;
	if (!value || typeof value !== "object") return undefined;
	const kind = value.kind as CardTask["kind"];
	if (!TASK_KINDS.has(kind)) return undefined;
	const command = parseLine(value.command);
	if (kind === "run" && !command) return undefined;
	return {
		kind,
		command,
		expect: parseLine(value.expect),
		verify: parseVerify((value as { verify?: unknown }).verify),
	};
}

// The app-side allowlist runs HERE, at parse time, so a check this app will not
// run never reaches the learner at all: the card simply has no Check button and
// falls back to "I did it". A refusal must never surface as an error, and never
// as a question about whether to permit it — see
// docs/adr/0001-the-learner-executes-the-app-only-verifies.md.
function parseVerify(raw: unknown): CardVerify | undefined {
	const value = raw as { argv?: unknown; expect?: unknown } | null | undefined;
	if (!value || !Array.isArray(value.argv)) return undefined;
	const argv = value.argv.filter(
		(part): part is string => typeof part === "string" && part.length > 0,
	);
	if (argv.length !== value.argv.length || !isAllowed(argv)) return undefined;
	const expect = parseLine(value.expect);
	// A check with nothing to judge it against is not a check: the judge is
	// handed the expectation, and without one it would be inventing a standard.
	return expect ? { argv, expect } : undefined;
}

const REQUIREMENT_KINDS = new Set<RequirementKind>([
	"install",
	"account",
	"payment",
	"disk",
	"time",
	"workspace",
]);

// The most a checklist can hold and still be read before the lesson starts
const MAX_REQUIREMENTS = 8;

// What the learner needs before the setup begins. A row needs a name and a kind
// the app has an icon for; an unknown kind would draw a blank tile, and the
// point of this panel is that it is skimmable.
function parseRequirements(raw: unknown): Requirement[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const rows: Requirement[] = [];
	for (const item of raw) {
		const value = item as {
			name?: unknown;
			kind?: unknown;
			detail?: unknown;
			cost?: unknown;
		};
		const name = parseLine(value?.name);
		const kind = value?.kind as RequirementKind;
		if (!name || !REQUIREMENT_KINDS.has(kind)) continue;
		rows.push({
			name,
			kind,
			detail: parseLine(value.detail),
			cost: parseLine(value.cost),
		});
		if (rows.length === MAX_REQUIREMENTS) break;
	}
	return rows.length > 0 ? rows : undefined;
}

// The most rungs a picture of this kind can carry before it stops being one
// glance. A deeper structure is two lessons, not one diagram.
const MAX_HIERARCHY_LEVELS = 8;

// A structure needs at least two rungs to be one. Depth is clamped rather than
// trusted: it drives an indent, and a rung claiming depth 40 would walk the
// panel off its own right edge.
function parseHierarchy(raw: unknown): Hierarchy | undefined {
	const value = raw as { levels?: unknown; current?: unknown } | null;
	if (!value || !Array.isArray(value.levels)) return undefined;
	const levels: HierarchyLevel[] = [];
	for (const item of value.levels) {
		const level = item as { name?: unknown; depth?: unknown; note?: unknown };
		if (typeof level?.name !== "string" || !level.name.trim()) continue;
		const depth =
			typeof level.depth === "number" && Number.isFinite(level.depth)
				? Math.min(Math.max(Math.round(level.depth), 0), 5)
				: 0;
		const note = typeof level.note === "string" ? level.note.trim() : "";
		levels.push({ name: level.name.trim(), depth, note: note || undefined });
		if (levels.length === MAX_HIERARCHY_LEVELS) break;
	}
	if (levels.length < 2) return undefined;
	const current = typeof value.current === "string" ? value.current.trim() : "";
	return { levels, current: current || undefined };
}

// Both fields or nothing: the button reads "Start with <topic>" and explains
// itself with the reason, so half an offer is not one.
function parsePrerequisite(raw: unknown): Prerequisite | undefined {
	const value = raw as { topic?: unknown; reason?: unknown } | null;
	if (
		!value ||
		typeof value.topic !== "string" ||
		typeof value.reason !== "string"
	) {
		return undefined;
	}
	const topic = value.topic.trim();
	const reason = value.reason.trim();
	return topic && reason ? { topic, reason } : undefined;
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
