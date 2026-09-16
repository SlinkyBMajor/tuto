// What this machine already has, read once before a lab lesson starts.
//
// The repo-map pattern (repo-map.ts) pointed at the machine instead of a
// project: a token-free orientation pass whose result goes into the opening
// message, so the tutor plans setup around what is here and never writes an
// "install Docker" card at somebody who has Docker.
//
// Every command in this file is a fixed argv array written by us, run with no
// shell, and read-only. Nothing here comes from the model, and nothing here
// changes the machine — see docs/adr/0001-the-learner-executes-the-app-only-verifies.md.
// The probes read local config; none of them is a login, a purchase, or a
// deploy, and none of them prints a secret.

// Local probes answer immediately. The two that may refresh a cached token get
// longer, and everything runs in parallel, so the whole pass costs one timeout
// at worst.
const PROBE_TIMEOUT_MS = 2_000;
const CLOUD_PROBE_TIMEOUT_MS = 5_000;

// Tools a lab lesson is likely to build on, in the order a report reads best
const TOOLS = [
	"docker",
	"kubectl",
	"helm",
	"git",
	"node",
	"python3",
	"brew",
] as const;

// Kubernetes contexts that run on this Mac. Anything else is somebody's real
// cluster until proven otherwise — the local ones are a short, known list, and
// the remote ones are every name a person might give a cluster.
const LOCAL_KUBE_CONTEXTS = [
	"docker-desktop",
	"minikube",
	"orbstack",
	"rancher-desktop",
	"colima",
];
const LOCAL_KUBE_PREFIXES = ["kind-", "k3d-"];

export interface MachineProbe {
	// Installed tools, name → short version ("27.3.1"). Absent means not found.
	tools: Record<string, string>;
	docker: { context?: string; daemonRunning: boolean };
	kubernetes: { context?: string; kubeconfigSet: boolean };
	// Cloud CLIs that are logged in, with what they are pointed at
	clouds: { name: string; account: string }[];
}

// One read-only command. A failure of any kind — missing binary, non-zero exit,
// timeout — is "not found": the report says what it could see, never why it
// could not see something.
async function run(
	argv: string[],
	timeoutMs = PROBE_TIMEOUT_MS,
): Promise<string | undefined> {
	try {
		const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore" });
		const timer = setTimeout(() => proc.kill(), timeoutMs);
		try {
			const [output, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				proc.exited,
			]);
			if (exitCode !== 0) return undefined;
			return output.trim() || undefined;
		} finally {
			clearTimeout(timer);
		}
	} catch {
		return undefined; // the binary is not on this machine
	}
}

// "Docker version 27.3.1, build 41ca978" → "27.3.1". The whole line is noise in
// a report the tutor has to plan from; the number is the part that decides
// whether a command exists yet.
function shortVersion(output: string | undefined): string | undefined {
	if (!output) return undefined;
	const match = output.match(/\d+(?:\.\d+)+/);
	return match?.[0] ?? output.split("\n")[0]?.slice(0, 40);
}

// Most tools answer `--version`. The two that do not are worth spelling out:
// `kubectl --version` is an error, and helm's long form prints a git SHA.
const VERSION_ARGS: Record<string, string[]> = {
	kubectl: ["version", "--client"],
	helm: ["version", "--short"],
};

async function probeTool(name: string): Promise<[string, string] | undefined> {
	if (!Bun.which(name)) return undefined;
	const version = shortVersion(
		await run([name, ...(VERSION_ARGS[name] ?? ["--version"])]),
	);
	return [name, version ?? "present"];
}

async function probeAzure(): Promise<{ name: string; account: string }[]> {
	if (!Bun.which("az")) return [];
	const output = await run(
		["az", "account", "show", "--query", "name", "--output", "tsv"],
		CLOUD_PROBE_TIMEOUT_MS,
	);
	return output ? [{ name: "Azure CLI (az)", account: output }] : [];
}

async function probeGcloud(): Promise<{ name: string; account: string }[]> {
	if (!Bun.which("gcloud")) return [];
	const output = await run(
		["gcloud", "config", "get-value", "account"],
		CLOUD_PROBE_TIMEOUT_MS,
	);
	// gcloud answers "(unset)" rather than failing when nobody is logged in
	if (!output || output.startsWith("(")) return [];
	return [{ name: "Google Cloud CLI (gcloud)", account: output }];
}

// No subprocess: AWS_PROFILE is the thing that decides which account a command
// lands in, and it is already in this process's environment.
function probeAws(): { name: string; account: string }[] {
	const profile = process.env.AWS_PROFILE?.trim();
	if (!profile) return [];
	return [{ name: "AWS CLI (aws)", account: `profile ${profile}` }];
}

// The probe is asked for twice within a second at the start of a lab lesson:
// once by the webview, to warn the learner before anything happens, and once by
// the mode, to write the opening message. Running eight subprocesses twice for
// the same answer is waste, and the machine cannot meaningfully change between
// the two — so a fresh result is held briefly and handed to both.
//
// Deliberately short. A lesson resumed an hour later must re-read the machine,
// because that is exactly when the container has been stopped and the work
// cluster has become the current context.
const PROBE_CACHE_MS = 30_000;
let cached: { at: number; probe: MachineProbe } | undefined;

export async function probeMachine(): Promise<MachineProbe> {
	if (cached && Date.now() - cached.at < PROBE_CACHE_MS) return cached.probe;
	const probe = await readMachine();
	cached = { at: Date.now(), probe };
	return probe;
}

