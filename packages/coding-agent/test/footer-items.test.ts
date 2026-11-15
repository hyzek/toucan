// The info bar block catalogue: which blocks exist, what a fresh install shows, and how a
// hand-written `footer.items` list in settings.json is read.

import { describe, expect, it } from "vitest";
import {
	FOOTER_ITEM_IDS,
	FOOTER_ITEM_TEXT,
	FOOTER_ITEMS_DEFAULT,
	type FooterItemId,
	footerItemsSummary,
	isFooterItemId,
	resolveFooterItems,
} from "../src/core/footer-items.ts";

describe("FOOTER_ITEMS_DEFAULT", () => {
	it("is the model, its effort, and the directory", () => {
		expect([...FOOTER_ITEMS_DEFAULT]).toEqual(["model", "thinking", "directory"]);
	});

	it("only lists blocks the catalogue has text for", () => {
		for (const id of FOOTER_ITEMS_DEFAULT) {
			expect(FOOTER_ITEM_IDS).toContain(id);
			expect(FOOTER_ITEM_TEXT[id].label.length).toBeGreaterThan(0);
			expect(FOOTER_ITEM_TEXT[id].description.length).toBeGreaterThan(0);
		}
	});
});

describe("FOOTER_ITEM_TEXT", () => {
	it("names every block exactly once so menu rows are unambiguous", () => {
		const labels = FOOTER_ITEM_IDS.map((id) => FOOTER_ITEM_TEXT[id].label);
		expect(new Set(labels).size).toBe(labels.length);
	});
});

describe("isFooterItemId", () => {
	it("accepts ids this build knows", () => {
		expect(isFooterItemId("model")).toBe(true);
		expect(isFooterItemId("tokens")).toBe(true);
	});

	it("rejects anything else, including ids a newer build may have added", () => {
		expect(isFooterItemId("total-cost")).toBe(false);
		expect(isFooterItemId("")).toBe(false);
		expect(isFooterItemId(undefined)).toBe(false);
		expect(isFooterItemId(7)).toBe(false);
	});
});

describe("resolveFooterItems", () => {
	it("gives the default bar when the setting is missing or not a list", () => {
		expect(resolveFooterItems(undefined)).toEqual(FOOTER_ITEMS_DEFAULT);
		expect(resolveFooterItems(null)).toEqual(FOOTER_ITEMS_DEFAULT);
		expect(resolveFooterItems("model")).toEqual(FOOTER_ITEMS_DEFAULT);
		expect(resolveFooterItems({ 0: "model" })).toEqual(FOOTER_ITEMS_DEFAULT);
	});

	it("keeps the order the user set and drops the entries it does not know", () => {
		const items = resolveFooterItems(["cost", "total-cost", 7, null, "model"]);
		expect(items).toEqual(["cost", "model"]);
	});

	it("falls back to the default when nothing usable is left, so the bar is never empty", () => {
		expect(resolveFooterItems([])).toEqual(FOOTER_ITEMS_DEFAULT);
		expect(resolveFooterItems(["total-cost", null])).toEqual(FOOTER_ITEMS_DEFAULT);
	});
});

describe("footerItemsSummary", () => {
	it("lists up to two blocks by name", () => {
		expect(footerItemsSummary(["model"])).toBe("Model");
		expect(footerItemsSummary(["model", "thinking"])).toBe("Model, Thinking");
	});

	it("counts the rest", () => {
		const items: FooterItemId[] = ["model", "thinking", "session", "directory", "cost"];
		expect(footerItemsSummary(items)).toBe("Model, Thinking +3");
	});
});
