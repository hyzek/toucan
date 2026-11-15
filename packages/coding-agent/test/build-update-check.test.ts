// Tests for the startup update check: what it announces, what it stays silent about, and how
// update-check.json keeps a build announced once per machine. Git is replaced by a fake
// remote; the network path stubs fetch. No real remotes are contacted.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForAvailableBuild } from "../src/core/build-update-check.ts";
import type { ChannelBuildInfo } from "../src/core/channel-manager.ts";
import { UPDATE_CHECK_TTL_MS, updateCheckStatePath } from "../src/core/update-check-state.ts";
import { allowNetwork } from "./test-network-env.ts";

const COMMIT_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COMMIT_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function channelInstall(overrides: Partial<ChannelBuildInfo> = {}): ChannelBuildInfo {
	return {
		kind: "toucan-channel",
		schemaVersion: 1,
		channel: "dev",
		ref: "dev",
		commit: COMMIT_A,
		builtAt: "2026-11-01T00:00:00.000Z",
		node: process.version,
		repoUrl: "https://github.com/hyzek/toucan.git",
		...overrides,
	};
}

/** Fake `git ls-remote`: answers per repo/ref pair, undefined records an unreachable remote. */
function fakeGit(remoteCommit: string | undefined, remoteTags = "b70") {
	const calls: string[][] = [];
	return {
		calls,
		lsRemote: async (args: string[]) => {
			calls.push(args);
			if (remoteCommit === undefined) return undefined;
			if (args[0] === "--tags") return `${remoteCommit}\trefs/tags/${remoteTags}\n`;
			const ref = args[args.length - 1];
			const refKind = /^b\d+$/.test(ref) ? "tags" : "heads";
			return `${remoteCommit}\trefs/${refKind}/${ref}\n`;
		},
	};
}

function readState(): Record<string, string> | undefined {
	try {
		return JSON.parse(readFileSync(updateCheckStatePath(), "utf8"));
	} catch {
		return undefined;
	}
}

