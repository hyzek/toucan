import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PACKAGE_NAME, RELEASE_FEED_URL } from "../src/config.ts";
import {
	comparePackageVersions,
	formatVersionCheckError,
	getLatestToucanRelease,
	isNewerPackageVersion,
} from "../src/utils/version-check.ts";
import { allowNetwork } from "./test-network-env.ts";

beforeEach(() => {
	allowNetwork();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("version checks", () => {
	it("compares package versions", () => {
		expect(comparePackageVersions("0.70.6", "0.70.5")).toBeGreaterThan(0);
		expect(comparePackageVersions("0.70.5", "0.70.5")).toBe(0);
		expect(comparePackageVersions("0.70.4", "0.70.5")).toBeLessThan(0);
		expect(comparePackageVersions("5.0.0-beta.20", "5.0.0-beta.9")).toBeGreaterThan(0);
		expect(isNewerPackageVersion("0.70.5", "0.70.5")).toBe(false);
		expect(isNewerPackageVersion("0.70.6", "0.70.5")).toBe(true);
	});

	it("answers a b<N> release tag as the numeric version self-update compares", async () => {
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "b70" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestToucanRelease("61.0.0")).resolves.toEqual({
			version: "70.0.0",
			packageName: PACKAGE_NAME,
		});
	});

	it("uses the GitHub release feed with a toucan user agent", async () => {
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "b70" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestToucanRelease("61.0.0")).resolves.toBeDefined();
		expect(fetchMock).toHaveBeenCalledWith(
			RELEASE_FEED_URL,
			expect.objectContaining({
				headers: expect.objectContaining({
					"User-Agent": expect.stringMatching(/^toucan\/61\.0\.0 /),
					accept: "application/vnd.github+json",
				}),
			}),
		);
	});

	it("returns the release body as the update note", async () => {
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "b70", body: " **Read this** " }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestToucanRelease("61.0.0")).resolves.toEqual({
			version: "70.0.0",
			packageName: PACKAGE_NAME,
			note: "**Read this**",
		});
	});

	it("names this package, never one the feed suggests", async () => {
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "b70", name: "@someone-else/toucan" }));
		vi.stubGlobal("fetch", fetchMock);

		const release = await getLatestToucanRelease("61.0.0");
		expect(release?.packageName).toBe(PACKAGE_NAME);
	});

	it("ignores releases whose tag is not a build tag", async () => {
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "v3.1.0" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestToucanRelease("61.0.0")).resolves.toBeUndefined();
	});

	it("returns undefined when the feed is unavailable", async () => {
		const fetchMock = vi.fn(async () => new Response("nope", { status: 503 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestToucanRelease("61.0.0", { retry: false })).resolves.toBeUndefined();
	});

	it("retries a transient release request when explicitly requested", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error("fetch failed"))
			.mockRejectedValueOnce(new Error("fetch failed"))
			.mockResolvedValueOnce(Response.json({ tag_name: "b70" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestToucanRelease("61.0.0", { retry: true })).resolves.toEqual({
			version: "70.0.0",
			packageName: PACKAGE_NAME,
		});
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("skips the request when offline", async () => {
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "b70" }));
		vi.stubGlobal("fetch", fetchMock);
		vi.stubEnv("TOUCAN_OFFLINE", "1");

		await expect(getLatestToucanRelease("61.0.0")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("formats nested network error details", () => {
		const error = new Error("fetch failed", {
			cause: new AggregateError([
				Object.assign(new Error("connect timeout"), { code: "ETIMEDOUT" }),
				Object.assign(new Error("network unreachable"), { code: "ENETUNREACH" }),
			]),
		});

		expect(formatVersionCheckError(error)).toBe("fetch failed (ETIMEDOUT, ENETUNREACH)");
	});
});
