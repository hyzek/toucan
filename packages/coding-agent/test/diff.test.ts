import { beforeAll, describe, expect, it } from "vitest";
import { COLLAPSED_DIFF_ROWS, DiffComponent, renderDiff } from "../src/modes/interactive/components/diff.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function rows(component: DiffComponent, width: number): string[] {
	return component.render(width).map((line) => stripAnsi(line));
}

/** A diff in the shape `generateDiffString` writes for a file with single-digit line numbers. */
function change(count: number, prefix = "line"): string {
	const removed = Array.from({ length: count }, (_, i) => `-${i + 1} ${prefix} ${i}`);
	const added = Array.from({ length: count }, (_, i) => `+${i + 1} ${prefix} x${i}`);
	return [...removed, ...added].join("\n");
}

describe("renderDiff", () => {
	beforeAll(() => initTheme("dark"));

	it.each([
		{
			name: "text is inserted at the start of a line",
			diff: "-83   await commitRecordingChunk({\n+83   const result = await commitRecordingChunk({",
			expected: ["-83   await commitRecordingChunk({", "+83   const result = await commitRecordingChunk({"],
		},
		{
			name: "indented text is replaced",
			diff: "-12     const value = oldValue\n+12     const value = newValue",
			expected: ["-12     const value = oldValue", "+12     const value = newValue"],
		},
	])("preserves indentation when $name", ({ diff, expected }) => {
		const rendered = renderDiff(diff);

		expect(stripAnsi(rendered).split("\n")).toEqual(expected);
	});

	it("marks only the words that differ in a changed line", () => {
		const rendered = renderDiff(
			"-83   await commitRecordingChunk({\n+83   const result = await commitRecordingChunk({",
		);
		const insertion = theme.fg("toolDiffAdded", "const result = ");

		expect(rendered).toContain(insertion);
		expect(rendered.indexOf("+83   ")).toBeLessThan(rendered.indexOf(insertion));
		expect(rendered).not.toContain(theme.fg("toolDiffAdded", "await"));
		expect(stripAnsi(rendered)).not.toContain("-83   const result");
	});

	it("keeps context dim and marks the context the diff skipped", () => {
		const rendered = renderDiff(" 1 alpha\n   ...\n 9 omega");
		const lines = rendered.split("\n");

		expect(lines[0]).toContain(theme.fg("toolDiffContext", "alpha"));
		expect(lines[1]).toContain(theme.fg("toolDiffContext", "..."));
		expect(rows(new DiffComponent(" 1 alpha\n   ...\n 9 omega"), 80)).toEqual([" 1 alpha", "   ...", " 9 omega"]);
	});

	it("colours the body with the file language on a paired edit", () => {
		const colored = renderDiff("-1 const x = 1;\n+1 const x = 2;", { filePath: "src/app.ts" });

		expect(colored).toContain(theme.getFgAnsi("syntaxKeyword"));
		expect(stripAnsi(colored)).toBe("-1 const x = 1;\n+1 const x = 2;");
	});

	it("marks changed words in the state colour and keeps the rest of the line highlighted", () => {
		const rendered = renderDiff("-1 export const value = 1;\n+1 export const value = 2;", {
			filePath: "src/app.ts",
		});

		expect(rendered).toContain(theme.fg("toolDiffRemoved", "1"));
		expect(rendered).toContain(theme.fg("toolDiffAdded", "2"));
		expect(rendered).toContain(`${theme.getFgAnsi("syntaxKeyword")}export`);
		expect(stripAnsi(rendered)).toBe("-1 export const value = 1;\n+1 export const value = 2;");
	});

	it("tints a pure insertion as one line, and a rewrite that does not pair as well", () => {
		const insertion = renderDiff("+1 const added = 1;", { filePath: "src/app.ts" });
		expect(insertion).toContain(theme.fg("toolDiffAdded", "const added = 1;"));

		const rewrite = renderDiff("-1 one\n-2 two\n+1 replaced", { filePath: "src/app.ts" });
		expect(rewrite).toContain(theme.fg("toolDiffRemoved", "one"));
		expect(rewrite).toContain(theme.fg("toolDiffRemoved", "two"));
		expect(rewrite).toContain(theme.fg("toolDiffAdded", "replaced"));
	});

	it("leaves the body in the state colour when no language is known", () => {
		expect(renderDiff("+ 1 const x = 1;")).toContain(theme.fg("toolDiffAdded", "const x = 1;"));
	});
});

describe("DiffComponent", () => {
	beforeAll(() => initTheme("dark"));

	it("folds long changes and names the key that expands them", () => {
		const diff = change(COLLAPSED_DIFF_ROWS + 6);
		const folded = new DiffComponent(diff, { expandHint: "(ctrl+o to expand)" });
		const expanded = new DiffComponent(diff, { expanded: true });

		const foldedRows = rows(folded, 80);
		expect(foldedRows).toHaveLength(COLLAPSED_DIFF_ROWS + 1);
		expect(foldedRows.at(-1)).toBe("    36 more lines (ctrl+o to expand)");
		expect(rows(expanded, 80)).toHaveLength((COLLAPSED_DIFF_ROWS + 6) * 2);
	});

	it("shows one column below the split width and two above it", () => {
		const diff = change(3);

		expect(rows(new DiffComponent(diff), 100)).toEqual([
			"-1 line 0",
			"-2 line 1",
			"-3 line 2",
			"+1 line x0",
			"+2 line x1",
			"+3 line x2",
		]);

		const split = rows(new DiffComponent(diff), 160);
		expect(split).toHaveLength(3);
		expect(split[0]).toContain("\u2502");
		expect(stripAnsi(split[0]).trimStart()).toMatch(/^-1 line 0\s*\u2502\s*\+1 line x0/);
	});

	it("keeps the columns lined up when one side has no line for a row", () => {
		const split = rows(new DiffComponent("-1 gone\n+5 created\n+6 also"), 160);

		expect(split).toHaveLength(2);
		expect(split[0].indexOf("\u2502")).toBe(split[1].indexOf("\u2502"));
		expect(split[1]).toContain("also");
	});

	it("falls back to one column when the two sides do not fit", () => {
		const wide = `-1 ${"x".repeat(90)}\n+1 ${"y".repeat(90)}`;
		const lines = rows(new DiffComponent(wide), 160);

		expect(lines).toHaveLength(2);
		expect(lines[0]).not.toContain("\u2502");
	});

	it("cuts a row to the terminal width", () => {
		const long = `+1 ${"z".repeat(200)}`;

		expect(rows(new DiffComponent(long), 40)[0]).toHaveLength(40);
	});
});
