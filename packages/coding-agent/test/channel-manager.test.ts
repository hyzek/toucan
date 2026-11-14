// Tests for the channel manager: source parsing, pointer/launcher state, and the
// install/update/remove/switch machinery with a fake process seam (no git, no npm).

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ChannelProcess,
	checkNodeEngine,
	detectChannelInstall,
	ensureLauncher,
	getChannelBuildDir,
	getChannelBuildsDir,
	getChannelLauncherDir,
	getToucanHome,
	installChannel,
	listChannelBuilds,
	parseChannelSource,
	readActiveChannel,
	readChannelBuildInfo,
	removeChannel,
	renderLauncherScript,
	resolveLatestBuildTag,
	switchChannel,
	updateChannel,
} from "../src/core/channel-manager.ts";

/** Fake git/npm: records every call and materializes the files install expects. */
interface FakeOptions {
	/** Remote commit per ref for `git ls-remote <repo> <ref>`. */
	commits?: Record<string, string>;
	/** Raw `git ls-remote --tags` output for the stable default resolution. */
	latestTagList?: string;
	/** Commit `git rev-parse HEAD` reports inside a fresh clone. */
	cloneCommit?: string;
	/** engines.node written into the cloned root package.json. */
	enginesNode?: string;
}

function createFakeProcess(options: FakeOptions = {}) {
	const runCalls: { command: string; args: string[]; cwd: string }[] = [];
	const captureCalls: { command: string; args: string[] }[] = [];
	const cloneCommit = options.cloneCommit ?? "1111111111111111111111111111111111111111";
	const fake: ChannelProcess = {
		async run(command, args, { cwd }) {
			runCalls.push({ command, args, cwd });
			if (command === "git" && args[0] === "clone") {
				const target = args[6];
				mkdirSync(target, { recursive: true });
				writeFileSync(
					join(target, "package.json"),
					JSON.stringify({ engines: options.enginesNode ? { node: options.enginesNode } : {} }),
				);
			}
			if (command === "npm" && args[0] === "run" && cwd.endsWith("coding-agent")) {
				const bundle = join(cwd, "dist", "bundle");
				mkdirSync(bundle, { recursive: true });
				writeFileSync(join(bundle, "cli.js"), "// built");
			}
		},
		capture(command, args) {
			captureCalls.push({ command, args });
			if (args[0] === "ls-remote" && args[1] === "--tags") return options.latestTagList ?? "";
			if (args[0] === "ls-remote") {
				const ref = args[2];
				const commit = options.commits?.[ref] ?? "";
				return commit ? `${commit}\trefs/heads/${ref}\n` : "";
			}
			if (args[0] === "rev-parse") return `${cloneCommit}\n`;
			throw new Error(`unexpected capture: ${command} ${args.join(" ")}`);
		},
	};
	return { fake, runCalls, captureCalls, cloneCommit };
}

function fakeCommit(ref: string): string {
	// Deterministic 40-hex commit per ref for the ls-remote fixtures.
	let hex = "";
	for (const char of ref) hex += char.charCodeAt(0).toString(16).padStart(2, "0");
	return (hex + "0".repeat(40)).slice(0, 40);
}

function writeBuildMetadata(buildDir: string, overrides: Partial<{ commit: string; ref: string }> = {}): void {
	mkdirSync(buildDir, { recursive: true });
	writeFileSync(
		join(buildDir, "channel.json"),
		JSON.stringify({
			kind: "toucan-channel",
			schemaVersion: 1,
			channel: "stable",
			ref: "b24",
			commit: fakeCommit("b24"),
			builtAt: "2026-11-01T00:00:00.000Z",
			node: process.version,
			repoUrl: "https://git.test/repo.git",
			...overrides,
		}),
	);
}

