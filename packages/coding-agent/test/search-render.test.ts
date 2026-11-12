import type { TUI } from "@hyzek/toucan-tui";
import { beforeAll, describe, expect, test } from "vitest";
import { withBuiltInRenderers } from "../src/core/tools/renderers/index.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function fakeTui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

function row(name: "grep" | "find" | "ls", args: unknown, output: string, details?: unknown): string[] {
	const component = new ToolExecutionComponent(
		name,
		`${name}-row`,
		args,
		{},
		withBuiltInRenderers(name, undefined),
		fakeTui(),
		"/repo",
	);
	component.markExecutionStarted();
	component.updateResult({ content: [{ type: "text", text: output }], details, isError: false });
	return component.render(100).map((line) => stripAnsi(line).trimEnd());
}

describe("search and listing rows", () => {
	beforeAll(() => initTheme("dark"));

	test("grep reports its match count and expands to the matches", () => {
		const collapsed = row("grep", { pattern: "needle", path: "src" }, "src/a.ts:1: needle\nsrc/b.ts:2: needle");
		expect(collapsed.join("\n")).toContain('• Grep "needle" in src');
		expect(collapsed.join("\n")).toContain("2 matches");
		expect(collapsed.join("\n")).toContain("to expand");
		expect(collapsed.join("\n")).not.toContain("src/a.ts:1");

		const expanded = new ToolExecutionComponent(
			"grep",
			"grep-expanded",
			{ pattern: "needle", path: "src" },
			{},
			withBuiltInRenderers("grep", undefined),
			fakeTui(),
			"/repo",
		);
		expanded.markExecutionStarted();
		expanded.setExpanded(true);
		expanded.updateResult({
			content: [{ type: "text", text: "src/a.ts:1: needle\nsrc/b.ts:2: needle" }],
			isError: false,
		});
		expect(
			expanded
				.render(100)
				.map((line) => stripAnsi(line))
				.join("\n"),
		).toContain("src/a.ts:1");
	});

	test("grep says no matches instead of an empty row", () => {
		expect(row("grep", { pattern: "none", path: "src" }, "").join("\n")).toContain("no matches");
	});

	test("find reports its file count", () => {
		const lines = row("find", { pattern: "*.ts", path: "." }, "src/a.ts\nsrc/b.ts");
		expect(lines.join("\n")).toContain('• Find "*.ts" in .');
		expect(lines.join("\n")).toContain("2 files");
		expect(lines.join("\n")).not.toContain("src/a.ts");
	});

	test("find says no files found for the tool's empty result", () => {
		expect(row("find", { pattern: "*.zig", path: "." }, "No files found matching pattern").join("\n")).toContain(
			"no files found",
		);
	});

	test("ls reports its entry count and marks directories when expanded", () => {
		const collapsed = row("ls", { path: "src" }, "index.ts\ncomponents/");
		expect(collapsed.join("\n")).toContain("• Ls src");
		expect(collapsed.join("\n")).toContain("2 entries");

		const expanded = new ToolExecutionComponent(
			"ls",
			"ls-expanded",
			{ path: "src" },
			{},
			withBuiltInRenderers("ls", undefined),
			fakeTui(),
			"/repo",
		);
		expanded.markExecutionStarted();
		expanded.setExpanded(true);
		expanded.updateResult({ content: [{ type: "text", text: "index.ts\ncomponents/" }], isError: false });
		const text = expanded
			.render(100)
			.map((line) => stripAnsi(line))
			.join("\n");
		expect(text).toContain("components/");
		expect(text).toContain("index.ts");
	});

	test("ls says empty directory for the tool's empty result", () => {
		expect(row("ls", { path: "src" }, "(empty directory)").join("\n")).toContain("empty directory");
	});
});

describe("expanded search and listing limits", () => {
	beforeAll(() => initTheme("dark"));

	function expanded(name: "grep" | "find" | "ls", args: unknown, output: string): string {
		const component = new ToolExecutionComponent(
			name,
			`${name}-expanded-limit`,
			args,
			{},
			withBuiltInRenderers(name, undefined),
			fakeTui(),
			"/repo",
		);
		component.markExecutionStarted();
		component.setExpanded(true);
		component.updateResult({ content: [{ type: "text", text: output }], isError: false });
		return component
			.render(100)
			.map((line) => stripAnsi(line))
			.join("\n");
	}

	test("grep shows eight matches and names the rest", () => {
		const output = Array.from({ length: 10 }, (_, index) => `src/f${index}.ts:1: match`).join("\n");
		const text = expanded("grep", { pattern: "match", path: "src" }, output);
		expect(text).toContain("src/f7.ts");
		expect(text).not.toContain("src/f8.ts");
		expect(text).toContain("… 2 more matches");
	});

	test("find shows eight files with icons and names the rest", () => {
		const output = Array.from({ length: 10 }, (_, index) => `src/f${index}.ts`).join("\n");
		const text = expanded("find", { pattern: "*.ts", path: "." }, output);
		expect(text).toContain("\ue628");
		expect(text).toContain("src/f7.ts");
		expect(text).not.toContain("src/f8.ts");
		expect(text).toContain("… 2 more files");
	});

	test("ls shows eight entries with directory and file icons", () => {
		const output = `src/\nsrc/a.ts\nsrc/b.ts\nsrc/c.ts\nsrc/d.ts\nsrc/e.ts\nsrc/f.ts\nsrc/g.ts\nsrc/h.ts\nsrc/i.ts`;
		const text = expanded("ls", { path: "src" }, output);
		expect(text).toContain("\ue5ff");
		expect(text).toContain("\ue628");
		expect(text).toContain("src/g.ts");
		expect(text).not.toContain("src/h.ts");
		expect(text).toContain("… 2 more entries");
	});
});

describe("tool notice footers", () => {
	beforeAll(() => initTheme("dark"));

	test("grep treats the tool's no-match sentence as no matches", () => {
		const lines = row("grep", { pattern: "none", path: "src" }, "No matches found");
		expect(lines.join("\n")).toContain("no matches");
		expect(lines.join("\n")).not.toContain("1 matches");
	});

	test("grep does not count its own limit notice as a match", () => {
		const lines = row(
			"grep",
			{ pattern: "x", path: "src" },
			"src/a.ts:1: x\n\n[100 matches limit reached. Use limit=200 for more]",
			{ matchLimitReached: 100 },
		);
		expect(lines.join("\n")).toContain("1 matches");
		expect(lines.join("\n")).not.toContain("matches limit reached");
	});

	test("find does not count its own limit notice as a file", () => {
		const lines = row("find", { pattern: "*.ts", path: "." }, "src/a.ts\n\n[100 results limit reached]", {
			resultLimitReached: 100,
		});
		expect(lines.join("\n")).toContain("1 files");
		expect(lines.join("\n")).not.toContain("results limit reached");
	});

	test("ls does not count its own limit notice as an entry", () => {
		const lines = row("ls", { path: "." }, "src/\n\n[100 entries limit reached]", { entryLimitReached: 100 });
		expect(lines.join("\n")).toContain("1 entries");
		expect(lines.join("\n")).not.toContain("entries limit reached");
	});
});
