import { describe, expect, it } from "vitest";
import { buildBashCommandPresentation } from "../src/core/tools/renderers/bash-command.ts";

describe("buildBashCommandPresentation", () => {
	it("skips setup lines and names the operative one", () => {
		expect(buildBashCommandPresentation("cd repo\nset -e\nexport A=1\nnpm test").headline).toBe("npm test · 4 lines");
	});

	it("collapses a single long command to one middle-truncated line", () => {
		const command = `${"a".repeat(300)} middle ${"b".repeat(300)}`;
		const headline = buildBashCommandPresentation(command).headline;
		expect(headline).toHaveLength(180);
		expect(headline).toContain("...");
		expect(headline.startsWith("a")).toBe(true);
		expect(headline.endsWith("b")).toBe(true);
	});

	it("strips terminal escapes and control characters", () => {
		expect(buildBashCommandPresentation("\u001b[31mls\u001b[0m\u0007").headline).toBe("ls");
	});

	it("falls back to a placeholder for an empty command", () => {
		expect(buildBashCommandPresentation("").headline).toBe("command");
	});
});
