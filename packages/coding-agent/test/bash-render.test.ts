import { beforeAll, describe, expect, it } from "vitest";
import type { ToolDefinition, ToolRenderContext } from "../src/core/extensions/types.ts";
import { createBashToolDefinition } from "../src/core/tools/bash.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const tool = createBashToolDefinition("/repo") as Required<Pick<ToolDefinition, "renderCall" | "renderResult">>;

function context(overrides: Partial<ToolRenderContext> = {}): ToolRenderContext {
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
		durationMs: 1_500,
		outputPad: 0,
		rowMarkerShown: true,
		keyText: () => "ctrl+o",
		keyHint: (_keybinding, description) => `ctrl+o ${description}`,
		...overrides,
	};
}

function callLines(command: string, width = 100, overrides: Partial<ToolRenderContext> = {}): string[] {
	const component = tool.renderCall({ command }, theme, context(overrides));
	return component.render(width).map((line) => stripAnsi(line).trimEnd());
}

function resultLines(
	command: string,
	output: string,
	overrides: Partial<ToolRenderContext> = {},
	expanded = false,
): string[] {
	const callContext = context({ args: { command }, ...overrides });
	const component = tool.renderResult(
		{ content: [{ type: "text", text: output }], details: {} },
		{ expanded, isPartial: overrides.isPartial ?? false },
		theme,
		callContext,
	);
	return component.render(100).map((line) => stripAnsi(line).trimEnd());
}

describe("bash tool row", () => {
	beforeAll(() => initTheme("dark"));

	it("shows a one-line command headline with the duration on the right", () => {
		const [line] = callLines("cd /repo && git status --short --branch --untracked-files=all --ignored", 80);
		expect(line).toContain("• Bash cd /repo && git status");
		expect(line).toContain("...");
		expect(line).toContain("· 1.5s");
	});

	it("summarizes a multi-line script and skips setup lines", () => {
		const [line] = callLines("cd /repo\nset -e\nnpm test\n");
		expect(line).toContain("• Bash npm test · 3 lines");
	});

	it("shows the command under the row when expanded, continuing into the result", () => {
		const lines = callLines("echo one\necho two", 80, { expanded: true });
		expect(lines[0]).toMatch(/^• Bash echo one · 2 lines +· 1\.5s$/);
		expect(lines.slice(1)).toEqual(["  ├ echo one", "  │ echo two"]);
	});

	it("previews the first ten output lines with the count and the expand key", () => {
		const output = Array.from({ length: 13 }, (_, index) => `line-${index + 1}`).join("\n");
		const lines = resultLines("generate output", output);

		expect(lines[0]).toBe("  ├ Done (13 lines) (ctrl+o to expand)");
		expect(lines[1]).toBe("  │ line-1");
		expect(lines[10]).toBe("  │ line-10");
		expect(lines[11]).toBe("  └ ... (3 more lines)");
		expect(lines.join("\n")).not.toContain("earlier lines");
	});

	it("shows every output line and collapses with ctrl+o", () => {
		const lines = resultLines("generate output", "one\ntwo", {}, true);
		expect(lines).toEqual(["  ├ Done (2 lines) (ctrl+o to collapse)", "  │ one", "  └ two"]);
	});

	it("names the exit code and does not print it as output", () => {
		const lines = resultLines("false", "boom\nCommand exited with code 2", { isError: true });
		expect(lines).toEqual(["  ├ Exit 2 (ctrl+o to expand)", "  └ boom"]);
	});

	it("reports a command with no output without a placeholder line", () => {
		expect(resultLines("true", "(no output)")).toEqual(["  └ Done (0 lines) (ctrl+o to expand)"]);
	});
});
