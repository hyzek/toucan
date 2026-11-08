/**
 * Diff display in the transcript.
 *
 * A change sits on a surface of its own: each line carries the terminal background mixed toward its
 * state colour, so an added line is a green band and a removed line a red one, and the words that
 * differ inside a line that was edited rather than replaced sit on a deeper band. A `▌` in the state
 * colour marks the left edge of a changed line, the gutter reads number then sign (`12-`, `13+`), and
 * a rule opens and closes each hunk, with the tool's own label above it (`Edit 1/2 at line 6`). Context
 * lines keep the file's syntax colours and are dimmed: they give position, not reading. A change that
 * replaces several lines at once becomes two columns when the terminal is wide enough for both sides,
 * and a change longer than the row budget folds to a notice naming the key that expands it.
 */

import {
	backgroundAnsi,
	type Component,
	mixColors,
	sliceByColumn,
	truncateToWidth,
	visibleWidth,
} from "@hyzek/toucan-tui";
import {
	type DiffHunk,
	type DiffLine,
	diffStats,
	pairChanges,
	parseDisplayDiff,
	wordMarks,
} from "../../../core/tools/diff-lines.ts";
import { CodeHighlighter, getLanguageFromPath, type ThemeColor, theme } from "../theme/theme.ts";

/** Diff rows a folded change shows before the notice. Rules, labels and blanks do not count. */
export const COLLAPSED_DIFF_ROWS = 24;
/** Narrower than this, and two columns plus their gutters cannot hold real code. */
const MIN_SPLIT_WIDTH = 150;
/** The least body width worth splitting a diff for. */
const MIN_SPLIT_BODY_WIDTH = 24;
/** A -/+ pair sharing less than this is a rewrite; picking words out of it would be noise. */
const MIN_PAIR_SIMILARITY = 0.15;
/** Highlighting cost grows with the block, so a huge diff stays plain text. */
const MAX_HIGHLIGHT_CHARS = 32_000;
/** How far the surface moves toward the state colour, for a whole line and for a changed word. */
const LINE_TINT: Record<"added" | "removed", number> = { added: 0.24, removed: 0.12 };
const WORD_TINT: Record<"added" | "removed", number> = { added: 0.44, removed: 0.26 };
/** How far the surface moves toward the text colour to make the block's own surface. */
const SURFACE_TINT = 0.05;
/** Columns one side's gutter takes besides the line number: accent bar, sign, two spaces, divider. */
const GUTTER_EXTRA = 5;
const ACCENT_BAR = "▌";
const RULE_CHAR = "─";
const DIVIDER_CHAR = "│";
const GAP_TEXT = "...";
const DIM = "\x1b[2m";
const UNDIM = "\x1b[22m";
/** SGR sequences that close an entire style run, and so would close a band painted here. */
const SGR = /\x1b\[([0-9;]*)m/g;
const RESET_CODES = new Set(["0", "22", "39", "49"]);

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
	/**
	 * Names one hunk of the change, on its own row above it, for example `Edit 1/2 at line 6`. Without
	 * it the hunks are still divided by rules; they are just not named.
	 */
	hunkLabel?: (hunk: DiffHunk, index: number, total: number) => string;
}

/** One side of one line of a diff, already syntax-coloured, with its changed words located. */
interface DiffCell {
	kind: DiffLine["kind"];
	number: number | undefined;
	body: string;
	/** Changed-word ranges in visible columns of `body`. Empty when no word stands out. */
	marks: Array<[number, number]>;
}

/** One row of the two-column view: the old side and the new side, or one of them for a pure insert or delete. */
interface SplitRow {
	left: DiffCell | undefined;
	right: DiffCell | undefined;
}

/** One hunk: the run of lines a display diff shows together, and what it says about itself. */
interface PreparedHunk {
	cells: DiffCell[];
	rows: SplitRow[];
	meta: DiffHunk;
}

interface PreparedDiff {
	hunks: PreparedHunk[];
	numWidth: number;
	highlighted: boolean;
}

/** The surfaces and lines a diff block is painted with, derived from the theme once per render. */
interface DiffPalette {
	surface: string;
	band: Record<"added" | "removed", string>;
	word: Record<"added" | "removed", string>;
	rule: string;
}

/**
 * Render a diff string: banded lines, a state-coloured gutter, syntax colours inside.
 * - Context lines: dim, on the block's surface
 * - Removed lines: red band and gutter, a deeper red behind the words that changed
 * - Added lines: the same in green
 *
 * The hunks are not labelled and the rows are not filled to a width, because the caller has neither.
 * No folding and no truncation either: the transcript view does all three, and extensions that call this
 * get the whole diff.
 */
export function renderDiff(diffText: string, options: RenderDiffOptions = {}): string {
	const prepared = prepareDiff(diffText, options, new CodeHighlighter());
	const palette = diffPalette();
	const rows: string[] = [];
	for (const [index, hunk] of prepared.hunks.entries()) {
		if (index > 0) rows.push(theme.fg("toolDiffContext", GAP_TEXT));
		for (const cell of hunk.cells) rows.push(renderRow(cell, prepared, palette));
	}
	return rows.join("\n");
}

