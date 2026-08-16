// A token-free orientation pass over a project, run in the Bun process before
// the lesson's first turn and handed to the tutor in its opening message.
//
// Walking a tree costs nothing here. Making the model discover the same thing
// costs a round of greps at the start of every lesson, and it discovers it
// worse: a project that documents itself has already written down where its
// parts are, and the tutor was finding those files by accident.

import { readdir } from "node:fs/promises";
import type { ProjectRef } from "../shared/types";

// Folders that hold what a project has written down about itself, in the order
// a reader wants them. `working-notes` is deliberately absent: it holds
// research, not decisions, and says so.
const DOC_FOLDERS = ["system", "architecture", "adr", "reference"] as const;

// Orientation files, best first — the whole point is the directory index a
// project keeps for newcomers.
const INDEX_FILES = ["AGENTS.md", "CLAUDE.md", "README.md"];

// Never worth walking into, and worktrees would list every doc a second time
const SKIP_DIRS = new Set([
	"node_modules",
	"dist",
	"build",
	"out",
	"target",
	"vendor",
	"coverage",
	"worktrees",
	"tmp",
	"__pycache__",
]);

// `services/<name>/docs` is depth 3; nothing useful hides deeper
const MAX_DEPTH = 4;
const MAX_DOC_DIRS = 40;
// Roughly a long AGENTS.md; enough that a typical one arrives whole
const INDEX_CHAR_BUDGET = 12_000;
const DOCS_CHAR_BUDGET = 8_000;

// Cut on a line boundary and say so, rather than stopping mid-sentence and
// leaving the tutor to guess whether it read the whole thing.
function clamp(text: string, budget: number): string {
	if (text.length <= budget) return text;
	const cut = text.slice(0, budget);
	const lastBreak = cut.lastIndexOf("\n");
	return `${cut.slice(0, lastBreak > budget / 2 ? lastBreak : budget)}\n\n[…truncated]`;
}

interface DocGroup {
	// Path of the docs subfolder, relative to the project root
	dir: string;
	files: string[];
}

export interface RepoMap {
	// Top-level directories, so a project with no docs still gets a shape
	roots: string[];
	// The project's own index file: which one, and what it says
	index?: { name: string; text: string };
	docs: DocGroup[];
}

async function readIndexFile(root: string): Promise<RepoMap["index"]> {
	for (const name of INDEX_FILES) {
		const file = Bun.file(`${root}/${name}`);
		if (!(await file.exists())) continue;
		const text = (await file.text()).trim();
		// A CLAUDE.md that only points at AGENTS.md is not orientation; keep
		// looking rather than handing the tutor a one-line redirect
		if (text.length < 200) continue;
		return { name, text: clamp(text, INDEX_CHAR_BUDGET) };
	}
	return undefined;
}

// Collect the documentation folders under one `docs/` directory
async function readDocFolders(
	root: string,
	relative: string,
): Promise<DocGroup[]> {
	const groups: DocGroup[] = [];
	for (const folder of DOC_FOLDERS) {
		let entries: string[];
		try {
			entries = await readdir(`${root}/${relative}/${folder}`);
		} catch {
			continue; // this project doesn't keep that kind of doc
		}
		const files = entries
			.filter((name) => name.endsWith(".md") && name !== "README.md")
			.sort();
		if (files.length > 0) {
			groups.push({ dir: `${relative}/${folder}`, files });
		}
	}
	return groups;
}

// Depth-first walk that prunes hard: it is looking for `docs/` folders and
// nothing else, and gives up once it has found more than a lesson can use.
async function findDocs(
	root: string,
	relative: string,
	depth: number,
	found: DocGroup[],
): Promise<void> {
	if (depth > MAX_DEPTH || found.length >= MAX_DOC_DIRS) return;
	const entries = await readdir(relative ? `${root}/${relative}` : root, {
		withFileTypes: true,
	}).catch(() => []); // unreadable folders are simply not part of the map
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
		const next = relative ? `${relative}/${entry.name}` : entry.name;
		if (entry.name === "docs") {
			found.push(...(await readDocFolders(root, next)));
		} else {
			await findDocs(root, next, depth + 1, found);
		}
	}
}

export async function readRepoMap(root: string): Promise<RepoMap> {
	let roots: string[] = [];
	try {
		roots = (await readdir(root, { withFileTypes: true }))
			.filter(
				(entry) =>
					entry.isDirectory() &&
					!entry.name.startsWith(".") &&
					!SKIP_DIRS.has(entry.name),
			)
			.map((entry) => entry.name)
			.sort();
	} catch {
		// An unreadable root is the caller's problem; an empty map is still valid
	}
	const docs: DocGroup[] = [];
	await findDocs(root, "", 0, docs);
	return { roots, index: await readIndexFile(root), docs };
}

// The map as the tutor reads it. Grouped by folder rather than one path per
// line: 180 file names cost a few hundred tokens this way.
function renderDocs(docs: DocGroup[]): string {
	const lines: string[] = [];
	let used = 0;
	for (const group of docs) {
		const line = `${group.dir}/ — ${group.files.join(", ")}`;
		if (used + line.length > DOCS_CHAR_BUDGET) {
			lines.push(
				`…and ${docs.length - lines.length} more documentation folders`,
			);
			break;
		}
		lines.push(line);
		used += line.length;
	}
	return lines.join("\n");
}

// The opening message's project briefing. Everything here was read from disk,
// so the tutor starts oriented instead of spending its first minute finding
// out what kind of project this is.
export function renderRepoMap(project: ProjectRef, map: RepoMap): string {
	const parts = [
		`The project I want to understand is open in your working directory: ${project.name} (${project.path}).`,
	];
	if (map.roots.length > 0) {
		parts.push(`Top-level folders: ${map.roots.join(", ")}`);
	}
	if (map.index) {
		parts.push(
			`Here is the project's own ${map.index.name}, in full:\n\n${map.index.text}`,
		);
	}
	if (map.docs.length > 0) {
		parts.push(
			`This project documents itself. Every file below exists — I listed them from disk, so you never need to search for them. This is an index to look things up in, not a reading list: open one when the card you are writing needs it, and confirm what it says against the code.\n\n${renderDocs(map.docs)}`,
		);
	}
	return parts.join("\n\n");
}

export async function describeRepo(project: ProjectRef): Promise<string> {
	return renderRepoMap(project, await readRepoMap(project.path));
}
