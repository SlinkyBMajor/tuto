// The lesson's notes document: card bodies filed into a section tree,
// rendered to markdown, and mirrored to disk. The feed is chronological;
// this document is hierarchical — deeper material about a concept nests
// under that concept's section regardless of arrival order.
//
// Two files per lesson: notes.md (the rendered, human-readable view) and
// notes.json (the section tree, so a resumed lesson keeps appending in the
// right places after the app restarts).

import { lessonDir } from "./paths";

interface Section {
	title: string;
	content: string[];
	children: Section[];
}

export class NotesDoc {
	private topic = "";
	private sections: Section[] = [];
	private dir: string | undefined;

	private mdPath(): string | undefined {
		return this.dir ? `${this.dir}/notes.md` : undefined;
	}

	private treePath(): string | undefined {
		return this.dir ? `${this.dir}/notes.json` : undefined;
	}

	startLesson(id: string, topic: string) {
		this.topic = topic;
		this.sections = [];
		this.dir = lessonDir(id);
	}

	// Reload an existing lesson's tree so appends land in the right sections.
	async resume(id: string, topic: string) {
		this.topic = topic;
		this.dir = lessonDir(id);
		this.sections = [];
		try {
			const file = Bun.file(`${lessonDir(id)}/notes.json`);
			if (await file.exists()) {
				const saved = (await file.json()) as {
					topic?: string;
					sections?: Section[];
				};
				if (saved.topic) this.topic = saved.topic;
				if (Array.isArray(saved.sections)) this.sections = saved.sections;
			}
		} catch (error) {
			console.error(`failed to load notes tree for ${id}:`, error);
		}
	}

	insert(sectionPath: string[], markdown: string) {
		let siblings = this.sections;
		let section: Section | undefined;
		for (const title of sectionPath) {
			section = siblings.find(
				(existing) =>
					existing.title.toLowerCase() === title.trim().toLowerCase(),
			);
			if (!section) {
				section = { title: title.trim(), content: [], children: [] };
				siblings.push(section);
			}
			siblings = section.children;
		}
		section?.content.push(markdown.trim());
		void this.save();
	}

	render(): string {
		const parts: string[] = [];
		if (this.topic) parts.push(`# ${this.topic}`);
		const walk = (sections: Section[], depth: number) => {
			for (const section of sections) {
				parts.push(`${"#".repeat(Math.min(depth, 6))} ${section.title}`);
				parts.push(...section.content);
				walk(section.children, depth + 1);
			}
		};
		walk(this.sections, 2);
		return `${parts.join("\n\n")}\n`;
	}

	private async save() {
		const md = this.mdPath();
		const tree = this.treePath();
		if (!md || !tree) return;
		try {
			await Bun.write(md, this.render());
			await Bun.write(
				tree,
				JSON.stringify({ topic: this.topic, sections: this.sections }),
			);
		} catch (error) {
			console.error("failed to write notes:", error);
		}
	}
}
