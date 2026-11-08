import assert from "node:assert";
import { describe, it } from "node:test";
import { SelectList } from "../src/components/select-list.ts";
import { visibleWidth } from "../src/utils.ts";

const testTheme = {
	selectedPrefix: (text: string) => text,
	selectedText: (text: string) => text,
	description: (text: string) => text,
	scrollInfo: (text: string) => text,
	noMatch: (text: string) => text,
};

const visibleIndexOf = (line: string, text: string): number => {
	const index = line.indexOf(text);
	assert.notEqual(index, -1);
	return visibleWidth(line.slice(0, index));
};

describe("SelectList", () => {
	it("normalizes multiline descriptions to single line", () => {
		const items = [
			{
				value: "test",
				label: "test",
				description: "Line one\nLine two\nLine three",
			},
		];

		const list = new SelectList(items, 5, testTheme);
		const rendered = list.render(100);

		assert.ok(rendered.length > 0);
		assert.ok(!rendered[0].includes("\n"));
		assert.ok(rendered[0].includes("Line one Line two Line three"));
	});

	it("keeps descriptions aligned when the primary text is truncated", () => {
		const items = [
			{ value: "short", label: "short", description: "short description" },
			{
				value: "very-long-command-name-that-needs-truncation",
				label: "very-long-command-name-that-needs-truncation",
				description: "long description",
			},
		];

		const list = new SelectList(items, 5, testTheme);
		const rendered = list.render(80);

		assert.equal(visibleIndexOf(rendered[0], "short description"), visibleIndexOf(rendered[1], "long description"));
	});

	it("uses the configured minimum primary column width", () => {
		const items = [
			{ value: "a", label: "a", description: "first" },
			{ value: "bb", label: "bb", description: "second" },
		];

		const list = new SelectList(items, 5, testTheme, {
			minPrimaryColumnWidth: 12,
			maxPrimaryColumnWidth: 20,
		});
		const rendered = list.render(80);

		assert.equal(rendered[0].indexOf("first"), 14);
		assert.equal(rendered[1].indexOf("second"), 14);
	});

	it("uses the configured maximum primary column width", () => {
		const items = [
			{
				value: "very-long-command-name-that-needs-truncation",
				label: "very-long-command-name-that-needs-truncation",
				description: "first",
			},
			{ value: "short", label: "short", description: "second" },
		];

		const list = new SelectList(items, 5, testTheme, {
			minPrimaryColumnWidth: 12,
			maxPrimaryColumnWidth: 20,
		});
		const rendered = list.render(80);

		assert.equal(visibleIndexOf(rendered[0], "first"), 22);
		assert.equal(visibleIndexOf(rendered[1], "second"), 22);
	});

	it("allows overriding primary truncation while preserving description alignment", () => {
		const items = [
			{
				value: "very-long-command-name-that-needs-truncation",
				label: "very-long-command-name-that-needs-truncation",
				description: "first",
			},
			{ value: "short", label: "short", description: "second" },
		];

		const list = new SelectList(items, 5, testTheme, {
			minPrimaryColumnWidth: 12,
			maxPrimaryColumnWidth: 12,
			truncatePrimary: ({ text, maxWidth }) => {
				if (text.length <= maxWidth) {
					return text;
				}

				return `${text.slice(0, Math.max(0, maxWidth - 1))}…`;
			},
		});
		const rendered = list.render(80);

		assert.ok(rendered[0].includes("…"));
		assert.equal(visibleIndexOf(rendered[0], "first"), visibleIndexOf(rendered[1], "second"));
	});

	it("moves by one visible page with selection page keys (#7629)", () => {
		const items = Array.from({ length: 12 }, (_, index) => ({ value: `item-${index}`, label: `Item ${index}` }));
		const list = new SelectList(items, 5, testTheme);
		const selections: string[] = [];
		list.onSelectionChange = (item) => selections.push(item.value);

		for (const key of ["\x1b[6~", "\x1b[6~", "\x1b[6~", "\x1b[6~", "\x1b[5~"]) list.handleInput(key);

		assert.deepStrictEqual(selections, ["item-5", "item-10", "item-11", "item-6"]);

		list.setFilter("no match");
		list.handleInput("\x1b[6~");
		assert.deepStrictEqual(selections, ["item-5", "item-10", "item-11", "item-6"]);
	});

	it("paints the selected row as a solid bar with the menu's own marker", () => {
		const barTheme = { ...testTheme, selectedRow: (text: string) => `\x1b[44m${text}\x1b[49m` };
		const items = [
			{ value: "model", label: "/model", description: "choose what model and reasoning effort to use" },
			{ value: "fast", label: "/fast", description: "1.5x speed" },
		];
		const list = new SelectList(items, 5, barTheme, {
			selectionMarker: "\u203a",
			solidSelection: true,
			keepSelectionInView: true,
		});

		const rendered = list.render(60);
		assert.ok(rendered[0].startsWith("\x1b[44m\u203a /model"));
		assert.equal(visibleWidth(rendered[0]), 60 + visibleWidth("\x1b[44m") + visibleWidth("\x1b[49m"));
		// An unselected row gets no bar.
		assert.ok(!rendered[1].includes("\x1b[44m"));
	});

	it("drops the selected/total row when the layout asks", () => {
		const items = Array.from({ length: 12 }, (_, index) => ({ value: `c${index}`, label: `/c${index}` }));
		const counting = new SelectList(items, 5, testTheme);
		assert.equal(counting.render(60).length, 6); // 5 rows plus the count

		const hidden = new SelectList(items, 5, testTheme, { keepSelectionInView: true, hideScrollInfo: true });
		assert.equal(hidden.render(60).length, 5);
	});

	it("slides the window the least needed to keep the selection in view", () => {
		const items = Array.from({ length: 8 }, (_, index) => ({ value: `c${index}`, label: `/c${index}` }));
		const list = new SelectList(items, 5, testTheme, { keepSelectionInView: true });

		list.setSelectedIndex(3);
		assert.ok(list.render(40)[0].includes("/c0")); // the window stays put while the selection fits

		list.setSelectedIndex(5);
		const lines = list.render(40).map((line) => line.trim());
		assert.deepStrictEqual(lines.slice(0, 5), ["/c1", "/c2", "/c3", "/c4", "→ /c5"]); // one row in from the bottom

		// Without the option the visible window centers on the selection.
		const centered = new SelectList(items, 5, testTheme);
		centered.setSelectedIndex(5);
		assert.ok(centered.render(40)[0].includes("/c3"));
	});
});
