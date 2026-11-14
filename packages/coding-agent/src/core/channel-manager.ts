// Channel deployments: dev/nightly/stable builds cloned from GitHub into TOUCAN_HOME
// (default ~/.toucan), an active-channel pointer the PATH launcher reads, and the build
// machinery (git clone + npm ci + workspace builds) behind `toucan install toucan:<name>`.

import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { CONFIG_DIR_NAME, expandTildePath, getPackageDir } from "../config.ts";
import { spawnProcess, spawnProcessSync, waitForChildProcess } from "../utils/child-process.ts";
import { stripBom } from "../utils/text.ts";

export type ChannelName = "dev" | "nightly" | "stable";

const CHANNEL_NAMES: readonly ChannelName[] = ["dev", "nightly", "stable"];

/** Overrides the shared state root (default ~/.toucan) for tests and custom layouts. */
export const TOUCAN_HOME_ENV = "TOUCAN_HOME";
const TOUCAN_REPO_URL_ENV = "TOUCAN_REPO_URL";
const DEFAULT_REPO_URL = "https://github.com/hyzek/toucan.git";
const CHANNEL_POINTER_FILE = "channel";
const BUILD_METADATA_FILE = "channel.json";
const STAGING_DIR_NAME = ".tmp";
const LAUNCHER_FILE_NAME = "toucan";
// Builds (npm ci + tsc + bundle) outlive a crashed process's lock; a lock untouched for
// this long is broken so the next operation can take over.
const LOCK_STALE_MS = 30 * 60_000;
// Dependency packages built before the CLI bundle, mirroring the build:binary script order.
const WORKSPACE_BUILD_PACKAGES = ["tui", "telemetry", "ai", "agent"] as const;
const REF_NAME_RE = /^[A-Za-z0-9._/-]+$/;
const BUILD_TAG_RE = /^b\d+$/;

/** A parsed `toucan:<channel>[@<ref>]` install/remove source. */
export interface ChannelSource {
	channel: ChannelName;
	/** Git ref pinned with `@`, e.g. `b24`; absent means follow the channel's default ref. */
	pinnedRef?: string;
}

/** Record written to `<build>/channel.json` after a successful build. */
export interface ChannelBuildInfo {
	kind: "toucan-channel";
	schemaVersion: 1;
	channel: ChannelName;
	/** Resolved git ref the build came from: a branch name or a `b<N>` tag. */
	ref: string;
	/** Git commit the checkout was built at. */
	commit: string;
	/** ISO timestamp of the build. */
	builtAt: string;
	/** Node version (`process.version`) that built and can run the build. */
	node: string;
	repoUrl: string;
	/** User-pinned `@<ref>`; absent means the channel's default ref is tracked. */
	pinnedRef?: string;
}

export type ChannelBuildResult =
	| { kind: "built"; info: ChannelBuildInfo }
	| { kind: "up-to-date"; info: ChannelBuildInfo };

export interface ChannelStatus {
	info: ChannelBuildInfo;
	active: boolean;
}

/** Process seams so tests can exercise channel operations without git or npm. */
export interface ChannelProcess {
	run(command: string, args: string[], options: { cwd: string }): Promise<void>;
	capture(command: string, args: string[], options?: { cwd?: string }): string;
}

export interface ChannelOperationOptions {
	pinnedRef?: string;
	force?: boolean;
	process?: ChannelProcess;
}

