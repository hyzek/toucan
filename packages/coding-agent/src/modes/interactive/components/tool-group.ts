/**
 * A run of consecutive tool calls, shown as one sentence until it is expanded.
 *
 * The group holds the same `ToolExecutionComponent`s the transcript would otherwise show one by one.
 * Collapsed, it renders a single summary line plus the call still running; expanded, every call's own
 * row. A group of one renders that call's row alone, so a single `bash` or `edit` never loses its
 * output behind a one-call sentence. Which rows join a group, and where a run ends, is the
 * transcript's decision; this file only decides what a group shows.
 */

import { Container, MouseRegion, Text, type TUI } from "@hyzek/toucan-tui";
import { type GroupedToolCall, summarizeToolGroup, type ToolGroupSummary } from "../../../core/tools/group-summary.ts";
import { TOOL_ROW_MARKER } from "../../../core/tools/render-utils.ts";
import { formatElapsedSeconds } from "../../../utils/duration.ts";
import { theme } from "../theme/theme.ts";
import { keyHint } from "./keybinding-hints.ts";
import type { ToolExecutionComponent } from "./tool-execution.ts";

/** Two calls make a run: one call is just a row. */
const MIN_GROUP_SIZE = 2;
/** How often a running group redraws, for its `· 3s` tail. */
const RUNNING_TICK_MS = 1000;

export class ToolGroupComponent extends Container {
	private readonly ui: TUI;
	private readonly tools: ToolExecutionComponent[] = [];
	private readonly summaryLine: Text;
	private readonly summaryRegion: MouseRegion;
	private expanded = false;
	/** When the current run of pending calls began, for the elapsed tail; gone once none are left. */
	private runStartedAt: number | undefined;
	/** What the last refresh summarized; the running tick redraws the elapsed tail from it. */
	private summary: ToolGroupSummary = { sentence: "", running: false, failed: 0 };
	private runningTick: ReturnType<typeof setInterval> | undefined;

	constructor(ui: TUI) {
		super();
		this.ui = ui;
		this.summaryLine = new Text("", 1, 0);
		this.summaryRegion = new MouseRegion(this.summaryLine, (event) => {
			if (event.type !== "click" || event.button !== "left") return undefined;
			this.setExpanded(!this.expanded);
			this.ui.requestRender();
			return { handled: true };
		});
	}

	/** Adds a tool row to the run and re-lays out the group. */
	addTool(tool: ToolExecutionComponent): void {
		this.tools.push(tool);
		this.refresh();
	}

	/** Expands or collapses the group and every call in it. This is what `ctrl+o` drives. */
	setExpanded(expanded: boolean): void {
		if (this.expanded === expanded) return;
		this.expanded = expanded;
		for (const tool of this.tools) {
			tool.setExpanded(expanded);
		}
		this.refresh();
	}

	override invalidate(): void {
		super.invalidate();
		this.refresh();
	}

	/** Calls in the group, in transcript order. */
	getToolRows(): readonly ToolExecutionComponent[] {
		return this.tools;
	}

	/**
	 * Rebuilds what the group shows and what it hides, after a call joined, settled or expanded.
	 *
	 * Rows stay `ToolExecutionComponent`s either way, so results keep streaming into them, an expanded
	 * group keeps each row's own output preview, and collapsing costs nothing but lines on screen.
	 */
	refresh(): void {
		const states = this.tools.map((tool) => tool.getGroupedState());
		this.summary = summarizeToolGroup(states);
		const grouped = this.tools.length >= MIN_GROUP_SIZE;
		for (const tool of this.tools) {
			tool.setRowMarkerShown(!grouped || this.expanded);
		}

		this.summaryLine.setText(grouped ? this.summaryText() : "");
		this.clear();
		if (!grouped) {
			for (const tool of this.tools) this.addChild(tool);
			this.trackRunning(states);
			return;
		}

		this.addChild(this.summaryRegion);
		if (this.expanded) {
			for (const tool of this.tools) this.addChild(tool);
		} else {
			// While the run is collapsed, only the call still running keeps a row.
			let running: ToolExecutionComponent | undefined;
			for (const [index, state] of states.entries()) {
				if (state.status === "pending") running = this.tools[index];
			}
			if (running) this.addChild(running);
		}
		this.trackRunning(states);
	}

	/** `• Reading 2 files, running 1 shell command… · 3s · 1 failed (ctrl+o to expand)` */
	private summaryText(): string {
		const markerToken = this.summary.failed > 0 ? "error" : this.summary.running ? "dim" : "success";
		const parts = [
			theme.fg(markerToken, TOOL_ROW_MARKER),
			` ${this.summary.sentence}`,
			this.summary.running ? "…" : "",
		];
		if (this.summary.running && this.runStartedAt !== undefined) {
			parts.push(theme.fg("muted", ` · ${formatElapsedSeconds(Date.now() - this.runStartedAt)}`));
		}
		if (this.summary.failed > 0) parts.push(theme.fg("error", ` · ${this.summary.failed} failed`));
		parts.push(theme.fg("muted", ` (${keyHint("app.tools.expand", this.expanded ? "to collapse" : "to expand")})`));
		return parts.join("");
	}

	/** Starts the one-second redraw while calls run, stops it when the run is over. */
	private trackRunning(states: readonly GroupedToolCall[]): void {
		if (states.some((state) => state.status === "pending")) {
			this.runStartedAt ??= Date.now();
			this.runningTick ??= setInterval(() => {
				this.refresh();
				this.ui.requestRender();
			}, RUNNING_TICK_MS);
			return;
		}
		this.runStartedAt = undefined;
		if (this.runningTick) {
			clearInterval(this.runningTick);
			this.runningTick = undefined;
		}
	}
}
