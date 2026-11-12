import { type Component, Spacer, Text } from "@hyzek/toucan-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { ToolBranchBlock } from "../src/modes/interactive/components/tool-branch.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function rows(block: ToolBranchBlock, width: number): string[] {
	return block.render(width).map((line) => stripAnsi(line).trimEnd());
}

describe("ToolBranchBlock", () => {
	beforeAll(() => initTheme("dark"));

	it("opens the guide under the first row of the block and closes it under the last", () => {
		const block = new ToolBranchBlock();
		block.addChild(new Text("first\nmiddle", 0, 0));
		block.addChild(new Text("last", 0, 0));

		expect(rows(block, 20)).toEqual(["  ├ first", "  │ middle", "  └ last"]);
	});

	it("guides a single row with the closing glyph only", () => {
		const block = new ToolBranchBlock();
		block.addChild(new Text("alone", 0, 0));

		expect(rows(block, 20)).toEqual(["  └ alone"]);
	});

	it("leaves the blank rows between parts of the block unguided", () => {
		const block = new ToolBranchBlock();
		block.addChild(new Text("one", 0, 0));
		block.addChild(new Spacer(1));
		block.addChild(new Text("two", 0, 0));

		expect(rows(block, 20)).toEqual(["  ├ one", "", "  └ two"]);
	});

	it("renders nothing when it has no children", () => {
		expect(rows(new ToolBranchBlock(), 20)).toEqual([]);
	});

	it("cuts the block's rows to the width left by the guide, marking the cut", () => {
		const wide: Component = { render: (width: number) => ["y".repeat(width + 10)], invalidate: () => {} };
		const block = new ToolBranchBlock();
		block.addChild(wide);

		expect(rows(block, 10)).toEqual(["  └ yyy..."]);
	});
});

describe("ToolBranchBlock openEnded", () => {
	beforeAll(() => initTheme("dark"));

	it("leaves the last row continuing the guide", () => {
		const block = new ToolBranchBlock({ openEnded: true });
		block.addChild(new Text("first\nlast", 0, 0));

		expect(rows(block, 20)).toEqual(["  ├ first", "  │ last"]);
	});

	it("opens a single row instead of closing it", () => {
		const block = new ToolBranchBlock({ openEnded: true });
		block.addChild(new Text("alone", 0, 0));

		expect(rows(block, 20)).toEqual(["  ├ alone"]);
	});
});
