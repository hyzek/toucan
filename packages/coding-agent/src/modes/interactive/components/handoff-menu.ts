/**
 * Handoff menu: the chooser rendered by the `handoff` tool.
 *
 * Same input-band look as the question form — every row painted with the editor's `editorBg`,
 * content aligned to the band's caret column, padded top and bottom — but a single question,
 * fixed model-supplied options, no free text, and no hint row: the menu is just the question,
 * the options, and the picker.
 */

import { type KeybindingsManager, type TUI, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@hyzek/toucan-tui";
import type { HandoffToolOption } from "../../../core/tools/handoff.ts";
import { theme } from "../theme/theme.ts";
import { INPUT_PROMPT } from "./custom-editor.ts";

export interface HandoffMenuResult {
	choiceIndex: number;
	dismissed: boolean;
}

const INDENT = " ".repeat(visibleWidth(INPUT_PROMPT));
const MAX_VISIBLE_OPTIONS = 9;

export class HandoffMenu {
	private optionIndex = 0;
	private viewStart = 0;
	private readonly tui: TUI;
	private readonly keybindings: KeybindingsManager;
	private readonly prompt: string;
	private readonly summary: string | undefined;
	private readonly options: HandoffToolOption[];
	private readonly done: (result: HandoffMenuResult) => void;

	constructor(
		tui: TUI,
		keybindings: KeybindingsManager,
		prompt: string,
		summary: string | undefined,
		options: HandoffToolOption[],
		done: (result: HandoffMenuResult) => void,
	) {
		this.tui = tui;
		this.keybindings = keybindings;
		this.prompt = prompt;
		this.summary = summary;
		this.options = options;
		this.done = done;
	}

	invalidate(): void {}

	dispose(): void {}

	render(width: number): string[] {
		return this.renderMenu(width);
	}

	handleInput(data: string): void {
		const kb = this.keybindings;
		if (kb.matches(data, "tui.select.up")) {
			this.optionIndex = Math.max(0, this.optionIndex - 1);
			this.tui.requestRender();
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			this.optionIndex = Math.min(this.options.length - 1, this.optionIndex + 1);
			this.tui.requestRender();
			return;
		}
		if (kb.matches(data, "tui.select.cancel")) {
			this.done({ choiceIndex: 0, dismissed: true });
			return;
		}
		if (kb.matches(data, "tui.select.confirm")) {
			this.done({ choiceIndex: this.optionIndex, dismissed: false });
		}
	}

	private addWrapped(rows: string[], text: string, width: number): void {
		for (const line of wrapTextWithAnsi(`${INDENT}${text}`, width)) rows.push(line);
	}

	private renderMenu(width: number): string[] {
		const rows: string[] = [""];
		this.addWrapped(rows, theme.fg("accent", theme.bold(this.prompt)), width);
		if (this.summary) {
			rows.push("");
			for (const line of this.summary.split("\n")) {
				this.addWrapped(rows, theme.fg("muted", line), width);
			}
		}
		rows.push("");

		const window = Math.min(MAX_VISIBLE_OPTIONS, this.options.length);
		if (this.optionIndex < this.viewStart) this.viewStart = this.optionIndex;
		else if (this.optionIndex >= this.viewStart + window) this.viewStart = this.optionIndex - window + 1;
		this.viewStart = Math.max(0, Math.min(this.viewStart, this.options.length - window));

		const withDescriptions = this.options.some((option) => option.description) && width >= 60;
		const primaryWidth = withDescriptions
			? Math.min(
					Math.max(10, ...this.options.map((option) => visibleWidth(option.label))) + 4,
					Math.floor(width * 0.55),
				)
			: 0;

		for (let i = this.viewStart; i < this.viewStart + window; i++) {
			const option = this.options[i]!;
			const isCursor = i === this.optionIndex;
			const label = `${i + 1}. ${option.label}`;
			const labelText = isCursor ? theme.fg("accent", label) : theme.fg("text", label);
			if (option.description && primaryWidth > 0) {
				const gap = Math.max(1, primaryWidth - visibleWidth(label));
				const descWidth = width - INDENT.length - 2 - primaryWidth - 2;
				if (descWidth > 8) {
					rows.push(
						`${INDENT}${isCursor ? theme.fg("accent", "❯ ") : "  "}${truncateToWidth(labelText, primaryWidth, "")}${" ".repeat(gap)}${theme.fg("muted", truncateToWidth(option.description, descWidth, ""))}`,
					);
					continue;
				}
			}
			rows.push(`${INDENT}${isCursor ? theme.fg("accent", "❯ ") : "  "}${labelText}`);
			if (option.description)
				this.addWrapped(rows, theme.fg("muted", option.description), width - INDENT.length - 4);
		}
		if (this.options.length > window) {
			rows.push(`${INDENT}${theme.fg("dim", `(${this.optionIndex + 1}/${this.options.length})`)}`);
		}
		rows.push("");

		// The band: clip, pad to the full width, paint the editor background on every row.
		return rows.map((row) => {
			const clipped = truncateToWidth(row, width, "");
			const padded = clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
			return theme.bg("editorBg", padded);
		});
	}
}
