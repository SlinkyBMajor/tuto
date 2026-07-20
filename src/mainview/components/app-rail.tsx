import { Home01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { SettingsButton } from "@/components/settings";
import { cn } from "@/lib/utils";

// The app's global navigation. Tuto has one destination — the lesson library —
// so the rail stays deliberately short; everything else is scoped to the
// lesson and lives in the sidebar or the content tabs.
export function AppRail({
	active,
	onHome,
}: {
	active: "home" | "lesson";
	onHome: () => void;
}) {
	return (
		<nav
			aria-label="Main"
			className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-foreground/3 py-3"
		>
			<RailButton
				icon={Home01Icon}
				label="Lessons"
				active={active === "home"}
				onClick={onHome}
			/>
			<div className="flex-1" />
			<SettingsButton />
		</nav>
	);
}

function RailButton({
	icon,
	label,
	active,
	onClick,
}: {
	icon: IconSvgElement;
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={label}
			aria-label={label}
			aria-current={active ? "page" : undefined}
			className={cn(
				"grid size-9 place-items-center rounded-xl transition-colors",
				active
					? "bg-muted text-foreground"
					: "text-muted-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			<HugeiconsIcon icon={icon} className="size-5" />
		</button>
	);
}
