// Token counts in the shapes the info bar and the stats tables print.

import { describe, expect, it } from "vitest";
import { formatTokens } from "../src/utils/tokens.ts";

describe("formatTokens", () => {
	it("prints counts under a thousand as themselves", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(950)).toBe("950");
		expect(formatTokens(999)).toBe("999");
	});

	it("keeps one decimal from a thousand to ten thousand", () => {
		expect(formatTokens(1000)).toBe("1.0k");
		expect(formatTokens(1234)).toBe("1.2k");
		expect(formatTokens(9999)).toBe("10.0k");
	});

	it("rounds to whole thousands from ten thousand to a million", () => {
		expect(formatTokens(10_000)).toBe("10k");
		expect(formatTokens(23_456)).toBe("23k");
		expect(formatTokens(999_499)).toBe("999k");
	});

	it("switches to millions from a million up", () => {
		expect(formatTokens(1_000_000)).toBe("1.0M");
		expect(formatTokens(1_234_567)).toBe("1.2M");
		expect(formatTokens(12_345_678)).toBe("12M");
	});
});