async function readMachine(): Promise<MachineProbe> {
	const [found, dockerContext, dockerInfo, kubeContext, azure, gcloud] =
		await Promise.all([
			Promise.all(TOOLS.map(probeTool)),
			run(["docker", "context", "show"]),
			run(["docker", "info", "--format", "{{.ServerVersion}}"]),
			run(["kubectl", "config", "current-context"]),
			probeAzure(),
			probeGcloud(),
		]);
	return {
		tools: Object.fromEntries(found.filter((entry) => entry !== undefined)),
		docker: { context: dockerContext, daemonRunning: Boolean(dockerInfo) },
		kubernetes: {
			context: kubeContext,
			kubeconfigSet: Boolean(process.env.KUBECONFIG),
		},
		clouds: [...azure, ...gcloud, ...probeAws()],
	};
}

function isLocalCluster(context: string): boolean {
	return (
		LOCAL_KUBE_CONTEXTS.includes(context) ||
		LOCAL_KUBE_PREFIXES.some((prefix) => context.startsWith(prefix))
	);
}

// What the app tells the learner before the lesson opens, written here rather
// than by the tutor. A lesson that is about to touch a real cluster or a real
// cloud account has to say so, and that must not depend on a model remembering
// a prompt rule — so these come out of the probe deterministically, and the
// tutor's own `caution` fields are a second layer on top.
export function machineWarnings(probe: MachineProbe): string[] {
	const warnings: string[] = [];
	const context = probe.kubernetes.context;
	if (context && !isLocalCluster(context)) {
		warnings.push(
			`Your kubectl points at \`${context}\`, which does not look like a cluster on this Mac. Switch context before any step that touches Kubernetes.`,
		);
	}
	for (const cloud of probe.clouds) {
		warnings.push(
			`The ${cloud.name} is logged in to ${cloud.account}. Anything this lesson creates there is real, and may bill.`,
		);
	}
	return warnings;
}

// What changed on this machine since the lesson was last open.
//
// A lab lesson is about the state of a real machine, and that state does not
// wait for the learner. They quit halfway, stop the container, switch clusters,
// and come back a day later to a lesson whose next card assumes none of it —
// so the app says what moved before the tutor says anything at all.
//
// Only losses and switches, never gains: somebody who started Docker before
// re-opening the lesson does not need telling that Docker is running.
export function probeDrift(
	before: MachineProbe,
	after: MachineProbe,
): string[] {
	const notes: string[] = [];
	for (const [name] of Object.entries(before.tools)) {
		if (!after.tools[name]) {
			notes.push(
				`\`${name}\` was installed when you left this lesson, and is not on this machine now.`,
			);
		}
	}
	if (before.docker.daemonRunning && !after.docker.daemonRunning) {
		notes.push(
			"Docker was running when you left this lesson. Its daemon is not answering now, so anything you started with it has stopped.",
		);
	}
	const wasContext = before.kubernetes.context;
	const nowContext = after.kubernetes.context;
	if (wasContext && nowContext && wasContext !== nowContext) {
		notes.push(
			`Your kubectl context was \`${wasContext}\` during this lesson and is \`${nowContext}\` now.`,
		);
	}
	const wasLoggedIn = new Set(before.clouds.map((cloud) => cloud.name));
	for (const cloud of after.clouds) {
		if (!wasLoggedIn.has(cloud.name)) {
			notes.push(
				`The ${cloud.name} was not logged in during this lesson and is now, to ${cloud.account}.`,
			);
		}
	}
	return notes;
}

// The probe as the tutor reads it — it arrives as part of the first message of
// the lesson, and it is the learner's machine being described. Everything here
// was read from disk, so the tutor plans around what is present instead of
// asking.
//
// It is a caption, not something the learner said, and it carries no
// instructions in their voice. An instruction here is one the tutor will
// visibly comply with — "you already have Docker, so we can skip that" — about
// a message the learner never sent and never saw. What the tutor should DO with
// the report belongs in prompts/modes/lab.md, with the rest of the rules.
export function renderMachine(probe: MachineProbe): string {
	const installed = Object.entries(probe.tools)
		.map(([name, version]) => `${name} ${version}`)
		.join(", ");
	const missing = TOOLS.filter((name) => !probe.tools[name]);
	const lines = [
		"What the app read off this Mac from disk just now, before the lesson opened:",
		installed ? `- Installed: ${installed}` : "- Installed: none of the usual",
	];
	if (missing.length > 0) lines.push(`- Not installed: ${missing.join(", ")}`);
	if (probe.tools.docker) {
		const context = probe.docker.context
			? ` (context ${probe.docker.context})`
			: "";
		lines.push(
			probe.docker.daemonRunning
				? `- Docker: the daemon is running${context}`
				: `- Docker: installed, but the daemon is not running${context}`,
		);
	}
	if (probe.kubernetes.context) {
		const kubeconfig = probe.kubernetes.kubeconfigSet
			? ", and KUBECONFIG is set"
			: "";
		lines.push(
			`- Kubernetes: current context is ${probe.kubernetes.context}${kubeconfig}`,
		);
	}
	// The CLI, not the account. Which subscription or which email is the
	// learner's business and belongs in the warning they read; the tutor only
	// needs to know that a step here could land somewhere real.
	for (const cloud of probe.clouds) {
		lines.push(`- ${cloud.name}: logged in`);
	}
	lines.push(
		"",
		"That is the whole of what the app looked at, and it looks for the same short list of tools on every lab lesson — a tool missing from it is not a sign that this lesson needs it. None of this was shown to me.",
	);
	return lines.join("\n");
}

export async function describeMachine(): Promise<string> {
	return renderMachine(await probeMachine());
}
