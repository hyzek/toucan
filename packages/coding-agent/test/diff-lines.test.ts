import { describe, expect, it } from "vitest";
import { pairChanges, parseDisplayDiff, wordMarks } from "../src/core/tools/diff-lines.ts";
import { generateDiffString } from "../src/core/tools/edit-diff.ts";

function line(kind: string, text: string, extra: object = {}) {
	return { kind, text, ...extra };
}

describe("parseDisplayDiff", () => {
	it("reads the sign, the number and the text of every line", () => {
		const lines = parseDisplayDiff(["  1 alpha", "-  1 beta", "+  2 gamma", "  3 delta"].join("\n"));

		expect(lines).toEqual([
			line("context", "alpha", { oldNumber: 1, newNumber: 1 }),
			line("removed", "beta", { oldNumber: 1 }),
			line("added", "gamma", { newNumber: 2 }),
			line("context", "delta", { oldNumber: 3, newNumber: 3 }),
		]);
	});

	it("keeps leading whitespace inside the text", () => {
		expect(parseDisplayDiff("+ 12   indent").map((l) => l.text)).toEqual(["  indent"]);
	});

	it("marks the context the diff skipped as a separator", () => {
		expect(parseDisplayDiff("  1 a\n      ...\n  9 d").map((l) => l.kind)).toEqual([
			"context",
			"separator",
			"context",
		]);
	});

	it("numbers lines by their column width and reads them back", () => {
		const oldContent = Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n");
		const newContent = oldContent.replace("line 42", "line forty-two");
		const { diff } = generateDiffString(oldContent, newContent);

		const parsed = parseDisplayDiff(diff);
		const changed = parsed.filter((l) => l.kind === "removed" || l.kind === "added");

		expect(changed).toEqual([
			line("removed", "line 42", { oldNumber: 43 }),
			line("added", "line forty-two", { newNumber: 43 }),
		]);
		expect(parsed.filter((l) => l.kind === "separator")).toHaveLength(2);
	});

	it("treats text it does not recognise as context", () => {
		expect(parseDisplayDiff("warning: not a diff")).toEqual([line("context", "warning: not a diff")]);
	});
});

describe("wordMarks", () => {
	it("locates the characters that differ in a line pair", () => {
		const marks = wordMarks("const a = 1;", "const a = 2;");

		expect(marks.removed).toEqual([[10, 11]]);
		expect(marks.added).toEqual([[10, 11]]);
		expect(marks.similarity).toBeCloseTo(11 / 12);
	});

	it("reports unrelated lines with low similarity", () => {
		const marks = wordMarks("aaaaaaaa", "zzzzzzzz");

		expect(marks.similarity).toBeLessThan(0.2);
		expect(marks.removed).toEqual([[0, 8]]);
		expect(marks.added).toEqual([[0, 8]]);
	});

	it("does not mark the indentation two lines share", () => {
		const marks = wordMarks("\t  a b", "\t  c b");

		expect(marks.removed).toEqual([[3, 4]]);
		expect(marks.added).toEqual([[3, 4]]);
	});

	it("matches an empty pair exactly", () => {
		expect(wordMarks("", "")).toEqual({ similarity: 1, removed: [], added: [] });
	});
});

describe("pairChanges", () => {
	const lines = (kind: "removed" | "added", texts: string[]) => texts.map((text) => ({ kind, text }));

	it("pairs runs of the same length position by position", () => {
		const pairs = pairChanges(lines("removed", ["a", "b"]), lines("added", ["A", "B"]));

		expect(pairs.map(([r, a]) => [r.text, a.text])).toEqual([
			["a", "A"],
			["b", "B"],
		]);
	});

	it("pairs nothing when the runs differ in length", () => {
		expect(pairChanges(lines("removed", ["a", "b"]), lines("added", ["A"]))).toEqual([]);
		expect(pairChanges(lines("removed", []), lines("added", ["A"]))).toEqual([]);
	});
});
