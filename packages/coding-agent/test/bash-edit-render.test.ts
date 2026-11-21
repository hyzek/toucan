import { beforeAll, describe, expect, it } from "vitest";
import type { ToolDefinition, ToolRenderContext } from "../src/core/extensions/types.ts";
import { createBashToolDefinition } from "../src/core/tools/bash.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

// The bash definition always provides both renderers; the tool type marks them optional for tools
// that use the default display.
const tool = createBashToolDefinition("/repo") as Required<Pick<ToolDefinition, "renderCall" | "renderResult">>;

function renderContext(overrides: Partial<ToolRenderContext> = {}): ToolRenderContext {
	return {
		args: {},
		state: {},
		lastComponent: undefined,
		invalidate: () => {},
		toolCallId: "call-1",
		cwd: "/repo",
		executionStarted: false,
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

function callLine(command: string): string {
	const component = tool.renderCall({ command }, theme, renderContext());
	return stripAnsi(component.render(80).join("\n")).trimEnd();
}

function resultLines(command: string, diff: string, expanded = false): string[] {
	const context = renderContext({ args: { command }, expanded });
	const component = tool.renderResult(
		{
			content: [{ type: "text", text: "" }],
			details: { fileEdit: { tool: "sed", path: "/repo/src/app.ts", diff, firstChangedLine: 1 } },
		},
		{ expanded, isPartial: false },
		theme,
		context,
	);
	return component.render(80).map((line) => stripAnsi(line).trimEnd());
}

describe("bash tool rendering of file edits", () => {
	beforeAll(() => initTheme("dark"));

	it("leads the row with the edit a single-file command makes", () => {
		expect(callLine("sed -i 's/one/two/' src/app.ts")).toContain("sed -i 's/one/two/' src/app.ts");
		expect(callLine("echo hi > notes.txt")).toContain("echo hi > notes.txt");
	});

	it("keeps the command line for a command that is not a single-file edit", () => {
		expect(callLine("ls -1 | grep x")).toBe("• Bash ls -1 | grep x");
	});

	it("states the change under the row, then the diff, joined by a guide", () => {
		const lines = resultLines("sed -i 's/one/two/' src/app.ts", "-1 one\n+1 two");

		expect(lines[0]).toBe("  ├ +1 -1 at line 1");
		expect(lines[1]).toBe(`  │ ${"\u2500".repeat(76)}`);
		expect(lines[2]).toBe("  │ ▌1- │ one");
		expect(lines[3]).toBe("  │ ▌1+ │ two");
		expect(lines.at(-1)).toBe(`  └ ${"\u2500".repeat(76)}`);
	});

	it("says so when the file the command writes did not change", () => {
		const context = renderContext({ args: { command: "echo hi > notes.txt" } });
		const component = tool.renderResult(
			{ content: [{ type: "text", text: "(no output)" }], details: undefined },
			{ expanded: false, isPartial: false },
			theme,
			context,
		);

		expect(component.render(80).map((line) => stripAnsi(line).trimEnd())).toEqual(["  └ no change"]);
	});

	it("keeps the plain output of a command that is not an edit", () => {
		const context = renderContext({ args: { command: "ls -1" } });
		const component = tool.renderResult(
			{ content: [{ type: "text", text: "(no output)" }], details: undefined },
			{ expanded: false, isPartial: false },
			theme,
			context,
		);

		expect(component.render(80).map((line) => stripAnsi(line).trimEnd())).toEqual([
			"  └ Done (0 lines) (ctrl+o to expand)",
		]);
	});

	it("folds a long diff and names the expand key", () => {
		const diff = Array.from({ length: 40 }, (_, i) => `${i % 2 === 0 ? "-" : "+"}${i + 1} line ${i}`).join("\n");
		const folded = resultLines("sed -i 's/one/two/' src/app.ts", diff);

		expect(folded.filter((line) => line.includes("▌"))).toHaveLength(24);
		expect(folded.at(-1)).toContain("16 more diff lines (ctrl+o to expand)");
		expect(resultLines("sed -i 's/one/two/' src/app.ts", diff, true)).toHaveLength(43);
	});
});