describe("build update check", () => {
	let tempDir: string;
	const nowMs = Date.parse("2026-11-15T12:00:00.000Z");

	beforeEach(() => {
		allowNetwork();
		tempDir = mkdtempSync(join(tmpdir(), "toucan-update-check-"));
		vi.stubEnv("TOUCAN_HOME", tempDir);
		vi.stubEnv("TOUCAN_REPO_URL", undefined);
		vi.stubEnv("TOUCAN_OFFLINE", undefined);
		vi.stubEnv("TOUCAN_SKIP_VERSION_CHECK", undefined);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("announces a newer commit on a branch channel and records the announcement", async () => {
		const git = fakeGit(COMMIT_B);

		const available = await checkForAvailableBuild({
			install: channelInstall(),
			process: { lsRemote: git.lsRemote },
			nowMs,
		});

		expect(available).toEqual({
			kind: "branch",
			ref: "dev",
			commit: COMMIT_B.slice(0, 7),
			url: `https://github.com/hyzek/toucan/commit/${COMMIT_B}`,
		});
		expect(readState()).toMatchObject({
			source: "channel:dev",
			remoteIdentity: COMMIT_B,
			remoteRef: "dev",
			notifiedIdentity: COMMIT_B,
		});
	});

	it("does not announce the same build twice", async () => {
		const git = fakeGit(COMMIT_B);
		const options = { install: channelInstall(), process: { lsRemote: git.lsRemote }, nowMs };

		await expect(checkForAvailableBuild(options)).resolves.toBeDefined();
		await expect(checkForAvailableBuild(options)).resolves.toBeUndefined();
	});

	it("answers a fresh cache without asking the remote again", async () => {
		writeFileSync(
			updateCheckStatePath(),
			JSON.stringify({
				kind: "toucan-update-check",
				schemaVersion: 1,
				source: "channel:dev",
				checkedAt: new Date(nowMs - 60_000).toISOString(),
				remoteIdentity: COMMIT_B,
				remoteLabel: COMMIT_B.slice(0, 7),
				remoteRef: "dev",
				remoteUrl: `https://github.com/hyzek/toucan/commit/${COMMIT_B}`,
				notifiedIdentity: COMMIT_A,
			}),
		);
		const git = fakeGit(undefined);

		const available = await checkForAvailableBuild({
			install: channelInstall({ commit: "0".repeat(40) }),
			process: { lsRemote: git.lsRemote },
			nowMs,
		});

		expect(available).toEqual({
			kind: "branch",
			ref: "dev",
			commit: COMMIT_B.slice(0, 7),
			url: `https://github.com/hyzek/toucan/commit/${COMMIT_B}`,
		});
		expect(git.calls).toHaveLength(0);
	});

	it("stays silent when the build is already current, and caches that answer", async () => {
		const git = fakeGit(COMMIT_A);
		const options = { install: channelInstall(), process: { lsRemote: git.lsRemote }, nowMs };

		await expect(checkForAvailableBuild(options)).resolves.toBeUndefined();
		expect(readState()).toMatchObject({ source: "channel:dev", remoteIdentity: COMMIT_A });
		expect(readState()?.notifiedIdentity).toBeUndefined();

		await expect(checkForAvailableBuild(options)).resolves.toBeUndefined();
		expect(git.calls).toHaveLength(1);
	});

	it("announces the newest release tag for an unpinned stable channel", async () => {
		const git = fakeGit(COMMIT_B, "b71");

		const available = await checkForAvailableBuild({
			install: channelInstall({ channel: "stable", ref: "b70" }),
			process: { lsRemote: git.lsRemote },
			nowMs,
		});

		expect(available).toEqual({
			kind: "release",
			label: "b71",
			url: "https://github.com/hyzek/toucan/releases/tag/b71",
		});
	});

	it("stays silent for a build pinned to a ref, because toucan update cannot move it", async () => {
		const git = fakeGit(COMMIT_B);

		await expect(
			checkForAvailableBuild({
				install: channelInstall({ channel: "stable", ref: "b24", pinnedRef: "b24" }),
				process: { lsRemote: git.lsRemote },
				nowMs,
			}),
		).resolves.toBeUndefined();
		expect(git.calls).toHaveLength(0);
	});

	it("looks again once the cache is older than its ttl", async () => {
		const stale = {
			kind: "toucan-update-check",
			schemaVersion: 1,
			source: "channel:dev",
			checkedAt: new Date(nowMs - UPDATE_CHECK_TTL_MS - 1000).toISOString(),
			remoteIdentity: COMMIT_A,
			remoteLabel: COMMIT_A.slice(0, 7),
		};
		writeFileSync(updateCheckStatePath(), JSON.stringify(stale));
		const git = fakeGit(COMMIT_B);

		const available = await checkForAvailableBuild({
			install: channelInstall(),
			process: { lsRemote: git.lsRemote },
			nowMs,
		});

		expect(available).toMatchObject({ kind: "branch", commit: COMMIT_B.slice(0, 7) });
		expect(git.calls).toHaveLength(1);
	});

	it("keeps quiet and retries later when the remote cannot be reached", async () => {
		const git = fakeGit(undefined);
		const options = { install: channelInstall(), process: { lsRemote: git.lsRemote }, nowMs };

		await expect(checkForAvailableBuild(options)).resolves.toBeUndefined();
		expect(readState()).toBeUndefined();
	});

	it("does not ask when offline or when checks are disabled", async () => {
		for (const env of ["TOUCAN_OFFLINE", "TOUCAN_SKIP_VERSION_CHECK"] as const) {
			vi.stubEnv(env, "1");
			const git = fakeGit(COMMIT_B);

			await expect(
				checkForAvailableBuild({ install: channelInstall(), process: { lsRemote: git.lsRemote }, nowMs }),
			).resolves.toBeUndefined();
			expect(git.calls).toHaveLength(0);
			vi.stubEnv(env, undefined);
		}
	});

	it("announces a newer GitHub release for installs that are not channel builds", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({ tag_name: "b999999", html_url: "https://github.com/hyzek/toucan/releases/tag/b999999" }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const available = await checkForAvailableBuild({ install: undefined, nowMs });

		expect(available).toEqual({
			kind: "release",
			label: "b999999",
			url: "https://github.com/hyzek/toucan/releases/tag/b999999",
		});
		expect(readState()).toMatchObject({ source: "release", remoteIdentity: "b999999" });
		expect(readState()?.remoteRef).toBeUndefined();
	});

	it("stays silent when the newest release is not ahead of this build", async () => {
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "b1" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForAvailableBuild({ install: undefined, nowMs })).resolves.toBeUndefined();
	});
});
