// Persistence for saved lessons. lesson.json holds the webview's display
// snapshot plus bun-owned metadata (session id, language, timestamps) so a
// lesson can be listed on the home screen and fully rehydrated on resume.

import { readdir, rm } from "node:fs/promises";
import type {
	LessonConfig,
	LessonRecord,
	LessonSnapshot,
	LessonSummary,
} from "../shared/types";
import { lessonDir, lessonsDir } from "./paths";

function recordPath(id: string): string {
	return `${lessonDir(id)}/lesson.json`;
}

// How a saved lesson was started. Records written before lesson modes existed
// have no config; they were all topic lessons, and their code language sat at
// the top level.
export function configOf(record: LessonRecord): LessonConfig {
	return (
		record.config ?? {
			mode: "topic",
			topic: record.topic,
			language: record.language,
		}
	);
}

// Save a snapshot, merging bun-owned metadata. createdAt is preserved from the
// existing record so it reflects when the lesson was first started.
export async function saveLesson(
	snapshot: LessonSnapshot,
	meta: { sessionId?: string; config?: LessonConfig },
): Promise<void> {
	const now = new Date().toISOString();
	const existing = await loadLesson(snapshot.id);
	const record: LessonRecord = {
		...snapshot,
		// Fall back to what is already on disk: a save for a lesson that is no
		// longer the open one arrives with no metadata, and dropping the session
		// id would leave that lesson unable to resume its conversation.
		sessionId: meta.sessionId ?? existing?.sessionId,
		config: meta.config ?? existing?.config,
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
		.map((record) => {
			const config = configOf(record);
			return {
				id: record.id,
				topic: record.topic,
				updatedAt: record.updatedAt,
				conceptCount: record.outline?.length ?? 0,
				currentIndex: record.outline
					? record.outline.findIndex(
							(item) => item.id === record.currentConceptId,
						)
					: -1,
				// Reaching the recap ends a lesson; a follow-up answered after it
				// lands as an ordinary card and does not reopen it.
				ended: record.feed.some((item) => item.card?.type === "recap"),
				mode: config.mode,
				project: config.mode === "codebase" ? config.project.name : undefined,
			};
		})
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteLesson(id: string): Promise<void> {
	try {
		await rm(lessonDir(id), { recursive: true, force: true });
	} catch (error) {
		console.error(`failed to delete lesson ${id}:`, error);
	}
}
