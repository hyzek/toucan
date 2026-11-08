import type { TUI, TuiMouseEvent } from "@hyzek/toucan-tui";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { withBuiltInRenderers } from "../src/core/tools/renderers/index.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { ToolGroupComponent } from "../src/modes/interactive/components/tool-group.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

let renders = 0;

function fakeTui(): TUI {
	return {
		requestRender: () => {
			renders += 1;
		},
	} as unknown as TUI;
}

function toolRow(name: "read" | "bash" | "ls", id: string, args: unknown): ToolExecutionComponent {
	return new ToolExecutionComponent(
		name,
		id,
		args,
		{},
		withBuiltInRenderers(name, undefined),
		fakeTui(),
		process.cwd(),
	);
}

/** Rendered, non-blank lines with the row padding and colors removed. */
function render(group: ToolGroupComponent, width = 100): string[] {
	return group
		.render(width)
		.map((line) => stripAnsi(line).trim())
		.filter((line) => line !== "");
}

function settle(row: ToolExecutionComponent, isError = false): void {
	row.markExecutionStarted();
	row.updateResult({ content: [{ type: "text", text: "ok" }], isError });
}

describe("ToolGroupComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	test("a single call renders its own row, not a sentence", () => {
		const group = new ToolGroupComponent(fakeTui());
		const read = toolRow("read", "r1", { path: "package.json" });
		settle(read);
		group.addTool(read);

		expect(render(group)).toEqual(["• Read package.json", "└ 1 lines loaded ( to expand)"]);
	});

	test("two finished calls say one sentence and hide their rows", () => {
		const group = new ToolGroupComponent(fakeTui());
		const read = toolRow("read", "r1", { path: "package.json" });
		const ls = toolRow("ls", "l1", { path: "." });
		settle(read);
		settle(ls);
		group.addTool(read);
		group.addTool(ls);

		const lines = render(group);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("• Read 1 file, listed 1 directory");
		expect(lines[0]).toContain("to expand");
	});

	test("a running call keeps its row under the sentence, without its own marker", () => {
		const group = new ToolGroupComponent(fakeTui());
		const read = toolRow("read", "r1", { path: "package.json" });
		const bash = toolRow("bash", "b1", { command: "sleep 5" });
		settle(read);
		group.addTool(read);
		group.addTool(bash);
		bash.markExecutionStarted();

		const lines = render(group);
		expect(lines[0]).toContain("Reading 1 file, running 1 shell command…");
		expect(lines[1]).toBe("$ sleep 5");
	});

	test("counts failures onto the sentence", () => {
		const group = new ToolGroupComponent(fakeTui());
		const first = toolRow("bash", "b1", { command: "ls" });
		const second = toolRow("bash", "b2", { command: "false" });
		settle(first);
		settle(second, true);
		group.addTool(first);
		group.addTool(second);

		expect(render(group)[0]).toContain("Ran 2 shell commands · 1 failed");
	});

	test("expanding shows every row again, each with its own marker", () => {
		const group = new ToolGroupComponent(fakeTui());
		const read = toolRow("read", "r1", { path: "package.json" });
		const ls = toolRow("ls", "l1", { path: "." });
		settle(read);
		settle(ls);
		group.addTool(read);
		group.addTool(ls);

		group.setExpanded(true);
		const lines = render(group);
		expect(lines[0]).toContain("to collapse");
		expect(lines).toContain("• Read package.json");
		expect(lines).toContain("• Ls .");

		group.setExpanded(false);
		expect(render(group)).toHaveLength(1);
	});

	test("clicking the sentence expands the group", () => {
		const group = new ToolGroupComponent(fakeTui());
		const read = toolRow("read", "r1", { path: "package.json" });
		const ls = toolRow("ls", "l1", { path: "." });
		settle(read);
		settle(ls);
		group.addTool(read);
		group.addTool(ls);

		const event = { type: "click", button: "left", x: 2, y: 0, width: 100, height: 3 } as TuiMouseEvent;
		group.handleMouse(event);

		const lines = render(group);
		expect(lines).toContain("• Read package.json");
		expect(lines).toContain("• Ls .");
	});

	test("ticks the elapsed tail while calls run and stops once they settle", () => {
		vi.useFakeTimers();
		const group = new ToolGroupComponent(fakeTui());
		const ls = toolRow("ls", "l1", { path: "." });
		const bash = toolRow("bash", "b1", { command: "sleep 5" });
		group.addTool(ls);
		group.addTool(bash);
		bash.markExecutionStarted();

		expect(render(group)[0]).toContain("· 0s");
		vi.advanceTimersByTime(2000);
		expect(render(group)[0]).toContain("· 2s");

		settle(bash);
		settle(ls);
		group.refresh();
		const ticksAfterSettling = renders;
		vi.advanceTimersByTime(5000);
		expect(renders).toBe(ticksAfterSettling);
		expect(render(group)[0]).toContain("Listed 1 directory, ran 1 shell command");
	});
});
