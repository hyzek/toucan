// The `/footer` menu: row order, toggling, reordering, and the guard that keeps the bar non-empty.

import { setKeybindings } from "@hyzek/toucan-tui";
import type { Mock } from "vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FooterItemId } from "../src/core/footer-items.ts";
import { FOOTER_ITEM_TEXT, FOOTER_ITEMS_DEFAULT } from "../src/core/footer-items.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { FooterEditorComponent } from "../src/modes/interactive/components/footer-editor.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const REORDER_UP = "\x1b[1;3A";
const REORDER_DOWN = "\x1b[1;3B";
const CONFIRM = "\r";
const CANCEL = "\x1b";
const RESET = "r";

interface Row {
	/** Position in the bar, undefined for a hidden block. */
	position: number | undefined;
	label: string;
	selected: boolean;
}

interface Editor {
	component: FooterEditorComponent;
	/** Blocks the editor reported as the bar's new content, newest call last. */
	changes: Mock<(items: readonly FooterItemId[]) => void>;
	close: () => void;
	/** The newest reported block order, or undefined when nothing changed. */
	reported(): readonly FooterItemId[] | undefined;
}

function createEditor(items: readonly FooterItemId[]): Editor {
	const changes = vi.fn();
	const close = vi.fn();
	return {
		component: new FooterEditorComponent(items, { onItemsChanged: changes, onCancel: close }),
		changes,
		close,
		reported: () => changes.mock.calls.at(-1)?.[0],
	};
}

/** Reads the block rows back out of the render: the lines between the two blank separators. */
function rows(editor: FooterEditorComponent): Row[] {
	const lines = stripAnsi(editor.render(120).join("\n")).split("\n");
	const first = lines.indexOf("") + 1;
	const out: Row[] = [];
	for (let i = first; i < lines.length && lines[i] !== ""; i++) {
		const line = lines[i]!;
		const selected = line.startsWith("\u2192");
		const text = line.slice(2).trimStart();
		const shown = /^(\d+)\.\s+(.*)$/.exec(text);
		// The label column is padded, so the description always starts after a double space.
		out.push(
			shown
				? { position: Number(shown[1]), label: shown[2]!.split(/\s{2,}/)[0]!, selected }
				: { position: undefined, label: text.split(/\s{2,}/)[0]!, selected },
		);
	}
	return out;
}

function rowFor(editor: FooterEditorComponent, id: FooterItemId): Row {
	const label = FOOTER_ITEM_TEXT[id].label;
	const row = rows(editor).find((candidate) => candidate.label === label);
	if (!row) throw new Error(`Expected a row for ${label}`);
	return row;
}

describe("FooterEditorComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("lists shown blocks first in bar order, then hidden ones in catalogue order", () => {
		const { component } = createEditor(["cost", "model"]);

		expect(rows(component).map((row) => [row.position, row.label])).toEqual([
			[1, "Cost"],
			[2, "Model"],
			[undefined, "Model id"],
			[undefined, "Thinking"],
			[undefined, "Session name"],
			[undefined, "Directory"],
			[undefined, "Git branch"],
			[undefined, "Context"],
			[undefined, "Tokens"],
			[undefined, "Cache hit rate"],
		]);
	});

	it("selects the first shown block", () => {
		const { component } = createEditor(["cost", "model"]);

		expect(
			rows(component)
				.filter((row) => row.selected)
				.map((row) => row.label),
		).toEqual(["Cost"]);
	});

	it("appends a hidden block to the end of the bar", () => {
		const { component, reported } = createEditor(["model"]);
		for (let i = 0; i < 3; i++) component.handleInput(DOWN);
		expect(rowFor(component, "session").selected).toBe(true);

		component.handleInput(CONFIRM);

		expect(reported()).toEqual(["model", "session"]);
		expect(rowFor(component, "session")).toMatchObject({ position: 2, selected: true });
	});

	it("moves a hidden block out of the bar without losing its place in the list", () => {
		const { component, reported } = createEditor(["model", "session"]);
		expect(rows(component)[0]!.label).toBe("Model");

		component.handleInput(CONFIRM);

		expect(reported()).toEqual(["session"]);
		expect(rowFor(component, "session")).toMatchObject({ position: 1 });
		// The cursor stays on the block that was hidden, which now leads the hidden section.
		expect(rowFor(component, "model")).toMatchObject({ position: undefined, selected: true });
	});

	it("refuses to hide the last shown block, since an empty bar reads as a bug", () => {
		const { component, changes } = createEditor(["model"]);

		component.handleInput(CONFIRM);

		expect(changes).not.toHaveBeenCalled();
		expect(rowFor(component, "model")).toMatchObject({ position: 1 });
	});

	it("moves a shown block one place later", () => {
		const { component, reported } = createEditor(["cost", "model", "session"]);

		component.handleInput(REORDER_DOWN);

		expect(reported()).toEqual(["model", "cost", "session"]);
	});

	it("moves a shown block one place earlier", () => {
		const { component, reported } = createEditor(["session", "model", "cost"]);
		component.handleInput(DOWN);
		expect(rowFor(component, "model").position).toBe(2);

		component.handleInput(REORDER_UP);

		expect(reported()).toEqual(["model", "session", "cost"]);
	});

	it("has nothing to reorder at the ends of the bar or on a hidden block", () => {
		const { component, changes } = createEditor(["cost", "model"]);

		component.handleInput(REORDER_UP);
		component.handleInput(DOWN);
		component.handleInput(DOWN);
		expect(rowFor(component, "model-id").position).toBeUndefined();
		component.handleInput(REORDER_DOWN);

		expect(changes).not.toHaveBeenCalled();
	});

	it("restores the default blocks and order", () => {
		const { component, reported } = createEditor(["cost"]);

		component.handleInput(RESET);

		expect(reported()).toEqual([...FOOTER_ITEMS_DEFAULT]);
	});

	it("wraps the selection around the list", () => {
		const { component } = createEditor(["model"]);
		const count = rows(component).length;

		component.handleInput(UP);

		expect(rows(component)[count - 1]!.selected).toBe(true);
	});

	it("closes without changing anything", () => {
		const { component, changes, close } = createEditor(["model"]);

		component.handleInput(CANCEL);

		expect(close).toHaveBeenCalled();
		expect(changes).not.toHaveBeenCalled();
	});
});
