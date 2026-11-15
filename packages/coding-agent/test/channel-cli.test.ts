// CLI surface for channel commands: `toucan install toucan:<name>`, `toucan channel`,
// `toucan remove toucan:<name>`, and `toucan launcher` through handlePackageCommand,
// backed by the local fixture remote (real git and npm, no network).

import { existsSync, mkdtempSync, rmSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getChannelBuildDir, getChannelLauncherDir, getToucanHome } from "../src/core/channel-manager.ts";
import { handlePackageCommand } from "../src/package-manager-cli.ts";
import { type ChannelRepoFixture, createChannelRepoFixture } from "./channel-test-fixture.ts";

const BUILD_TIMEOUT = 120_000;

describe("channel commands through the package CLI", () => {
	let repo: ChannelRepoFixture;
	let homeDir: string;
	let logLines: string[];
	let errorLines: string[];

	async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
		logLines = [];
		errorLines = [];
		process.exitCode = undefined;
		const logSpy = vi.spyOn(console, "log").mockImplementation((...messages: unknown[]) => {
			logLines.push(messages.map(String).join(" "));
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation((...messages: unknown[]) => {
			errorLines.push(messages.map(String).join(" "));
		});
		try {
			const handled = await handlePackageCommand(args);
			expect(handled).toBe(true);
		} finally {
			logSpy.mockRestore();
			errorSpy.mockRestore();
		}
		return { stdout: logLines.join("\n"), stderr: errorLines.join("\n") };
	}

	beforeAll(() => {
		repo = createChannelRepoFixture();
		homeDir = mkdtempSync(join(tmpdir(), "toucan-channels-cli-"));
	});

	// The vitest config has unstubEnvs: true, so env stubs do not survive a test;
	// re-stub them every test while the repo and state root stay shared.
	beforeEach(() => {
		vi.stubEnv("TOUCAN_HOME", homeDir);
		vi.stubEnv("TOUCAN_REPO_URL", `file://${repo.repoDir}`);
	});

	afterAll(() => {
		vi.unstubAllEnvs();
		rmSync(homeDir, { force: true, recursive: true });
		repo.destroy();
	});

	it("reports no channel builds before the first install", async () => {
		const { stdout } = await runCli(["channel"]);
		expect(stdout).toContain("No channel builds");
		expect(process.exitCode).toBeUndefined();
	});

	it("rejects an unknown channel in a toucan source", async () => {
		const { stderr } = await runCli(["install", "toucan:beta"]);
		expect(stderr).toContain("Invalid channel source");
		expect(stderr).toContain("toucan:beta");
		expect(process.exitCode).toBe(1);
	});

	it("rejects an unknown channel name for switching", async () => {
		const { stderr } = await runCli(["channel", "banana"]);
		expect(stderr).toContain('Unknown channel "banana"');
		expect(process.exitCode).toBe(1);
	});

	it("installs toucan:dev and makes it the active channel", { timeout: BUILD_TIMEOUT }, async () => {
		const { stdout } = await runCli(["install", "toucan:dev"]);
		expect(stdout).toContain("Installed toucan:dev");
		expect(existsSync(join(getChannelBuildDir("dev"), "channel.json"))).toBe(true);
		const { stdout: list } = await runCli(["channel"]);
		expect(list).toContain("*");
		expect(list).toContain("dev");
		expect(process.exitCode).toBeUndefined();
	});

	it(
		"reports an installed channel as up to date when the remote has not moved",
		{ timeout: BUILD_TIMEOUT },
		async () => {
			const { stdout } = await runCli(["install", "toucan:dev"]);
			expect(stdout).toContain("already up to date");
			expect(process.exitCode).toBeUndefined();
		},
	);

	it("switches to nightly, building it on demand", { timeout: BUILD_TIMEOUT }, async () => {
		const { stdout } = await runCli(["channel", "nightly"]);
		expect(stdout).toContain("Active channel: nightly");
		expect(existsSync(getChannelBuildDir("nightly"))).toBe(true);
		const { stdout: list } = await runCli(["channel"]);
		expect(list).toContain("*");
		expect(list).toContain("nightly");
		expect(list).toContain("dev");
	});

	it("removes the active channel and clears the pointer", { timeout: BUILD_TIMEOUT }, async () => {
		const { stdout } = await runCli(["remove", "toucan:nightly"]);
		expect(stdout).toContain("Removed channel nightly");
		expect(existsSync(getChannelBuildDir("nightly"))).toBe(false);
		const { stdout: list } = await runCli(["channel"]);
		expect(list).toContain("No active channel");
		expect(list).toContain("dev");
		expect(list).not.toContain("*");
	});

	it("fails to remove a channel that is not installed", async () => {
		const { stderr } = await runCli(["remove", "toucan:nightly"]);
		expect(stderr).toContain("not installed");
		expect(process.exitCode).toBe(1);
	});

	it("regenerates the launcher on demand", { timeout: BUILD_TIMEOUT }, async () => {
		const launcherPath = join(getChannelLauncherDir(), "toucan");
		unlinkSync(launcherPath);
		const { stdout } = await runCli(["launcher"]);
		expect(stdout).toContain(launcherPath);
		expect(existsSync(launcherPath)).toBe(true);
		expect(statSync(launcherPath).mode & 0o777).toBe(0o755);
		expect(getToucanHome()).toBe(homeDir);
	});
});
