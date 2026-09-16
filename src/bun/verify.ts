// The one thing the app executes on the learner's behalf, and the narrowest
// thing it could be: a read-only check that a step actually worked.
//
// The rules are the spine of the lab mode, not a configuration:
// docs/adr/0001-the-learner-executes-the-app-only-verifies.md.
//
//   1. The tutor proposes an ARGV ARRAY, never a shell string. It is spawned
//      directly, so no shell parses model output at any point — there is no
//      shell in the path, so there is no shell injection in the path.
//   2. The binary must be on the allowlist below, and the subcommand must be in
//      that binary's read-only set. Both lists live here, in our code.
//   3. A check that fails validation is DROPPED at parse time, so it never
//      reaches the learner. The card falls back to "I did it" — a check the app
//      cannot vouch for must never become a prompt asking to permit it.
//   4. Nothing runs without the learner's click, under a consent they gave for
//      this lesson.

import { resolve } from "node:path";
import type { CardVerify } from "../shared/types";

// A check answers in a second or two. This is a backstop against a command that
// waits on something — `docker logs -f` with the flag slipped past the reader —
// not a budget.
const VERIFY_TIMEOUT_MS = 10_000;

// The tail, not the head: a check that prints pages is telling us about its
// last lines, and the judge reads what a person would look at.
const OUTPUT_BUDGET = 8_000;

// Subcommands that only ever report. `docker ps` lists; `docker run` does not
// belong here and never will — the learner runs that themselves, in their own
// terminal, which is the whole point of the mode.
const ALLOWED: Record<string, readonly string[]> = {
	docker: ["ps", "images", "inspect", "version", "info", "port", "logs"],
	kubectl: ["get", "describe", "version", "config"],
	helm: ["list", "status", "version", "search"],
	git: ["status", "log", "remote", "version"],
	// No subcommands: these are only ever asked what version they are, and an
	// empty list means exactly that — see isAllowed.
	node: [],
	python3: [],
	npm: [],
	pnpm: [],
	// Three shapes of their own, none of them a subcommand: `which <tool>`
	// answers whether something is installed, curl is GET-at-this-machine only,
	// and ls/cat are confined to the lesson's own folder.
	which: [],
	curl: [],
	ls: [],
	cat: [],
};

// `ls` and `cat` are the two checks that need a place as well as a name: "did
// the file you wrote land where it should?" They are allowed only inside the
// lesson's own folder, which the app created — never anywhere else on the
// machine, and never at all in a lesson that has no folder.
let labFolder: string | undefined;

export function setLabFolder(dir: string | undefined): void {
	labFolder = dir ? resolve(dir) : undefined;
}

// Resolved before comparing, so `..` cannot walk out of the folder and a
// symlinked path cannot pretend to be inside it.
function isInsideLabFolder(args: string[], allowBare: boolean): boolean {
	if (!labFolder) return false;
	const paths = args.filter((arg) => !arg.startsWith("-"));
	// A bare `ls` lists the folder itself, which is the commonest check of all.
	// A bare `cat` reads standard input and would sit there until the timeout.
	if (paths.length === 0) {
		return allowBare && args.every((arg) => arg.startsWith("-"));
	}
	// There is no shell here, so `~` is a literal directory name and would in
	// fact resolve inside the folder. Refused anyway: a check that reads as
	// "list my home directory" must not be one this app runs, whatever it
	// actually means.
	if (paths.some((path) => path.startsWith("~"))) return false;
	// Only the harmless listing flags; nothing that follows or recurses far
	if (
		!args
			.filter((arg) => arg.startsWith("-"))
			.every((flag) => /^-[lah1]+$/.test(flag))
	) {
		return false;
	}
	return paths.every((path) => {
		const full = resolve(labFolder ?? "", path);
		return full === labFolder || full.startsWith(`${labFolder}/`);
	});
}

// `which docker` is the cheapest possible "is it installed?", and it reads
// PATH and nothing else. One bare name, so it cannot be handed a path or a flag.
const TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// `kubectl config` can write (`set-context`, `use-context`); only these read.
const KUBECTL_CONFIG_READS = ["view", "current-context", "get-contexts"];

