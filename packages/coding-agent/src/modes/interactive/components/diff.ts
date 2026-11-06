/**
 * Diff display in the transcript.
 *
 * A tool row has no background, so a diff row carries its state in the gutter: the sign and the line
 * number are red for a removal, green for an addition, dim for context. Inside a changed line the
 * words that differ are coloured the same way as the gutter, over the file's syntax colours, so a
 * one-word edit stays readable at a glance. Context lines stay dim: they are there for position, not
 * for reading. A change that replaces several lines at once becomes two columns when the terminal is
 * wide enough for both sides, and a change longer than the row budget folds to a notice naming the
 * key that expands it.
 */

import { type Component, sliceByColumn, truncateToWidth, visibleWidth } from "@hyzek/toucan-tui";
import { type DiffLine, pairChanges, parseDisplayDiff, wordMarks } from "../../../core/tools/diff-lines.ts";
import { stripAnsi } from "../../../utils/ansi.ts";
import { CodeHighlighter, getLanguageFromPath, type ThemeColor, theme } from "../theme/theme.ts";

/** Rows a folded diff shows before the notice. */
export const COLLAPSED_DIFF_ROWS = 24;
/** Narrower than this, and two columns plus their gutters cannot hold real code. */
const MIN_SPLIT_WIDTH = 150;
/** The least body width worth splitting a diff for. */
const MIN_SPLIT_BODY_WIDTH = 24;
/** A -/+ pair sharing less than this is a rewrite; marking its words would be noise. */
const MIN_PAIR_SIMILARITY = 0.15;
/** Highlighting cost grows with the block, so a huge diff stays plain text. */
const MAX_HIGHLIGHT_CHARS = 32_000;
const SPLIT_DIVIDER = " \u2502 ";
const ELLIPSIS = "...";

export interface RenderDiffOptions {
	/** Picks the language for syntax colouring; unknown or absent extensions leave the diff plain. */
	filePath?: string;
}

/** What a transcript diff needs on top of the language: how much room there is and how much to show. */
export interface DiffViewOptions extends RenderDiffOptions {
	expanded?: boolean;
	/** Rows shown while folded. */
	maxRows?: number;
	/** Notice naming the key that expands the diff, e.g. `(ctrl+o to expand)`. */
	expandHint?: string;
}

/** One side of one line of a diff, already syntax-coloured, with its changed words located. */
interface DiffCell {
	kind: DiffLine["kind"];
	number: number | undefined;
	body: string;
	/** Changed-word ranges, in visible columns of `body`. */
	marks: Array<[number, number]>;
}

/** One row of the two-column view: the old side and the new side, or one of them for a pure insert or delete. */
interface SplitRow {
	left: DiffCell | undefined;
	right: DiffCell | undefined;
}

interface PreparedDiff {
	unified: DiffCell[];
	split: SplitRow[];
	numWidth: number;
	highlighted: boolean;
}

/**
 * Render a diff string with colored lines and intra-line change highlighting.
 * - Context lines: dim
 * - Removed lines: red gutter, red on the tokens that changed
 * - Added lines: green gutter, green on the tokens that changed
 *
 * No folding and no truncation: the transcript view does both, and extensions that call this get the
 * whole diff.
 */
export function renderDiff(diffText: string, options: RenderDiffOptions = {}): string {
	const prepared = prepareDiff(diffText, options, new CodeHighlighter());
	return prepared.unified.map((cell) => renderCell(cell, prepared)).join("\n");
}

/**
 * A diff as a component, so it can choose a layout from the width it renders into and fold long
 * changes. One instance per tool row: it keeps a highlighter, and the highlighter keeps the last block
 * it coloured.
 */
export class DiffComponent implements Component {
	private readonly highlighter = new CodeHighlighter();
	private diff: string;
	private options: DiffViewOptions;

	constructor(diff: string, options: DiffViewOptions = {}) {
		this.diff = diff;
		this.options = options;
	}

	setDiff(diff: string): void {
		this.diff = diff;
	}

	setOptions(options: DiffViewOptions): void {
		this.options = options;
	}

	invalidate(): void {
		// Nothing is kept between renders except the highlighter's cache, which checks the theme itself.
	}

	render(width: number): string[] {
		const prepared = prepareDiff(this.diff, this.options, this.highlighter);
		const limit = this.options.expanded ? Number.POSITIVE_INFINITY : (this.options.maxRows ?? COLLAPSED_DIFF_ROWS);
		const bodyWidth = fitSplit(prepared, width);
		const lines: string[] = [];
		if (bodyWidth === undefined) {
			for (const cell of prepared.unified.slice(0, limit)) {
				lines.push(truncateToWidth(renderCell(cell, prepared), width));
			}
		} else {
			for (const row of prepared.split.slice(0, limit)) {
				lines.push(truncateToWidth(renderSplitRow(row, prepared, bodyWidth), width));
			}
		}
		const hidden = (bodyWidth === undefined ? prepared.unified.length : prepared.split.length) - lines.length;
		return [...lines, ...this.foldNote(prepared, hidden)];
	}

