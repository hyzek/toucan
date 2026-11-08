import { beforeAll, describe, expect, it } from "vitest";
import type { ToolDefinition, ToolRenderContext } from "../src/core/extensions/types.ts";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

// The write definition always provides both renderers; the tool type marks them optional for tools
// that use the default display.
const tool = createWriteToolDefinition("/repo") as Required<Pick<ToolDefinition, "renderCall" | "renderResult">>;

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

function callLines(args: { path?: string; content?: string }, streaming = false): string[] {
	const context = renderContext(streaming ? { args, argsComplete: false, isPartial: true } : { args });
	const component = tool.renderCall(args, theme, context);
	return component.render(80).map((line) => stripAnsi(line).trimEnd());
}

function resultLines(diff: string | undefined, overrides: { unchanged?: boolean } = {}, expanded = false): string[] {
	const args = { path: "/repo/src/app.ts", content: "x" };
	const context = renderContext({ args, expanded });
	const component = tool.renderResult(
		{
			content: [{ type: "text", text: "Successfully wrote to src/app.ts" }],
			details: { path: "/repo/src/app.ts", diff, firstChangedLine: diff ? 1 : undefined, ...overrides },
		},
		{ expanded, isPartial: false },
		theme,
		context,
	);
	return component.render(80).map((line) => stripAnsi(line).trimEnd());
}

describe("write tool rendering", () => {
	beforeAll(() => initTheme("dark"));

	it("previews the content only while the call is still streaming", () => {
		const streaming = callLines({ path: "/repo/new.ts", content: "hello\nworld" }, true);
		expect(streaming[0]).toBe("• Write /repo/new.ts");
		expect(streaming).toContain("hello");
		expect(streaming).toContain("world");

		// Once the call is complete the content preview is gone; the change block tells the story.
		expect(callLines({ path: "/repo/new.ts", content: "hello\nworld" })).toEqual(["• Write /repo/new.ts"]);

		// A replayed row has no final streaming state; it shows the header and the block, not both bodies.
		const replay = tool.renderCall(
			{ path: "/repo/new.ts", content: "hello\nworld" },
			theme,
			renderContext({ args: { path: "/repo/new.ts", content: "hello\nworld" }, argsComplete: false }),
		);
		expect(replay.render(80).map((line) => stripAnsi(line).trimEnd())).toEqual(["• Write /repo/new.ts"]);
	});

	it("states the change under the row, then the diff, joined by a guide", () => {
		const lines = resultLines("-1 one\n+1 two");

		expect(lines[0]).toBe("  ├ +1 -1 at line 1");
		expect(lines[1]).toBe(`  │ ${"\u2500".repeat(76)}`);
		expect(lines[2]).toBe("  │ ▌1- │ one");
		expect(lines[3]).toBe("  │ ▌1+ │ two");
		expect(lines.at(-1)).toBe(`  └ ${"\u2500".repeat(76)}`);
	});

	it("shows an all-added diff for a new file", () => {
		const lines = resultLines("+1 created\n+2 lines");

		expect(lines[0]).toBe("  ├ +2 at line 1");
		expect(lines[2]).toBe("  │ ▌1+ │ created");
		expect(lines[3]).toBe("  │ ▌2+ │ lines");
	});

	it("says so when the write left the file unchanged", () => {
		expect(resultLines(undefined, { unchanged: true })).toEqual(["  └ no change"]);
	});

	it("shows nothing extra when the file could not be diffed", () => {
		const args = { path: "/repo/src/app.ts", content: "x" };
		const component = tool.renderResult(
			{ content: [{ type: "text", text: "ok" }], details: { path: "/repo/src/app.ts" } },
			{ expanded: false, isPartial: false },
			theme,
			renderContext({ args }),
		);
		expect(component.render(80)).toEqual([]);
	});

	it("keeps the error text under a failed write", () => {
		const args = { path: "/repo/src/app.ts", content: "x" };
		const component = tool.renderResult(
			{ content: [{ type: "text", text: "EACCES: permission denied" }], details: undefined },
			{ expanded: false, isPartial: false },
			theme,
			renderContext({ args, isError: true }),
		);
		expect(component.render(80).map((line) => stripAnsi(line).trimEnd())).toEqual(["", "EACCES: permission denied"]);
	});
});