const defaultProcess: ChannelProcess = {
	async run(command, args, options) {
		const code = await waitForChildProcess(spawnProcess(command, args, { ...options, stdio: "inherit" }));
		if (code !== 0) {
			throw new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`);
		}
	},
	capture(command, args, options) {
		const result = spawnProcessSync(command, args, {
			...options,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		if (result.error) throw new Error(`${command} failed: ${result.error.message}`);
		if (result.status !== 0) {
			const reason = result.stderr.trim() || `exit code ${result.status ?? "unknown"}`;
			throw new Error(`${command} ${args.join(" ")} failed: ${reason}`);
		}
		return result.stdout;
	},
};

/** True when the value names a channel (dev, nightly, stable). */
export function isChannelName(value: string): value is ChannelName {
	return CHANNEL_NAMES.includes(value as ChannelName);
}

/** True when the source addresses a toucan channel build rather than an extension package. */
export function isChannelSource(source: string): boolean {
	return source.startsWith("toucan:");
}

/** Parse `toucan:<channel>[@<ref>]`; undefined for other sources, unknown channels, bad refs. */
export function parseChannelSource(source: string): ChannelSource | undefined {
	if (!isChannelSource(source)) return undefined;
	const body = source.slice("toucan:".length);
	const separator = body.indexOf("@");
	const name = separator === -1 ? body : body.slice(0, separator);
	if (!isChannelName(name)) return undefined;
	if (separator === -1) return { channel: name };
	const pinnedRef = body.slice(separator + 1);
	if (!isGitRefName(pinnedRef)) return undefined;
	return { channel: name, pinnedRef };
}

/** Validate a user-supplied git ref before it reaches git's argv. */
function isGitRefName(ref: string): boolean {
	if (!REF_NAME_RE.test(ref)) return false;
	return !ref.includes("..") && !ref.startsWith("-") && !ref.startsWith("/") && !ref.endsWith("/");
}

/** Shared state root holding builds, the channel pointer, and the launcher. */
export function getToucanHome(): string {
	const configured = process.env[TOUCAN_HOME_ENV]?.trim();
	if (configured) return expandTildePath(configured);
	return join(homedir(), CONFIG_DIR_NAME);
}

export function getChannelBuildsDir(): string {
	return join(getToucanHome(), "builds");
}

export function getChannelBuildDir(channel: ChannelName): string {
	return join(getChannelBuildsDir(), channel);
}

export function getChannelLauncherDir(): string {
	return join(getToucanHome(), "bin");
}

/** Channel the launcher will start; undefined when no channel is active. */
export function readActiveChannel(): ChannelName | undefined {
	let raw: string;
	try {
		raw = readFileSync(join(getToucanHome(), CHANNEL_POINTER_FILE), "utf8");
	} catch {
		return undefined;
	}
	const name = raw.trim();
	return isChannelName(name) ? name : undefined;
}

function writeActiveChannel(channel: ChannelName): void {
	const home = getToucanHome();
	mkdirSync(home, { recursive: true });
	const target = join(home, CHANNEL_POINTER_FILE);
	const temporary = join(home, `${CHANNEL_POINTER_FILE}.tmp.${process.pid}`);
	try {
		writeFileSync(temporary, `${channel}\n`);
		renameSync(temporary, target);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function clearActiveChannel(): void {
	rmSync(join(getToucanHome(), CHANNEL_POINTER_FILE), { force: true });
}

/** Parse `<buildDir>/channel.json`; undefined unless it is a valid channel build record. */
export function readChannelBuildInfo(buildDir: string): ChannelBuildInfo | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripBom(readFileSync(join(buildDir, BUILD_METADATA_FILE), "utf8")));
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null) return undefined;
	// Trust boundary: the metadata file on disk (hand-edited or written by another version).
	const value = parsed as Partial<ChannelBuildInfo>;
	if (
		value.kind !== "toucan-channel" ||
		value.schemaVersion !== 1 ||
		typeof value.ref !== "string" ||
		typeof value.commit !== "string" ||
		!isChannelName(value.channel ?? "")
	) {
		return undefined;
	}
	const pinnedRef = typeof value.pinnedRef === "string" && isGitRefName(value.pinnedRef) ? value.pinnedRef : undefined;
	return {
		kind: "toucan-channel",
		schemaVersion: 1,
		// Cast is decided: the isChannelName guard above validated value.channel.
		channel: value.channel as ChannelName,
		ref: value.ref,
		commit: value.commit,
		builtAt: typeof value.builtAt === "string" ? value.builtAt : "",
		node: typeof value.node === "string" ? value.node : "",
		repoUrl: typeof value.repoUrl === "string" ? value.repoUrl : "",
		...(pinnedRef !== undefined ? { pinnedRef } : {}),
	};
}

/** Channel build this process runs from (walks up from the package dir), if any. */
export function detectChannelInstall(startDir: string = getPackageDir()): ChannelBuildInfo | undefined {
	let dir = startDir;
	for (;;) {
		const info = readChannelBuildInfo(dir);
		if (info) return info;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

export type NodeEngineCheck = { kind: "ok" } | { kind: "too-old"; required: string } | { kind: "unknown-range" };

/**
 * Compare a Node version against an `engines.node` range. Only `>=X.Y.Z` is understood;
 * any other form passes with "unknown-range" so future engines syntax cannot lock users out.
 */
export function checkNodeEngine(requirement: string | undefined, nodeVersion: string): NodeEngineCheck {
	if (requirement === undefined) return { kind: "ok" };
	const range = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(requirement.trim());
	const current = /^v(\d+)\.(\d+)\.(\d+)/.exec(nodeVersion);
	if (!range || !current) return { kind: "unknown-range" };
	const required = range.slice(1, 4).map(Number);
	const running = current.slice(1, 4).map(Number);
	for (let index = 0; index < 3; index++) {
		if (running[index] > required[index]) return { kind: "ok" };
		if (running[index] < required[index]) return { kind: "too-old", required: requirement.trim() };
	}
	return { kind: "ok" };
}

/** Install or rebuild a channel: shallow clone, engine check, npm ci, bundle build, swap. */
export async function installChannel(
	channel: ChannelName,
	options: ChannelOperationOptions = {},
): Promise<ChannelBuildResult> {
	const childProcess = options.process ?? defaultProcess;
	const buildsDir = getChannelBuildsDir();
	mkdirSync(join(buildsDir, STAGING_DIR_NAME), { recursive: true });
	const buildDir = getChannelBuildDir(channel);
	const release = await acquireChannelLock(buildsDir, channel);
	try {
		cleanupStaleStaging(buildsDir, channel);
		const repoUrl = process.env[TOUCAN_REPO_URL_ENV]?.trim() || DEFAULT_REPO_URL;
		const ref = options.pinnedRef ?? defaultRefFor(channel, childProcess, repoUrl);
		const remoteCommit = resolveRemoteCommit(childProcess, repoUrl, ref);
		const existing = readChannelBuildInfo(buildDir);
		if (!options.force && existing && existing.commit === remoteCommit) {
			return { kind: "up-to-date", info: existing };
		}

		const staging = mkdtempSync(join(buildsDir, STAGING_DIR_NAME, `${channel}-`));
		try {
			await childProcess.run("git", ["clone", "--depth", "1", "--branch", ref, repoUrl, staging], {
				cwd: buildsDir,
			});
			const info = await buildChannelBuild(childProcess, staging, channel, ref, repoUrl, options.pinnedRef);
			swapStagingIntoPlace(buildDir, staging);
			garbageCollectOldBuilds(buildsDir, channel);
			ensureLauncher();
			if (readActiveChannel() === undefined) writeActiveChannel(channel);
			return { kind: "built", info };
		} finally {
			rmSync(staging, { force: true, recursive: true });
		}
	} finally {
		await release();
	}
}

/** Rebuild an installed channel from GitHub; a pinned build stays on its pin. */
export async function updateChannel(
	channel: ChannelName,
	options: Omit<ChannelOperationOptions, "pinnedRef"> = {},
): Promise<ChannelBuildResult> {
	const installed = readChannelBuildInfo(getChannelBuildDir(channel));
	if (!installed) {
		throw new Error(`Channel "${channel}" is not installed. Run "toucan install toucan:${channel}".`);
	}
	return installChannel(channel, {
		...(installed.pinnedRef !== undefined ? { pinnedRef: installed.pinnedRef } : {}),
		force: options.force,
		process: options.process,
	});
}

/** Point the launcher at a channel, building it first when it is missing. */
export async function switchChannel(
	channel: ChannelName,
	options: ChannelOperationOptions = {},
): Promise<ChannelBuildInfo> {
	const info = readChannelBuildInfo(getChannelBuildDir(channel)) ?? (await installChannel(channel, options)).info;
	writeActiveChannel(channel);
	return info;
}

/** Delete a channel build; clears the active pointer when it pointed at the removed channel. */
export async function removeChannel(channel: ChannelName): Promise<void> {
	const buildsDir = getChannelBuildsDir();
	const buildDir = getChannelBuildDir(channel);
	if (!existsSync(buildDir)) {
		throw new Error(`Channel "${channel}" is not installed.`);
	}
	const release = await acquireChannelLock(buildsDir, channel);
	try {
		rmSync(buildDir, { force: true, recursive: true });
		if (readActiveChannel() === channel) clearActiveChannel();
	} finally {
		await release();
	}
}

/** Installed channel builds with their metadata and active flag. */
export function listChannelBuilds(): ChannelStatus[] {
	const active = readActiveChannel();
	const statuses: ChannelStatus[] = [];
	for (const channel of CHANNEL_NAMES) {
		const info = readChannelBuildInfo(getChannelBuildDir(channel));
		if (info) statuses.push({ info, active: info.channel === active });
	}
	return statuses;
}

/** Create or refresh `<home>/bin/toucan`; returns the launcher path. */
export function ensureLauncher(): string {
	const home = getToucanHome();
	const launcherDir = join(home, "bin");
	mkdirSync(launcherDir, { recursive: true });
	const target = join(launcherDir, LAUNCHER_FILE_NAME);
	const contents = renderLauncherScript(home);
	if (!existsSync(target) || readFileSync(target, "utf8") !== contents) {
		writeFileSync(target, contents);
	}
	chmodSync(target, 0o755);
	return target;
}

/** The POSIX launcher script: resolves the active channel at every invocation. */
export function renderLauncherScript(home: string): string {
	return `#!/bin/sh
# toucan launcher: starts the active channel build under TOUCAN_HOME.
# Generated by toucan (\`toucan launcher\` regenerates it); do not edit.
TOUCAN_HOME_DEFAULT=${JSON.stringify(home)}
TOUCAN_HOME="\${TOUCAN_HOME:-$TOUCAN_HOME_DEFAULT}"
TOUCAN_CHANNEL_FILE="$TOUCAN_HOME/channel"
if [ ! -f "$TOUCAN_CHANNEL_FILE" ]; then
	echo "toucan: no active channel. Run \\"toucan install toucan:stable\\" from another toucan, or re-run the installer." >&2
	exit 1
fi
TOUCAN_CHANNEL="$(cat "$TOUCAN_CHANNEL_FILE")"
TOUCAN_ENTRY="$TOUCAN_HOME/builds/$TOUCAN_CHANNEL/packages/coding-agent/dist/bundle/cli.js"
if [ ! -f "$TOUCAN_ENTRY" ]; then
	echo "toucan: channel \\"$TOUCAN_CHANNEL\\" is not installed. Run \\"toucan install toucan:$TOUCAN_CHANNEL\\"." >&2
	exit 1
fi
if ! command -v node >/dev/null 2>&1; then
	echo "toucan: node must be on PATH to run channel \\"$TOUCAN_CHANNEL\\"." >&2
	exit 1
fi
TOUCAN_CHANNEL="$TOUCAN_CHANNEL" exec node "$TOUCAN_ENTRY" "$@"
`;
}

function defaultRefFor(channel: ChannelName, childProcess: ChannelProcess, repoUrl: string): string {
	if (channel !== "stable") return channel;
	const tags = childProcess.capture("git", ["ls-remote", "--tags", repoUrl, "refs/tags/b*"]);
	const tag = resolveLatestBuildTag(tags);
	if (!tag) throw new Error(`No b<N> release tags found in ${repoUrl}; cannot resolve the stable channel.`);
	return tag;
}

/** Newest `b<N>` tag in `git ls-remote --tags` output; peeled and non-tag lines are ignored. */
export function resolveLatestBuildTag(lsRemoteOutput: string): string | undefined {
	let best: string | undefined;
	let bestNumber = -1;
	for (const line of lsRemoteOutput.split("\n")) {
		const match = /^[0-9a-f]+\trefs\/tags\/(b\d+)$/.exec(line);
		if (!match) continue;
		const tag = match[1];
		const number = Number.parseInt(tag.slice(1), 10);
		if (number > bestNumber) {
			bestNumber = number;
			best = tag;
		}
	}
	return best && BUILD_TAG_RE.test(best) ? best : undefined;
}

function resolveRemoteCommit(childProcess: ChannelProcess, repoUrl: string, ref: string): string {
	const output = childProcess.capture("git", ["ls-remote", repoUrl, ref]);
	let tagObject: string | undefined;
	let peeled: string | undefined;
	for (const line of output.split("\n")) {
		const match = /^([0-9a-f]{7,})\s+refs\/(?:heads|tags)\/(.+)$/.exec(line);
		if (!match) continue;
		if (match[2] === ref) tagObject = match[1];
		else if (match[2] === `${ref}^{}`) peeled = match[1];
	}
	const commit = peeled ?? tagObject;
	if (!commit) throw new Error(`Ref "${ref}" was not found in ${repoUrl}.`);
	return commit;
}

async function buildChannelBuild(
	childProcess: ChannelProcess,
	staging: string,
	channel: ChannelName,
	ref: string,
	repoUrl: string,
	pinnedRef: string | undefined,
): Promise<ChannelBuildInfo> {
	const engine = checkNodeEngine(readEnginesNode(join(staging, "package.json")), process.version);
	if (engine.kind === "too-old") {
		throw new Error(
			`This ${channel} build requires Node ${engine.required}, but this is ${process.version}. Install a newer Node and retry.`,
		);
	}
	await childProcess.run("npm", ["ci", "--ignore-scripts"], { cwd: staging });
	for (const buildPackage of WORKSPACE_BUILD_PACKAGES) {
		await childProcess.run("npm", ["--prefix", `packages/${buildPackage}`, "run", "build"], { cwd: staging });
	}
	await childProcess.run("npm", ["run", "build"], { cwd: join(staging, "packages", "coding-agent") });
	if (!existsSync(join(staging, "packages", "coding-agent", "dist", "bundle", "cli.js"))) {
		throw new Error("The build finished but packages/coding-agent/dist/bundle/cli.js is missing.");
	}
	const commit = childProcess.capture("git", ["rev-parse", "HEAD"], { cwd: staging }).trim();
	const info: ChannelBuildInfo = {
		kind: "toucan-channel",
		schemaVersion: 1,
		channel,
		ref,
		commit,
		builtAt: new Date().toISOString(),
		node: process.version,
		repoUrl,
		...(pinnedRef !== undefined ? { pinnedRef } : {}),
	};
	writeFileSync(join(staging, BUILD_METADATA_FILE), `${JSON.stringify(info, null, "\t")}\n`);
	return info;
}

function readEnginesNode(packageJsonPath: string): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripBom(readFileSync(packageJsonPath, "utf8")));
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const engines = (parsed as { engines?: unknown }).engines;
	if (typeof engines !== "object" || engines === null) return undefined;
	const node = (engines as { node?: unknown }).node;
	return typeof node === "string" ? node : undefined;
}

function swapStagingIntoPlace(buildDir: string, staging: string): void {
	const previous = `${buildDir}.old-${Date.now()}`;
	if (existsSync(buildDir)) renameSync(buildDir, previous);
	try {
		renameSync(staging, buildDir);
	} catch (error) {
		if (existsSync(previous)) renameSync(previous, buildDir);
		throw error;
	}
	rmSync(previous, { force: true, recursive: true });
}

function garbageCollectOldBuilds(buildsDir: string, channel: ChannelName): void {
	for (const entry of readdirSync(buildsDir)) {
		if (entry.startsWith(`${channel}.old-`)) {
			// Leftover builds may hold Windows-locked files; the next successful swap retries.
			rmSync(join(buildsDir, entry), { force: true, recursive: true });
		}
	}
}

function cleanupStaleStaging(buildsDir: string, channel: ChannelName): void {
	const stagingRoot = join(buildsDir, STAGING_DIR_NAME);
	let entries: string[];
	try {
		entries = readdirSync(stagingRoot);
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.startsWith(`${channel}-`)) {
			rmSync(join(stagingRoot, entry), { force: true, recursive: true });
		}
	}
}

async function acquireChannelLock(buildsDir: string, channel: ChannelName): Promise<() => Promise<void>> {
	try {
		return await lockfile.lock(join(buildsDir, channel), { realpath: false, stale: LOCK_STALE_MS, retries: 0 });
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "ELOCKED") {
			throw new Error(`Another toucan channel operation is already running for "${channel}".`);
		}
		throw error;
	}
}
