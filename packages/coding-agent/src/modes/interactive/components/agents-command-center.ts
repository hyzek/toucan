/**
 * The agent command center: the screen opened with Left at an empty prompt or
 * `/agents`. Lists this session's subagents under the session they ran in, with a
 * details pane for the selected agent and a scrollable transcript view on Enter.
 */

import type { AgentMessage } from "@hyzek/toucan-agent-core";
import {
	type Component,
	Container,
	type Focusable,
	getKeybindings,
	HStack,
	matchesKey,
	Spacer,
	Text,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@hyzek/toucan-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import { SessionManager } from "../../../core/session-manager.ts";
import type {
	SubagentManager,
	SubagentRecord,
	SubagentRecordStatus,
} from "../../../core/subagents/subagent-manager.ts";
import { theme } from "../theme/theme.ts";
import { keyText } from "./keybinding-hints.ts";

type AgentsFilter = "all" | "working" | "ready";

const FILTERS: AgentsFilter[] = ["all", "working", "ready"];
const BLINK_MS = 500;
const INDENT = "  ";

function isWorking(status: SubagentRecordStatus): boolean {
	return status === "queued" || status === "running";
}

function matchesFilter(record: SubagentRecord, filter: AgentsFilter): boolean {
	if (filter === "all") return true;
	if (filter === "working") return isWorking(record.status);
	return !isWorking(record.status);
}

function statusWord(status: SubagentRecordStatus, blinkOn: boolean): string {
	switch (status) {
		case "running":
			return blinkOn ? theme.fg("text", "working") : theme.fg("dim", "working");
		case "queued":
			return theme.fg("dim", "queued");
		case "completed":
			return theme.fg("success", "done");
		case "stopped":
			return theme.fg("dim", "stopped");
		case "error":
			return theme.fg("error", "error");
	}
}

function statusDot(status: SubagentRecordStatus, blinkOn: boolean): string {
	switch (status) {
		case "running":
			return blinkOn ? theme.fg("text", "●") : theme.fg("dim", "●");
		case "queued":
			return theme.fg("dim", "○");
		case "completed":
			return theme.fg("success", "●");
		case "stopped":
			return theme.fg("dim", "●");
		case "error":
			return theme.fg("error", "●");
	}
}

function recordLabel(record: SubagentRecord): string {
	const source = record.description?.trim() || record.task.trim();
	return source.split("\n")[0] ?? source;
}

function formatElapsed(startedAt: number, finishedAt: number | undefined): string {
	const seconds = Math.max(0, Math.round(((finishedAt ?? Date.now()) - startedAt) / 1000));
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
	return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/** Word-wrap plain text (explicit newlines preserved) to the pane width. */
function wrapText(text: string, width: number): string[] {
	const safe = Math.max(8, width);
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		if (!paragraph.trim()) {
			lines.push("");
			continue;
		}
		let current = "";
		for (const word of paragraph.split(/\s+/)) {
			if (!current) {
				current = word;
			} else if (visibleWidth(`${current} ${word}`) <= safe) {
				current += ` ${word}`;
			} else {
				lines.push(current);
				current = word;
			}
		}
		if (current) lines.push(current);
	}
	return lines;
}

/**
 * Compact conversation rendering: prompt lines, answer text, and tool call/result
 * markers. Thinking, system, and bookkeeping messages are left out.
 */
function transcriptLines(messages: AgentMessage[]): string[] {
	const lines: string[] = [];
	for (const message of messages) {
		if (message.role === "user") {
			const text =
				typeof message.content === "string"
					? message.content
					: message.content
							.filter((part) => part.type === "text")
							.map((part) => part.text)
							.join("\n");
			if (text.trim()) lines.push(theme.fg("accent", `› ${text.trim()}`));
		} else if (message.role === "assistant") {
			for (const part of message.content) {
				if (part.type === "text" && part.text.trim()) {
					for (const line of wrapText(part.text.trim(), 200)) lines.push(theme.fg("text", line));
				} else if (part.type === "toolCall") {
					lines.push(theme.fg("muted", `→ ${part.name}`));
				}
			}
		} else if (message.role === "toolResult") {
			const first = message.content.filter((part) => part.type === "text").map((part) => part.text)[0];
			const summary = (first ?? "").trim().split("\n")[0] ?? "";
			if (summary) lines.push(theme.fg("dim", `   └─ ${summary}`));
		}
		lines.push("");
	}
	return lines;
}

interface TranscriptState {
	recordId: string;
	lines: string[];
	scroll: number;
}

/** State the command center exposes to its pane components. */
export interface CommandCenterState {
	filter: AgentsFilter;
	selectedIndex: number;
	blinkOn: boolean;
	transcript: TranscriptState | undefined;
	/** Row offset the tree pane is scrolled by (kept aligned with `selectedIndex`). */
	treeScroll(): number;
	visibleRecords(): SubagentRecord[];
	filterCounts(): Record<AgentsFilter, number>;
	selectedRecord(): SubagentRecord | undefined;
	liveTurns(record: SubagentRecord): number;
	sessionLabel(): string;
	/** Body rows available to a pane (tree, details, or transcript). */
	bodyHeight(): number;
	/** Tree pane geometry for mouse routing; written by the tree during render. */
	recordTreeGeometry(width: number, rows: number): void;
}

/** The command center screen; owns its filter, selection, and transcript state. */
export class AgentsCommandCenterComponent extends Container implements Focusable {
	/** Screen state read by the pane components; mutated only through this class. */
	public filter: AgentsFilter = "all";
	public selectedIndex = 0;
	public blinkOn = true;
	public transcript: TranscriptState | undefined;

	private manager: SubagentManager;
	private ui: TUI;
	private sessionName: string;
	private onClose: () => void;
	private requestRender: () => void;
	private unsubscribe: () => void;
	private blinkTimer: ReturnType<typeof setInterval> | undefined;
	private selectedId: string | undefined;
	private bodyRows = 12;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
	}

	get capturesViewportInput(): boolean {
		return true;
	}

	constructor(session: AgentSession, options: { ui: TUI; onClose: () => void; requestRender: () => void }) {
		super();
		this.manager = session.subagentManager;
		this.ui = options.ui;
		this.sessionName = session.sessionName ?? "this session";
		this.onClose = options.onClose;
		this.requestRender = options.requestRender;
		this.unsubscribe = this.manager.subscribe(() => this.refresh());
		this.refresh();
	}

	/** Stop the blink timer and the manager subscription. */
	dispose(): void {
		if (this.blinkTimer !== undefined) {
			clearInterval(this.blinkTimer);
			this.blinkTimer = undefined;
		}
		this.unsubscribe();
	}

	visibleRecords(): SubagentRecord[] {
		return this.manager.list().filter((record) => matchesFilter(record, this.filter));
	}

	/** Mouse routing bookkeeping, written by the tree pane during render. */
	recordTreeGeometry(width: number, rows: number): void {
		this.treeColumnWidth = width;
		this.lastRenderedTreeRows = rows;
	}

	filterCounts(): Record<AgentsFilter, number> {
		const all = this.manager.list();
		return {
			all: all.length,
			working: all.filter((record) => isWorking(record.status)).length,
			ready: all.filter((record) => !isWorking(record.status)).length,
		};
	}

	selectedRecord(): SubagentRecord | undefined {
		return this.visibleRecords()[this.selectedIndex];
	}

	/** Turns of a still-running agent, read from its live session. */
	liveTurns(record: SubagentRecord): number {
		const live = this.manager.liveSession(record.id);
		if (!live) return record.turns;
		return live.messages.filter((message) => message.role === "assistant").length;
	}

	sessionLabel(): string {
		return this.sessionName;
	}

	bodyHeight(): number {
		return this.bodyRows;
	}

	/** Scroll offset that keeps the selected tree row inside the visible window. */
	treeScroll(): number {
		const height = Math.max(1, this.bodyRows - 1); // -1: the group header row
		const row = this.selectedIndex + 1;
		const scroll = Math.max(0, row - height);
		return Math.min(scroll, Math.max(0, this.visibleRecords().length + 1 - this.bodyRows));
	}

	override render(width: number): string[] {
		// The screen fills the terminal: header (5 rows), body, and the footer
		// pinned to the terminal's last row.
		const termRows = this.ui.terminal.rows;
		this.bodyRows = Math.max(4, termRows - 7); // 5 header rows + gap + footer
		return this.renderPinnedFooter(super.render(width), termRows);
	}

	/** Pin the footer line to the bottom row; the panes get any slack above it. */
	private renderPinnedFooter(lines: string[], height: number): string[] {
		const footer = lines[lines.length - 1] ?? "";
		const body = lines.slice(0, -1).slice(0, Math.max(0, height - 1));
		while (body.length < height - 1) body.push("");
		body.push(footer);
		return body;
	}

	override handleMouse(event: Parameters<Container["handleMouse"]>[0]): ReturnType<Container["handleMouse"]> {
		this.treeTop = 5; // spacer, title, spacer, tabs, spacer
		// The full-screen screen does not register its mouse regions, so route clicks
		// by row and column: clicks inside the tree band move the selection; clicks
		// elsewhere toggle the transcript of the selected agent.
		if (
			event.type === "click" &&
			event.button === "left" &&
			event.x < this.treeColumnWidth &&
			event.y >= this.treeTop &&
			event.y < this.treeTop + this.lastRenderedTreeRows
		) {
			const rowInTree = event.y - this.treeTop + this.treeScroll();
			const index = rowInTree - 1; // -1: the group header row
			const records = this.visibleRecords();
			if (index >= 0 && index < records.length && index !== this.selectedIndex) this.selectIndex(index);
			return { handled: true, target: { component: this, originX: 0, originY: 0, width: 0, height: 0 } };
		}
		if (event.type === "click" && event.button === "left" && event.y >= this.treeTop) {
			if (this.transcript) {
				this.transcript = undefined;
				this.refresh();
			} else {
				const record = this.selectedRecord();
				if (record) this.openTranscript(record);
			}
			return { handled: true, target: { component: this, originX: 0, originY: 0, width: 0, height: 0 } };
		}
		return undefined;
	}

	/** Layout bookkeeping for mouse routing, refreshed on every render. */
	private treeColumnWidth = 0;
	private treeTop = 0;
	private lastRenderedTreeRows = 0;

	private refresh(): void {
		const records = this.visibleRecords();
		if (this.selectedId !== undefined) {
			const index = records.findIndex((record) => record.id === this.selectedId);
			this.selectedIndex = index >= 0 ? index : Math.min(this.selectedIndex, Math.max(0, records.length - 1));
		}
		const selected = records[this.selectedIndex];
		if (selected) this.selectedId = selected.id;
		this.updateBlink(records);
		this.rebuild();
		this.requestRender();
	}

	private updateBlink(records: SubagentRecord[]): void {
		const anyWorking = records.some((record) => isWorking(record.status));
		if (anyWorking && this.blinkTimer === undefined) {
			this.blinkTimer = setInterval(() => {
				this.blinkOn = !this.blinkOn;
				this.rebuild();
				this.requestRender();
			}, BLINK_MS);
		} else if (!anyWorking && this.blinkTimer !== undefined) {
			clearInterval(this.blinkTimer);
			this.blinkTimer = undefined;
		}
	}

	private rebuild(): void {
		this.clear();
		this.addChild(new Spacer(1));
		this.addChild(new TitleLine());
		this.addChild(new Spacer(1));
		this.addChild(new FilterTabs(this));
		this.addChild(new Spacer(1));
		if (this.transcript) {
			this.addChild(new TranscriptPane(this));
		} else {
			// basis 0: the two panes split the screen evenly, whatever their
			// intrinsic widths are, so the tree column never collapses.
			const panes = new HStack([], { gap: 4 });
			panes.addChild(new AgentTree(this), { basis: 0, grow: 1, minSize: 30 });
			panes.addChild(new TaskDetails(this), { basis: 0, grow: 1, minSize: 40 });
			this.addChild(panes);
		}
		this.addChild(new Spacer(1));
		this.addChild(new Text(this.footerText(), 0, 0));
	}

	/** Footer hint: the key in bright white, what it does in dark gray. */
	private hint(keys: string, description: string): string {
		return theme.fg("text", keys) + theme.fg("dim", ` ${description}`);
	}

	private footerText(): string {
		if (this.transcript) {
			return `${INDENT}${this.hint("↑/↓", "scroll")}   ${this.hint("esc", "back")}`;
		}
		return (
			`${INDENT}${this.hint(keyText("tui.select.cancel"), "back")}   ` +
			`${this.hint("↑/↓", "move")}   ` +
			`${this.hint("enter", "open")}   ` +
			this.hint("tab", "tabs")
		);
	}

	handleInput(data: string): void {
		if (this.transcript) {
			this.handleTranscriptInput(data);
			return;
		}
		if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
			this.cycleFilter(matchesKey(data, "shift+tab") ? -1 : 1);
			return;
		}
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.cancel")) {
			this.onClose();
			return;
		}
		if (kb.matches(data, "tui.select.up")) {
			this.cycleSelection(-1);
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			this.cycleSelection(1);
			return;
		}
		if (kb.matches(data, "tui.select.confirm")) {
			const record = this.selectedRecord();
			if (record) this.openTranscript(record);
			return;
		}
	}

	/** Move the tree selection by `delta`, wrapping, and keep `selectedId` in step. */
	private cycleSelection(delta: number): void {
		const records = this.visibleRecords();
		if (records.length === 0) return;
		const next = (this.selectedIndex + delta + records.length) % records.length;
		this.selectIndex(next);
	}

	/** Select a tree row; the id anchor must follow or `refresh` would undo the move. */
	private selectIndex(index: number): void {
		const record = this.visibleRecords()[index];
		if (!record) return;
		this.selectedIndex = index;
		this.selectedId = record.id;
		this.refresh();
	}

	private cycleFilter(delta: number): void {
		const index = FILTERS.indexOf(this.filter);
		this.filter = FILTERS[(index + delta + FILTERS.length) % FILTERS.length] ?? "all";
		this.refresh();
	}

	private handleTranscriptInput(data: string): void {
		const transcript = this.transcript;
		if (!transcript) return;
		if (matchesKey(data, "up")) {
			transcript.scroll = Math.max(0, transcript.scroll - 1);
			this.rebuild();
			this.requestRender();
			return;
		}
		if (matchesKey(data, "down")) {
			transcript.scroll += 1;
			this.rebuild();
			this.requestRender();
			return;
		}
		if (matchesKey(data, "escape") || matchesKey(data, "enter")) {
			this.transcript = undefined;
			this.refresh();
		}
	}

	private openTranscript(record: SubagentRecord): void {
		let messages: AgentMessage[] = [];
		const live = this.manager.liveSession(record.id);
		if (live) {
			messages = live.messages;
		} else if (record.sessionFile) {
			try {
				messages = SessionManager.open(record.sessionFile).buildSessionContext().messages;
			} catch {
				messages = [];
			}
		}
		this.transcript = { recordId: record.id, lines: transcriptLines(messages), scroll: 0 };
		this.refresh();
	}
}

