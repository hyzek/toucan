import { beforeAll, describe, expect, it } from "vitest";
import { ToolCallLine } from "../src/modes/interactive/components/tool-call-line.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function line(component: ToolCallLine, width: number): string {
	return stripAnsi(component.render(width).join("\n")).trimEnd();
}

describe("ToolCallLine", () => {
	beforeAll(() => initTheme("dark"));

	it("keeps the trailing value visible when the left side must be cut", () => {
		const rendered = line(new ToolCallLine("a very long tool call header", "· 1.5s"), 20);
		expect(rendered).toContain("...");
		expect(rendered.endsWith("· 1.5s")).toBe(true);
	});

	it("right-aligns the trailing value", () => {
		const rendered = line(new ToolCallLine("Bash npm test", "· 1.5s"), 30);
		expect(rendered).toBe(`${"Bash npm test".padEnd(24)}· 1.5s`);
	});

	it("truncates a line without a trailing value", () => {
		expect(line(new ToolCallLine("x".repeat(50)), 10)).toBe("xxxxxxx...");
	});
});
