import {
	Alert02Icon,
	CheckmarkCircle02Icon,
	CheckmarkSquare02Icon,
	Clock01Icon,
	Coins01Icon,
	CreditCardIcon,
	Cursor01Icon,
	Download04Icon,
	Folder01Icon,
	HardDriveIcon,
	PencilEdit02Icon,
	TerminalIcon,
	UserAccountIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import { CopyButton } from "@/components/card-markdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { stripCardRefs } from "../../shared/card-refs";
import type {
	CardTask,
	Requirement,
	RequirementKind,
	TaskStatus,
} from "../../shared/types";

// What one run of a task's check left behind: what the app ran, what it
// printed, and the judge's line about it.
export interface TaskCheck {
	command: string;
	output: string;
	note: string;
}

/**
 * The panels a lab card carries under its body.
 *
 * Each one is a reading section of its own — `[data-segment]`, like the
 * takeaway and the hierarchy — so the arrow keys step through them, a question
 * can be asked about them, and a note can be pinned beside them, with no new
 * wiring. They sit under the card rather than inside it for the same reason the
 * takeaway does: the card clips its own overflow, and the action rail belongs
 * to the whole feed item.
 */

// What the learner is being asked to do, and where. The body has already said
// why; this labels the doing.
const TASK_LABELS: Record<
	CardTask["kind"],
	{ icon: IconSvgElement; label: string }
> = {
	run: { icon: TerminalIcon, label: "Run this" },
	ui: { icon: Cursor01Icon, label: "Do this" },
	edit: { icon: PencilEdit02Icon, label: "Write this" },
};

/**
 * The step the learner performs. The app never runs it — see
 * docs/adr/0001-the-learner-executes-the-app-only-verifies.md — so this panel
 * is the whole handover: what to type, and what they should see when it worked.
 *
 * Marker-accented, because the marker is the colour of what you are doing
 * inside the content, and this is the one thing on the card to do.
 */
export function TaskPanel({
	task,
	status,
	check,
	checksAllowed,
	checking,
	onCheck,
	onDecideChecks,
}: {
	task: CardTask;
	status?: TaskStatus;
	check?: TaskCheck;
	// undefined = the learner has not been asked whether the app may run checks
	checksAllowed?: boolean;
	checking?: boolean;
	onCheck?: () => void;
	onDecideChecks?: (allowed: boolean) => void;
}) {
	const { icon, label } = TASK_LABELS[task.kind];
	const done = status === "done" || status === "verified";
	const failed = status === "failed";
	// A check is offered only on the step the learner is standing on: once a
	// card is done it is history, and re-running its check would say nothing.
	const canCheck = Boolean(task.verify && onCheck && !done);
	return (
		<div
			className={cn("task", done && "is-done", failed && "is-failed")}
			data-segment
		>
			<div className="task__bar">
				<span className="task__label">
					<HugeiconsIcon icon={icon} className="size-3.5 shrink-0" />
					{label}
				</span>
				{done && (
					<span className="task__done">
						<HugeiconsIcon
							icon={CheckmarkCircle02Icon}
							className="size-3.5 shrink-0"
						/>
						{status === "verified" ? "Checked" : "Done"}
					</span>
				)}
				{canCheck && checksAllowed && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 gap-1.5 rounded-lg px-2 text-xs"
						disabled={checking}
						onClick={onCheck}
					>
						<HugeiconsIcon icon={CheckmarkSquare02Icon} className="size-3.5" />
						{checking ? "Checking…" : "Check"}
					</Button>
				)}
				{/* In the bar, not beside the command: everything inside
				    data-section-text below is what a question about this section
				    is about, and "Copy" is not part of the step. */}
				{task.command && <CopyButton source={task.command} />}
			</div>
			<div data-section-text>
				{task.command && (
					<pre className="task__command">
						<code>{task.command}</code>
					</pre>
				)}
				{task.expect && (
					<div className="task__expect">
						<span className="task__expect-label">You should see</span>
						<Markdown>{stripCardRefs(task.expect)}</Markdown>
					</div>
				)}
			</div>
			{/* Asked here, on the first step that actually has a check to run, as
			    well as on the plan card — a learner who skipped it there should
			    not lose the feature for the rest of the lesson. */}
			{canCheck && checksAllowed === undefined && onDecideChecks && (
				<ChecksConsent
					verify={task.verify?.argv.join(" ")}
					onDecide={onDecideChecks}
				/>
			)}
			{check && <CheckResultNote check={check} failed={failed} />}
		</div>
	);
}

