import { Cancel01Icon, FolderCodeIcon } from "@hugeicons/core-free-icons";
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

// The second field on the home screen: point a lesson at a project and the
// tutor teaches from that code instead of from what it already knows.
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
		<div className="flex w-full flex-col items-center gap-2">
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
					{picking ? "Choosing…" : "Or learn from a project on this Mac"}
				</Button>
			)}
			{error && <p className="text-sm text-destructive">{error}</p>}
		</div>
	);
}
