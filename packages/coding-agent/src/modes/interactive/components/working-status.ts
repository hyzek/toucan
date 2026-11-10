/** The working line: `Thinking` or `Working`, with the token count and elapsed time in brackets. */

import type { AssistantMessage } from "@hyzek/toucan-ai";

/** What the agent is doing, which decides the line's label. */
export type WorkingActivity = "thinking" | "working";

/**
 * One render of the working line. The engine stays unstyled: the component that owns it sweeps
 * `label` with the shine curve and brackets `status` in the muted color.
 */
export interface WorkingStatusLine {
	/** `Thinking` while a thinking block streams, `Working` while tool calls are written or run. */
	label: string;
	/** Tail such as `1.000 tokens · 4s`; empty when there is nothing to report. */
	status: string;
}

export interface WorkingStatusOptions {
	onLine: (line: WorkingStatusLine) => void;
	/** Injectable clock so the elapsed time and easing are testable. */
	now?: () => number;
	/** How often the line is recomputed for elapsed time and the climbing token count. */
	tickEveryMs?: number;
}

const TICK_MS = 250;
/** Rough characters per output token, used only for the live estimate. */
const CHARS_PER_TOKEN = 4;
/**
 * The token number counts up instead of jumping to the target. Providers report usage in chunks,
 * and a finished message replaces the estimate with the real count, so each tick closes about
 * 63% of the gap (EASE_MS) and at least one token.
 */
const EASE_MS = 150;

const LABELS: Record<WorkingActivity, string> = { thinking: "Thinking", working: "Working" };

/** The live token count keeps every digit, grouped with dots instead of the footer's abbreviations. */
function formatLiveTokens(count: number): string {
	return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Keep the runtime timer short: seconds, then minutes, then hours. */
function formatElapsed(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		const remainder = seconds % 60;
		return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	const remainingSeconds = seconds % 60;
	const parts = [`${hours}h`];
	if (remainingMinutes > 0) parts.push(`${remainingMinutes}m`);
	if (remainingSeconds > 0) parts.push(`${remainingSeconds}s`);
	return parts.join(" ");
}

/**
 * Characters the model has produced in a streamed message: text, thinking, and tool-call
 * arguments. Only an estimate of output tokens, used until the provider reports the real count.
 */
export function streamedCharCount(message: AssistantMessage): number {
	let chars = 0;
	for (const content of message.content) {
		if (content.type === "text") chars += content.text.length;
		else if (content.type === "thinking") chars += content.thinking.length;
		else chars += JSON.stringify(content.arguments).length;
	}
	return chars;
}

/**
 * Tracks one agent turn and reports the working line: `Thinking` while a thinking block streams,
 * `Working` while tool calls are streamed or run, and the token and elapsed tail throughout.
 * It owns its timers and never touches the UI itself.
 */
export class WorkingStatusEngine {
	private readonly onLine: (line: WorkingStatusLine) => void;
	private readonly now: () => number;
	private readonly tickEveryMs: number;

	private activity: WorkingActivity = "working";
	private startedAt = 0;
	private tickTimer: ReturnType<typeof setInterval> | undefined;
	private streamedChars = 0;
	private settledTokens = 0;
	private shownTokens = 0;
	private easeAt = 0;
	private lastLine: WorkingStatusLine | undefined;
	private active = false;
	// An extension called setWorkingMessage: its text wins until it clears it.
	private frozen = false;

	constructor(options: WorkingStatusOptions) {
		this.onLine = options.onLine;
		this.now = options.now ?? Date.now;
		this.tickEveryMs = options.tickEveryMs ?? TICK_MS;
	}

	/** Start of a turn. Idempotent so steering a running agent does not restart the clock. */
	begin(): void {
		if (this.active) return;
		this.active = true;
		this.activity = "working";
		this.startedAt = this.now();
		this.easeAt = this.startedAt;
		this.streamedChars = 0;
		this.settledTokens = 0;
		this.shownTokens = 0;
		this.emit();
		this.tickTimer = setInterval(() => this.emit(), this.tickEveryMs);
	}

	/** End of a turn: stops the timers and lets the next turn start fresh. */
	end(): void {
		this.active = false;
		this.stopTick();
	}

	dispose(): void {
		this.end();
	}

	/** The streamed assistant message so far: sets the token estimate and Thinking vs Working. */
	noteStreamedMessage(message: AssistantMessage): void {
		this.streamedChars = streamedCharCount(message);
		const lastBlock = message.content[message.content.length - 1];
		this.activity = lastBlock?.type === "thinking" ? "thinking" : "working";
		this.emit();
	}

	/** A tool call is executing: tool work is `Working` even if thinking streamed last. */
	noteToolRunning(): void {
		this.activity = "working";
		this.emit();
	}

	/** A finished assistant message swaps its estimate for the provider's real output count. */
	settleMessage(outputTokens: number): void {
		this.settledTokens += outputTokens;
		this.streamedChars = 0;
		this.emit();
	}

	/**
	 * While an extension owns the working text the engine keeps tracking state but stays quiet, so
	 * clearing the extension message resumes the line instead of leaving it blank.
	 */
	setFrozen(frozen: boolean): void {
		this.frozen = frozen;
		if (!frozen) this.lastLine = undefined;
	}

	/** The line as it stands now, with the token count eased toward its target. */
	line(): WorkingStatusLine {
		const now = this.now();
		this.easeTokens(now);
		const statusParts: string[] = [];
		if (this.shownTokens > 0)
			statusParts.push(`${formatLiveTokens(this.shownTokens)} token${this.shownTokens === 1 ? "" : "s"}`);
		const elapsedSeconds = Math.floor((now - this.startedAt) / 1000);
		if (elapsedSeconds >= 1) statusParts.push(formatElapsed(elapsedSeconds));
		return { label: LABELS[this.activity], status: statusParts.join(" · ") };
	}

	private emit(): void {
		if (!this.active || this.frozen) return;
		const next = this.line();
		if (this.lastLine && this.lastLine.label === next.label && this.lastLine.status === next.status) return;
		this.lastLine = next;
		this.onLine(next);
	}

	private easeTokens(now: number): void {
		const target = this.settledTokens + Math.round(this.streamedChars / CHARS_PER_TOKEN);
		const gap = target - this.shownTokens;
		if (gap === 0) return;
		const eased = Math.abs(gap) * (1 - Math.exp(-Math.max(0, now - this.easeAt) / EASE_MS));
		const step = Math.max(1, Math.round(eased));
		this.shownTokens = step >= Math.abs(gap) ? target : this.shownTokens + Math.sign(gap) * step;
		this.easeAt = now;
	}

	private stopTick(): void {
		if (this.tickTimer === undefined) return;
		clearInterval(this.tickTimer);
		this.tickTimer = undefined;
	}
}