/**
 * A diff as a component, so it can choose a layout from the width it renders into, paint its surfaces to
 * that width, name and rule off each hunk, and fold long changes. One instance per tool row: it keeps a
 * highlighter, and the highlighter keeps the last block it coloured.
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
		if (prepared.hunks.length === 0) return [];
		const palette = diffPalette();
		const split = fitSplit(prepared, width);
		const budget = this.options.expanded ? Number.POSITIVE_INFINITY : (this.options.maxRows ?? COLLAPSED_DIFF_ROWS);
		const total = prepared.hunks.reduce(
			(sum, hunk) => sum + (split === undefined ? hunk.cells.length : hunk.rows.length),
			0,
		);

		const lines: string[] = [];
		let shown = 0;
		for (const [index, hunk] of prepared.hunks.entries()) {
			if (shown >= budget) break;
			const label = this.options.hunkLabel?.(hunk.meta, index, prepared.hunks.length);
			if (label) lines.push(theme.fg("toolDiffContext", label));
			lines.push(rule(width, palette));
			const rows: Array<DiffCell | SplitRow> = split === undefined ? hunk.cells : hunk.rows;
			for (const row of rows.slice(0, budget - shown)) {
				lines.push(
					split === undefined
						? flatRow(row as DiffCell, prepared, palette, width)
						: splitRow(row as SplitRow, prepared, palette, split),
				);
			}
			shown += Math.min(rows.length, budget - shown);
			lines.push(rule(width, palette));
		}
		return [...lines, ...this.foldNote(prepared, total - shown)];
	}

	/** The row that says how much of the change is hidden, naming the key that shows it. */
	private foldNote(prepared: PreparedDiff, hidden: number): string[] {
		if (hidden <= 0) return [];
		const hint = this.options.expandHint ? ` ${this.options.expandHint}` : "";
		const gutter = " ".repeat(prepared.numWidth + GUTTER_EXTRA);
		return [`${gutter}${theme.fg("toolDiffContext", `${hidden} more diff lines${hint}`)}`];
	}
}

/** One row of the one-column view, painted to the terminal width rather than wrapped. */
function flatRow(cell: DiffCell, prepared: PreparedDiff, palette: DiffPalette, width: number): string {
	return renderRow(cell, prepared, palette, width - prepared.numWidth - GUTTER_EXTRA);
}

/** One row of the two-column view: both sides to `bodyWidth`, with the divider between them. */
function splitRow(row: SplitRow, prepared: PreparedDiff, palette: DiffPalette, bodyWidth: number): string {
	const side = prepared.numWidth + GUTTER_EXTRA + bodyWidth;
	const left = row.left ? renderRow(row.left, prepared, palette, bodyWidth) : " ".repeat(side);
	const right = row.right ? renderRow(row.right, prepared, palette, bodyWidth) : " ".repeat(side);
	return `${left} ${palette.rule}${DIVIDER_CHAR}\x1b[39m ${right}`;
}

