import type {
	Card,
	Exercise,
	LessonSummary,
	OutlineItem,
	ProjectRef,
	SavedThread,
} from "../../shared/types";

// Stands in for a folder the learner picked, so the codebase-lesson chrome can
// be rendered outside the app shell (?demoproject)
export const DEMO_PROJECT: ProjectRef = {
	path: "/Users/you/Documents/GitHub/everest",
	name: "everest",
};

// Lookups of the kind a codebase lesson streams while it plans, for rendering
// the planning screen without a model call (?demoplanning&demoproject)
export const DEMO_ACTIVITY = [
	"Reading services/auth-service/docs/system/oauth.md",
	"Reading services/auth-service/docs/system/security.md",
	"Reading docs/adr/0007-bff-token-handler-pattern.md",
	"Searching for scopedRoles|resolveActiveGrants",
	"Reading services/auth-service/src/tokens/token.service.ts",
];

export const DEMO_LESSONS: LessonSummary[] = [
	{
		id: "demo-kafka",
		topic: "Kafka, from the basics",
		updatedAt: new Date(Date.now() - 12 * 60000).toISOString(),
		conceptCount: 5,
		currentIndex: 2,
		ended: false,
		mode: "topic",
	},
	{
		id: "demo-auth",
		topic: "How identity and org-scoped tokens work",
		updatedAt: new Date(Date.now() - 4 * 3600000).toISOString(),
		conceptCount: 6,
		currentIndex: 1,
		ended: false,
		mode: "codebase",
		project: "everest",
	},
	{
		id: "demo-k8s",
		topic: "Kubernetes networking",
		updatedAt: new Date(Date.now() - 26 * 3600000).toISOString(),
		conceptCount: 8,
		currentIndex: 7,
		ended: true,
		mode: "topic",
	},
	{
		id: "demo-rust",
		topic: "Rust ownership and borrowing",
		updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
		conceptCount: 0,
		currentIndex: -1,
		ended: false,
		mode: "topic",
	},
];

// Fixture data for UI iteration without model calls: open the app (or the
// vite dev server) with ?demo to preload the feed with these.
export const DEMO_TOPIC = "Kafka, from the basics";

export const DEMO_OUTLINE: OutlineItem[] = [
	{ id: "what-kafka-is", title: "What Kafka is" },
	{ id: "consuming", title: "Consuming" },
	{ id: "message-flow", title: "Message flow" },
	{ id: "partitions", title: "Partitions" },
	{ id: "consumer-groups", title: "Consumer groups" },
];

export const DEMO_EXERCISES: Exercise[] = [
	{
		conceptId: "consuming",
		question: "What does this consumer need so Kafka can track its position?",
		code: {
			language: "js",
			source:
				'const consumer = kafka.consumer({ ____: "my-app" });\n\nawait consumer.subscribe({ topic: "orders" });',
		},
		answer: "groupId",
	},
	{
		conceptId: "message-flow",
		question:
			"Two services both need every message from the orders topic. What must differ between them?",
		code: {
			language: "js",
			source:
				'// Billing service\nkafka.consumer({ groupId: "billing" });\n\n// Analytics service\nkafka.consumer({ groupId: ____ });',
		},
		answer: 'a different group id, e.g. "analytics"',
	},
];

export const DEMO_NOTES = `# Kafka, from the basics

## What Kafka is

Kafka keeps every message on disk for a set time, whether anyone read it or not. Consumers just remember their own position and read at their own pace.

## Consuming

A consumer subscribes to a topic and reads messages in order.

\`\`\`js
const consumer = kafka.consumer({ groupId: "my-app" });
await consumer.subscribe({ topic: "orders" });
\`\`\`

> **Key takeaway** — Kafka tracks a reading position per \`groupId\`, not per consumer.

### Consumer groups

Two apps that both need every message use different group ids — each group tracks its own reading position.

## Message flow

Producers write to a topic; consumers read from it independently.

\`\`\`mermaid
flowchart LR
  P1[Order service] --> T[(orders topic)]
  T --> C1[Billing consumer]
  T --> C2[Analytics consumer]
\`\`\`

## Summary

Topics are append-only logs; producers write, consumers read independently at their own pace.
`;

