// The `/footer` menu: which blocks the info bar shows, and in what order. Every change is
// applied as it is made, so the real bar under the input is the preview and this dialog never
// needs to draw its own.

import { type Component, getKeybindings, truncateToWidth } from "@hyzek/toucan-tui";
import {
	FOOTER_ITEM_IDS,
	FOOTER_ITEM_TEXT,
	FOOTER_ITEMS_DEFAULT,
	type FooterItemId,
} from "../../../core/footer-items.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyDisplayText } from "./keybinding-hints.ts";

/** Positions never exceed the block count, and a fixed index column keeps the labels aligned. */
const INDEX_WIDTH = String(FOOTER_ITEM_IDS.length).length;
/** Label column: the index, the longest block name, and two spaces of gutter before the description. */
const LABEL_WIDTH = Math.max(...FOOTER_ITEM_IDS.map((id) => FOOTER_ITEM_TEXT[id].label.length)) + INDEX_WIDTH + 4;

export interface FooterEditorCallbacks {
	/** The blocks to show, left to right. Applied immediately, and again after every edit. */
	onItemsChanged: (items: readonly FooterItemId[]) => void;
	onCancel: () => void;
}

interface FooterRow {
	id: FooterItemId;
	/** Position in the bar, or undefined when the block is hidden. */
	position: number | undefined;
}

/**
 * Shown blocks first, in bar order, then hidden ones in catalogue order: the list top is the bar,
 * and hiding a block only moves it out of the way instead of losing its place.
 */
function buildRows(items: readonly FooterItemId[]): FooterRow[] {
	const rows: FooterRow[] = items.map((id, index) => ({ id, position: index + 1 }));
	for (const id of FOOTER_ITEM_IDS) {
		if (!items.includes(id)) rows.push({ id, position: undefined });
	}
	return rows;
}

export class FooterEditorComponent implements Component {
	private items: FooterItemId[];
	private selectedId: FooterItemId;
	private callbacks: FooterEditorCallbacks;
	private border = new DynamicBorder();

	constructor(items: readonly FooterItemId[], callbacks: FooterEditorCallbacks) {
		this.items = [...items];
		this.selectedId = this.items[0] ?? FOOTER_ITEM_IDS[0];
		this.callbacks = callbacks;
	}

	invalidate(): void {
		// No cached layout: rows render from `items` each time.
	}

	render(width: number): string[] {
		const lines: string[] = [this.border.render(width)[0]!];
		lines.push(theme.bold(theme.fg("accent", " Info bar")));
		lines.push(theme.fg("muted", " Shown blocks lead the bar, in this order. The bar updates as you edit."));
		lines.push("");

		for (const row of buildRows(this.items)) {
			const text = FOOTER_ITEM_TEXT[row.id];
			const selected = row.id === this.selectedId;
			const cursor = selected ? theme.fg("accent", "\u2192 ") : "  ";
			const marker = row.position === undefined ? "" : `${row.position}.`;
			const label = `${marker.padStart(INDEX_WIDTH + 1)} ${text.label}`.padEnd(LABEL_WIDTH);
			const labelText =
				row.position === undefined ? theme.fg("muted", label) : selected ? theme.fg("accent", label) : label;
			const description = theme.fg("dim", text.description);
			lines.push(truncateToWidth(`${cursor}${labelText}${description}`, width));
		}

		lines.push("");
		lines.push(theme.fg("dim", ` ${this.hint()}`));
		lines.push(this.border.render(width)[0]!);
		return lines;
	}

	private hint(): string {
		const parts = [
			`${keyDisplayText("tui.select.up")}/${keyDisplayText("tui.select.down")} select`,
			`${keyDisplayText("tui.select.confirm")} show/hide`,
			`${keyDisplayText("app.footer.reorderUp")}/${keyDisplayText("app.footer.reorderDown")} reorder`,
			`${keyDisplayText("app.footer.reset")} default`,
			`${keyDisplayText("tui.select.cancel")} close`,
		];
		return parts.join(" \u00b7 ");
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.up")) {
			this.moveSelection(-1);
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			this.moveSelection(1);
			return;
		}
		if (kb.matches(data, "app.footer.reorderUp")) {
			this.reorder(-1);
			return;
		}
		if (kb.matches(data, "app.footer.reorderDown")) {
			this.reorder(1);
			return;
		}
		if (kb.matches(data, "app.footer.reset")) {
			this.apply([...FOOTER_ITEMS_DEFAULT]);
			return;
		}
		if (kb.matches(data, "tui.select.confirm")) {
			this.toggle(this.selectedId);
			return;
		}
		if (kb.matches(data, "tui.select.cancel")) {
			this.callbacks.onCancel();
		}
	}

	private rows(): FooterRow[] {
		return buildRows(this.items);
	}

	private selectedIndex(): number {
		return this.rows().findIndex((row) => row.id === this.selectedId);
	}

	private moveSelection(delta: number): void {
		const rows = this.rows();
		const from = this.selectedIndex();
		const next = (from + delta + rows.length) % rows.length;
		this.selectedId = rows[next]!.id;
	}

	/** Move a shown block within the bar. Hidden blocks have no order to change. */
	private reorder(delta: number): void {
		const from = this.items.indexOf(this.selectedId);
		if (from === -1) return;
		const to = from + delta;
		if (to < 0 || to >= this.items.length) return;
		const [moved] = this.items.splice(from, 1);
		this.items.splice(to, 0, moved!);
		this.apply(this.items);
	}

	private toggle(id: FooterItemId): void {
		const shown = this.items.indexOf(id);
		if (shown !== -1) {
			// A bar with no blocks left is a bar with nothing to show, and `footer.items` falls
			// back to the default when it is empty: hiding the last block has to be refused.
			if (this.items.length === 1) return;
			this.items.splice(shown, 1);
		} else {
			this.items.push(id);
		}
		this.apply(this.items);
	}

	private apply(items: readonly FooterItemId[]): void {
		this.items = [...items];
		this.callbacks.onItemsChanged(this.items);
	}
}
