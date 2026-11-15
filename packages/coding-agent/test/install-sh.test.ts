// Tests for scripts/install.sh: the bootstrap installer runs the real recipe
// (clone, engine check, npm ci, build, swap, launcher, PATH block) against the
// local fixture remote, in a fake HOME so shell rc files are never touched.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChannelRepoFixture, createChannelRepoFixture } from "./channel-test-fixture.ts";

const INSTALLER = fileURLToPath(new URL("../../../scripts/install.sh", import.meta.url));
const RUN_TIMEOUT = 180_000;
const MARKER = "# >>> toucan channel launcher >>>";

describe("install.sh", () => {
	let repo: ChannelRepoFixture;
	let tempDir: string;
	let home: string;
	let toucanHome: string;

	function installerEnv(): NodeJS.ProcessEnv {
		return {
			...process.env,
			HOME: home,
			TOUCAN_HOME: toucanHome,
			TOUCAN_REPO_URL: `file://${repo.repoDir}`,
			// Never let a root-run suite link into the real /usr/local/bin.
			TOUCAN_SYSTEM_LINK: "0",
		};
	}

	function runInstaller(args: string[], envRemovals: string[] = []) {
		const env = installerEnv();
		for (const name of envRemovals) delete env[name];
		return spawnSync("sh", [INSTALLER, ...args], {
			env,
			encoding: "utf8",
			timeout: RUN_TIMEOUT,
			maxBuffer: 16 * 1024 * 1024,
		});
	}

	beforeEach(() => {
		repo = createChannelRepoFixture();
		tempDir = mkdtempSync(join(tmpdir(), "toucan-installer-"));
		home = join(tempDir, "home");
		toucanHome = join(tempDir, "state");
		mkdirSync(home, { recursive: true });
		writeFileSync(join(home, ".bashrc"), "# existing bashrc\n");
		writeFileSync(join(home, ".profile"), "# existing profile\n");
		vi.stubEnv("TOUCAN_REPO_URL", undefined);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(tempDir, { force: true, recursive: true });
		repo.destroy();
	});

	it("builds a channel, installs the launcher, and adds PATH to rc files once", { timeout: RUN_TIMEOUT }, async () => {
		const first = runInstaller(["dev"]);
		expect(first.stderr).not.toMatch(/:\s.*error/i);
		expect(first.stdout).toContain("is ready — type: toucan");

		const buildDir = join(toucanHome, "builds", "dev");
		expect(readFileSync(join(toucanHome, "channel"), "utf8").trim()).toBe("dev");
		expect(readFileSync(join(buildDir, "channel.json"), "utf8")).toContain(repo.headOf("dev"));
		const launcher = join(toucanHome, "bin", "toucan");
		expect(statSync(launcher).mode & 0o777).toBe(0o755);

		for (const rc of [".bashrc", ".profile"]) {
			const contents = readFileSync(join(home, rc), "utf8");
			expect(contents).toContain(MARKER);
			expect(contents).toContain(`export PATH="${join(toucanHome, "bin")}:$PATH"`);
		}

		// Re-running repairs in place without duplicating the PATH block.
		const second = runInstaller(["dev"]);
		expect(second.stdout).toContain("Already at dev");
		const bashrc = readFileSync(join(home, ".bashrc"), "utf8");
		expect(bashrc.split(MARKER).length - 1).toBe(1);
	});

	it("resolves the stable channel to the highest release tag", { timeout: RUN_TIMEOUT }, async () => {
		const result = runInstaller(["stable"]);
		expect(result.stdout).toContain("is ready — type: toucan");
		const metadata = readFileSync(join(toucanHome, "builds", "stable", "channel.json"), "utf8");
		expect(metadata).toContain('"ref": "b10"');
		expect(metadata).toContain(repo.commitOfTag("b10"));
	});

	it("rejects an unknown channel", () => {
		const result = runInstaller(["beta"]);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("unknown channel 'beta'");
	});

	it("refuses to run while the channel lock exists", () => {
		mkdirSync(join(toucanHome, "builds", ".dev.installer.lock"), { recursive: true });
		const result = runInstaller(["dev"]);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("another channel operation");
		expect(existsSync(join(toucanHome, "builds", "dev"))).toBe(false);
	});

	it("refuses when the tree requires a newer Node", { timeout: RUN_TIMEOUT }, async () => {
		repo.destroy();
		repo = createChannelRepoFixture({ enginesNode: ">=999.0.0" });
		const result = runInstaller(["dev"]);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("requires Node >=999.0.0");
		expect(existsSync(join(toucanHome, "builds", "dev"))).toBe(false);
	});

	it("follows the remote recorded in the build when TOUCAN_REPO_URL is unset", { timeout: RUN_TIMEOUT }, () => {
		// Regression: the installer always used the default repository, so re-running it on a
		// fork or mirror install silently replaced it with upstream code.
		const stored = "file:///toucan-installer-remote-missing";
		mkdirSync(join(toucanHome, "builds", "dev"), { recursive: true });
		writeFileSync(
			join(toucanHome, "builds", "dev", "channel.json"),
			JSON.stringify({
				kind: "toucan-channel",
				schemaVersion: 1,
				channel: "dev",
				ref: "dev",
				commit: "0".repeat(40),
				builtAt: new Date().toISOString(),
				node: process.version,
				repoUrl: stored,
			}),
		);

		const result = runInstaller(["dev"], ["TOUCAN_REPO_URL"]);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain(stored);
	});
});