// Conversations hanging off sections of the fixture cards, so the margin can be
// seen full without an RPC bridge: one thread that ran to several questions,
// and one that was a single exchange.
export const DEMO_THREADS: SavedThread[] = [
	{
		id: "demo-thread-groups",
		cardIndex: 1,
		segmentIndex: 2,
		messages: [
			{
				role: "user",
				text: "Why does the position belong to the group and not to the consumer?",
			},
			{
				role: "tutor",
				text: "So a group can gain or lose consumers without losing its place. If the position lived on the consumer, restarting one would restart its reading.\n\nKafka keeps it per `groupId` and per partition, in an internal topic called `__consumer_offsets`.",
			},
			{
				role: "user",
				text: "What happens if two different groups read the same topic?",
			},
			{
				role: "tutor",
				text: "Each keeps its own position, so both see every message. That is how one topic feeds billing and analytics at the same time.",
			},
		],
	},
	{
		id: "demo-thread-producer",
		cardIndex: 2,
		segmentIndex: 0,
		messages: [
			{ role: "user", text: "Is a producer always a separate service?" },
			{
				role: "tutor",
				text: "No. A producer is any code holding a Kafka client that calls `send`. It is usually part of a service that does other work too.",
			},
		],
	},
];

export const DEMO_CARDS: Card[] = [
	{
		type: "question",
		title: "Where are you starting from?",
		body: "So I can pitch this right:",
		prerequisite: {
			topic: "Publish and subscribe",
			reason:
				"Kafka is a publish–subscribe log, so that pattern is the shape everything in it follows.",
		},
		options: [
			{
				id: "beginner",
				label: "New to messaging systems",
				description: "I haven't worked with queues or streaming before",
			},
			{
				id: "intermediate",
				label: "Know queues, new to Kafka",
				description: "I've used something like RabbitMQ or SQS",
			},
			{
				id: "advanced",
				label: "Used Kafka a bit",
				description: "I've produced or consumed messages already",
			},
		],
	},
	{
		type: "step",
		conceptId: "consuming",
		title: "Consuming messages",
		body: 'A consumer subscribes to a topic and reads messages in order.\n\n```js\nimport { Kafka } from "kafkajs";\n\nconst kafka = new Kafka({ brokers: ["localhost:9092"] });\nconst consumer = kafka.consumer({ groupId: "my-app" });\n\nawait consumer.subscribe({ topic: "orders" });\nawait consumer.run({\n  eachMessage: async ({ message }) => {\n    console.log(message.value.toString());\n  },\n});\n```\n\nThe `groupId` tells Kafka which reading position to track for your app.',
		takeaway:
			"Kafka tracks a reading position per `groupId`, not per consumer.",
	},
	{
		type: "step",
		conceptId: "message-flow",
		title: "How messages flow",
		body: "Producers write to a topic; consumers read from it independently.\n\n```mermaid\nflowchart LR\n  P1[Order service] --> T[(orders topic)]\n  P2[Checkout service] --> T\n  T --> C1[Billing consumer]\n  T --> C2[Analytics consumer]\n```\n\nBoth consumers see every message — reading does not remove anything. The `groupId` in [[card:Consuming messages]] is what keeps their positions apart.",
		hierarchy: {
			levels: [
				{ name: "Cluster", depth: 0, note: "the brokers, running together" },
				{ name: "Topic", depth: 1, note: "one named stream of messages" },
				{ name: "Partition", depth: 2, note: "one ordered log inside a topic" },
				{ name: "Message", depth: 3, note: "one record, at one offset" },
			],
			current: "Topic",
		},
		// Two takeaways in a row is rarer than this in a real lesson; the fixture
		// carries both so the panel can be checked after a code block and after a
		// diagram, and the card below shows what a card without one looks like.
		takeaway: "Reading a message does not remove it from the topic.",
	},
	{
		type: "step",
		conceptId: "message-flow",
		title: "A broken diagram (tests the fix path)",
		body: "The diagram below has a syntax error on purpose.\n\n```mermaid\nflowchart LR\n  A[Producer --> B[(topic)]\n  B --> C[Consumer\n```\n\nIn the app it should be silently repaired; in a plain browser it is hidden. A reference to [[card:No card by this name]] names no card in the feed, and must read as plain words rather than a dead link.",
	},
	{
		type: "recap",
		title: "What you covered",
		body: "You now know the core Kafka model: topics are append-only logs, producers write to them, and consumers read independently at their own pace, tracked per consumer group.\n\nPartitions split a topic for scale, and consumer groups share the reading work across app instances.",
		suggestions: [
			"Kafka delivery guarantees and exactly-once semantics",
			"Designing topics and partitions for a real system",
			"Kafka Streams for processing data inside Kafka",
		],
	},
];

