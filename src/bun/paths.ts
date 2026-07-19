// Filesystem layout for saved lessons. Each lesson is a folder under the
// app data dir holding lesson.json (the display snapshot), notes.md (the
// rendered notes), and notes.json (the notes section tree for resume).

export function dataDir(): string {
	const home = process.env.HOME ?? ".";
	if (process.platform === "darwin") {
		return `${home}/Library/Application Support/tuto`;
	}
	return `${home}/.tuto`;
}

export function lessonsDir(): string {
	return `${dataDir()}/lessons`;
}

export function lessonDir(id: string): string {
	return `${lessonsDir()}/${id}`;
}

function slugify(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "lesson"
	);
}

// Human-browsable folder id: date + topic slug + a short random suffix so two
// lessons on the same topic on the same day don't collide.
export function makeLessonId(topic: string): string {
	const stamp = new Date().toISOString().slice(0, 10);
	return `${stamp}-${slugify(topic)}-${Math.random().toString(36).slice(2, 6)}`;
}
