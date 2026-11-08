import { Container, type Focusable, getKeybindings, Text } from "@hyzek/toucan-tui";
import type { UsageReport } from "../../../core/usage-stats.ts";
import { totalTokens } from "../../../core/usage-stats.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { formatTokens } from "./footer.ts";
import { keyDisplayText } from "./keybinding-hints.ts";
import { ThemedText } from "./themed-text.ts";

/** Both scopes `/stats` reports: every session on this machine, and this project's. */
export interface StatsReport {
	global: UsageReport;
	project: UsageReport;
	/** Working directory the project scope was filtered to, for display. */
	projectDir: string;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Width of the abbreviated day labels in the week strip. */
const WEEK_CELL_WIDTH = 7;

/** Day key (`YYYY-MM-DD`) to the strip's short weekday label. */
function weekdayLabel(day: string): string {
	return WEEKDAY_NAMES[new Date(`${day}T12:00:00`).getDay()]!;
}

/**
 * Overlay for `/stats`: bold token counts for this project and for all sessions,
 * plus a 7-day strip with one abbreviated number per weekday. Closes on Esc/Ctrl+C.
 */
export class StatsSelectorComponent extends Container implements Focusable {
	private onCancel: () => void;
	private body: ThemedText;
	private report: StatsReport | null = null;
	private error: string | null = null;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	constructor(onCancel: () => void) {
		super();
		this.onCancel = onCancel;

		this.addChild(new DynamicBorder());
		this.addChild(new ThemedText(() => theme.bold(theme.fg("accent", "Usage Stats")), 1, 1));
		this.body = new ThemedText(() => this.renderBody(), 1, 0);
		this.addChild(this.body);
		this.addChild(new Text(theme.fg("dim", `  ${keyDisplayText("tui.select.cancel")} to close`), 0, 1));
		this.addChild(new DynamicBorder());
	}

	/** Swap in the computed report; the body repaints on the next render. */
	setReport(report: StatsReport): void {
		this.report = report;
		this.body.invalidate();
	}

	/** Show a failure instead of the report. */
	setError(message: string): void {
		this.error = message;
		this.body.invalidate();
	}

	handleInput(keyData: string): void {
		if (getKeybindings().matches(keyData, "tui.select.cancel")) this.onCancel();
	}

	private renderBody(): string {
		if (this.error) return theme.fg("error", `Could not compute usage: ${this.error}`);
		if (!this.report)
			return `${theme.fg("dim", "Computing usage…")} ${theme.fg("dim", "(scans all stored sessions)")}`;

		const { global, project, projectDir } = this.report;
		let text = `${theme.fg("dim", `This project · ${projectDir}`)}\n`;
		text += `  ${theme.bold(theme.fg("accent", `${formatTokens(totalTokens(project.totals))} tokens`))}\n\n`;
		text += `${theme.fg("dim", "All sessions on this machine")}\n`;
		text += `  ${theme.bold(`${formatTokens(totalTokens(global.totals))} tokens`)}\n\n`;
		text += `${theme.bold("Last 7 days")} ${theme.fg("dim", "(tokens)")}\n`;
		text += `  ${" ".repeat(8)}${project.byDay.map((d) => weekdayLabel(d.day).padStart(WEEK_CELL_WIDTH)).join("")}\n`;
		text += this.renderWeek("project", project);
		text += this.renderWeek("all", global);
		return text.trimEnd();
	}

	/** One strip row: weekday labels, then each day's abbreviated token count. */
	private renderWeek(label: string, report: UsageReport): string {
		const cells = report.byDay.map((day) =>
			day.tokens === 0
				? " ".repeat(WEEK_CELL_WIDTH - 1) + theme.fg("dim", "·")
				: formatTokens(day.tokens).padStart(WEEK_CELL_WIDTH),
		);
		return `  ${label.padStart(8)}${cells.join("")}\n`;
	}
}
