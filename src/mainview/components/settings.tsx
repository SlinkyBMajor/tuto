import { Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "tuto.settings";

const FONT_SIZES = ["default", "large", "xlarge"] as const;
type FontSize = (typeof FONT_SIZES)[number];

interface Settings {
	serifFont: boolean;
	fontSize: FontSize;
	// Preferred language for code examples; empty = let the topic decide
	codeLanguage: string;
}

const DEFAULT_SETTINGS: Settings = {
	serifFont: false,
	fontSize: "default",
	codeLanguage: "",
};

export function loadSettings(): Settings {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
	} catch {
		return DEFAULT_SETTINGS;
	}
}

function applySettings(settings: Settings) {
	const root = document.documentElement;
	root.classList.toggle("serif-reading", settings.serifFont);
	root.classList.toggle("font-large", settings.fontSize === "large");
	root.classList.toggle("font-xlarge", settings.fontSize === "xlarge");
}

// Called once at startup (before React renders) so there is no font flash
export function initSettings() {
	applySettings(loadSettings());
}

export function SettingsButton() {
	const [settings, setSettings] = useState<Settings>(loadSettings);

	function update(partial: Partial<Settings>) {
		const next = { ...settings, ...partial };
		setSettings(next);
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		applySettings(next);
	}

	return (
		<div className="shrink-0">
			<Popover>
				<PopoverTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							className="size-9 rounded-xl text-muted-foreground hover:text-foreground"
							aria-label="Settings"
						/>
					}
				>
					<HugeiconsIcon icon={Settings02Icon} className="size-5" />
				</PopoverTrigger>
				<PopoverContent align="end" className="w-72 text-sm">
					<PopoverHeader>
						<PopoverTitle className="text-sm text-muted-foreground">
							Reading
						</PopoverTitle>
					</PopoverHeader>
					<label
						htmlFor="setting-serif-font"
						className="flex items-center justify-between gap-3"
					>
						<span>Serif font</span>
						<Switch
							id="setting-serif-font"
							checked={settings.serifFont}
							onCheckedChange={(checked) => update({ serifFont: checked })}
						/>
					</label>
					<div className="flex items-center justify-between gap-3">
						<span>Text size</span>
						<div className="flex gap-0.5 rounded-full bg-muted p-0.5">
							{FONT_SIZES.map((size, index) => (
								<button
									key={size}
									type="button"
									aria-label={`Text size ${size}`}
									aria-pressed={settings.fontSize === size}
									onClick={() => update({ fontSize: size })}
									className={cn(
										"grid h-7 w-8 place-items-center rounded-full transition-colors",
										settings.fontSize === size
											? "bg-card text-foreground shadow-xs"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									<span
										className={
											["text-[0.7rem]", "text-sm", "text-base"][index] ??
											"text-base"
										}
									>
										A
									</span>
								</button>
							))}
						</div>
					</div>
					<label
						htmlFor="setting-code-language"
						className="flex flex-col gap-1.5"
					>
						<span>Code example language</span>
						<Input
							id="setting-code-language"
							value={settings.codeLanguage}
							onChange={(event) => update({ codeLanguage: event.target.value })}
							placeholder="e.g. JavaScript"
							className="h-9 rounded-xl border-border bg-card text-sm"
						/>
						<span className="text-xs text-muted-foreground">
							Leave empty to let the topic decide.
						</span>
					</label>
				</PopoverContent>
			</Popover>
		</div>
	);
}
