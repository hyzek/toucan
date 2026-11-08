import type { Component } from "@hyzek/toucan-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { ToolDefinition, ToolRenderContext } from "../src/core/extensions/types.ts";
import { editRenderers } from "../src/core/tools/renderers/edit.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

// The edit definition always provides both renderers; the tool type marks them optional for tools
// that use the default display.
const tool = editRenderers as Required<Pick<ToolDefinition, "renderCall" | "renderResult">>;

function renderContext(overrides: Partial<ToolRenderContext> = {}): ToolRenderContext {
	return {
		args: {},
		state: {},
		lastComponent: undefined,
		invalidate: () => {},
		toolCallId: "call-1",
		cwd: "/repo",
		executionStarted: true,
		// No preview is computed from the file: these tests feed the diff in through the result.
		argsComplete: false,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
		durationMs: undefined,
		outputPad: 0,
		rowMarkerShown: true,
		keyText: () => "ctrl+o",
		keyHint: (_keybinding, description) => `ctrl+o ${description}`,
		...overrides,
	};
}

/**
 * The rows of one edit call as the transcript shows them: the header the call draws and the block the
 * result puts under it.
 */
function editRows(args: unknown, diff: string, expanded: boolean): string[] {
	const state = {};
	const context = renderContext({ args, state, expanded });
	tool.renderCall(args as never, theme, context);
	tool.renderResult(
		{ content: [], details: { diff } },
		{ expanded, isPartial: false },
		theme,
		renderContext({ args, state, expanded }),
	);
	return (state as { callComponent: Component }).callComponent.render(80).map((line) => stripAnsi(line).trimEnd());
}

describe("edit tool rendering", () => {
	beforeAll(() => initTheme("dark"));

	it("names the file, and the number of edits once the row is open", () => {
		const one = editRows({ path: "src/app.ts", edits: [{ oldText: "a", newText: "b" }] }, "-1 a\n+1 b", true);
		const two = editRows(
			{
				path: "src/app.ts",
				edits: [
					{ oldText: "a", newText: "b" },
					{ oldText: "c", newText: "d" },
				],
			},
			"-1 a\n+1 b\n   ...\n-9 c\n+9 d",
			true,
		);
		const closed = editRows(
			{
				path: "src/app.ts",
				edits: [
					{ oldText: "a", newText: "b" },
					{ oldText: "c", newText: "d" },
				],
			},
			"-1 a\n+1 b",
			false,
		);

		expect(one[1]).toBe("• Edit src/app.ts");
		expect(two[1]).toBe("• Edit src/app.ts (2 edits)");
		expect(closed[1]).toBe("• Edit src/app.ts");
	});

	it("states the change, names each hunk, and counts the parts", () => {
		const rows = editRows(
			{
				path: "src/app.ts",
				edits: [
					{ oldText: "a", newText: "b" },
					{ oldText: "c", newText: "d" },
				],
			},
			"-6 a\n+6 b\n   ...\n+13 d",
			true,
		);

		expect(rows).toContain("  ├ 2 edits +2 -1");
		expect(rows).toContain("  │ Edit 1/2 at line 6");
		expect(rows).toContain("  │ Edit 2/2 at line 13");
		expect(rows.at(-2)).toBe("  └ 2 edits +2 -1 · 2 hunks (4 diff lines)");
	});

	it("names the hunks of a single edit after themselves, not after the edit", () => {
		const rows = editRows(
			{ path: "src/app.ts", edits: [{ oldText: "a", newText: "b" }] },
			"-6 a\n+6 b\n   ...\n+13 d",
			true,
		);

		expect(rows).toContain("  ├ +2 -1");
		expect(rows).toContain("  │ Hunk 1/2 at line 6");
	});

	it("gives a single change its position on the summary line instead of naming its hunk", () => {
		const rows = editRows({ path: "src/app.ts", edits: [{ oldText: "a", newText: "b" }] }, "-8 a\n+8 b", true);

		expect(rows).toContain("  ├ +1 -1 at line 8");
		expect(rows).not.toContain("  │ Hunk 1/1 at line 8");
		expect(rows).not.toContain("  │ Edit 1/1 at line 8");
	});
});
