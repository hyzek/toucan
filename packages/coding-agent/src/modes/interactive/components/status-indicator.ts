import { type Component, clamp01, Loader, shinePhase, type TUI, truncateToWidth } from "@hyzek/toucan-tui";
import type { WorkingIndicatorOptions } from "../../../core/extensions/index.ts";
import { theme } from "../theme/theme.ts";
import { CountdownTimer } from "./countdown-timer.ts";
import { keyText } from "./keybinding-hints.ts";
import type { WorkingStatusLine } from "./working-status.ts";

// The default working indicator: a bullet dot that pulses from the secondary-text gray
// (256-color grayscale #808080) to near-white, while the working label fades white→gray
// left to right. Both ride the shared shine curve (toucan-tui shine.ts), so this and the
// input band's startup glint read as one family. Each frame cycle holds the dot bright
// and dips it quickly to gray; the label sweep restarts at the start of each cycle.
const WORKING_DOT = "•";
const WORKING_DOT_FRAMES = 24;
const WORKING_DOT_INTERVAL_MS = 40;
const GRAY_INDEX_MIN = 244; // #808080 (secondary-text gray)
const GRAY_INDEX_MAX = 255; // near-white
const GRAY_RANGE = GRAY_INDEX_MAX - GRAY_INDEX_MIN;

function grayIndex(brightness: number): number {
	return Math.round(GRAY_INDEX_MIN + clamp01(brightness) * GRAY_RANGE);
}

/**
 * Brightness (0 = gray, 1 = white) for the dot pulse, over one cycle [0,1]. A continuous,
 * bright-biased raised cosine so the dot breathes white → gray → white smoothly (no flat
 * hold, no abrupt dip); the power lifts the curve toward the bright end.
 */
function workingDotBrightness(t: number): number {
	const s = 0.5 + 0.5 * Math.cos(2 * Math.PI * t);
	return s ** 0.6;
}

/** Build the gray-to-white fade-dot frames. Frames render verbatim, so each has its own shade. */
export function createWorkingDotIndicator(): WorkingIndicatorOptions {
	const frames: string[] = [];
	for (let i = 0; i < WORKING_DOT_FRAMES; i++) {
		const t = i / (WORKING_DOT_FRAMES - 1);
		frames.push(`\x1b[38;5;${grayIndex(workingDotBrightness(t))}m${WORKING_DOT}\x1b[39m`);
	}
	return { frames, intervalMs: WORKING_DOT_INTERVAL_MS };
}

/** Color each character white near the sweep center, gray away from it (scaled by envelope). */
function sweepWord(word: string, position: number, envelope: number): string {
	if (word.length === 0) return "";
	let out = "";
	for (let i = 0; i < word.length; i++) {
		const pos = word.length <= 1 ? 1 : i / (word.length - 1);
		const brightness = clamp01(1 - Math.abs(pos - position) / 0.35) * envelope;
		out += `\x1b[38;5;${grayIndex(brightness)}m${word[i]}\x1b[39m`;
	}
	return out;
}

export type StatusIndicatorKind = "working" | "retry" | "compaction" | "branchSummary";

export class StatusIndicator extends Loader {
	readonly kind: StatusIndicatorKind;

	constructor(
		kind: StatusIndicatorKind,
		ui: TUI,
		spinnerColorFn: (str: string) => string,
		messageColorFn: (str: string) => string,
		message: string,
		indicator?: WorkingIndicatorOptions,
	) {
		super(ui, spinnerColorFn, messageColorFn, message, indicator);
		this.kind = kind;
	}

	/** Plain status text, colored as the status tail is: muted. */
	setLabel(label: string): void {
		this.setMessage(theme.fg("muted", label));
	}

	renderInBorder(width: number): string {
		const line = super.render(width + 2)[1] ?? "";
		return truncateToWidth(line.startsWith(" ") ? line.slice(1).trimEnd() : line.trimEnd(), width, "");
	}

	renderSpinnerInBorder(width: number): string {
		return truncateToWidth(this.getRenderedIndicator(), width, "");
	}

	dispose(): void {
		this.stop();
	}
}

export class WorkingStatusIndicator extends StatusIndicator {
	/** Plain label being swept, while set; undefined once a caller owns the full styled line. */
	private labelText: string | undefined;
	private styledTail: string = "";

	constructor(
		ui: TUI,
		label: string,
		indicator?: WorkingIndicatorOptions,
		spinnerColorFn: (text: string) => string = (text) => theme.fg("accent", text),
	) {
		// The message color function is the identity because this class colors every part of the
		// message itself: the swept label and the muted status tail.
		super("working", ui, spinnerColorFn, (text) => text, label, indicator ?? createWorkingDotIndicator());
		this.labelText = label;
	}

	/**
	 * The engine's line: the label swept gray→white by the shine curve, then the token and
	 * elapsed tail in brackets, e.g. `Thinking (1.2k tokens · 4s)`.
	 */
	setLine(line: WorkingStatusLine): void {
		this.labelText = line.label;
		this.styledTail = line.status ? ` ${theme.fg("muted", `(${line.status})`)}` : "";
		this.setMessage(`${line.label}${this.styledTail}`);
	}

	override setLabel(label: string): void {
		this.labelText = undefined;
		super.setLabel(label);
	}

	protected override renderMessage(message: string, frameIndex: number): string {
		if (this.labelText === undefined) return message;
		// Sweep the label white→gray left→right: the shared shine curve, so this and the
		// input band's startup glint are the same effect rather than two lookalikes.
		const total = this.frames.length;
		const { position, envelope } = shinePhase(total <= 1 ? 0 : frameIndex / (total - 1));
		return sweepWord(this.labelText, position, envelope) + this.styledTail;
	}
}

export class RetryStatusIndicator extends StatusIndicator {
	private countdown: CountdownTimer | undefined;

	constructor(ui: TUI, attempt: number, maxAttempts: number, delayMs: number) {
		const retryMessage = (seconds: number) =>
			`Retrying (${attempt}/${maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
		super(
			"retry",
			ui,
			(spinner) => theme.fg("warning", spinner),
			(text) => theme.fg("muted", text),
			retryMessage(Math.ceil(delayMs / 1000)),
		);
		this.countdown = new CountdownTimer(
			delayMs,
			ui,
			(seconds) => {
				this.setMessage(retryMessage(seconds));
			},
			() => {
				this.countdown = undefined;
			},
		);
	}

	override dispose(): void {
		this.countdown?.dispose();
		this.countdown = undefined;
		super.dispose();
	}
}

export type CompactionStatusReason = "manual" | "threshold" | "overflow";

export class CompactionStatusIndicator extends StatusIndicator {
	constructor(ui: TUI, reason: CompactionStatusReason, colorFn?: (text: string) => string) {
		const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
		const label =
			reason === "manual"
				? `Compacting context... ${cancelHint}`
				: `${reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
		super(
			"compaction",
			ui,
			colorFn ?? ((spinner) => theme.fg("accent", spinner)),
			colorFn ?? ((text) => theme.fg("muted", text)),
			label,
		);
	}
}

export class BranchSummaryStatusIndicator extends StatusIndicator {
	constructor(ui: TUI) {
		super(
			"branchSummary",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			`Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
		);
	}
}

export class IdleStatus implements Component {
	invalidate(): void {
		// No cached state to invalidate.
	}

	render(width: number): string[] {
		const emptyLine = " ".repeat(width);
		return [emptyLine, emptyLine];
	}
}
