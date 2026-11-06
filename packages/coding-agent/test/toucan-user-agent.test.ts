import { describe, expect, it } from "vitest";
import { getToucanUserAgent } from "../src/utils/toucan-user-agent.ts";

describe("getToucanUserAgent", () => {
	it("formats the user agent expected by pi.dev", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getToucanUserAgent("1.2.3");

		expect(userAgent).toBe(`toucan/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^toucan\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
