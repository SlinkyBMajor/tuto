import type { Card, OutlineItem } from "../../shared/types";

// Fixture data for UI iteration without model calls: open the app (or the
// vite dev server) with ?demo to preload the feed with these.
export const DEMO_OUTLINE: OutlineItem[] = [
	{ id: "what-kafka-is", title: "What Kafka is" },
	{ id: "consuming", title: "Consuming" },
	{ id: "message-flow", title: "Message flow" },
	{ id: "partitions", title: "Partitions" },
	{ id: "consumer-groups", title: "Consumer groups" },
];

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
