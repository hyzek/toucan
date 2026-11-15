// Integration tests for the channel manager against real git and npm: a local
// fixture repository stands in for the toucan remote (see channel-test-fixture.ts),
// so cloning, lockfiles, build scripts, atomic swaps, and the launcher all execute
// for real while the network stays untouched.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getChannelBuildDir,
	getChannelBuildsDir,
	getChannelLauncherDir,
	installChannel,
	readActiveChannel,
	readChannelBuildInfo,
	updateChannel,
} from "../src/core/channel-manager.ts";
import { type ChannelRepoFixture, createChannelRepoFixture } from "./channel-test-fixture.ts";

const BUILD_TIMEOUT = 120_000;

describe("channel manager (real git and npm)", () => {
	let repo: ChannelRepoFixture;
	let homeDir: string;

	beforeEach(() => {
		repo = createChannelRepoFixture();
		homeDir = mkdtempSync(join(tmpdir(), "toucan-channels-integration-"));
		vi.stubEnv("TOUCAN_HOME", homeDir);
		vi.stubEnv("TOUCAN_REPO_URL", `file://${repo.repoDir}`);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(homeDir, { force: true, recursive: true });
		repo.destroy();
	});

	function stagingEntries(): string[] {
		try {
			return readdirSync(join(getChannelBuildsDir(), ".tmp"));
		} catch {
			return [];
		}
	}

	it(
		"clones the branch, builds with npm, and the launcher runs the built entry",
		{ timeout: BUILD_TIMEOUT },
		async () => {
			const result = await installChannel("dev");
			expect(result.kind).toBe("built");
			if (result.kind !== "built") return;
			expect(result.info.commit).toBe(repo.headOf("dev"));

			const buildDir = getChannelBuildDir("dev");
			expect(existsSync(join(buildDir, "packages", "coding-agent", "dist", "bundle", "cli.js"))).toBe(true);
			expect(readChannelBuildInfo(buildDir)?.ref).toBe("dev");
			expect(readActiveChannel()).toBe("dev");

			const launcherOut = execFileSync(join(getChannelLauncherDir(), "toucan"), ["--version"], {
				encoding: "utf8",
			});
			expect(launcherOut.trim()).toBe("fixture-cli --version");
		},
	);

	it("resolves stable to the annotated tag's peeled commit", { timeout: BUILD_TIMEOUT }, async () => {
		const result = await installChannel("stable");
		if (result.kind !== "built") throw new Error("expected a build");
		expect(result.info.ref).toBe("b10");
		expect(result.info.commit).toBe(repo.commitOfTag("b10"));
		expect(readChannelBuildInfo(getChannelBuildDir("stable"))?.commit).toBe(repo.commitOfTag("b10"));
	});

	it(
		"rebuilds an installed channel when the branch moves, then reports up to date",
		{ timeout: BUILD_TIMEOUT },
		async () => {
			await installChannel("dev");
			const moved = repo.commitOnBranch("dev", "second commit");

			const rebuilt = await updateChannel("dev");
			if (rebuilt.kind !== "built") throw new Error("expected a rebuild");
			expect(rebuilt.info.commit).toBe(moved);
			expect(readChannelBuildInfo(getChannelBuildDir("dev"))?.commit).toBe(moved);

			const again = await updateChannel("dev");
			expect(again.kind).toBe("up-to-date");
		},
	);

	it(
		"keeps following the remote a build came from after TOUCAN_REPO_URL is unset",
		{ timeout: BUILD_TIMEOUT },
		async () => {
			// A fork or mirror install sets the variable once; updates must keep using it.
			await installChannel("dev");
			const moved = repo.commitOnBranch("dev", "advance the recorded remote");
			vi.stubEnv("TOUCAN_REPO_URL", "");

			const result = await updateChannel("dev");
			if (result.kind !== "built") throw new Error("expected a rebuild");
			expect(result.info.commit).toBe(moved);
			expect(result.info.repoUrl).toBe(`file://${repo.repoDir}`);
		},
	);

	it("keeps the last-good build and releases the lock when a build fails", { timeout: BUILD_TIMEOUT }, async () => {
		const good = await installChannel("dev");
		if (good.kind !== "built") throw new Error("expected a build");

		const moved = repo.commitOnBranch("dev", "advance to a failing build");
		vi.stubEnv("FIXTURE_BUILD_FAILS", "1");
		await expect(updateChannel("dev")).rejects.toThrow(/npm run build|exited with code/);
		vi.stubEnv("FIXTURE_BUILD_FAILS", "0");

		// The previous build is untouched, staging left nothing behind.
		expect(readChannelBuildInfo(getChannelBuildDir("dev"))?.commit).toBe(good.info.commit);
		expect(stagingEntries()).toEqual([]);

		// The lock was released: the update against the moved branch rebuilds.
		const followUp = await updateChannel("dev");
		if (followUp.kind !== "built") throw new Error("expected a rebuild");
		expect(followUp.info.commit).toBe(moved);
	});

	it("refuses a second install while the channel lock is held", { timeout: BUILD_TIMEOUT }, async () => {
		vi.stubEnv("FIXTURE_BUILD_DELAY_MS", "2500");
		const first = installChannel("dev");
		// The first install takes the lock synchronously; give it past clone and npm ci.
		await new Promise((resolve) => setTimeout(resolve, 300));
		const second = installChannel("dev");
		await expect(second).rejects.toThrow(/already running for "dev"/);
		const result = await first;
		expect(result.kind).toBe("built");
	});

	it("refuses to build a tree that requires a newer Node", { timeout: BUILD_TIMEOUT }, async () => {
		const demanding = createChannelRepoFixture({ enginesNode: ">=999.0.0" });
		try {
			vi.stubEnv("TOUCAN_REPO_URL", `file://${demanding.repoDir}`);
			await expect(installChannel("dev")).rejects.toThrow(/requires Node >=999\.0\.0/);
		} finally {
			demanding.destroy();
		}
		expect(existsSync(getChannelBuildDir("dev"))).toBe(false);
		expect(stagingEntries()).toEqual([]);
	});

	it("works when the state root contains spaces", { timeout: BUILD_TIMEOUT }, async () => {
		const spaceHome = join(homeDir, "state root with spaces");
		mkdirSync(spaceHome, { recursive: true });
		vi.stubEnv("TOUCAN_HOME", spaceHome);

		const result = await installChannel("dev");
		expect(result.kind).toBe("built");
		const out = execFileSync(join(spaceHome, "bin", "toucan"), ["hello", "world"], { encoding: "utf8" });
		expect(out.trim()).toBe("fixture-cli hello world");
	});
});
