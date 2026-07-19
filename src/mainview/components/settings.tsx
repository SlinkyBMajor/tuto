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

export function SettingsButton({ floating = false }: { floating?: boolean }) {
	const [settings, setSettings] = useState<Settings>(loadSettings);

	function update(partial: Partial<Settings>) {
		const next = { ...settings, ...partial };
		setSettings(next);
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		applySettings(next);
	}

	return (
		<div className={floating ? "fixed top-4 right-4 z-10" : "shrink-0"}>
			<Popover>
				<PopoverTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							className="size-11 rounded-2xl"
							aria-label="Settings"
						/>
					}
				>
					<HugeiconsIcon icon={Settings02Icon} className="size-6" />
				</PopoverTrigger>
				<PopoverContent align="end" className="w-64">
					<PopoverHeader>
						<PopoverTitle>Settings</PopoverTitle>
					</PopoverHeader>
					<label
						htmlFor="setting-serif-font"
						className="flex items-center justify-between gap-3 text-base"
					>
						<span>Serif font</span>
						<Switch
							id="setting-serif-font"
							checked={settings.serifFont}
							onCheckedChange={(checked) => update({ serifFont: checked })}
						/>
					</label>
					<label
						htmlFor="setting-code-language"
						className="flex flex-col gap-2 text-base"
					>
						<span>Code example language</span>
						<Input
							id="setting-code-language"
							value={settings.codeLanguage}
							onChange={(event) => update({ codeLanguage: event.target.value })}
							placeholder="e.g. JavaScript (topic decides if empty)"
							className="h-10 rounded-xl"
						/>
					</label>
					<div className="flex items-center justify-between gap-3 text-base">
						<span>Text size</span>
						<div className="flex gap-1">
							{FONT_SIZES.map((size, index) => (
								<Button
									key={size}
									type="button"
									variant={settings.fontSize === size ? "default" : "outline"}
									size="sm"
									className="w-9 rounded-xl"
									aria-label={`Text size ${size}`}
									onClick={() => update({ fontSize: size })}
								>
									<span
										className={
											["text-xs", "text-sm", "text-base"][index] ?? "text-base"
										}
									>
										A
									</span>
								</Button>
							))}
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}
