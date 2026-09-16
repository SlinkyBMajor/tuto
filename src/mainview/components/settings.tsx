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
import { bun } from "@/lib/rpc";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "tuto.settings";

const FONT_SIZES = ["default", "large", "xlarge"] as const;
type FontSize = (typeof FONT_SIZES)[number];

// What a lesson turn runs on. Mirrors MODELS and EFFORTS in src/bun/settings.ts,
// which is the side that checks them before spawning anything — this list is
// the menu, not the guard.
const MODELS = [
	{ id: "claude-opus-5", label: "Opus 5", note: "Best cards, dearest" },
	{ id: "claude-sonnet-5", label: "Sonnet 5", note: "Cheaper, still teaches" },
] as const;

// The scale starts at high. Below it the model stops thinking rather than
// thinking less, and a card written without thinking teaches two new terms in
// two sentences — measured, see docs/system/claude-backend.md.
const EFFORTS = ["high", "xhigh", "max"] as const;

interface Settings {
	serifFont: boolean;
	fontSize: FontSize;
	// Preferred language for code examples; empty = let the topic decide
	codeLanguage: string;
	// context7 API key for a lab lesson's documentation lookup; empty = keyless,
	// which is how the endpoint works out of the box. A key only raises rate
	// limits. See docs/system/lab-mode.md.
	context7Key: string;
	// Where a lab lesson creates its own folder, when it needs one
	labRoot: string;
	// The tier and the thinking depth for every turn of every lesson, whatever
	// kind it is. Both go on the CLI command line the Bun process builds.
	model: (typeof MODELS)[number]["id"];
	effort: (typeof EFFORTS)[number];
}

const DEFAULT_SETTINGS: Settings = {
	serifFont: false,
	fontSize: "default",
	codeLanguage: "",
	context7Key: "",
	labRoot: "~/Documents/Tuto Labs",
	// Matches DEFAULT_MODEL / DEFAULT_EFFORT in src/bun/settings.ts
	model: "claude-opus-5",
	effort: "xhigh",
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

// The settings the Bun process needs a copy of: it spawns the CLI, makes the
// documentation call and creates the lesson folder, none of which the webview
// does. Pushed on mount and on every edit rather than read from disk over
// there, because Settings live in this side's localStorage — and none of them
// may travel in a lesson's config, which is persisted.
export function pushSettings(settings: {
	context7Key: string;
	labRoot: string;
	model: string;
	effort: string;
}) {
	void bun.setSettings(settings).catch(() => {});
}

export function SettingsButton() {
	const [settings, setSettings] = useState<Settings>(loadSettings);

	function update(partial: Partial<Settings>) {
		const next = { ...settings, ...partial };
		setSettings(next);
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		applySettings(next);
		if (
			partial.context7Key !== undefined ||
			partial.labRoot !== undefined ||
			partial.model !== undefined ||
			partial.effort !== undefined
		) {
			pushSettings(next);
		}
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
					<PopoverHeader>
						<PopoverTitle className="text-sm text-muted-foreground">
							Tutor
						</PopoverTitle>
					</PopoverHeader>
					<div className="flex flex-col gap-1.5">
						<span>Model</span>
						<div className="flex gap-0.5 rounded-full bg-muted p-0.5">
							{MODELS.map((model) => (
								<button
									key={model.id}
									type="button"
									aria-pressed={settings.model === model.id}
									onClick={() => update({ model: model.id })}
									className={cn(
										"h-7 flex-1 rounded-full text-xs transition-colors",
										settings.model === model.id
											? "bg-card text-foreground shadow-xs"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{model.label}
								</button>
							))}
						</div>
						<span className="text-xs text-muted-foreground">
							{MODELS.find((model) => model.id === settings.model)?.note}. Every
							turn of every lesson runs on this.
						</span>
					</div>
					<div className="flex flex-col gap-1.5">
						<span>Thinking</span>
						<div className="flex gap-0.5 rounded-full bg-muted p-0.5">
							{EFFORTS.map((effort) => (
								<button
									key={effort}
									type="button"
									aria-pressed={settings.effort === effort}
									onClick={() => update({ effort })}
									className={cn(
										"h-7 flex-1 rounded-full text-xs transition-colors",
										settings.effort === effort
											? "bg-card text-foreground shadow-xs"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{effort}
								</button>
							))}
						</div>
						<span className="text-xs text-muted-foreground">
							How long the tutor thinks before it writes a card. More thinking
							costs more and takes longer.
						</span>
					</div>
					<PopoverHeader>
						<PopoverTitle className="text-sm text-muted-foreground">
							Hands-on lessons
						</PopoverTitle>
					</PopoverHeader>
					<label
						htmlFor="setting-context7-key"
						className="flex flex-col gap-1.5"
					>
						<span>context7 API key</span>
						<Input
							id="setting-context7-key"
							type="password"
							value={settings.context7Key}
							onChange={(event) => update({ context7Key: event.target.value })}
							placeholder="ctx7sk-…"
							className="h-9 rounded-xl border-border bg-card text-sm"
						/>
						<span className="text-xs text-muted-foreground">
							Optional. A lab lesson looks the tool's current docs up either
							way; a key only raises the rate limit.
						</span>
					</label>
					<label htmlFor="setting-lab-root" className="flex flex-col gap-1.5">
						<span>Lab folder</span>
						<Input
							id="setting-lab-root"
							value={settings.labRoot}
							onChange={(event) => update({ labRoot: event.target.value })}
							placeholder="~/Documents/Tuto Labs"
							className="h-9 rounded-xl border-border bg-card text-sm"
						/>
						<span className="text-xs text-muted-foreground">
							Where a lesson puts files you write. One folder per lesson, and
							only for lessons that need one.
						</span>
					</label>
				</PopoverContent>
			</Popover>
		</div>
	);
}