class TitleLine implements Component {
	invalidate(): void {}

	render(width: number): string[] {
		return [truncateToWidth(`${INDENT}${theme.fg("toolTitle", theme.bold("Agent command center"))}`, width, "")];
	}
}

class FilterTabs implements Component {
	owner: CommandCenterState;

	constructor(owner: CommandCenterState) {
		this.owner = owner;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const counts = this.owner.filterCounts();
		const parts = FILTERS.map((filter) => {
			const name = filter === "all" ? "All" : filter === "working" ? "Working" : "Ready";
			const label = `${name} ${counts[filter]}`;
			return filter === this.owner.filter ? theme.fg("accent", theme.bold(label)) : theme.fg("muted", label);
		});
		return [truncateToWidth(`${INDENT}${parts.join("   ")}`, width, "")];
	}
}

class AgentTree implements Component {
	owner: CommandCenterState;

	constructor(owner: CommandCenterState) {
		this.owner = owner;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const records = this.owner.visibleRecords();
		const header = `${INDENT}${theme.fg("toolTitle", theme.bold(this.owner.sessionLabel()))}`;
		if (records.length === 0) {
			this.owner.recordTreeGeometry(width, 2);
			return [header, `${INDENT}${theme.fg("muted", "no subagents this session")}`];
		}
		const height = this.owner.bodyHeight();
		const scroll = this.owner.treeScroll();
		const maxWidth = Math.max(8, width - 9); // + branch(2+1) + gutters + dot + space = 9
		// Labels share one column width (the widest label, capped at the pane) so
		// the status dots line up right behind the tree instead of at the edge.
		const labelWidth = Math.min(maxWidth, Math.max(...records.map((r) => visibleWidth(recordLabel(r)))));
		const lines: string[] = [];
		if (scroll > 0) lines.push(`${INDENT}${theme.fg("dim", `↑ ${scroll} above`)}`);
		// The header shares the scroll so long trees stay connected to their group.
		const rows: string[] = [header];
		records.forEach((record, index) => {
			const branch = index === records.length - 1 ? "└─" : "├─";
			const dot = statusDot(record.status, this.owner.blinkOn);
			const label = truncateToWidth(recordLabel(record), labelWidth, "…");
			// Pad labels to one column so the status dots line up across rows; the
			// space before the dot is added separately, so padding may be empty.
			const pad = " ".repeat(Math.max(0, labelWidth - visibleWidth(label)));
			const row = `${INDENT}  ${theme.fg("dim", branch)} ${label}${pad} ${dot}`;
			// The selection bar spans the whole pane, not just the text run. Some
			// themes paint no selectedBg, so the selection also brightens and emboldens
			// the row: it stays visible even where the background does not render.
			const bar = row + " ".repeat(Math.max(0, width - visibleWidth(row)));
			const marked = index === this.owner.selectedIndex;
			rows.push(marked ? theme.bg("selectedBg", theme.fg("text", theme.bold(bar))) : row);
		});
		const visible = rows.slice(scroll, scroll + Math.max(1, height - lines.length));
		lines.push(...visible);
		const remaining = rows.length - scroll - visible.length;
		if (remaining > 0) lines.push(`${INDENT}${theme.fg("dim", `↓ ${remaining} below`)}`);
		this.owner.recordTreeGeometry(width, lines.length);
		return lines;
	}
}

