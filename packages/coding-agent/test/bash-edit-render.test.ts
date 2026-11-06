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
		expect(callLine("sed -i 's/one/two/' src/app.ts")).toBe("• edit (sed) src/app.ts");
		expect(callLine("echo hi > notes.txt")).toBe("• edit (echo) notes.txt");
	});

	it("keeps the command line for a command that is not a single-file edit", () => {
		expect(callLine("ls -1 | grep x")).toBe("• $ ls -1 | grep x");
	});

	it("renders the diff the command made instead of its output", () => {
		const lines = resultLines("sed -i 's/one/two/' src/app.ts", "-1 one\n+1 two");

		expect(lines).toEqual(["", "-1 one", "+1 two"]);
	});

	it("folds a long diff and names the expand key", () => {
		const diff = Array.from({ length: 40 }, (_, i) => `${i % 2 === 0 ? "-" : "+"}${i + 1} line ${i}`).join("\n");
		const folded = resultLines("sed -i 's/one/two/' src/app.ts", diff);

		expect(folded.filter((line) => /line \d+/.test(line))).toHaveLength(24);
		expect(folded.at(-1)).toContain("16 more lines (ctrl+o to expand)");
		expect(resultLines("sed -i 's/one/two/' src/app.ts", diff, true)).toHaveLength(41);
	});
});
