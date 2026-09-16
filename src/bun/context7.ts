// Current documentation for what a lab lesson is about, fetched before the
// lesson starts and handed to the tutor in its opening message.
//
// The third thing a lab lesson is told before it plans anything: repo-map.ts
// reads the project, env-probe.ts reads the machine, and this reads the docs.
// It is a plain HTTP client rather than an MCP server the tutor calls, because
// --safe-mode disables the MCP subsystem outright and hermetic spawns are worth
// more than a tool call — see
// docs/adr/0002-fetch-documentation-in-the-app-not-through-mcp.md.

import { settings } from "./settings";

const ENDPOINT = "https://mcp.context7.com/mcp";

// Two network round-trips on the critical path of starting a lesson. A lesson
// that opens without its briefing is a lesson taught from memory, which is what
// every lesson did before this existed — so failing fast beats waiting.
const RESOLVE_TIMEOUT_MS = 8_000;
const QUERY_TIMEOUT_MS = 15_000;

// Roughly what one query comes back with. The briefing rides in every turn of
// the lesson's session, so it is budgeted like the repo map rather than pasted
// in whole.
const DOC_CHAR_BUDGET = 8_000;

// Raises rate limits when the learner sets one in Settings; the endpoint works
// without it. Read from settings.ts rather than persisted here — it is a
// machine setting the webview owns, and it must never land in a lesson record.

export interface DocBriefing {
	// The context7 library, as it names itself: "/grafana/grafana"
	libraryId: string;
	text: string;
}

// The endpoint speaks JSON-RPC over an SSE frame and keeps no session, so one
// POST is the whole exchange. Anything unexpected — a timeout, an HTTP error, a
// body we cannot read — comes back undefined, and the caller carries on.
async function callTool(
	name: string,
	args: Record<string, string>,
	timeoutMs: number,
): Promise<string | undefined> {
	try {
		const response = await fetch(ENDPOINT, {
			method: "POST",
			signal: AbortSignal.timeout(timeoutMs),
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				...(settings().context7Key
					? { Authorization: `Bearer ${settings().context7Key}` }
					: {}),
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name, arguments: args },
			}),
		});
		if (!response.ok) return undefined;
		return readToolText(await response.text());
	} catch {
		return undefined; // offline, blocked, or slow: the lesson does without
	}
}

// Pull the tool's text out of the SSE frame. The body is one or more
// `data: {json}` lines; the payload is a JSON-RPC result whose content is a
// list of blocks.
function readToolText(body: string): string | undefined {
	for (const line of body.split("\n")) {
		if (!line.startsWith("data:")) continue;
		let payload: {
			result?: { isError?: boolean; content?: { text?: unknown }[] };
		};
		try {
			payload = JSON.parse(line.slice(5));
		} catch {
			continue;
		}
		if (payload.result?.isError) return undefined;
		const text = (payload.result?.content ?? [])
			.map((block) => (typeof block.text === "string" ? block.text : ""))
			.join("\n")
			.trim();
		if (text) return text;
	}
	return undefined;
}

// resolve-library-id answers with a ranked list of candidate libraries in prose,
// each with its title and its id on their own lines. The first is the
// endpoint's own best match, and choosing between them is a judgement we have
// no better basis for than its ranking.
function firstLibrary(
	listing: string,
): { title: string; libraryId: string } | undefined {
	const libraryId = listing.match(
		/Context7-compatible library ID:\s*(\S+)/,
	)?.[1];
	if (!libraryId) return undefined;
	return {
		title: listing.match(/Title:\s*(.+)/)?.[1]?.trim() ?? "",
		libraryId,
	};
}

// The shortest word that can identify a tool. Below this the overlap is
// coincidence — "made" in "a made up thing" against "Made With ML", which is
// exactly what this test was written after.
const MIN_NAME_LENGTH = 5;