/** Splits the diff into hunks of cells: one per row in the one-column view, paired left and right in the other. */
function prepareDiff(diffText: string, options: DiffViewOptions, highlighter?: CodeHighlighter): PreparedDiff {
	const lines = parseDisplayDiff(diffText);
	if (lines.length === 0) return { hunks: [], numWidth: 1, highlighted: false };

	const stats = diffStats(lines);
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
	const hunks: PreparedHunk[] = [];

	let oldIndex = 0;
	let newIndex = 0;
	let index = 0;
	while (index < lines.length) {
		if (lines[index].kind === "separator") {
			index++;
			continue;
		}
		const cells: DiffCell[] = [];
		const rows: SplitRow[] = [];
		while (index < lines.length && lines[index].kind !== "separator") {
			const line = lines[index];
			if (line.kind === "context") {
				const left = toCell(line, oldBodies[oldIndex++], marks);
				const right = toCell(line, newBodies[newIndex++], marks);
				cells.push(left);
				rows.push({ left, right });
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
			cells.push(...removed, ...added);
			for (let row = 0; row < Math.max(removed.length, added.length); row++) {
				rows.push({ left: removed[row], right: added[row] });
			}
		}
		// The hunks of the parsed lines and of the stats are the same runs in the same order.
		hunks.push({ cells, rows, meta: stats.hunks[hunks.length] });
	}

	return { hunks, numWidth, highlighted };
}

/**
 * Word ranges to mark, for every line of a change.
 *
 * A -/+ pair that looks like an edit marks the words that differ. A line with no partner is a pure
 * insertion or deletion, so the line as a whole is the change and no word stands out; a pair too unlike
 * to be an edit is treated the same way. Those lines get no ranges.
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
		if (removed.length !== added.length) continue;
		for (const [oldLine, newLine] of pairChanges(removed, added)) {
			const pair = wordMarks(replaceTabs(oldLine.text), replaceTabs(newLine.text));
			if (pair.similarity < MIN_PAIR_SIMILARITY) continue;
			marks.set(oldLine, pair.removed);
			marks.set(newLine, pair.added);
		}
	}
	return marks;
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
	const bodyWidth = Math.floor((width - 2 * (prepared.numWidth + GUTTER_EXTRA) - 3) / 2);
	if (bodyWidth < MIN_SPLIT_BODY_WIDTH) return undefined;
	for (const hunk of prepared.hunks) {
		for (const row of hunk.rows) {
			for (const cell of [row.left, row.right]) {
				if (cell && visibleWidth(cell.body) > bodyWidth) return undefined;
			}
		}
	}
	return bodyWidth;
}

function stateColor(kind: DiffLine["kind"]): ThemeColor {
	if (kind === "added") return "toolDiffAdded";
	if (kind === "removed") return "toolDiffRemoved";
	return "toolDiffContext";
}

function diffPalette(): DiffPalette {
	const base = theme.terminalBackground;
	const mode = theme.getColorMode();
	const tint = (color: ThemeColor, amount: number) =>
		backgroundAnsi(mixColors(base, theme.colors[color], amount, "srgb"), mode);
	return {
		surface: backgroundAnsi(mixColors(base, theme.colors.text, SURFACE_TINT, "srgb"), mode),
		band: { added: tint("toolDiffAdded", LINE_TINT.added), removed: tint("toolDiffRemoved", LINE_TINT.removed) },
		word: { added: tint("toolDiffAdded", WORD_TINT.added), removed: tint("toolDiffRemoved", WORD_TINT.removed) },
		rule: theme.getFgAnsi("borderMuted"),
	};
}

function bandOf(palette: DiffPalette, kind: DiffLine["kind"]): string {
	return kind === "added" ? palette.band.added : kind === "removed" ? palette.band.removed : palette.surface;
}

function wordBandOf(palette: DiffPalette, kind: DiffLine["kind"]): string {
	return kind === "added" ? palette.word.added : kind === "removed" ? palette.word.removed : palette.surface;
}

/** A rule the length of the block, in the colour of the lines that divide it. */
function rule(width: number, palette: DiffPalette): string {
	return `${palette.surface}${palette.rule}${RULE_CHAR.repeat(width)}\x1b[39m\x1b[49m`;
}

/**
 * `▌ 12- │ body` in the block's colours. With a `bodyWidth` the body is cut and padded to it, which is
 * what keeps the two columns of the split view lined up; without one the row is only as long as its
 * text, because the caller has no width to fill.
 */
function renderRow(cell: DiffCell, prepared: PreparedDiff, palette: DiffPalette, bodyWidth?: number): string {
	const changed = cell.kind === "added" || cell.kind === "removed";
	const band = bandOf(palette, cell.kind);
	const state = stateColor(cell.kind);
	const number =
		cell.number === undefined ? " ".repeat(prepared.numWidth) : String(cell.number).padStart(prepared.numWidth);
	const sign = cell.kind === "added" ? "+" : cell.kind === "removed" ? "-" : " ";
	const accent = changed ? `${theme.getFgAnsi(state)}${ACCENT_BAR}\x1b[39m` : " ";
	const gutter = paint(band, `${theme.getFgAnsi(state)}${theme.bold(`${number}${sign}`)}\x1b[39m`, band);
	const divider = `${palette.rule}${DIVIDER_CHAR}\x1b[39m`;
	const body = changed
		? paintBody(cell.body, cell.marks, band, wordBandOf(palette, cell.kind))
		: paint(`${band}${DIM}`, cell.body, `${band}${DIM}`);
	const filled = bodyWidth === undefined ? body : truncateToWidth(body, bodyWidth, "", true);
	return `${band}${accent}${gutter} ${divider} ${filled}${UNDIM}\x1b[49m`;
}

/** The body of a changed line: the line band under all of it, the deeper band behind the words that differ. */
function paintBody(body: string, marks: ReadonlyArray<[number, number]>, band: string, deep: string): string {
	if (marks.length === 0) return paint(band, body, band);
	let out = "";
	let column = 0;
	for (const [start, end] of marks) {
		out += paint(band, sliceByColumn(body, column, start - column), band);
		out += paint(deep, sliceByColumn(body, start, end - start), deep);
		column = end;
	}
	return out + paint(band, sliceByColumn(body, column, visibleWidth(body) - column), band);
}

/**
 * Opens `codes` over a piece of an ANSI line.
 *
 * Highlighted code and the theme helpers close their styles with resets, which would also close the band
 * painted here, so every reset inside the piece is followed by the codes again.
 */
function paint(codes: string, text: string, reopen: string): string {
	return (
		codes + text.replace(SGR, (sequence, params: string) => (RESET_CODES.has(params) ? sequence + reopen : sequence))
	);
}

function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}
