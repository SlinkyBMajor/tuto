// Choosing the project a codebase lesson teaches from. The path picked here
// becomes the CLI's working directory for every turn of that lesson, so it is
// resolved and checked once, up front, rather than on each spawn.

import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { PickProjectResult } from "../shared/types";

// Open the OS folder dialog. A cancelled dialog is not an error: it comes back
// as a null project with nothing to report, and the field stays as it was.
//
// Electrobun is imported here rather than at the top of the file: importing it
// boots the app runtime (it binds a port and reads app resources), which hangs
// any headless script that only wanted describeProject — scripts/codebase-smoke.ts
// among them. Inside the app the module is already loaded, so this costs nothing.
export async function pickProject(): Promise<PickProjectResult> {
	let chosen: string[];
	try {
		const { Utils } = await import("electrobun/bun");
		chosen = await Utils.openFileDialog({
			canChooseFiles: false,
			canChooseDirectory: true,
			allowsMultipleSelection: false,
			startingFolder: "~/",
		});
	} catch (error) {
		console.error("folder dialog failed:", error);
		return {
			project: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
	const path = chosen.map((entry) => entry.trim()).find(Boolean);
	if (!path) return { project: null };
	return describeProject(path);
}

// Resolve a path to a project, or say why it isn't one. Also the guard on
// resume: a saved lesson can point at a folder that has since moved away.
export async function describeProject(
	path: string,
): Promise<PickProjectResult> {
	const full = resolve(path.trim().replace(/\/+$/, ""));
	try {
		const info = await stat(full);
		if (!info.isDirectory()) {
			return { project: null, error: `${full} is a file, not a folder` };
		}
	} catch {
		return { project: null, error: `No folder at ${full}` };
	}
	return { project: { path: full, name: basename(full) || full } };
}
