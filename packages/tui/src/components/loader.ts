import type { TUI } from "../tui.ts";
import { Text } from "./text.ts";

export interface LoaderIndicatorOptions {
	/** Animation frames. Use an empty array to hide the indicator. */
	frames?: string[];
	/** Frame interval in milliseconds for animated indicators. */
	intervalMs?: number;
}

const DEFAULT_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DEFAULT_INTERVAL_MS = 80;

/**
 * Loader component that updates with an optional spinning animation.
 */
export class Loader extends Text {
	protected frames = [...DEFAULT_FRAMES];
	private intervalMs = DEFAULT_INTERVAL_MS;
	protected currentFrame = 0;
	private intervalId: NodeJS.Timeout | null = null;
	private ui: TUI | null = null;
	private renderIndicatorVerbatim = false;
	private spinnerColorFn: (str: string) => string;
	protected messageColorFn: (str: string) => string;
	private message: string = "Loading...";

	constructor(
		ui: TUI,
		spinnerColorFn: (str: string) => string,
		messageColorFn: (str: string) => string,
		message: string = "Loading...",
		indicator?: LoaderIndicatorOptions,
	) {
		super("", 1, 0);
		this.ui = ui;
		this.spinnerColorFn = spinnerColorFn;
		this.messageColorFn = messageColorFn;
		this.message = message;
		this.setIndicator(indicator);
	}

	render(width: number): string[] {
		return ["", ...super.render(width)];
	}

	start(): void {
		this.updateDisplay();
		this.restartAnimation();
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	setMessage(message: string): void {
		this.message = message;
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	setIndicator(indicator?: LoaderIndicatorOptions): void {
		this.renderIndicatorVerbatim = indicator !== undefined;
		this.frames = indicator?.frames !== undefined ? [...indicator.frames] : [...DEFAULT_FRAMES];
		this.intervalMs = indicator?.intervalMs && indicator.intervalMs > 0 ? indicator.intervalMs : DEFAULT_INTERVAL_MS;
		this.currentFrame = 0;
		this.start();
	}

	private restartAnimation(): void {
		this.stop();
		if (this.frames.length <= 1) {
			return;
		}
		this.intervalId = setInterval(() => {
			this.currentFrame = (this.currentFrame + 1) % this.frames.length;
			this.updateDisplay();
		}, this.intervalMs);
	}

	protected getRenderedIndicator(): string {
		const frame = this.frames[this.currentFrame] ?? "";
		return this.renderIndicatorVerbatim ? frame : this.spinnerColorFn(frame);
	}

	/** The animated indicator prefix (defaults to the spinner frame, double-spaced). */
	protected getIndicatorText(): string {
		const renderedFrame = this.getRenderedIndicator();
		return renderedFrame.length > 0 ? `${renderedFrame} ` : "";
	}

	/** Render the message. Subclasses override this for animated text effects (e.g. a sweep). */
	protected renderMessage(message: string, _frameIndex: number): string {
		return this.messageColorFn(message);
	}

	protected updateDisplay(): void {
		this.setText(`${this.getIndicatorText()}${this.renderMessage(this.message, this.currentFrame)}`);
		if (this.ui) {
			this.ui.requestRender();
		}
	}
}