// What the check found, under the step it checked. The learner sees the exact
// command the app ran and everything it printed: the app is asking them to
// trust it with their machine, and the least it can do is show its working.
function CheckResultNote({
	check,
	failed,
}: {
	check: TaskCheck;
	failed: boolean;
}) {
	return (
		<div className={cn("check", failed && "check--failed")}>
			<p className="check__note">{check.note}</p>
			{check.output && (
				<details className="check__details">
					<summary>
						<code>{check.command}</code>
					</summary>
					<pre className="check__output">{check.output}</pre>
				</details>
			)}
		</div>
	);
}

// The one consent the lab mode asks for, once per lesson. It names what kind of
// command it means, because "allow checks" is not something anybody can answer.
export function ChecksConsent({
	verify,
	onDecide,
}: {
	verify?: string;
	onDecide: (allowed: boolean) => void;
}) {
	return (
		<div className="consent">
			<p className="consent__text">
				May this lesson run read-only checks for you —{" "}
				<code>{verify ?? "docker ps"}</code> and the like? Nothing that changes
				anything, and only when you press Check.
			</p>
			<div className="consent__actions">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 rounded-lg px-2.5 text-xs"
					onClick={() => onDecide(false)}
				>
					No thanks
				</Button>
				<Button
					type="button"
					size="sm"
					className="h-7 rounded-lg px-2.5 text-xs"
					onClick={() => onDecide(true)}
				>
					Allow
				</Button>
			</div>
		</div>
	);
}

/**
 * A step that could touch something outside this lesson — a real cluster, a
 * work account, a port in use. Red rather than the takeaway's yellow: yellow
 * means keep this, and the two must never be confusable on the same card.
 */
export function CautionNote({ text }: { text: string }) {
	return (
		<div className="caution" data-segment>
			<p className="caution__label">
				<HugeiconsIcon icon={Alert02Icon} className="size-3.5 shrink-0" />
				Check first
			</p>
			<div className="caution__text" data-explainable data-section-text>
				<Markdown>{stripCardRefs(text)}</Markdown>
			</div>
		</div>
	);
}

/**
 * What this step costs. Its own panel, never a line in the prose, because a
 * learner who skims must not be able to skim past the money.
 */
export function CostNote({ text }: { text: string }) {
	return (
		<div className="cost" data-segment>
			<p className="cost__label">
				<HugeiconsIcon icon={Coins01Icon} className="size-3.5 shrink-0" />
				What this costs
			</p>
			<div className="cost__text" data-explainable data-section-text>
				<Markdown>{stripCardRefs(text)}</Markdown>
			</div>
		</div>
	);
}

const REQUIREMENT_ICONS: Record<RequirementKind, IconSvgElement> = {
	install: Download04Icon,
	account: UserAccountIcon,
	payment: CreditCardIcon,
	disk: HardDriveIcon,
	time: Clock01Icon,
	workspace: Folder01Icon,
};

/**
 * Everything the lesson needs before the first command, on the card that plans
 * it — while backing out still costs the learner nothing.
 */