// ?demolab — a hands-on lesson, for checking the lab panels without a model
// call: the plan card's requirements, a task card, and the pair a step that
// touches something real carries (a caution and a cost).
export const DEMO_LAB_TOPIC = "Grafana, hands-on";

export const DEMO_LAB_OUTLINE: OutlineItem[] = [
	{ id: "setup", title: "Setup" },
	{ id: "orientation", title: "What's Running" },
	{ id: "data-sources", title: "Data Sources" },
	{ id: "dashboards", title: "Dashboards" },
	{ id: "cleanup", title: "Clean Up" },
];

// What a resumed lesson would say has moved since it was last open (?demolab=resume)
export const DEMO_LAB_DRIFT = [
	"Docker was running when you left this lesson. Its daemon is not answering now, so anything you started with it has stopped.",
	"Your kubectl context was `orbstack` during this lesson and is `prod-eu-1` now.",
];

// What the app itself would say about this machine before the lesson starts
export const DEMO_LAB_WARNINGS = [
	"Your kubectl points at `prod-eu-1`, which does not look like a cluster on this Mac. Switch context before any step that touches Kubernetes.",
	"The Azure CLI (az) is logged in to Hydda Production. Anything this lesson creates there is real, and may bill.",
];

// What a failed check leaves on the card it checked, for ?demolab
export const DEMO_LAB_CHECK = {
	command: "curl -s http://localhost:3000/api/health",
	output:
		"curl: (7) Failed to connect to localhost port 3000: Connection refused",
	note: "Grafana is not listening on port 3000; the container is not running.",
};

export const DEMO_LAB_CARDS: Card[] = [
	{
		type: "step",
		conceptId: "setup",
		title: "What we will build",
		body: "We will run Grafana in one container on this Mac, connect it to a data source, and build a dashboard that updates while you watch it. Everything stays local.",
		requirements: [
			{
				name: "Docker Desktop",
				kind: "install",
				detail: "Free for personal use",
				cost: "free",
			},
			{ name: "Disk space", kind: "disk", detail: "About 1 GB of images" },
			{ name: "Time", kind: "time", detail: "About 45 minutes" },
		],
		notes: { sectionPath: ["Setup"] },
	},
	{
		type: "step",
		conceptId: "setup",
		title: "Start Grafana in a container",
		body: "Grafana ships as a container image, so there is nothing to install on the Mac itself.\n\n`-d` runs it in the background, and `-p 3000:3000` connects the container's port 3000 to the same port on this machine.",
		task: {
			kind: "run",
			command: "docker run -d -p 3000:3000 --name=grafana grafana/grafana-oss",
			expect:
				"Docker prints a long container id and returns you to the prompt.",
		},
		notes: { sectionPath: ["Setup"] },
	},
	{
		type: "step",
		conceptId: "orientation",
		title: "Open Grafana in the browser",
		body: "Grafana serves its whole interface over HTTP. The first sign-in asks you to replace the default password, which is the one thing to do before anything else.",
		task: {
			kind: "ui",
			command: "http://localhost:3000",
			expect: "A sign-in page. The first login is admin / admin.",
			verify: {
				argv: ["curl", "-s", "http://localhost:3000/api/health"],
				expect: 'JSON with "database": "ok" in it.',
			},
		},
		takeaway:
			"Grafana is a web app in a container — nothing is installed on the Mac.",
		notes: { sectionPath: ["What's Running"] },
	},
	{
		type: "step",
		conceptId: "cleanup",
		title: "Stop and remove the container",
		body: "Removing the container removes the dashboards with it. That is the point of a lab: it leaves nothing behind.",
		caution:
			"Run `docker ps` first. This removes the container named `grafana` — check that it is the one you started here.",
		cost: "Free, and stays free. Nothing in this lesson bills; a hosted Grafana Cloud instance would start at around $9/month.",
		task: {
			kind: "run",
			command: "docker rm -f grafana",
			expect:
				"Docker prints the name back, and `docker ps` no longer lists it.",
		},
		notes: { sectionPath: ["Clean Up"] },
	},
	{
		type: "recap",
		title: "What you built",
		body: "You ran Grafana in a container, signed in, connected a data source, and built a dashboard over it — all on this Mac, and all removable in one command.",
		suggestions: [
			"Grafana alerting, hands-on",
			"Prometheus as a data source, hands-on",
		],
	},
];
