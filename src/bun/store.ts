// Persistence for saved lessons. lesson.json holds the webview's display
// snapshot plus bun-owned metadata (session id, language, timestamps) so a
// lesson can be listed on the home screen and fully rehydrated on resume.

import { readdir, rm } from "node:fs/promises";
import type {
	LessonRecord,
	LessonSnapshot,
	LessonSummary,
} from "../shared/types";
import { lessonDir, lessonsDir } from "./paths";

function recordPath(id: string): string {
	return `${lessonDir(id)}/lesson.json`;
}

// Save a snapshot, merging bun-owned metadata. createdAt is preserved from the
// existing record so it reflects when the lesson was first started.
export async function saveLesson(
	snapshot: LessonSnapshot,
	meta: { sessionId?: string; language?: string },
): Promise<void> {
	const now = new Date().toISOString();
	const existing = await loadLesson(snapshot.id);
	const record: LessonRecord = {
		...snapshot,
		sessionId: meta.sessionId,
		language: meta.language,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
	await Bun.write(recordPath(snapshot.id), JSON.stringify(record, null, 2));
}

export async function loadLesson(id: string): Promise<LessonRecord | null> {
	try {
		const file = Bun.file(recordPath(id));
		if (!(await file.exists())) return null;
		return (await file.json()) as LessonRecord;
	} catch (error) {
		console.error(`failed to load lesson ${id}:`, error);
		return null;
	}
}

export async function listLessons(): Promise<LessonSummary[]> {
	let ids: string[];
	try {
		ids = await readdir(lessonsDir());
	} catch {
		return []; // no lessons dir yet
	}
	const records = await Promise.all(ids.map((id) => loadLesson(id)));
	return records
		.filter((record): record is LessonRecord => record !== null)
		.map((record) => ({
			id: record.id,
			topic: record.topic,
			updatedAt: record.updatedAt,
			conceptCount: record.outline?.length ?? 0,
			currentIndex: record.outline
				? record.outline.findIndex(
						(item) => item.id === record.currentConceptId,
					)
				: -1,
			ended: record.feed.at(-1)?.card?.type === "recap",
		}))
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteLesson(id: string): Promise<void> {
	try {
		await rm(lessonDir(id), { recursive: true, force: true });
	} catch (error) {
		console.error(`failed to delete lesson ${id}:`, error);
	}
}