// The only flags curl may carry. Anything that writes a file, changes the
// method, or uploads is absent by construction rather than by inspection —
// there is no -o, no -X, no -d, and adding one is a decision, not a tweak.
// Short flags combine (`-sf`), so they are checked letter by letter.
const CURL_SHORT = new Set(["s", "S", "f", "i", "I"]);
const CURL_LONG = ["--silent", "--fail", "--head", "--show-error"];

function isCurlFlag(flag: string): boolean {
	if (flag.startsWith("--")) return CURL_LONG.includes(flag);
	return (
		/^-[A-Za-z]+$/.test(flag) &&
		[...flag.slice(1)].every((letter) => CURL_SHORT.has(letter))
	);
}

// A check may only look at this machine. A URL pointing anywhere else is the
// tutor asking the app to make a request on the learner's behalf, which is not
// what verification is for.
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"];

function isLocalUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return false;
		return LOCAL_HOSTS.includes(url.hostname) || url.hostname === "::1";
	} catch {
		return false;
	}
}

// curl is the odd one out: no subcommand, and the argument that matters is the
// URL. GET only, this machine only, and a short list of flags that cannot
// change either of those.
function checkCurl(args: string[]): boolean {
	const urls = args.filter((arg) => !arg.startsWith("-"));
	if (urls.length !== 1 || !isLocalUrl(urls[0] ?? "")) return false;
	return args.filter((arg) => arg.startsWith("-")).every(isCurlFlag);
}

// Is this argv something the app is willing to run? Called at parse time, so a
// check that fails here is simply not offered, and again before spawning,
// because the webview is not the authority on what may run.
export function isAllowed(argv: readonly string[]): boolean {
	const [binary, ...args] = argv;
	if (!binary || argv.some((part) => typeof part !== "string")) return false;
	// A path is not a binary name: `/usr/bin/env docker …` and `../docker` are
	// both ways of getting somewhere this list does not cover.
	if (binary.includes("/") || binary.includes("\\")) return false;
	const subcommands = ALLOWED[binary];
	if (!subcommands) return false;
	if (binary === "curl") return checkCurl(args);
	if (binary === "which") {
		return args.length === 1 && TOOL_NAME.test(args[0] ?? "");
	}
	if (binary === "ls" || binary === "cat") {
		return isInsideLabFolder(args, binary === "ls");
	}
	// A version query is a read whatever the binary is
	if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
		return true;
	}
	if (subcommands.length === 0) return args.length === 0;
	const [subcommand, ...rest] = args;
	if (!subcommand || !subcommands.includes(subcommand)) return false;
	if (binary === "kubectl" && subcommand === "config") {
		return KUBECTL_CONFIG_READS.includes(rest[0] ?? "");
	}
	// `docker logs -f` never returns; the timeout would cover it, but a check
	// the learner waits ten seconds for is a broken check.
	if (binary === "docker" && subcommand === "logs") {
		return !rest.some((arg) => arg === "-f" || arg === "--follow");
	}
	return true;
}

export interface VerifyRun {
	// What the app actually ran, for the learner to see beside the result
	command: string;
	output: string;
	exitCode: number;
	// A check whose command was refused, or that never ran
	refused?: boolean;
}

function tail(text: string): string {
	if (text.length <= OUTPUT_BUDGET) return text;
	return `[…earlier output omitted]\n${text.slice(-OUTPUT_BUDGET)}`;
}

// Run one validated check. Output and exit code both come back: a command that
// exits non-zero has usually said why on stderr, and the judge reads both.
export async function runCheck(verify: CardVerify): Promise<VerifyRun> {
	const command = verify.argv.join(" ");
	if (!isAllowed(verify.argv)) {
		return { command, output: "", exitCode: -1, refused: true };
	}
	try {
		const proc = Bun.spawn(verify.argv as string[], {
			// So a relative path in a check means what it looks like it means
			cwd: labFolder,
			stdout: "pipe",
			stderr: "pipe",
		});
		const timer = setTimeout(() => proc.kill(), VERIFY_TIMEOUT_MS);
		try {
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
			return { command, output: tail(output), exitCode };
		} finally {
			clearTimeout(timer);
		}
	} catch (error) {
		// A missing binary lands here. It is a real answer about the machine, so
		// it goes to the judge as output rather than being thrown at the learner.
		return {
			command,
			output: error instanceof Error ? error.message : String(error),
			exitCode: -1,
		};
	}
}
