import { beforeAll, describe, expect, it } from "vitest";
import { getToolRowStatus, type ToolRowContext, toolRowCallLine } from "../src/core/tools/render-utils.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const row = (status: "pending" | "done" | "failed"): ToolRowContext => ({
	isPartial: status === "pending",
	isError: status === "failed",
	rowMarkerShown: true,
});

describe("tool row marker", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("reads the state from the render context", () => {
		expect(getToolRowStatus(row("pending"))).toBe("pending");
		expect(getToolRowStatus(row("done"))).toBe("done");
		expect(getToolRowStatus(row("failed"))).toBe("failed");
	});

	it("leads the call line with the marker and a space", () => {
		expect(stripAnsi(toolRowCallLine("read src/app.ts", row("done"), theme))).toBe("• read src/app.ts");
	});

	it("colors the marker by state", () => {
		const colors = { pending: "dim", done: "success", failed: "error" } as const;
		for (const status of ["pending", "done", "failed"] as const) {
			const marker = theme.fg(colors[status], "•");
			expect(toolRowCallLine("bash ls", row(status), theme).startsWith(`${marker} `)).toBe(true);
		}
	});

	it("leaves the header alone for a row whose marker belongs to its group", () => {
		const grouped: ToolRowContext = { isPartial: false, isError: false, rowMarkerShown: false };
		expect(toolRowCallLine("read src/app.ts", grouped, theme)).toBe("read src/app.ts");
	});
});
