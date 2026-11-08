import { beforeAll, describe, expect, it } from "vitest";
import type { ToolDefinition, ToolRenderContext } from "../src/core/extensions/types.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const tool = createReadToolDefinition("/repo") as Required<Pick<ToolDefinition, "renderCall" | "renderResult">>;

function renderContext(overrides: Partial<ToolRenderContext> = {}): ToolRenderContext {
	return {
		args: {},
		state: {},
		lastComponent: undefined,
		invalidate: () => {},
		toolCallId: "call-1",
		cwd: "/repo",
		executionStarted: true,
		argsComplete: true,
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

function resultLines(text: string, expanded = false): string[] {
	const args = { path: "/repo/notes.md" };
	const component = tool.renderResult(
		{ content: [{ type: "text", text }], details: undefined },
		{ expanded, isPartial: false },
		theme,
		renderContext({ args, expanded }),
	);
	return component.render(80).map((line) => stripAnsi(line).trimEnd());
}

describe("read tool rendering", () => {
	beforeAll(() => initTheme("dark"));

	it("says what it loaded under the row, joined by a guide, naming the expand key", () => {
		expect(resultLines("one\ntwo\nthree")).toEqual(["  └ 3 lines loaded (ctrl+o to expand)"]);
	});

	it("shows the content under the same guide once expanded", () => {
		const lines = resultLines("one\ntwo\nthree", true);
		expect(lines[0]).toBe("  ├ 3 lines loaded");
		expect(lines[1]).toBe("  │ one");
		expect(lines[2]).toBe("  │ two");
		expect(lines[3]).toBe("  └ three");
	});

	it("marks a truncated read on the summary line", () => {
		const args = { path: "/repo/notes.md" };
		const component = tool.renderResult(
			{
				content: [{ type: "text", text: "one\ntwo" }],
				details: {
					truncation: { truncated: true, truncatedBy: "lines", outputLines: 2, totalLines: 9, maxLines: 2 },
				},
			},
			{ expanded: false, isPartial: false },
			theme,
			renderContext({ args }),
		);
		expect(component.render(80).map((line) => stripAnsi(line).trimEnd())).toEqual([
			"  └ 2 lines loaded (truncated) (ctrl+o to expand)",
		]);
	});
});