	/** The row that says how much of the change is hidden, naming the key that shows it. */
	private foldNote(prepared: PreparedDiff, hidden: number): string[] {
		if (hidden <= 0) {
			return [];
		}
		const hint = this.options.expandHint ? ` ${this.options.expandHint}` : "";
		const text = `${hidden} more lines${hint}`;
		return [`${" ".repeat(prepared.numWidth + 2)}${theme.fg("toolDiffContext", text)}`];
	}
}

/** Splits the diff into cells: one per row in the unified view, paired left and right for the split view. */
function prepareDiff(diffText: string, options: DiffViewOptions, highlighter?: CodeHighlighter): PreparedDiff {
	const lines = parseDisplayDiff(diffText);
	if (lines.length === 0) {
		return { unified: [], split: [], numWidth: 1, highlighted: false };
	}

	const numWidth = widestLineNumber(lines);
	const language = options.filePath ? getLanguageFromPath(options.filePath) : undefined;
	const chars = lines.reduce((total, line) => total + line.text.length + 1, 0);
	const highlighted = language !== undefined && chars <= MAX_HIGHLIGHT_CHARS && highlighter !== undefined;

	// Separators stand for lines the diff left out, so they are not part of either source block.
	const oldSource: string[] = [];
	const newSource: string[] = [];
	for (const line of lines) {
		if (line.kind === "separator" || line.kind === "added") continue;
		oldSource.push(replaceTabs(line.text));
	}
	for (const line of lines) {
		if (line.kind === "separator" || line.kind === "removed") continue;
		newSource.push(replaceTabs(line.text));
	}
	// One block per side rather than line by line: a change inside a multi-line string or a template
	// literal still gets the colours it has in the file.
	const colour = (source: string[]) => [...(highlighter?.highlight(source.join("\n"), language) ?? source)];
	const oldBodies = highlighted ? colour(oldSource) : oldSource;
	const newBodies = highlighted ? colour(newSource) : newSource;

	const marks = pairMarks(lines);
	const unified: DiffCell[] = [];
	const split: SplitRow[] = [];

	let oldIndex = 0;
	let newIndex = 0;
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		if (line.kind === "separator") {
			const cell: DiffCell = { kind: "separator", number: undefined, body: ELLIPSIS, marks: [] };
			unified.push(cell);
			split.push({ left: cell, right: cell });
			index++;
			continue;
		}
		if (line.kind === "context") {
			const left = toCell(line, oldBodies[oldIndex++], marks);
			const right = toCell(line, newBodies[newIndex++], marks);
			unified.push(left);
			split.push({ left, right });
			index++;
			continue;
		}
		const removed: DiffCell[] = [];
		while (index < lines.length && lines[index].kind === "removed") {
			removed.push(toCell(lines[index], oldBodies[oldIndex++], marks));
			index++;
		}
		const added: DiffCell[] = [];
		while (index < lines.length && lines[index].kind === "added") {
			added.push(toCell(lines[index], newBodies[newIndex++], marks));
			index++;
		}
		unified.push(...removed, ...added);
		const rowCount = Math.max(removed.length, added.length);
		for (let row = 0; row < rowCount; row++) {
			split.push({ left: removed[row], right: added[row] });
		}
	}

	return { unified, split, numWidth, highlighted };
}

/**
 * Word ranges to mark, for every line of a change.
 *
 * A -/+ pair that looks like an edit marks only the words that differ; a line with no partner is a pure
 * insertion or deletion, so all of it changed.
 */
function pairMarks(lines: readonly DiffLine[]): Map<DiffLine, Array<[number, number]>> {
	const marks = new Map<DiffLine, Array<[number, number]>>();
	let index = 0;
	while (index < lines.length) {
		const kind = lines[index].kind;
		if (kind !== "removed" && kind !== "added") {
			index++;
			continue;
		}
		const removed: DiffLine[] = [];
		const added: DiffLine[] = [];
		while (index < lines.length && (lines[index].kind === "removed" || lines[index].kind === "added")) {
			(lines[index].kind === "removed" ? removed : added).push(lines[index]);
			index++;
		}
		if (removed.length !== added.length) {
			markWholeLine(removed, marks);
			markWholeLine(added, marks);
			continue;
		}
		for (const [oldLine, newLine] of pairChanges(removed, added)) {
			const pair = wordMarks(replaceTabs(oldLine.text), replaceTabs(newLine.text));
			if (pair.similarity < MIN_PAIR_SIMILARITY) {
				markWholeLine([oldLine, newLine], marks);
				continue;
			}
			marks.set(oldLine, pair.removed);
			marks.set(newLine, pair.added);
		}
	}
	return marks;
}

