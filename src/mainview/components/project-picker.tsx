import {
	Cancel01Icon,
	FolderCodeIcon,
	TestTube01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { bun } from "@/lib/rpc";
import type { ProjectRef } from "../../shared/types";

// Absolute paths are what the tutor needs; a home-relative one is what a
// person reads. Display only — the stored path stays absolute.
export function shortPath(path: string): string {
	return path.replace(/^\/(?:Users|home)\/[^/]+\//, "~/");
}

// The home screen's two ways of saying where a lesson comes from, under the
// topic box: point it at a project on this Mac, or ask for a lab and build the
// thing yourself. They are mutually exclusive, which the caller enforces by
// hiding one once the other is chosen — a lab has no repository to read.

// Point a lesson at a project and the tutor teaches from that code instead of
// from what it already knows.
export function ProjectField({
	project,
	onChange,
	disabled,
}: {
	project: ProjectRef | null;
	onChange: (project: ProjectRef | null) => void;
	disabled?: boolean;
}) {
	const [error, setError] = useState<string | null>(null);
	const [picking, setPicking] = useState(false);

	async function choose() {
		if (picking) return;
		setPicking(true);
		setError(null);
		try {
			const result = await bun.pickProject({});
			// A cancelled dialog reports neither a project nor an error
			if (result.project) onChange(result.project);
			setError(result.error ?? null);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setPicking(false);
		}
	}

	return (
		<div className="flex max-w-full flex-col items-center gap-2">
			{project ? (
				<div className="flex max-w-full items-center gap-2.5 rounded-2xl border border-border bg-card py-2 pr-2 pl-3.5 shadow-xs">
					<HugeiconsIcon
						icon={FolderCodeIcon}
						className="size-4.5 shrink-0 text-muted-foreground"
					/>
					<span className="flex min-w-0 flex-col text-left leading-tight">
						<span className="truncate text-sm font-medium">{project.name}</span>
						<span className="truncate text-xs text-muted-foreground">
							{shortPath(project.path)}
						</span>
					</span>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-8 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
						aria-label="Learn without a project"
						disabled={disabled}
						onClick={() => {
							setError(null);
							onChange(null);
						}}
					>
						<HugeiconsIcon icon={Cancel01Icon} className="size-4" />
					</Button>
				</div>
			) : (
				<Button
					type="button"
					variant="ghost"
					className="h-9 gap-2 rounded-2xl px-3.5 text-sm text-muted-foreground hover:text-foreground"
					disabled={disabled || picking}
					onClick={() => void choose()}
				>
					<HugeiconsIcon icon={FolderCodeIcon} className="size-4.5" />
					{picking ? "Choosing…" : "Learn from a project on this Mac"}
				</Button>
			)}
			{error && <p className="text-sm text-destructive">{error}</p>}
		</div>
	);
}

// Ask for a lab: the tutor plans a real thing to build on this machine and
// walks the learner through building it. No folder to pick — what it teaches
// from is the machine itself, which the app reads before the lesson starts.
export function LabField({
	chosen,
	onChange,
	disabled,
}: {
	chosen: boolean;
	onChange: (chosen: boolean) => void;
	disabled?: boolean;
}) {
	if (!chosen) {
		return (
			<Button
				type="button"
				variant="ghost"
				className="h-9 gap-2 rounded-2xl px-3.5 text-sm text-muted-foreground hover:text-foreground"
				disabled={disabled}
				onClick={() => onChange(true)}
			>
				<HugeiconsIcon icon={TestTube01Icon} className="size-4.5" />
				Build it yourself, step by step
			</Button>
		);
	}
	return (
		<div className="flex max-w-full items-center gap-2.5 rounded-2xl border border-border bg-card py-2 pr-2 pl-3.5 shadow-xs">
			<HugeiconsIcon
				icon={TestTube01Icon}
				className="size-4.5 shrink-0 text-muted-foreground"
			/>
			<span className="flex min-w-0 flex-col text-left leading-tight">
				<span className="truncate text-sm font-medium">Hands-on lab</span>
				<span className="truncate text-xs text-muted-foreground">
					You run every step yourself
				</span>
			</span>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="size-8 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
				aria-label="Learn without building it"
				disabled={disabled}
				onClick={() => onChange(false)}
			>
				<HugeiconsIcon icon={Cancel01Icon} className="size-4" />
			</Button>
		</div>
	);
}