// **context7 always answers.** Ask it for a subject it has never indexed and it
// returns its nearest neighbour with the same confidence as a real match, so a
// lesson on something it does not know would open with somebody else's
// documentation — worse than opening with none.
//
// This is a coarse filter and knows it: one substantial word of the topic has
// to show up in the library's own title. The real guard is in the prompt, which
// tells the tutor to ignore a briefing that is not about what was asked — a
// model reading Ray Serve docs for a Grafana lesson will notice, and no string
// test is going to beat it at that.
function titleMatchesTopic(title: string, topic: string): boolean {
	const haystack = title.toLowerCase();
	return topic
		.toLowerCase()
		.split(/[^a-z0-9+#.]+/)
		.some((word) => word.length >= MIN_NAME_LENGTH && haystack.includes(word));
}

function clamp(text: string, budget: number): string {
	if (text.length <= budget) return text;
	const cut = text.slice(0, budget);
	const lastBreak = cut.lastIndexOf("\n");
	return `${cut.slice(0, lastBreak > budget / 2 ? lastBreak : budget)}\n\n[…truncated]`;
}

// What a lab lesson needs to know before it plans one: how the thing is
// installed and started, what the first move is once it runs, and how it is
// taken down again. Aimed by us, once, because the tutor has no way to ask.
function docsQuery(topic: string): string {
	return `Install and run ${topic} locally from scratch: the exact commands that start it, what to do first once it is running, and how to stop and remove it afterwards.`;
}

// A learner types a lesson request, not a package name: "Grafana, hands-on",
// "Azure Container Apps, from scratch". The clause before the first comma is
// the thing itself, and the trailing lesson words are noise that pulls the
// match off — asked for "Azure Container Apps, hands-on" verbatim, the endpoint
// once answered with an SRE agent.
const LESSON_PHRASING =
	/\b(hands[- ]?on|from scratch|for beginners|basics|step by step|locally|on this mac|tutorial|lesson)\b/gi;

function libraryNameFrom(topic: string): string {
	const head = topic.split(",")[0] ?? topic;
	const cleaned = head.replace(LESSON_PHRASING, "").replace(/\s+/g, " ").trim();
	// A topic that is nothing BUT lesson phrasing still has to ask something
	return cleaned || topic.trim();
}

export async function fetchDocs(
	topic: string,
): Promise<DocBriefing | undefined> {
	const libraryName = libraryNameFrom(topic);
	const listing = await callTool(
		"resolve-library-id",
		{ query: docsQuery(libraryName), libraryName },
		RESOLVE_TIMEOUT_MS,
	);
	const library = listing ? firstLibrary(listing) : undefined;
	// A topic context7 has never heard of is normal — the lesson is taught from
	// the model's own knowledge, exactly as it was before this file existed.
	if (!library || !titleMatchesTopic(library.title, libraryName)) {
		return undefined;
	}
	const text = await callTool(
		"query-docs",
		{ libraryId: library.libraryId, query: docsQuery(topic) },
		QUERY_TIMEOUT_MS,
	);
	if (!text) return undefined;
	return { libraryId: library.libraryId, text: clamp(text, DOC_CHAR_BUDGET) };
}

// The briefing as the tutor reads it — it arrives as part of the first message
// of the lesson. It says where the material came from and how far it goes,
// because a tutor that mistakes an excerpt for the whole documentation will
// teach past the end of it.
//
// A caption, not something the learner said: they never see this text, so it
// asks for nothing on their behalf. It used to end "say so when something I ask
// about is not in it" — an instruction to write, in a card, about a document
// the learner cannot see. The honest form of that is a card admitting a detail
// is unverified, and that rule lives in prompts/modes/lab.md.
export function renderDocs(briefing: DocBriefing): string {
	return [
		`Current documentation for this topic, which the app looked up before the lesson opened (context7, ${briefing.libraryId}). It is an excerpt aimed at installing the thing and running it, not the whole manual — prefer it over memory for the exact commands, and where it stops, say a detail is unverified rather than sounding certain. I have not seen it:`,
		"",
		briefing.text,
	].join("\n");
}

export async function describeDocs(topic: string): Promise<string | undefined> {
	const briefing = await fetchDocs(topic);
	return briefing && renderDocs(briefing);
}