function markWholeLine(lines: readonly DiffLine[], marks: Map<DiffLine, Array<[number, number]>>): void {
	for (const line of lines) {
		marks.set(line, [[0, replaceTabs(line.text).length]]);
	}
}

function toCell(line: DiffLine, body: string, marks: Map<DiffLine, Array<[number, number]>>): DiffCell {
	return {
		kind: line.kind,
		number: line.kind === "removed" ? line.oldNumber : line.newNumber,
		body,
		marks: marks.get(line) ?? [],
	};
}

function widestLineNumber(lines: readonly DiffLine[]): number {
	let widest = 1;
	for (const line of lines) {
		widest = Math.max(widest, String(line.oldNumber ?? 0).length, String(line.newNumber ?? 0).length);
	}
	return widest;
}

/** The body width a split view gets at this terminal width, or `undefined` when it does not fit. */
function fitSplit(prepared: PreparedDiff, width: number): number | undefined {
	if (width < MIN_SPLIT_WIDTH) return undefined;
	const gutterWidth = prepared.numWidth + 2;
	const bodyWidth = Math.floor((width - 2 * gutterWidth - visibleWidth(SPLIT_DIVIDER)) / 2);
	if (bodyWidth < MIN_SPLIT_BODY_WIDTH) return undefined;
	for (const row of prepared.split) {
		for (const cell of [row.left, row.right]) {
			if (cell && visibleWidth(cell.body) > bodyWidth) return undefined;
		}
	}
	return bodyWidth;
}

function stateColor(kind: DiffLine["kind"]): ThemeColor {
	if (kind === "added") return "toolDiffAdded";
	if (kind === "removed") return "toolDiffRemoved";
	return "toolDiffContext";
}

/**
 * `sign + number + space + body`, in one column. With a `bodyWidth` the row is cut and padded to it,
 * which is what the split view needs to keep the divider lined up.
 */
function renderCell(cell: DiffCell, prepared: PreparedDiff, bodyWidth?: number): string {
	const gutterWidth = prepared.numWidth + 2;
	const number =
		cell.number === undefined ? " ".repeat(prepared.numWidth) : String(cell.number).padStart(prepared.numWidth);
	const sign = cell.kind === "added" ? "+" : cell.kind === "removed" ? "-" : " ";
	const color = stateColor(cell.kind);
	const gutter = theme.fg(color, `${sign}${number}`);
	const body =
		cell.kind === "context" || cell.kind === "separator"
			? theme.fg("toolDiffContext", cell.body)
			: renderChangedBody(cell, prepared.highlighted, color);
	const row = `${gutter} ${body}`;
	return bodyWidth === undefined ? row : truncateToWidth(row, gutterWidth + bodyWidth, "", true);
}

/**
 * A changed line keeps its syntax colours, and only the words that differ take the state colour. A line
 * with no partner, or one whose pair is too different to call an edit, is changed in full, so all of it
 * takes that colour. A plain-text diff has no syntax to protect, so the whole line takes it either way.
 *
 * The marked piece is stripped before it is recoloured: the syntax codes inside it would otherwise
 * win over the state colour, and a word that no longer matches the file is worth reading on its own.
 */
function renderChangedBody(cell: DiffCell, highlighted: boolean, color: ThemeColor): string {
	if (cell.marks.length === 0) {
		return highlighted ? cell.body : theme.fg(color, cell.body);
	}
	let out = "";
	let column = 0;
	for (const [start, end] of cell.marks) {
		out += sliceByColumn(cell.body, column, start - column);
		out += theme.fg(color, stripAnsi(sliceByColumn(cell.body, start, end - start)));
		column = end;
	}
	return out + sliceByColumn(cell.body, column, visibleWidth(cell.body) - column);
}

function renderSplitRow(row: SplitRow, prepared: PreparedDiff, bodyWidth: number): string {
	const blank = " ".repeat(prepared.numWidth + 2 + bodyWidth);
	const left = row.left ? renderCell(row.left, prepared, bodyWidth) : blank;
	const right = row.right ? renderCell(row.right, prepared, bodyWidth) : blank;
	return `${left}${SPLIT_DIVIDER}${right}`;
}

function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}