describe("channel manager", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "toucan-channels-"));
		vi.stubEnv("TOUCAN_HOME", tempDir);
		vi.stubEnv("TOUCAN_REPO_URL", "https://git.test/repo.git");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("source parsing", () => {
		it("parses channel sources with and without a pinned ref", () => {
			expect(parseChannelSource("toucan:dev")).toEqual({ channel: "dev" });
			expect(parseChannelSource("toucan:stable@b24")).toEqual({ channel: "stable", pinnedRef: "b24" });
			expect(parseChannelSource("toucan:nightly@feature/x")).toEqual({ channel: "nightly", pinnedRef: "feature/x" });
		});

		it("rejects non-channel sources, unknown channels, and invalid refs", () => {
			expect(parseChannelSource("npm:@foo/bar")).toBeUndefined();
			expect(parseChannelSource("dev")).toBeUndefined();
			expect(parseChannelSource("toucan:beta")).toBeUndefined();
			expect(parseChannelSource("toucan:dev@")).toBeUndefined();
			expect(parseChannelSource("toucan:dev@-x")).toBeUndefined();
			expect(parseChannelSource("toucan:dev@a..b")).toBeUndefined();
			expect(parseChannelSource("toucan:dev@bad ref")).toBeUndefined();
		});
	});

	describe("engine check", () => {
		it("passes current Node against a >= range and reports too-old", () => {
			expect(checkNodeEngine(">=1.0.0", "v22.19.0")).toEqual({ kind: "ok" });
			expect(checkNodeEngine(">=22.19.0", "v22.19.0")).toEqual({ kind: "ok" });
			expect(checkNodeEngine(">=22.19.1", "v22.19.0")).toEqual({ kind: "too-old", required: ">=22.19.1" });
			expect(checkNodeEngine(">=23.0.0", "v22.19.0")).toEqual({ kind: "too-old", required: ">=23.0.0" });
			expect(checkNodeEngine(undefined, "v22.19.0")).toEqual({ kind: "ok" });
			expect(checkNodeEngine("22.x || 24.x", "v22.19.0")).toEqual({ kind: "unknown-range" });
		});
	});

	describe("tag resolution", () => {
		it("picks the highest build tag and ignores peeled and non-tag lines", () => {
			const output = [
				"1111111111111111111111111111111111111111\trefs/tags/b24",
				"2222222222222222222222222222222222222222\trefs/tags/b24^{}",
				"3333333333333333333333333333333333333333\trefs/tags/b100",
				"4444444444444444444444444444444444444444\trefs/tags/v24.0.0",
				"5555555555555555555555555555555555555555\trefs/heads/nightly",
			].join("\n");
			expect(resolveLatestBuildTag(output)).toBe("b100");
			expect(resolveLatestBuildTag("")).toBeUndefined();
		});
	});

	describe("install", () => {
		async function installDev(fake: ChannelProcess) {
			return installChannel("dev", { process: fake });
		}

		it("clones, builds, records metadata, and installs the launcher", async () => {
			const { fake, runCalls, cloneCommit } = createFakeProcess({ commits: { dev: fakeCommit("dev") } });
			const result = await installDev(fake);

			expect(result.kind).toBe("built");
			expect(runCalls[0]?.command).toBe("git");
			expect(runCalls[0]?.args.slice(0, 6)).toEqual([
				"clone",
				"--depth",
				"1",
				"--branch",
				"dev",
				"https://git.test/repo.git",
			]);
			const npmArgs = runCalls.filter((call) => call.command === "npm").map((call) => call.args.join(" "));
			expect(npmArgs).toEqual([
				"ci --ignore-scripts",
				"--prefix packages/tui run build",
				"--prefix packages/telemetry run build",
				"--prefix packages/ai run build",
				"--prefix packages/agent run build",
				"run build",
			]);

			const buildDir = getChannelBuildDir("dev");
			const info = readChannelBuildInfo(buildDir);
			expect(info).toBeDefined();
			expect(info?.commit).toBe(cloneCommit);
			expect(info?.ref).toBe("dev");
			expect(info?.repoUrl).toBe("https://git.test/repo.git");
			expect(existsSync(join(buildDir, "packages", "coding-agent", "dist", "bundle", "cli.js"))).toBe(true);
			expect(readFileSync(getChannelLauncherPath(), "utf8")).toBe(renderLauncherScript(getToucanHome()));
			expect(statSync(getChannelLauncherPath()).mode & 0o777).toBe(0o755);
			// The first installed channel becomes active.
			expect(readActiveChannel()).toBe("dev");
		});

		it("resolves the stable default ref to the latest release tag", async () => {
			const { fake, runCalls, captureCalls } = createFakeProcess({
				latestTagList: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/b24\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/b25\n`,
				commits: { b25: fakeCommit("b25") },
				cloneCommit: fakeCommit("b25"),
			});
			const result = await installChannel("stable", { process: fake });

			expect(result.kind).toBe("built");
			expect(captureCalls.some((call) => call.args.join(" ").includes("ls-remote --tags"))).toBe(true);
			expect(runCalls[0]?.args).toContain("b25");
			expect(readChannelBuildInfo(getChannelBuildDir("stable"))?.ref).toBe("b25");
		});

		it("reports up to date without cloning when the remote commit matches", async () => {
			const commit = fakeCommit("dev");
			const first = createFakeProcess({ commits: { dev: commit }, cloneCommit: commit });
			await installDev(first.fake);
			const second = createFakeProcess({ commits: { dev: commit } });
			const result = await installDev(second.fake);

			expect(result.kind).toBe("up-to-date");
			expect(second.runCalls).toEqual([]);
		});

		it("keeps the previous active channel when installing another one", async () => {
			const first = createFakeProcess({ commits: { dev: fakeCommit("dev") } });
			await installDev(first.fake);
			const second = createFakeProcess({ commits: { nightly: fakeCommit("nightly") } });
			await installChannel("nightly", { process: second.fake });

			expect(readActiveChannel()).toBe("dev");
			expect(existsSync(getChannelBuildDir("nightly"))).toBe(true);
		});

		it("refuses to build when the fetched tree needs a newer Node", async () => {
			const { fake, runCalls } = createFakeProcess({
				commits: { dev: fakeCommit("dev") },
				enginesNode: ">=999.0.0",
			});
			await expect(installDev(fake)).rejects.toThrow(/requires Node >=999\.0\.0/);
			expect(runCalls.some((call) => call.args[0] === "ci")).toBe(false);
			expect(existsSync(getChannelBuildDir("dev"))).toBe(false);
		});

		it("fails when the requested ref does not exist on the remote", async () => {
			const { fake } = createFakeProcess({ commits: {} });
			await expect(installChannel("stable", { pinnedRef: "b999", process: fake })).rejects.toThrow(
				/was not found in https:\/\/git\.test\/repo\.git/,
			);
		});

		it("rejects when another channel operation holds the lock", async () => {
			mkdirSync(getChannelBuildsDir(), { recursive: true });
			const release = await lockfile.lock(join(getChannelBuildsDir(), "dev"), { realpath: false, retries: 0 });
			const { fake } = createFakeProcess({ commits: { dev: fakeCommit("dev") } });
			try {
				await expect(installDev(fake)).rejects.toThrow(/already running for "dev"/);
			} finally {
				await release();
			}
		});
	});

	describe("update", () => {
		it("keeps a pinned stable build on its pin instead of the latest tag", async () => {
			const install = createFakeProcess({ commits: { b24: fakeCommit("b24") }, cloneCommit: fakeCommit("b24") });
			await installChannel("stable", { pinnedRef: "b24", process: install.fake });

			const update = createFakeProcess({ commits: { b24: `${fakeCommit("b24")}f` } });
			const result = await updateChannel("stable", { process: update.fake });

			expect(result.kind).toBe("built");
			expect(update.captureCalls.some((call) => call.args.includes("--tags"))).toBe(false);
			expect(update.runCalls[0]?.args).toContain("b24");
		});

		it("rebuilds when the remote moved and reports up to date otherwise", async () => {
			const install = createFakeProcess({ commits: { dev: fakeCommit("dev") }, cloneCommit: fakeCommit("dev") });
			await installChannel("dev", { process: install.fake });

			const moved = fakeCommit("dev").replace(/0+$/, "9");
			const update = createFakeProcess({ commits: { dev: moved }, cloneCommit: moved });
			const result = await updateChannel("dev", { process: update.fake });
			expect(result.kind).toBe("built");
			expect(readChannelBuildInfo(getChannelBuildDir("dev"))?.commit).toBe(moved);

			const again = createFakeProcess({ commits: { dev: moved } });
			const second = await updateChannel("dev", { process: again.fake });
			expect(second.kind).toBe("up-to-date");
		});

		it("throws for a channel that is not installed", async () => {
			const { fake } = createFakeProcess();
			await expect(updateChannel("dev", { process: fake })).rejects.toThrow(/not installed/);
		});
	});

	describe("switch and remove", () => {
		it("switches to an installed channel and builds on demand when missing", async () => {
			const install = createFakeProcess({ commits: { dev: fakeCommit("dev") } });
			await installChannel("dev", { process: install.fake });
			const before = readActiveChannel();
			expect(before).toBe("dev");

			const info = await switchChannel("dev", { process: install.fake });
			expect(info.channel).toBe("dev");
			expect(readActiveChannel()).toBe("dev");

			const fresh = createFakeProcess({ commits: { nightly: fakeCommit("nightly") } });
			const built = await switchChannel("nightly", { process: fresh.fake });
			expect(built.channel).toBe("nightly");
			expect(readActiveChannel()).toBe("nightly");
			expect(fresh.runCalls[0]?.args).toContain("nightly");
		});

		it("removes a build and clears the active pointer when it pointed there", async () => {
			const install = createFakeProcess({ commits: { dev: fakeCommit("dev") } });
			await installChannel("dev", { process: install.fake });
			expect(readActiveChannel()).toBe("dev");

			await removeChannel("dev");
			expect(existsSync(getChannelBuildDir("dev"))).toBe(false);
			expect(readActiveChannel()).toBeUndefined();
		});

		it("keeps the pointer when removing a non-active channel", async () => {
			const dev = createFakeProcess({ commits: { dev: fakeCommit("dev") } });
			await installChannel("dev", { process: dev.fake });
			const nightly = createFakeProcess({ commits: { nightly: fakeCommit("nightly") } });
			await installChannel("nightly", { process: nightly.fake });

			await removeChannel("nightly");
			expect(readActiveChannel()).toBe("dev");
		});

		it("throws when removing a channel that is not installed", async () => {
			await expect(removeChannel("dev")).rejects.toThrow(/not installed/);
		});

		it("lists installed builds with the active flag", async () => {
			writeBuildMetadata(getChannelBuildDir("stable"));
			const dev = createFakeProcess({ commits: { dev: fakeCommit("dev") } });
			await installChannel("dev", { process: dev.fake });

			const statuses = listChannelBuilds();
			expect(statuses.map((status) => status.info.channel)).toEqual(["dev", "stable"]);
			expect(statuses.find((status) => status.info.channel === "dev")?.active).toBe(true);
			expect(statuses.find((status) => status.info.channel === "stable")?.active).toBe(false);
		});
	});

	describe("state files", () => {
		it("reads the active channel and ignores invalid pointer contents", () => {
			mkdirSync(getToucanHome(), { recursive: true });
			writeFileSync(join(getToucanHome(), "channel"), "stable\n");
			expect(readActiveChannel()).toBe("stable");
			writeFileSync(join(getToucanHome(), "channel"), "banana\n");
			expect(readActiveChannel()).toBeUndefined();
			rmSync(join(getToucanHome(), "channel"));
			expect(readActiveChannel()).toBeUndefined();
		});

		it("rejects malformed channel metadata", () => {
			const buildDir = getChannelBuildDir("dev");
			mkdirSync(buildDir, { recursive: true });
			writeFileSync(join(buildDir, "channel.json"), "not json");
			expect(readChannelBuildInfo(buildDir)).toBeUndefined();
			writeFileSync(join(buildDir, "channel.json"), JSON.stringify({ kind: "other", schemaVersion: 1 }));
			expect(readChannelBuildInfo(buildDir)).toBeUndefined();
		});

		it("detects a channel build by walking up from a nested package dir", () => {
			const buildDir = join(tempDir, "fake-build");
			const nested = join(buildDir, "packages", "coding-agent");
			mkdirSync(nested, { recursive: true });
			writeBuildMetadata(buildDir);
			const info = detectChannelInstall(nested);
			expect(info?.channel).toBe("stable");
			expect(detectChannelInstall(tempDir)).toBeUndefined();
		});

		it("ignores unknown channels when listing", async () => {
			mkdirSync(join(getChannelBuildsDir(), "beta"), { recursive: true });
			writeFileSync(join(getChannelBuildsDir(), "beta", "channel.json"), "garbage");
			expect(listChannelBuilds()).toEqual([]);
		});
	});

	describe("launcher", () => {
		it("renders a script that bakes the home default and execs the channel entry", () => {
			const script = renderLauncherScript("/home/x/.toucan");
			expect(script.startsWith("#!/bin/sh\n")).toBe(true);
			expect(script).toContain('TOUCAN_HOME_DEFAULT="/home/x/.toucan"');
			expect(script).toContain('exec node "$TOUCAN_ENTRY" "$@"');
			expect(script).toContain("packages/coding-agent/dist/bundle/cli.js");
		});

		it("regenerates the launcher when the home changes", () => {
			ensureLauncher();
			expect(readFileSync(getChannelLauncherPath(), "utf8")).toContain(tempDir);
			vi.stubEnv("TOUCAN_HOME", join(tempDir, "elsewhere"));
			ensureLauncher();
			expect(readFileSync(getChannelLauncherPath(), "utf8")).toContain(join(tempDir, "elsewhere"));
		});
	});
});

function getChannelLauncherPath(): string {
	return join(getChannelLauncherDir(), "toucan");
}
