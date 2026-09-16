// The verification loop, checked from both ends. Run with: pnpm smoke:verify
//
// The allowlist half is token-free and is the part that matters: it is the
// security boundary of the lab mode, so it is tested as a table of things that
// must run and things that must never. The judge half spends a few cents on
// canned outputs — no lesson, no model-written commands, just verdicts.
import { judgeVerify } from "../src/bun/claude";
import { isAllowed, runCheck, setLabFolder } from "../src/bun/verify";

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
	if (condition) {
		console.log(`  ok  ${name}`);
	} else {
		failures++;
		console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

// Read-only commands a lab lesson has a real reason to propose.
const ALLOWED: string[][] = [
	["docker", "ps", "--filter", "name=grafana", "--format", "{{.Status}}"],
	["docker", "inspect", "grafana"],
	["docker", "images"],
	["docker", "--version"],
	["docker", "logs", "--tail", "20", "grafana"],
	["kubectl", "get", "pods"],
	["kubectl", "config", "current-context"],
	["kubectl", "config", "view"],
	["helm", "list"],
	["git", "status"],
	["which", "docker"],
	["node", "--version"],
	["curl", "-s", "http://localhost:3000/api/health"],
	["curl", "-sf", "http://127.0.0.1:8080"],
	["curl", "-sS", "http://localhost:3000"],
];

// Everything below is a way of getting the app to change something, reach
// somewhere it has no business, or hang. None of them may ever be offered.
const REFUSED: [string[], string][] = [
	[
		["docker", "run", "-d", "-p", "3000:3000", "grafana/grafana"],
		"starts a container",
	],
	[["docker", "rm", "-f", "grafana"], "removes a container"],
	[["docker", "stop", "grafana"], "stops a container"],
	[["docker", "logs", "-f", "grafana"], "never returns"],
	[["docker", "logs", "--follow", "grafana"], "never returns, long form"],
	[["kubectl", "delete", "pod", "web"], "deletes"],
	[["kubectl", "apply", "-f", "deploy.yaml"], "writes to a cluster"],
	[
		["kubectl", "config", "use-context", "prod-eu-1"],
		"switches the learner's cluster",
	],
	[["rm", "-rf", "/tmp/x"], "not on the allowlist at all"],
	[["bash", "-c", "docker ps"], "a shell"],
	[["sh", "-c", "echo hi"], "a shell"],
	[["/usr/bin/docker", "ps"], "a path, not a binary name"],
	[["../docker", "ps"], "a relative path"],
	[["curl", "https://example.com"], "somewhere other than this machine"],
	[["curl", "-s", "http://192.168.1.4:3000"], "another host on the network"],
	[["curl", "-X", "POST", "http://localhost:3000"], "not a GET"],
	[["curl", "-o", "/tmp/out", "http://localhost:3000"], "writes a file"],
	[["docker"], "no subcommand"],
	[["git", "push"], "writes to a remote"],
	[["npm", "install"], "installs"],
	[["node", "server.js"], "runs a script"],
	[["which", "/bin/sh"], "a path rather than a tool name"],
	[["which", "-a", "docker"], "a flag rather than a tool name"],
	[["which"], "nothing to look for"],
	[
		["curl", "-so", "/tmp/out", "http://localhost:3000"],
		"a combined flag that writes a file",
	],
	[
		["curl", "-sfX", "POST", "http://localhost:3000"],
		"a combined flag that changes the method",
	],
];

// ls and cat are the two checks that need a place as well as a name, and they
// are refused outright until the lesson has a folder of its own.
console.log("The allowlist — reading files, with no lab folder open:");
for (const argv of [["ls"], ["ls", "-la"], ["cat", "Dockerfile"]]) {
	check(`${argv.join(" ")} is refused without a folder`, !isAllowed(argv));
}

setLabFolder("/tmp/tuto-lab-smoke");
console.log("\nThe allowlist — reading files, with one open:");
for (const argv of [
	["ls"],
	["ls", "-la", "."],
	["cat", "Dockerfile"],
	["cat", "app/main.py"],
]) {
	check(`${argv.join(" ")} may run inside the folder`, isAllowed(argv));
}
for (const [argv, why] of [
	[["cat", "/etc/passwd"], "an absolute path outside"],
	[["cat", "../../.ssh/id_rsa"], "walking out with .."],
	[["ls", "/"], "the root of the machine"],
	[["ls", "~"], "a path that reads as the home folder"],
	[["cat", "-v", "/etc/hosts"], "a flag does not make it inside"],
	[["ls", "-R", "."], "recursing without limit"],
	[["cat"], "would sit on standard input until the timeout"],
] as [string[], string][]) {
	check(`${argv.join(" ")} is refused (${why})`, !isAllowed(argv));
}
setLabFolder(undefined);

console.log("\nThe allowlist — what may run:");
for (const argv of ALLOWED) {
	check(argv.join(" "), isAllowed(argv));
}
console.log("\nThe allowlist — what must never run:");
for (const [argv, why] of REFUSED) {
	check(`${argv.join(" ")}  (${why})`, !isAllowed(argv));
}

// A refused command must come back as a refusal, not as an execution.
const refused = await runCheck({
	argv: ["docker", "rm", "-f", "grafana"],
	expect: "anything",
});
console.log("\nRunning a refused command:");
check("it is refused rather than run", refused.refused === true);
check("and it printed nothing", refused.output === "");

// A real, harmless check against this machine. Whatever the answer is, the
// runner has to come back with output and an exit code rather than throwing.
const real = await runCheck({
	argv: ["docker", "ps", "--format", "{{.Names}}"],
	expect: "A list of container names, possibly empty.",
});
console.log("\nRunning a real check:");
console.log(`  $ ${real.command}`);
console.log(
	`  exit ${real.exitCode}: ${real.output.slice(0, 120) || "(no output)"}`,
);
check("a real check returns rather than throwing", real.refused !== true);

// A binary that is not installed is an answer about the machine, not a crash.
const missing = await runCheck({
	argv: ["helm", "list"],
	expect: "A list of releases.",
});
console.log("\nRunning a check for a tool that may be missing:");
check(
	"a missing binary comes back as output, not an exception",
	typeof missing.output === "string",
	`exit ${missing.exitCode}: ${missing.output.slice(0, 80)}`,
);

// The judge, on outputs written by hand so the verdict is knowable in advance.
const JUDGED: {
	name: string;
	expect: string;
	taskExpect: string;
	output: string;
	exitCode: number;
	pass: boolean;
}[] = [
	{
		name: "a running container passes",
		expect: 'One line starting with "Up".',
		taskExpect:
			"Docker prints a long container id and returns you to the prompt.",
		output: "Up 2 minutes",
		exitCode: 0,
		pass: true,
	},
	{
		name: "a container that exited fails",
		expect: 'One line starting with "Up".',
		taskExpect:
			"Docker prints a long container id and returns you to the prompt.",
		output: "Exited (1) 3 seconds ago",
		exitCode: 0,
		pass: false,
	},
	{
		name: "no output at all fails",
		expect: 'One line starting with "Up".',
		taskExpect:
			"Docker prints a long container id and returns you to the prompt.",
		output: "",
		exitCode: 0,
		pass: false,
	},
	{
		name: "a health endpoint answering passes",
		expect: 'JSON with "database": "ok" in it.',
		taskExpect: "Grafana answers on port 3000.",
		output: '{"commit":"abc123","database":"ok","version":"11.2.0"}',
		exitCode: 0,
		pass: true,
	},
	{
		name: "a connection refused fails",
		expect: 'JSON with "database": "ok" in it.',
		taskExpect: "Grafana answers on port 3000.",
		output:
			"curl: (7) Failed to connect to localhost port 3000: Connection refused",
		exitCode: 7,
		pass: false,
	},
];

console.log("\nThe judge, on canned output:");
for (const item of JUDGED) {
	const verdict = await judgeVerify(
		{ command: "(canned)", output: item.output, exitCode: item.exitCode },
		item.expect,
		item.taskExpect,
	);
	check(
		`${item.name} — ${verdict.pass ? "pass" : "fail"}`,
		verdict.pass === item.pass,
		`expected ${item.pass ? "pass" : "fail"}; note: ${verdict.note}`,
	);
	console.log(`      note: ${verdict.note}`);
}

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log("\nPASS");
