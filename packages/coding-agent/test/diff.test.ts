import { beforeAll, describe, expect, it } from "vitest";
import { COLLAPSED_DIFF_ROWS, DiffComponent, renderDiff } from "../src/modes/interactive/components/diff.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function rows(component: DiffComponent, width: number): string[] {
	return component.render(width).map((line) => stripAnsi(line));
}

/** The distinct background colours a rendered row opens. */
function bands(line: string): string[] {
	return [...new Set(line.match(/\x1b\[48;[0-9;]*m/g) ?? [])];
}

/** The columns where a row draws a divider. */
function dividerColumns(row: string): number[] {
	const columns: number[] = [];
	for (const [index, char] of [...row].entries()) {
		if (char === "\u2502") columns.push(index);
	}
	return columns;
}

/** A diff in the shape `generateDiffString` writes for a file with single-digit line numbers. */
function change(count: number, prefix = "line"): string {
	const removed = Array.from({ length: count }, (_, i) => `-${i + 1} ${prefix} ${i}`);
	const added = Array.from({ length: count }, (_, i) => `+${i + 1} ${prefix} x${i}`);
	return [...removed, ...added].join("\n");
}

const RULE = "\u2500";

describe("renderDiff", () => {
	beforeAll(() => initTheme("dark"));

	it.each([
		{
			name: "text is inserted at the start of a line",
			diff: "-83   await commitRecordingChunk({\n+83   const result = await commitRecordingChunk({",
			expected: ["▌83- │   await commitRecordingChunk({", "▌83+ │   const result = await commitRecordingChunk({"],
		},
		{
			name: "indented text is replaced",
			diff: "-12     const value = oldValue\n+12     const value = newValue",
			expected: ["▌12- │     const value = oldValue", "▌12+ │     const value = newValue"],
		},
	])("puts the number before the sign and keeps indentation when $name", ({ diff, expected }) => {
		expect(stripAnsi(renderDiff(diff)).split("\n")).toEqual(expected);
	});

	it("picks out the words that differ with a deeper band", () => {
		const [removed, added] = renderDiff(
			"-83   await commitRecordingChunk({\n+83   const result = await commitRecordingChunk({",
		).split("\n");

		// The added line carries a deeper band behind the words it gained; the removed line lost nothing,
		// so it is one band all the way across.
		expect(bands(added)).toHaveLength(2);
		expect(bands(removed)).toHaveLength(1);
		expect(stripAnsi(added)).toBe("▌83+ │   const result = await commitRecordingChunk({");
	});

	it("dims context lines and marks the context the diff skipped", () => {
		const rendered = renderDiff(" 1 alpha\n   ...\n 9 omega");
		const lines = rendered.split("\n");

		expect(stripAnsi(lines[0])).toBe(" 1  │ alpha");
		expect(lines[0]).toContain("\x1b[2m");
		expect(lines[1]).toBe(theme.fg("toolDiffContext", "..."));
		expect(stripAnsi(lines[2])).toBe(" 9  │ omega");
	});

	it("colours the body with the file language on a paired edit", () => {
		const colored = renderDiff("-1 const x = 1;\n+1 const x = 2;", { filePath: "src/app.ts" });

		expect(colored).toContain(theme.getFgAnsi("syntaxKeyword"));
		expect(stripAnsi(colored)).toBe("▌1- │ const x = 1;\n▌1+ │ const x = 2;");
	});

	it("keeps the syntax colours under the deeper band of a changed word", () => {
		const rendered = renderDiff("-1 export const value = 1;\n+1 export const value = 2;", {
			filePath: "src/app.ts",
		});
		const added = rendered.split("\n")[1];

		expect(added).toContain(`${theme.getFgAnsi("syntaxKeyword")}export`);
		expect(stripAnsi(added)).toBe("▌1+ │ export const value = 2;");
	});

	it("bands a pure insertion as one line, and a rewrite that does not pair as well", () => {
		const insertion = renderDiff("+1 const added = 1;");
		expect(bands(insertion)).toHaveLength(1);
		expect(stripAnsi(insertion)).toBe("▌1+ │ const added = 1;");

		const rewrite = renderDiff("-1 one\n-2 two\n+1 replaced");
		for (const line of rewrite.split("\n")) {
			expect(bands(line)).toHaveLength(1);
		}
	});

	it("bands a plain-text row in one colour", () => {
		const rendered = renderDiff("+ 1 const x = 1;");

		expect(bands(rendered)).toHaveLength(1);
		expect(stripAnsi(rendered)).toBe("▌1+ │ const x = 1;");
	});

	it("separates hunks it cannot label", () => {
		expect(stripAnsi(renderDiff("-1 a\n+1 b\n   ...\n 9 z")).split("\n")).toEqual([
			"▌1- │ a",
			"▌1+ │ b",
			"...",
			" 9  │ z",
		]);
	});
});

describe("DiffComponent", () => {
	beforeAll(() => initTheme("dark"));

	it("rules off one hunk and folds long changes, naming the key that expands them", () => {
		const diff = change(COLLAPSED_DIFF_ROWS + 6);
		const folded = new DiffComponent(diff, { expandHint: "(ctrl+o to expand)" });
		const expanded = new DiffComponent(diff, { expanded: true });

		const foldedRows = rows(folded, 80);
		expect(foldedRows[0]).toBe(RULE.repeat(80));
		expect(foldedRows[1 + COLLAPSED_DIFF_ROWS]).toBe(RULE.repeat(80));
		expect(foldedRows.at(-1)).toBe("       36 more diff lines (ctrl+o to expand)");
		expect(rows(expanded, 80)).toHaveLength((COLLAPSED_DIFF_ROWS + 6) * 2 + 2);
	});

	it("names each hunk when the tool labels them", () => {
		const component = new DiffComponent("-6 total = 0\n+6 if not values:\n   ...\n+13 guard", {
			hunkLabel: (hunk, index, total) => `Edit ${index + 1}/${total} at line ${hunk.line}`,
		});

		expect(rows(component, 40)[0]).toBe("Edit 1/2 at line 6");
		expect(rows(component, 40)[5]).toBe("Edit 2/2 at line 13");
	});

	it("shows one column below the split width and two above it", () => {
		const diff = change(3);

		const flat = rows(new DiffComponent(diff), 100);
		expect(flat.map((row) => row.trimEnd())).toEqual([
			RULE.repeat(100),
			"▌1- │ line 0",
			"▌2- │ line 1",
			"▌3- │ line 2",
			"▌1+ │ line x0",
			"▌2+ │ line x1",
			"▌3+ │ line x2",
			RULE.repeat(100),
		]);
		expect(flat[1]).toHaveLength(100); // the band reaches the block's right edge

		const split = rows(new DiffComponent(diff), 160);
		expect(split).toHaveLength(5);
		expect(stripAnsi(split[1]).trim()).toMatch(/^▌1- │ line 0\s*│\s*▌1\+ │ line x0$/);
	});

	it("keeps the columns lined up when one side has no line for a row", () => {
		const split = rows(new DiffComponent("-1 gone\n+5 created\n+6 also"), 160);

		// Row one has a divider per side plus the middle one; row two has no left side, so only two.
		expect(dividerColumns(split[1]).at(-2)).toBe(dividerColumns(split[2])[0]);
		expect(split[2]).toContain("also");
	});

	it("falls back to one column when the two sides do not fit", () => {
		const wide = `-1 ${"x".repeat(90)}\n+1 ${"y".repeat(90)}`;
		const lines = rows(new DiffComponent(wide), 160);

		expect(lines).toHaveLength(4);
		expect(lines[1].split("\u2502")).toHaveLength(2);
	});

	it("fills a row to the terminal width and cuts what does not fit", () => {
		const lines = new DiffComponent(`+1 ${"z".repeat(200)}`).render(40);

		expect(stripAnsi(lines[1])).toHaveLength(40);
		expect(bands(lines[1])).toHaveLength(1);
	});
});
