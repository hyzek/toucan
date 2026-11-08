import { setKeybindings } from "@hyzek/toucan-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { UsageReport } from "../src/core/usage-stats.ts";
import { type StatsReport, StatsSelectorComponent } from "../src/modes/interactive/components/stats-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function report(sessions: number, totalTokens: number, dayTokens: number[]): UsageReport {
	return {
		sessions,
		totals: { input: totalTokens, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		byDay: dayTokens.map((tokens, i) => ({ day: `2026-11-0${i + 1}`, tokens, cost: 0 })),
		byModel: [],
	};
}

function sampleStats(): StatsReport {
	return {
		global: report(1284, 1_900_000, [0, 0, 0, 0, 1_300_000, 0, 647_000]),
		project: report(57, 1_800_000, [0, 0, 0, 0, 1_100_000, 0, 647_000]),
		projectDir: "~/Desktop/dev/toucan",
	};
}

describe("stats selector", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("shows a loading line until the report arrives", () => {
		const selector = new StatsSelectorComponent(() => {});
		expect(stripAnsi(selector.render(100).join("\n"))).toContain("Computing usage");
	});

	it("shows bold token counts for both scopes with their labels", () => {
		const selector = new StatsSelectorComponent(() => {});
		selector.setReport(sampleStats());

		const text = stripAnsi(selector.render(100).join("\n"));

		expect(text).toContain("This project · ~/Desktop/dev/toucan");
		expect(text).toContain("All sessions on this machine");
		expect(text).toContain("1.8M tokens");
		expect(text).toContain("1.9M tokens");
	});

	it("shows a 7-day strip with one abbreviated number per weekday, no costs", () => {
		const selector = new StatsSelectorComponent(() => {});
		selector.setReport(sampleStats());

		const lines = stripAnsi(selector.render(100).join("\n")).split("\n");
		const header = lines.find((line) => line.includes("Mon") && line.includes("Sun"))!;
		const projectRow = lines.find((line) => /^\s+project\s/.test(line))!;
		const allRow = lines.find((line) => /^\s+all\s/.test(line))!;

		for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
			expect(header).toContain(day);
		}
		expect(projectRow).toContain("1.1M");
		expect(projectRow).toContain("647k");
		expect(allRow).toContain("1.3M");
		// Quiet days mark with a dot instead of a number, and no money anywhere.
		expect(projectRow).toContain("·");
		expect(lines.join("\n")).not.toContain("$");
	});

	it("closes on the cancel keybinding", () => {
		const onCancel = vi.fn();
		const selector = new StatsSelectorComponent(onCancel);

		selector.handleInput("\x1b");
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("shows an error line when the scan fails", () => {
		const selector = new StatsSelectorComponent(() => {});
		selector.setError("disk on fire");
		expect(stripAnsi(selector.render(100).join("\n"))).toContain("Could not compute usage: disk on fire");
	});
});