export function RequirementsPanel({
	requirements,
	children,
}: {
	requirements: Requirement[];
	// The consent row, when the lesson still has to ask for it — it belongs
	// under this list, where the learner is already reading what the lesson
	// needs of them.
	children?: ReactNode;
}) {
	return (
		<div className="requirements" data-segment>
			<p className="requirements__label">What you will need</p>
			<ul className="requirements__list" data-section-text>
				{requirements.map((row) => (
					<li key={`${row.kind}-${row.name}`} className="requirements__row">
						<span className="requirements__icon">
							<HugeiconsIcon
								icon={REQUIREMENT_ICONS[row.kind]}
								className="size-4"
							/>
						</span>
						<span className="requirements__body">
							<span className="requirements__name">{row.name}</span>
							{row.detail && (
								<span className="requirements__detail">{row.detail}</span>
							)}
						</span>
						{row.cost && <span className="requirements__cost">{row.cost}</span>}
					</li>
				))}
			</ul>
			{children}
		</div>
	);
}

/**
 * What the lesson started and never stopped, listed on the recap by the app
 * rather than by the tutor.
 *
 * A lab lesson leaves things running on a real machine, and some of them cost
 * money. The tutor writes clean-up cards, but whether the learner actually ran
 * them is something only the app knows — so the reminder is built from the
 * steps that were never marked done, with their commands, and it is right even
 * when the recap forgot to mention any of it.
 */
export function TeardownNotice({
	steps,
}: {
	steps: { title: string; command?: string }[];
}) {
	return (
		<div className="machine-notice machine-notice--quiet">
			<p className="machine-notice__label">
				<HugeiconsIcon icon={Alert02Icon} className="size-4 shrink-0" />
				Steps you did not mark done
			</p>
			<ul className="machine-notice__list">
				{steps.map((step) => (
					<li key={step.title}>
						{step.title}
						{step.command && (
							<>
								{" — "}
								<code>{step.command}</code>
							</>
						)}
					</li>
				))}
			</ul>
			<p className="machine-notice__foot">
				Anything here that was going to stop or remove something has not run, so
				it is probably still going — and anything on a paid service is still
				billing. The app cannot clean up for you; these are yours to run.
			</p>
		</div>
	);
}

/**
 * What the app itself found on this Mac, shown before the tutor says a word.
 *
 * Written here and not by the model on purpose: whether this machine is pointed
 * at a real cluster or a logged-in cloud account is a safety fact, and safety
 * facts must not depend on a model remembering a prompt rule. The footer is the
 * other half of the same promise — it says what was read, and that nothing here
 * runs on its own.
 */
export function MachineNotice({
	warnings,
	drift,
}: {
	warnings: string[];
	// What has changed on this machine since the lesson was last open. Only on
	// a resumed lesson, and only ever losses and switches.
	drift?: string[];
}) {
	const changed = drift ?? [];
	// Drift is news; a warning is a risk. A resumed lesson with nothing to warn
	// about gets the quiet version of this panel rather than a red one.
	const alarming = warnings.length > 0;
	return (
		<div className={cn("machine-notice", !alarming && "machine-notice--quiet")}>
			{changed.length > 0 && (
				<>
					<p className="machine-notice__label">
						<HugeiconsIcon icon={Alert02Icon} className="size-4 shrink-0" />
						Since you were last here
					</p>
					<ul className="machine-notice__list">
						{changed.map((note) => (
							<li key={note}>
								<Markdown>{note}</Markdown>
							</li>
						))}
					</ul>
				</>
			)}
			{warnings.length > 0 && (
				<>
					<p
						className={cn(
							"machine-notice__label",
							changed.length > 0 && "machine-notice__label--second",
						)}
					>
						<HugeiconsIcon icon={Alert02Icon} className="size-4 shrink-0" />
						Before we start
					</p>
					<ul className="machine-notice__list">
						{warnings.map((warning) => (
							// App-authored text, but it names contexts and accounts — so
							// it goes through markdown for the same inline-code chip the
							// cards use, rather than showing the learner raw backticks.
							<li key={warning}>
								<Markdown>{warning}</Markdown>
							</li>
						))}
					</ul>
				</>
			)}
			<p className="machine-notice__foot">
				Tuto looked at which tools are installed, your Docker and kubectl
				context, and whether the cloud CLIs are logged in — nothing else. It
				runs nothing on this Mac: every command in this lesson is yours to run.
			</p>
		</div>
	);
}
