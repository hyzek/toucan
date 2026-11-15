// Info bar block text: what each block prints, and the states that hide it until they apply.

import type { Api, Model } from "@hyzek/toucan-ai";
import { beforeAll, describe, expect, it } from "vitest";
import type { FooterItemId } from "../src/core/footer-items.ts";
import type { UsageTotals } from "../src/core/usage-totals.ts";
import { type FooterRenderContext, renderFooterBlocks } from "../src/modes/interactive/components/footer-blocks.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function chatModel(options: { id: string; name?: string; reasoning?: boolean }): Model<Api> {
	return {
		id: options.id,
		name: options.name ?? options.id,
		provider: "test",
		reasoning: options.reasoning ?? false,
	} as unknown as Model<Api>;
}

function usage(overrides: Partial<UsageTotals> = {}): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, ...overrides };
}

function context(overrides: Partial<FooterRenderContext> = {}): FooterRenderContext {
	return {
		model: chatModel({ id: "test-model" }),
		thinkingLevel: "off",
		routedModel: undefined,
		sessionName: "",
		directory: "~/project",
		gitBranch: null,
		usage: usage(),
		contextTokens: undefined,
		contextPercent: undefined,
		cacheHitPercent: undefined,
		...overrides,
	};
}

function render(items: readonly FooterItemId[], overrides: Partial<FooterRenderContext> = {}): string[] {
	return renderFooterBlocks(items, context(overrides)).map(stripAnsi);
}

describe("renderFooterBlocks", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("prints the blocks in the order it is given", () => {
		expect(render(["directory", "model", "session"], { sessionName: "work" })).toEqual([
			"~/project",
			"test-model",
			"work",
		]);
	});

	it("contributes nothing for a hidden block, so no separator is left behind", () => {
		expect(render(["model", "session", "branch", "cost"])).toEqual(["test-model"]);
	});

	it("shows the model without an id when the catalog names it", () => {
		expect(render(["model"], { model: chatModel({ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }) })).toEqual([
			"Claude Sonnet 4.5",
		]);
	});

	it("shows the physical model a virtual model routed to, with the level it routed at", () => {
		expect(
			render(["model"], {
				model: chatModel({ id: "auto", reasoning: true }),
				routedModel: { model: chatModel({ id: "gpt-5.6-luna", name: "GPT-5.6 Luna" }), thinkingLevel: "medium" },
			}),
		).toEqual(["auto \u2192 GPT-5.6 Luna \u00b7 medium"]);
	});

	it("says so when there is no model at all", () => {
		expect(render(["model"], { model: undefined })).toEqual(["no-model"]);
	});

	it("shows the api id as its own block", () => {
		expect(
			render(["model-id"], { model: chatModel({ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }) }),
		).toEqual(["claude-sonnet-4-5"]);
	});

	it("hides the thinking level for a model that cannot reason", () => {
		expect(render(["thinking"], { thinkingLevel: "high" })).toEqual([]);
	});

	it("spells out off so the block never reads as a missing value", () => {
		expect(render(["thinking"], { model: chatModel({ id: "r", reasoning: true }) })).toEqual(["thinking off"]);
	});

	it("prints the level for a model that can reason", () => {
		expect(render(["thinking"], { model: chatModel({ id: "r", reasoning: true }), thinkingLevel: "xhigh" })).toEqual([
			"xhigh",
		]);
	});

	it("shows the branch only inside a repository", () => {
		expect(render(["branch"], { gitBranch: "feature/info-bar" })).toEqual(["feature/info-bar"]);
		expect(render(["branch"], { gitBranch: "detached" })).toEqual(["detached"]);
		expect(render(["branch"], { gitBranch: null })).toEqual([]);
	});

	it("shows how much context is in use and how full the window is", () => {
		expect(render(["context"], { contextTokens: 134_800, contextPercent: 70 })).toEqual(["134.8K (70%)"]);
		expect(render(["context"], { contextTokens: 6000, contextPercent: 3 })).toEqual(["6K (3%)"]);
		expect(render(["context"], { contextTokens: 1_234_567, contextPercent: 62 })).toEqual(["1.2M (62%)"]);
	});

	it("turns the context block yellow as the window fills and red near the limit", () => {
		const raw = (contextPercent: number) =>
			renderFooterBlocks(["context"], context({ contextTokens: 100_000, contextPercent }))[0]!;
		// Compared against the theme's own wrapping, so the assertion holds whether or not this
		// run emits escape codes.
		expect(raw(69)).toBe("100K (69%)");
		expect(raw(70)).toBe(theme.fg("warning", "100K (70%)"));
		expect(raw(84)).toBe(theme.fg("warning", "100K (84%)"));
		expect(raw(85)).toBe(theme.fg("error", "100K (85%)"));
		expect(raw(99)).toBe(theme.fg("error", "100K (99%)"));
	});

	it("colors the context block alone; every other block prints plain for the bar's dim color", () => {
		const segments = renderFooterBlocks(
			["directory", "branch", "tokens", "cache", "cost"],
			context({
				gitBranch: "main",
				usage: usage({ input: 9000, output: 640, cost: 0.42 }),
				cacheHitPercent: 87,
			}),
		);
		expect(segments.map(stripAnsi)).toEqual(["~/project", "main", "\u21919K \u2193640", "87%", "$0.42"]);
		for (const segment of segments) expect(segment).toBe(stripAnsi(segment));
	});

	it("hides the context block until the estimate has a number in it", () => {
		expect(render(["context"], { contextTokens: 0, contextPercent: 0 })).toEqual([]);
		expect(render(["context"], { contextTokens: undefined, contextPercent: 43 })).toEqual([]);
		expect(render(["context"], { contextTokens: 9000, contextPercent: undefined })).toEqual([]);
	});

	it("shows what was sent and what came back as one block", () => {
		expect(render(["tokens"], { usage: usage({ input: 3000, cacheRead: 100_000, cacheWrite: 1000 }) })).toEqual([
			"\u2191104K",
		]);
		expect(render(["tokens"], { usage: usage({ input: 9000, output: 640 }) })).toEqual(["\u21919K \u2193640"]);
		expect(render(["tokens"], { usage: usage({ output: 640 }) })).toEqual(["\u2193640"]);
		expect(render(["tokens"], { usage: usage() })).toEqual([]);
	});

	it("shows the cache share and hides it before anything was billed", () => {
		expect(render(["cache"], { cacheHitPercent: 87 })).toEqual(["87%"]);
		expect(render(["cache"], { cacheHitPercent: 0 })).toEqual(["0%"]);
		expect(render(["cache"], { cacheHitPercent: undefined })).toEqual([]);
	});

	it("prints cost with cents under a hundred dollars and whole dollars above", () => {
		expect(render(["cost"], { usage: usage({ cost: 0.42 }) })).toEqual(["$0.42"]);
		expect(render(["cost"], { usage: usage({ cost: 123.4 }) })).toEqual(["$123"]);
		expect(render(["cost"], { usage: usage({ input: 1000 }) })).toEqual([]);
	});
});
