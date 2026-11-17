/**
 * The keyboard shortcuts popup: a hotkey reference that appears above the input box while open
 * and renders nothing while closed. The content is generic - columns of key rows - and the
 * caller (interactive mode) builds them from keybindings and toggles visibility with `?`,
 * `/shortcuts`, and Esc. Columns sit side by side when they fit the width, descriptions shrink
 * to make a band fit, and a `maxRows` budget keeps the panel inside the terminal: it first
 * drops trailing columns to stay within two bands, then truncates rows and marks them with `⋯`.
 */

import { type Component, truncateToWidth, visibleWidth } from "@hyzek/toucan-tui";
import { theme } from "../theme/theme.ts";

export interface ShortcutRow {
	key: string;
	description: string;
}

export interface ShortcutColumn {
	title: string;
	rows: ShortcutRow[];
}

/** A column measured for rendering: the widths of its key and description cells. */
interface MeasuredColumn {
	section: ShortcutColumn;
	keyWidth: number;
	descriptionWidth: number;
}

/** Spaces between a key cell and its description inside a column. */
const KEY_GAP = 2;
/** Spaces between adjacent columns on one band. */
const COLUMN_GAP = 3;
/** A description cell never shrinks below this width; the line truncates instead. */
const MIN_DESCRIPTION_WIDTH = 6;
/** Marks rows left out by the height budget. */
const ELLIPSIS = "⋯";

/** Strips trailing spaces. Safe here: cell text is styled only at its start, padding is plain. */
function trimTrailing(line: string): string {
	return line.replace(/\s+$/, "");
}

export class ShortcutsPanel implements Component {
	private open = false;
	private columns: ShortcutColumn[] = [];
	private readonly title: string;
	private readonly footer: () => string;
	private readonly maxRows: () => number;

	constructor(options: { title?: string; footer?: () => string; maxRows?: () => number } = {}) {
		this.title = options.title ?? "Keyboard shortcuts";
		this.footer = options.footer ?? (() => "");
		this.maxRows = options.maxRows ?? (() => Number.POSITIVE_INFINITY);
	}

	get isOpen(): boolean {
		return this.open;
	}

	setOpen(open: boolean): void {
		this.open = open;
	}

	setColumns(columns: ShortcutColumn[]): void {
		this.columns = columns;
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (!this.open) return [];
		const effectiveWidth = Math.max(1, width);
		const budget = Math.max(1, this.maxRows());
		const heading = truncateToWidth(theme.bold(theme.fg("accent", this.title)), effectiveWidth, "");
		const measured = this.columns.map(measureColumn);
		const footerText = this.footer();
		const footer = visibleWidth(footerText) > 0 ? footerText : undefined;
		for (;;) {
			const plan = layoutPanel(measured, effectiveWidth, budget, heading, footer);
			// A null plan means the budget cannot carry this many columns: drop the least
			// important one. With a single column left the panel renders as small as it gets.
			if (plan !== null || measured.length <= 1) return plan ?? ["", heading];
			measured.pop();
		}
	}
}

function measureColumn(section: ShortcutColumn): MeasuredColumn {
	let keyWidth = 0;
	let descriptionWidth = 0;
	for (const row of section.rows) {
		keyWidth = Math.max(keyWidth, visibleWidth(row.key));
		descriptionWidth = Math.max(descriptionWidth, visibleWidth(row.description));
	}
	return { section, keyWidth, descriptionWidth };
}

/**
 * Lays out the panel inside `budget` rows. Returns the rendered lines, or null when the
 * caller should retry with fewer columns.
 */
