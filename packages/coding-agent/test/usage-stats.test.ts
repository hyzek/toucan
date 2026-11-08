import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Usage } from "@hyzek/toucan-ai";
import { describe, expect, it } from "vitest";
import { collectUsageReport, dayKey, recentDayKeys, totalTokens } from "../src/core/usage-stats.ts";

function usage(input: number, output: number, cost: number): Usage {
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}

/** Timestamp at local noon on the given local day, so it always lands on that day. */
function noon(day: string): string {
	const [year, month, date] = day.split("-").map(Number) as [number, number, number];
	return new Date(year, month - 1, date, 12, 0, 0).toISOString();
}

function assistantEntry(day: string, provider: string, model: string, u: Usage, responseModel?: string): string {
	return JSON.stringify({
		type: "message",
		id: `m-${day}-${model}`,
		parentId: null,
		timestamp: noon(day),
		message: { role: "assistant", provider, model, ...(responseModel ? { responseModel } : {}), usage: u },
	});
}

function writeSessionDir(name: string, lines: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), `usage-stats-${name}-`));
	const file = join(dir, "session.jsonl");
	writeFileSync(file, `${lines.join("\n")}\n`);
	return file;
}

describe("usage day keys", () => {
	it("formats local calendar days", () => {
		// Constructed in local time: the key must follow the machine's calendar, not UTC.
		expect(dayKey(new Date(2026, 10, 6, 0, 0, 0))).toBe("2026-11-06");
		expect(dayKey(new Date(2026, 10, 6, 23, 59, 59))).toBe("2026-11-06");
	});

	it("returns the last N days ending today, oldest first", () => {
		const now = new Date(2026, 10, 7, 12);
		expect(recentDayKeys(3, now)).toEqual(["2026-11-05", "2026-11-06", "2026-11-07"]);
	});
});

describe("collectUsageReport", () => {
	const days = ["2026-11-06", "2026-11-07"];

	it("sums usage across files into totals and per-day buckets, zero-filling quiet days", async () => {
		const fileA = writeSessionDir("a", [
			assistantEntry("2026-11-06", "anthropic", "claude-x", usage(100, 50, 1.5)),
			JSON.stringify({
				type: "model_change",
				id: "c1",
				parentId: null,
				timestamp: noon("2026-11-06"),
				provider: "anthropic",
				modelId: "claude-x",
			}),
		]);
		const fileB = writeSessionDir("b", [assistantEntry("2026-11-07", "openai", "gpt-y", usage(10, 5, 0.25))]);

		const report = await collectUsageReport([fileA, fileB], days);

		expect(report.sessions).toBe(2);
		expect(totalTokens(report.totals)).toBe(165);
		expect(report.totals.cost).toBeCloseTo(1.75);
		expect(report.byDay).toEqual([
			{ day: "2026-11-06", tokens: 150, cost: 1.5 },
			{ day: "2026-11-07", tokens: 15, cost: 0.25 },
		]);
	});

	it("counts entries outside the tracked days toward totals only", async () => {
		const file = writeSessionDir("outside", [
			assistantEntry("2026-10-01", "anthropic", "claude-x", usage(100, 100, 2)),
		]);

		const report = await collectUsageReport([file], days);

		expect(totalTokens(report.totals)).toBe(200);
		expect(report.byDay.map((d) => d.tokens)).toEqual([0, 0]);
	});

	it("attributes usage to the response model when present, and sorts models by cost", async () => {
		const file = writeSessionDir("models", [
			assistantEntry("2026-11-06", "openrouter", "auto", usage(1000, 100, 5), "anthropic/claude-x"),
			assistantEntry("2026-11-07", "openai", "gpt-y", usage(10, 10, 0.1)),
			JSON.stringify({
				type: "compaction",
				id: "k1",
				parentId: null,
				timestamp: noon("2026-11-07"),
				summary: "s",
				firstKeptEntryId: "m",
				tokensBefore: 10,
				usage: usage(5, 5, 0.2),
			}),
		]);

		const report = await collectUsageReport([file], days);

		expect(report.byModel.map((m) => m.model)).toEqual([
			"openrouter/anthropic/claude-x",
			"Tools/summaries",
			"openai/gpt-y",
		]);
		expect(report.byModel[0]!.input).toBe(1000);
	});

	it("includes cache warm usage entries", async () => {
		const file = writeSessionDir("warm", [
			JSON.stringify({
				type: "usage",
				id: "u1",
				parentId: null,
				timestamp: noon("2026-11-06"),
				kind: "cache_warm",
				provider: "anthropic",
				model: "claude-x",
				usage: usage(700, 1, 0.5),
			}),
		]);

		const report = await collectUsageReport([file], days);

		expect(totalTokens(report.totals)).toBe(701);
		expect(report.byDay[0]!.tokens).toBe(701);
	});

	it("skips corrupt lines and unreadable files", async () => {
		const file = writeSessionDir("corrupt", [
			"{ not json",
			assistantEntry("2026-11-06", "anthropic", "claude-x", usage(1, 1, 0.01)),
		]);

		const report = await collectUsageReport([join(tmpdir(), "definitely-missing.jsonl"), file], days);

		expect(totalTokens(report.totals)).toBe(2);
		expect(report.totals.cost).toBeCloseTo(0.01);
	});

	it("returns empty report shapes when there are no files", async () => {
		const report = await collectUsageReport([], days);

		expect(report.totals).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
		expect(report.byDay).toEqual([
			{ day: "2026-11-06", tokens: 0, cost: 0 },
			{ day: "2026-11-07", tokens: 0, cost: 0 },
		]);
	});
});
