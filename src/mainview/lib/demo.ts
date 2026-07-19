import type {
	Card,
	Exercise,
	LessonSummary,
	OutlineItem,
} from "../../shared/types";

export const DEMO_LESSONS: LessonSummary[] = [
	{
		id: "demo-kafka",
		topic: "Kafka, from the basics",
		updatedAt: new Date(Date.now() - 12 * 60000).toISOString(),
		conceptCount: 5,
		currentIndex: 2,
		ended: false,
	},
	{
		id: "demo-k8s",
		topic: "Kubernetes networking",
		updatedAt: new Date(Date.now() - 26 * 3600000).toISOString(),
		conceptCount: 8,
		currentIndex: 7,
		ended: true,
	},
	{
		id: "demo-rust",
		topic: "Rust ownership and borrowing",
		updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
		conceptCount: 0,
		currentIndex: -1,
		ended: false,
	},
];

// Fixture data for UI iteration without model calls: open the app (or the
// vite dev server) with ?demo to preload the feed with these.
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

export const DEMO_CARDS: Card[] = [
	{
		type: "question",
		title: "Where are you starting from?",
		body: "So I can pitch this right:",
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
	},
	{
		type: "step",
		conceptId: "message-flow",
		title: "How messages flow",
		body: "Producers write to a topic; consumers read from it independently.\n\n```mermaid\nflowchart LR\n  P1[Order service] --> T[(orders topic)]\n  P2[Checkout service] --> T\n  T --> C1[Billing consumer]\n  T --> C2[Analytics consumer]\n```\n\nBoth consumers see every message — reading does not remove anything.",
	},
	{
		type: "step",
		conceptId: "message-flow",
		title: "A broken diagram (tests the fix path)",
		body: "The diagram below has a syntax error on purpose.\n\n```mermaid\nflowchart LR\n  A[Producer --> B[(topic)]\n  B --> C[Consumer\n```\n\nIn the app it should be silently repaired; in a plain browser it is hidden.",
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
