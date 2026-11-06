import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalToucanExperimental = process.env.TOUCAN_EXPERIMENTAL;

	afterEach(() => {
		if (originalToucanExperimental === undefined) {
			delete process.env.TOUCAN_EXPERIMENTAL;
		} else {
			process.env.TOUCAN_EXPERIMENTAL = originalToucanExperimental;
		}
	});

	it("returns false when TOUCAN_EXPERIMENTAL is unset", () => {
		delete process.env.TOUCAN_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when TOUCAN_EXPERIMENTAL is empty", () => {
		process.env.TOUCAN_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when TOUCAN_EXPERIMENTAL is set to 1", () => {
		process.env.TOUCAN_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when TOUCAN_EXPERIMENTAL is set to 0", () => {
		process.env.TOUCAN_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when TOUCAN_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.TOUCAN_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});