class TaskDetails implements Component {
	owner: CommandCenterState;

	constructor(owner: CommandCenterState) {
		this.owner = owner;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const record = this.owner.selectedRecord();
		if (!record) {
			return [theme.fg("muted", "Select an agent to see its details.")];
		}
		const lines: string[] = [theme.fg("toolTitle", theme.bold("Task details")), ""];
		lines.push(`${theme.fg("muted", "Status")} ${statusWord(record.status, this.owner.blinkOn)}`);
		lines.push(`${theme.fg("muted", "Model")} ${theme.fg("toolOutput", record.model ?? "(not started)")}`);
		lines.push("", theme.fg("muted", "Prompt"));
		lines.push(...wrapText(record.task, width).map((line) => theme.fg("text", line)));
		lines.push("");
		if (record.status === "running" || record.status === "queued") {
			const liveTurns = this.owner.liveTurns(record);
			const running = `Running after ${liveTurns} turn${liveTurns === 1 ? "" : "s"}`;
			lines.push(theme.fg("muted", `${running} (${formatElapsed(record.startedAt, undefined)})`));
		} else {
			const turns = `${record.turns} turn${record.turns === 1 ? "" : "s"}`;
			const heading =
				record.status === "completed"
					? `Response after ${turns}`
					: record.status === "stopped"
						? `Partial answer after ${turns}`
						: "Error";
			lines.push(theme.fg("muted", heading));
			lines.push(...wrapText(record.result ?? "(no result)", width).map((line) => theme.fg("text", line)));
		}
		if (record.sessionFile) lines.push("", theme.fg("dim", record.sessionFile));

		// Fold to the pane height; a long answer tails off with the row count.
		const height = this.owner.bodyHeight();
		if (lines.length <= height) return lines;
		const clipped = lines.slice(0, Math.max(0, height - 1));
		clipped.push(theme.fg("dim", `… ${lines.length - clipped.length} more rows`));
		return clipped;
	}
}

class TranscriptPane implements Component {
	owner: CommandCenterState;

	constructor(owner: CommandCenterState) {
		this.owner = owner;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const transcript = this.owner.transcript;
		if (!transcript) return [];
		const height = this.owner.bodyHeight();
		const maxScroll = Math.max(0, transcript.lines.length - height);
		const scroll = Math.min(transcript.scroll, maxScroll);
		const out: string[] = [];
		if (scroll > 0) out.push(theme.fg("dim", `${INDENT}↑ ${scroll} more above`));
		for (const line of transcript.lines.slice(scroll, scroll + height)) {
			out.push(line ? truncateToWidth(`${INDENT}${line}`, width, "…") : "");
		}
		const remaining = transcript.lines.length - scroll - height;
		if (remaining > 0) out.push(theme.fg("dim", `${INDENT}↓ ${remaining} more below`));
		return out;
	}
}
