/**
 * Question form: the interactive answer sheet for the `question` tool.
 *
 * It is not a panel: it extends the input band upward. Every rendered row is painted with the
 * editor's `editorBg` background and content aligns to the band's caret column, so the form reads
 * as the message input grown over the questions. One question is visible at a time; with several
 * questions a tab row on top carries headers and progress. The last tab is a Submit question that
 * recaps every question and answer and asks Yes/No before sending them in one go.
 */

import {
	Input,
	type Keybinding,
	type KeybindingsManager,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@hyzek/toucan-tui";
import type {
	QuestionToolAnswer,
	QuestionToolAnswerValue,
	QuestionToolQuestion,
} from "../../../core/tools/question.ts";
import { theme } from "../theme/theme.ts";
import { INPUT_PROMPT } from "./custom-editor.ts";
import { formatKeyText } from "./keybinding-hints.ts";

export interface QuestionFormResult {
	answers: QuestionToolAnswer[];
	dismissed: boolean;
}

/** The extra pseudo-option every question carries. */
const OTHER_LABEL = "Type your own answer.";
/** Option rows shown at once; longer lists scroll with a `(i/n)` counter row. */
const MAX_VISIBLE_OPTIONS = 9;
const INDENT = " ".repeat(visibleWidth(INPUT_PROMPT));

interface AnswerState {
	selected: number[];
	typed?: string;
}

export class QuestionForm {
	private readonly showTabs: boolean;
	/** Tabs 0..n-1 are the questions; tab n is the Submit question, shown when `showTabs`. */
	private currentTab = 0;
	private optionIndex = 0;
	private viewStart = 0;
	private typingTab: number | undefined;
	private readonly input = new Input({ prompt: "" });
	private readonly answers = new Map<number, AnswerState>();
	private readonly tui: TUI;
	private readonly keybindings: KeybindingsManager;
	private readonly questions: QuestionToolQuestion[];
	private readonly done: (result: QuestionFormResult) => void;

	constructor(
		tui: TUI,
		keybindings: KeybindingsManager,
		questions: QuestionToolQuestion[],
		done: (result: QuestionFormResult) => void,
	) {
		this.tui = tui;
		this.keybindings = keybindings;
		this.questions = questions;
		this.done = done;
		// The Submit tab exists when there is more than one question, or when answers are
		// toggled (multi-select) and never auto-submit.
		this.showTabs = questions.length > 1 || questions.some((question) => question.multiple === true);
		this.input.onSubmit = (value) => this.commitTyped(value, true);
		this.input.onEscape = () => this.commitTyped(this.input.getValue(), false);
	}

	invalidate(): void {}

	dispose(): void {}

	render(width: number): string[] {
		return this.renderForm(width);
	}

	handleInput(data: string): void {
		this.onKey(data);
	}

	// ------------------------------------------------------------------
	// State helpers
	// ------------------------------------------------------------------

	private state(tab: number): AnswerState {
		let state = this.answers.get(tab);
		if (!state) {
			state = { selected: [] };
			this.answers.set(tab, state);
		}
		return state;
	}

	private isAnswered(tab: number): boolean {
		const state = this.answers.get(tab);
		return state !== undefined && (state.selected.length > 0 || state.typed !== undefined);
	}

	private allAnswered(): boolean {
		return this.questions.every((_, i) => this.isAnswered(i));
	}

	private firstUnanswered(from: number): number | undefined {
		const rotated = [...Array(this.questions.length)].map((_, i) => (from + i) % this.questions.length);
		return rotated.find((i) => !this.isAnswered(i));
	}

	private onSubmitTab(): boolean {
		return this.currentTab === this.questions.length;
	}

	private optionCount(tab: number): number {
		// The Submit tab offers exactly two choices: Yes and No.
		if (tab === this.questions.length) return 2;
		return this.questions[tab].options.length + 1;
	}

	private isOtherRow(index: number): boolean {
		return index === this.questions[this.currentTab].options.length;
	}

	private answerValues(tab: number): QuestionToolAnswerValue[] {
		const question = this.questions[tab];
		const state = this.answers.get(tab);
		if (!state) return [];
		const picked: QuestionToolAnswerValue[] = state.selected.flatMap((i) => {
			const option = question.options[i];
			if (!option) return [];
			return [option.description ? { title: option.label, subtitle: option.description } : { title: option.label }];
		});
		return state.typed !== undefined ? [...picked, { title: state.typed }] : picked;
	}

	// ------------------------------------------------------------------
	// Actions
	// ------------------------------------------------------------------

	private refresh(): void {
		this.tui.requestRender();
	}

	private setTab(tab: number): void {
		this.currentTab = tab;
		this.optionIndex = 0;
		this.viewStart = 0;
		this.typingTab = undefined;
		this.input.focused = false;
	}

	private advanceAfterAnswer(fromTab: number): void {
		if (!this.showTabs) {
			this.finish(false);
			return;
		}
		const next = this.firstUnanswered(fromTab + 1);
		this.setTab(next === undefined ? this.questions.length : next);
		this.refresh();
	}

	private finish(dismissed: boolean): void {
		const answers: QuestionToolAnswer[] = [];
		for (let tab = 0; tab < this.questions.length; tab++) {
			if (!this.isAnswered(tab)) continue;
			const question = this.questions[tab];
			const state = this.answers.get(tab)!;
			answers.push({
				header: question.header,
				question: question.question,
				answers: this.answerValues(tab),
				typed: state.typed !== undefined,
			});
		}
		this.done({ answers, dismissed });
	}

	private enterTyping(): void {
		this.typingTab = this.currentTab;
		this.input.setValue(this.answers.get(this.currentTab)?.typed ?? "");
		this.input.focused = true;
		this.refresh();
	}

	private commitTyped(value: string, advance: boolean): void {
		const tab = this.typingTab;
		if (tab === undefined) return;
		const trimmed = value.trim();
		const state = this.state(tab);
		if (trimmed) {
			state.typed = trimmed;
			state.selected = [];
		} else {
			state.typed = undefined;
		}
		this.typingTab = undefined;
		this.input.focused = false;
		if (trimmed && advance) this.advanceAfterAnswer(tab);
		else this.refresh();
	}

	private toggleOption(index: number): void {
		const question = this.questions[this.currentTab];
		if (this.isOtherRow(index)) {
			this.enterTyping();
			return;
		}
		const state = this.state(this.currentTab);
		if (question.multiple) {
			const at = state.selected.indexOf(index);
			if (at === -1) state.selected.push(index);
			else state.selected.splice(at, 1);
			state.selected.sort((a, b) => a - b);
			state.typed = undefined;
			this.refresh();
			return;
		}
		state.selected = [index];
		state.typed = undefined;
		this.advanceAfterAnswer(this.currentTab);
	}

	/** Yes/No on the Submit tab: submit, or go back to the first question worth editing. */
	private chooseSubmitOption(index: number): void {
		if (index === 0) {
			if (this.allAnswered()) {
				this.finish(false);
				return;
			}
			const missing = this.firstUnanswered(0);
			if (missing !== undefined) this.setTab(missing);
			this.refresh();
			return;
		}
		this.setTab(this.firstUnanswered(0) ?? 0);
		this.refresh();
	}

	private moveOption(delta: number): void {
		const count = this.optionCount(this.currentTab);
		this.optionIndex = Math.max(0, Math.min(count - 1, this.optionIndex + delta));
		this.refresh();
	}

	private keys(id: Keybinding): string {
		return formatKeyText(this.keybindings.getKeys(id).join("/"), { compact: true });
	}

	// ------------------------------------------------------------------
	// Input
	// ------------------------------------------------------------------

	private onKey(data: string): void {
		const kb = this.keybindings;
		if (this.typingTab !== undefined) {
			// Input owns the line: enter submits, escape leaves the row (callbacks commit).
			this.input.handleInput(data);
			return;
		}

		if (this.showTabs) {
			const tabCount = this.questions.length + 1;
			if (kb.matches(data, "app.question.tabForward")) {
				this.setTab((this.currentTab + 1) % tabCount);
				this.refresh();
				return;
			}
			if (kb.matches(data, "app.question.tabBackward")) {
				this.setTab((this.currentTab - 1 + tabCount) % tabCount);
				this.refresh();
				return;
			}
		}

		if (kb.matches(data, "tui.select.up")) {
			this.moveOption(-1);
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			this.moveOption(1);
			return;
		}
		if (kb.matches(data, "tui.select.cancel")) {
			this.finish(true);
			return;
		}
		if (kb.matches(data, "app.question.toggle")) {
			// Space only toggles; on multi-select it never advances, so Enter stays free to move on.
			if (!this.onSubmitTab()) this.toggleOption(this.optionIndex);
			return;
		}
		if (kb.matches(data, "tui.select.confirm")) {
			if (this.onSubmitTab()) this.chooseSubmitOption(this.optionIndex);
			else this.confirmOption(this.optionIndex);
		}
	}

	/** Enter on a question tab: pick single-select and move on, advance past multi-select. */
	private confirmOption(index: number): void {
		if (this.questions[this.currentTab].multiple) {
			if (this.isOtherRow(index)) {
				this.enterTyping();
				return;
			}
			this.advanceAfterAnswer(this.currentTab);
			return;
		}
		this.toggleOption(index);
	}

	// ------------------------------------------------------------------
	// Rendering
	// ------------------------------------------------------------------

	private renderForm(width: number): string[] {
		const rows: string[] = [""];
		if (this.showTabs) {
			rows.push(this.renderTabs());
			rows.push("");
		}
		if (this.onSubmitTab()) this.renderSubmitTab(rows, width);
		else this.renderQuestionTab(rows, width);
		rows.push("");
		rows.push(INDENT + this.renderHint());
		rows.push("");

		// The band: clip, pad to the full width, paint the editor background on every row.
		// Rows that start with their own background (the tab row) pad with a separate
		// editorBg run; an outer theme.bg would end the whole row in \x1b[49m anyway.
		return rows.map((row) => {
			const clipped = truncateToWidth(row, width, "");
			const filler = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
			if (clipped.startsWith("\x1b[4")) return clipped + theme.bg("editorBg", filler);
			return theme.bg("editorBg", clipped + filler);
		});
	}

	private renderTabs(): string {
		// Segments, not one wrapped row: theme.bg ends every chip with \x1b[49m, so the indent,
		// the gaps between chips, and the tail must carry their own editorBg to stay solid.
		const band = (text: string) => theme.bg("editorBg", text);
		const parts: string[] = [band(INDENT)];
		for (let i = 0; i < this.questions.length; i++) {
			const answered = this.isAnswered(i);
			const cell = ` ${answered ? "■" : "□"} ${this.questions[i].header} `;
			if (i === this.currentTab) parts.push(theme.bg("selectedBg", theme.fg("text", cell)));
			else if (answered) parts.push(theme.bg("toolSuccessBg", theme.fg("success", cell)));
			else parts.push(theme.bg("toolPendingBg", theme.fg("muted", cell)));
			parts.push(band(" "));
		}
		const submitCell = " ✓ Submit ";
		if (this.onSubmitTab()) parts.push(theme.bg("selectedBg", theme.fg("text", submitCell)));
		else if (this.allAnswered()) parts.push(theme.bg("toolSuccessBg", theme.fg("success", submitCell)));
		else parts.push(theme.bg("toolPendingBg", theme.fg("dim", submitCell)));
		return parts.join("");
	}

	/** Wrap `text` into `width` and prefix every line, so overflow keeps the gutter indent. */
	private addWrapped(rows: string[], text: string, width: number, prefix = INDENT): void {
		for (const line of wrapTextWithAnsi(text, Math.max(1, width - visibleWidth(prefix)))) {
			rows.push(`${prefix}${line}`);
		}
	}

	/** Push one row with a cursor/box gutter; content that overflows wraps under the gutter. */
	private addGutterRow(rows: string[], gutter: string, content: string, width: number): void {
		const contentWidth = Math.max(1, width - visibleWidth(INDENT) - visibleWidth(gutter));
		const lines = wrapTextWithAnsi(content, contentWidth);
		const pad = " ".repeat(visibleWidth(gutter));
		for (let i = 0; i < lines.length; i++) {
			rows.push(i === 0 ? `${INDENT}${gutter}${lines[i]}` : `${INDENT}${pad}${lines[i]}`);
		}
	}

	private renderQuestionTab(rows: string[], width: number): void {
		const question = this.questions[this.currentTab];
		this.addWrapped(rows, theme.fg("text", question.question), width);
		rows.push("");

		const count = this.optionCount(this.currentTab);
		const window = Math.min(MAX_VISIBLE_OPTIONS, count);
		if (this.optionIndex < this.viewStart) this.viewStart = this.optionIndex;
		else if (this.optionIndex >= this.viewStart + window) this.viewStart = this.optionIndex - window + 1;
		this.viewStart = Math.max(0, Math.min(this.viewStart, count - window));

		const withDescriptions = question.options.some((option) => option.description) && width >= 60;
		const primaryWidth = withDescriptions
			? Math.min(
					Math.max(10, ...question.options.map((option) => visibleWidth(`${option.label}`))) + 4,
					Math.floor(width * 0.55),
				)
			: 0;

		for (let i = this.viewStart; i < this.viewStart + window; i++) {
			const option = i < question.options.length ? question.options[i] : undefined;
			const isCursor = i === this.optionIndex;
			const isOther = option === undefined;
			const picked = this.answers.get(this.currentTab)?.selected.includes(i) ?? false;
			const typedHere = isOther && this.answers.get(this.currentTab)?.typed !== undefined;

			const cursor = isCursor ? theme.fg("accent", "❯ ") : "  ";
			let box: string;
			if (question.multiple) box = picked ? theme.fg("accent", "☒ ") : theme.fg("muted", "☐ ");
			else box = picked ? theme.fg("success", "✓ ") : "  ";

			const label = `${i + 1}. ${isOther ? OTHER_LABEL : option.label}`;
			const labelText = isCursor || typedHere ? theme.fg("accent", label) : theme.fg("text", label);
			const typedEcho =
				typedHere && this.answers.get(this.currentTab)?.typed
					? theme.fg("muted", `: ${this.answers.get(this.currentTab)!.typed}`)
					: "";

			if (option?.description && primaryWidth > 0) {
				const gap = Math.max(1, primaryWidth - visibleWidth(label));
				const descWidth = width - visibleWidth(cursor) - visibleWidth(box) - primaryWidth - 2;
				if (descWidth > 8) {
					rows.push(
						`${INDENT}${cursor}${box}${truncateToWidth(labelText, primaryWidth, "")}${" ".repeat(gap)}${theme.fg("muted", truncateToWidth(option.description, descWidth, ""))}`,
					);
					continue;
				}
			}
			this.addGutterRow(rows, `${cursor}${box}`, `${labelText}${typedEcho}`, width);
			if (option?.description)
				this.addWrapped(rows, theme.fg("muted", option.description), width, `${INDENT}${" ".repeat(4)}`);
		}
		if (count > window) {
			rows.push(`${INDENT}${theme.fg("dim", `(${this.optionIndex + 1}/${count})`)}`);
		}

		if (this.typingTab === this.currentTab) {
			rows.push("");
			rows.push(`${INDENT}${theme.fg("muted", "Your answer:")}`);
			for (const line of this.input.render(Math.max(1, width - visibleWidth(INDENT)))) {
				rows.push(`${INDENT}${line}`);
			}
		}
	}

	private renderSubmitTab(rows: string[], width: number): void {
		this.addWrapped(rows, theme.fg("accent", theme.bold("Submit these answers?")), width);
		rows.push("");
		for (let i = 0; i < this.questions.length; i++) {
			const question = this.questions[i];
			if (!this.isAnswered(i)) {
				this.addWrapped(rows, `${theme.fg("muted", `${question.header}: `)}${theme.fg("warning", "open")}`, width);
				continue;
			}
			const values = this.answerValues(i)
				.map((value) => (value.subtitle ? `${value.title} — ${value.subtitle}` : value.title))
				.join("; ");
			this.addWrapped(rows, `${theme.fg("muted", `${question.header}: `)}${theme.fg("text", values)}`, width);
		}
		rows.push("");
		const yesLabel = this.allAnswered() ? `Yes — submit ${this.questions.length} answers` : "Yes — submit";
		const options = [yesLabel, "No — go back and edit"];
		for (let i = 0; i < options.length; i++) {
			const isCursor = i === this.optionIndex;
			const label = `${i + 1}. ${options[i]}`;
			this.addGutterRow(
				rows,
				isCursor ? theme.fg("accent", "❯ ") : "  ",
				theme.fg(isCursor ? "accent" : "text", label),
				width,
			);
		}
		if (!this.allAnswered()) {
			const missing = this.questions.filter((_, i) => !this.isAnswered(i)).map((q) => q.header);
			this.addWrapped(rows, theme.fg("warning", `Unanswered: ${missing.join(", ")}`), width);
		}
	}

	private renderHint(): string {
		const parts: string[] = [];
		if (this.typingTab !== undefined) {
			parts.push(
				`${this.keys("tui.input.submit")} submit answer`,
				`${this.keys("tui.select.cancel")} back to options`,
			);
			return theme.fg("dim", parts.join(" · "));
		}
		if (this.showTabs)
			parts.push(`${this.keys("app.question.tabForward")}/${this.keys("app.question.tabBackward")} switch`);
		parts.push(`${this.keys("tui.select.up")}/${this.keys("tui.select.down")} move`);
		if (!this.onSubmitTab() && this.questions[this.currentTab].multiple) {
			parts.push(`${this.keys("app.question.toggle")} select`, `${this.keys("tui.select.confirm")} next`);
		} else {
			parts.push(`${this.keys("tui.select.confirm")} ${this.onSubmitTab() ? "choose" : "answer"}`);
		}
		parts.push(`${this.keys("tui.select.cancel")} dismiss`);
		return theme.fg("dim", parts.join(" · "));
	}
}