function layoutPanel(
	columns: MeasuredColumn[],
	width: number,
	budget: number,
	heading: string,
	footer: string | undefined,
): string[] | null {
	const bands = layoutBands(columns, width);
	if (bands.length > 2 && columns.length > 1) return null;

	// Fixed rows: the heading block, one blank line and one header per band, and the footer block.
	let overhead = 2 + bands.length * 2 + (footer === undefined ? 2 : 0);
	let rowsBudget = budget - overhead;
	if (rowsBudget < bands.length && footer !== undefined) {
		footer = undefined;
		overhead -= 2;
		rowsBudget = budget - overhead;
	}
	if (rowsBudget < bands.length) return null;

	const natural = bands.map((band) => Math.max(0, ...band.map((column) => column.section.rows.length)));
	const shown = [...natural];
	const cost = () => shown.reduce((sum, rows, index) => sum + rows + (rows < natural[index]! ? 1 : 0), 0);
	while (cost() > rowsBudget) {
		let widest = -1;
		for (let index = 0; index < shown.length; index++) {
			if (shown[index] === 0) continue;
			if (widest === -1 || shown[index]! > shown[widest]!) widest = index;
		}
		if (widest === -1) break;
		shown[widest]!--;
	}

	const lines: string[] = ["", heading];
	for (let index = 0; index < bands.length; index++) {
		lines.push("", ...renderBand(bands[index]!, width, shown[index]!));
		if (shown[index]! < natural[index]!) lines.push(renderEllipsisRow(bands[index]!, shown[index]!, width));
	}
	if (footer !== undefined) lines.push("", footer);
	return lines;
}

/** Greedily packs columns into bands that fit the width, in order, one column per band minimum. */
function layoutBands(columns: MeasuredColumn[], width: number): MeasuredColumn[][] {
	const bands: MeasuredColumn[][] = [];
	let band: MeasuredColumn[] = [];
	let used = 0;
	for (const column of columns) {
		const columnWidth = column.keyWidth + KEY_GAP + column.descriptionWidth;
		if (band.length > 0 && used + COLUMN_GAP + columnWidth > width) {
			bands.push(band);
			band = [];
			used = 0;
		}
		band.push(column);
		used += (band.length > 1 ? COLUMN_GAP : 0) + columnWidth;
	}
	if (band.length > 0) bands.push(band);
	return bands;
}

/** Renders one band of columns as aligned rows, shrinking descriptions so the band fits the width. */
function renderBand(columns: MeasuredColumn[], width: number, limit: number): string[] {
	const descriptionWidths = shrinkDescriptions(columns, width);
	const lines: string[] = [];
	for (let row = 0; row <= limit; row++) {
		const cells = columns.map((column, index) => {
			const keyWidth = column.keyWidth;
			const descriptionWidth = descriptionWidths[index]!;
			if (row === 0)
				return theme.bold(theme.fg("accent", column.section.title)).padEnd(keyWidth + KEY_GAP + descriptionWidth);
			const entry = column.section.rows[row - 1];
			if (entry === undefined) return " ".repeat(keyWidth + KEY_GAP + descriptionWidth);
			const key = theme.fg("accent", entry.key.padEnd(keyWidth)) + " ".repeat(KEY_GAP);
			const description =
				index === columns.length - 1 ? entry.description : entry.description.padEnd(descriptionWidth);
			return key + description;
		});
		lines.push(truncateToWidth(trimTrailing(cells.join(" ".repeat(COLUMN_GAP))), width, ""));
	}
	return lines;
}

/** Marks a height-truncated band: one dim `⋯` in each column that lost rows. */
function renderEllipsisRow(band: MeasuredColumn[], limit: number, width: number): string {
	const cells = band.map((column) =>
		column.section.rows.length > limit
			? theme.fg("dim", ELLIPSIS).padEnd(column.keyWidth + KEY_GAP)
			: " ".repeat(column.keyWidth + KEY_GAP),
	);
	return truncateToWidth(trimTrailing(cells.join(" ".repeat(COLUMN_GAP))), width, "");
}

/**
 * Widths of each column's description cell: the natural widths, reduced from the widest
 * column down until the band fits `width`, never below MIN_DESCRIPTION_WIDTH.
 */
function shrinkDescriptions(columns: MeasuredColumn[], width: number): number[] {
	const widths = columns.map((column) => column.descriptionWidth);
	const gaps = COLUMN_GAP * (columns.length - 1);
	let total = gaps + columns.reduce((sum, column, index) => sum + column.keyWidth + KEY_GAP + widths[index]!, 0);
	while (total > width) {
		let widest = -1;
		for (let index = 0; index < widths.length; index++) {
			if (widths[index]! <= MIN_DESCRIPTION_WIDTH) continue;
			if (widest === -1 || widths[index]! > widths[widest]!) widest = index;
		}
		if (widest === -1) break;
		const shrink = Math.min(widths[widest]! - MIN_DESCRIPTION_WIDTH, total - width);
		widths[widest]! -= shrink;
		total -= shrink;
	}
	return widths;
}
