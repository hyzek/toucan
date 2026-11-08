#!/usr/bin/env node
/**
 * Release script for toucan-mono
 *
 * Usage:
 *   node scripts/release.mjs                # cut the build numbered by the release commit
 *   node scripts/release.mjs <build-number> # override, only for release recovery
 *
 * Versions are build numbers: build N is package version N.0.0, tagged vN.0.0, announced as bN.
 * See scripts/build-name.mjs.
 *
 * Steps:
 * 1. Check for uncommitted changes
 * 2. Resolve the build number and verify every public workspace package is registered on npm,
 *    pin the newest model catalog for Nix, and build with it
 * 3. Set the version to <build>.0.0
 * 4. Update CHANGELOG.md files: [Unreleased] -> [version] - date
 * 5. Regenerate release artifacts
 * 6. Run checks and tests
 * 7. Commit and tag the release
 * 8. Add new [Unreleased] section to changelogs
 * 9. Commit next-cycle changelog updates
 * 10. Push main and the tag to trigger CI publication and verified pi.dev announcement
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildNameFromVersion, buildNumberFromVersion, versionFromBuildNumber } from "./build-name.mjs";
import { findPackageDirectories } from "./package-workspaces.mjs";
import { getPublicWorkspacePackages } from "./release-packages.mjs";
import { hydrateModelCatalogBytes, updateModelCatalogPin } from "./update-model-catalog-pin.mjs";

const BUILD_OVERRIDE = process.argv[2];
if (BUILD_OVERRIDE !== undefined && !/^\d+$/.test(BUILD_OVERRIDE)) {
	console.error("Usage: node scripts/release.mjs [build-number]");
	process.exit(1);
}

function run(cmd, options = {}) {
	console.log(`$ ${cmd}`);
	try {
		return execSync(cmd, { encoding: "utf-8", stdio: options.silent ? "pipe" : "inherit", ...options });
	} catch (e) {
		if (!options.ignoreError) {
			console.error(`Command failed: ${cmd}`);
			process.exit(1);
		}
		return null;
	}
}

function getVersion() {
	const pkg = JSON.parse(readFileSync("packages/ai/package.json", "utf-8"));
	return pkg.version;
}

function assertPackagesAreRegisteredWithNpm() {
	const packageNames = getPublicWorkspacePackages().map((pkg) => pkg.name);
	const unregisteredPackages = [];

	console.log("Checking npm package registration...");
	for (const packageName of packageNames) {
		const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["view", packageName, "version", "--json"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});

		if (result.status === 0 && result.stdout.trim()) {
			console.log(`  ${packageName}`);
			continue;
		}

		const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n");
		if (output.includes("E404") || output.includes("404 Not Found")) {
			unregisteredPackages.push(packageName);
			continue;
		}

		throw new Error(output ? `Failed to query npm registration for ${packageName}\n${output}` : `Failed to query npm registration for ${packageName}`);
	}

	if (unregisteredPackages.length > 0) {
		throw new Error(`The following public workspace packages are not registered on npm:\n${unregisteredPackages.map((packageName) => `  ${packageName}`).join("\n")}\nRegister them before running a release.`);
	}

	console.log("  All public workspace packages are registered on npm\n");
}

const MODEL_CATALOG_PIN = "nix/model-catalog.json";

// Release tags are immutable, so the tagged Nix pin must already build the
// release. Pin the newest catalog unconditionally (`--if-stale` only avoids pin
// churn on main), then run the Nix build's steps: hydrate the checkout's model
// data from it and build offline. This catches e.g. source that references a
// model the catalog lacks. On failure, restore the committed pin so the
// worktree is clean for a rerun.
async function pinAndBuildWithNewestModelCatalog() {
	const root = process.cwd();
	const committedPin = readFileSync(MODEL_CATALOG_PIN, "utf8");
	const restored = `${MODEL_CATALOG_PIN} was restored. Run \`npm run generate:models\` to restore local model data, then rerun the release.`;
	let revision;
	let result;
	try {
		const pin = await updateModelCatalogPin(root);
		revision = pin.revision;
		console.log(`  Pinned model catalog ${revision}`);
		hydrateModelCatalogBytes(root, pin.bytes);
		console.log("$ npm run build:offline");
		const npm = process.platform === "win32" ? "npm.cmd" : "npm";
		result = spawnSync(npm, ["run", "build:offline"], { stdio: "inherit" });
	} finally {
		if (result?.status !== 0) writeFileSync(MODEL_CATALOG_PIN, committedPin);
	}
	// Only a build that ran and exited non-zero says anything about the catalog.
	if (result.error || result.signal) {
		const cause = result.error ? result.error.message : `it was stopped by ${result.signal}`;
		console.error(`Error: npm run build:offline did not complete: ${cause}.\n${restored}`);
		process.exit(1);
	}
	if (result.status !== 0) {
		console.error(
			`Error: the build with the newest published model catalog ${revision} failed; the Nix build of the release tag would fail too.\n` +
				"If the errors concern model IDs, types, or APIs, the catalog predates main: publish one from main (Publish Model Catalog workflow).\n" +
				"Otherwise fix the build (e.g. run `npm ci --ignore-scripts` if node_modules is out of date).\n" +
				restored,
		);
		process.exit(1);
	}
}

function shellQuote(value) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The build number this release carries: the release commit's position on main, so build N is tagged
 * on the commit where `git rev-list --count HEAD` equals N. Commit counts only stay monotonic on
 * main, hence the branch check and the `<build-number>` override for release recovery.
 */
function resolveBuildNumber(currentVersion) {
	const currentBuild = buildNumberFromVersion(currentVersion);
	if (currentBuild === undefined) {
		console.error(
			`Error: current version ${currentVersion} is not a build version (N.0.0). Migrate the checkout first:\n` +
				"  npm version <N>.0.0 --workspaces --no-git-tag-version --no-workspaces-update && node scripts/sync-versions.js",
		);
		process.exit(1);
	}

	const branch = run("git rev-parse --abbrev-ref HEAD", { silent: true }).trim();
	if (branch !== "main") {
		console.error(`Error: releases cut their build number from main, but HEAD is on ${branch}.`);
		process.exit(1);
	}

	const commitsBeforeRelease = Number.parseInt(run("git rev-list --count HEAD", { silent: true }).trim(), 10);
	const buildNumber = BUILD_OVERRIDE === undefined ? commitsBeforeRelease + 1 : Number.parseInt(BUILD_OVERRIDE, 10);
	if (buildNumber <= currentBuild) {
		console.error(
			`Error: build ${buildNumber} does not succeed ${currentBuild}. A rebase or squash lowered the ` +
				"commit count; pass the next build number explicitly.",
		);
		process.exit(1);
	}
	return buildNumber;
}

function applyVersion(version) {
	console.log(`Setting version (${version})...`);
	run(`npm version ${version} --workspaces --no-git-tag-version --no-workspaces-update && node scripts/sync-versions.js && npm install --package-lock-only --ignore-scripts`);

	// npm version can temporarily install the previous workspace versions before
	// sync-versions updates inter-package ranges. Remove those stale lock entries,
	// refresh the lockfile, then hydrate from the final dependency graph.
	removeStaleWorkspaceLockEntries();
	run("npm install --package-lock-only --ignore-scripts");
	run("npm ci --ignore-scripts");
	return getVersion();
}

function removeStaleWorkspaceLockEntries() {
	const workspaceVersions = new Map(
		getPublicWorkspacePackages().map((pkg) => [pkg.name, pkg.version]),
	);
	const lockPath = "package-lock.json";
	const lock = JSON.parse(readFileSync(lockPath, "utf8"));
	let removed = 0;

	for (const [path, pkg] of Object.entries(lock.packages)) {
		if (!path.startsWith("packages/") || pkg.link === true) {
			continue;
		}
		for (const [name, version] of workspaceVersions) {
			if (path.endsWith(`/node_modules/${name}`) && pkg.version !== version) {
				delete lock.packages[path];
				removed++;
				break;
			}
		}
	}

	if (removed > 0) {
		writeFileSync(lockPath, `${JSON.stringify(lock, null, "\t")}\n`);
		console.log(`Removed ${removed} stale workspace package lock ${removed === 1 ? "entry" : "entries"}.`);
	}
}

function stageChangedFiles() {
	const output = run("git ls-files -m -o -d --exclude-standard", { silent: true });
	const paths = [...new Set((output || "").split("\n").map((line) => line.trim()).filter(Boolean))];
	if (paths.length === 0) {
		return;
	}

	run(`git add -- ${paths.map(shellQuote).join(" ")}`);
}

function getChangelogs() {
	return findPackageDirectories()
		.map((directory) => join(directory, "CHANGELOG.md"))
		.filter((path) => existsSync(path));
}

function updateChangelogsForRelease(version) {
	const date = new Date().toISOString().split("T")[0];
	const changelogs = getChangelogs();

	for (const changelog of changelogs) {
		const content = readFileSync(changelog, "utf-8");

		if (!content.includes("## [Unreleased]")) {
			console.log(`  Skipping ${changelog}: no [Unreleased] section`);
			continue;
		}

		const updated = content.replace(
			"## [Unreleased]",
			`## [${version}] - ${date}`
		);
		writeFileSync(changelog, updated);
		console.log(`  Updated ${changelog}`);
	}
}

function addUnreleasedSection() {
	const changelogs = getChangelogs();
	const unreleasedSection = "## [Unreleased]\n\n";

	for (const changelog of changelogs) {
		const content = readFileSync(changelog, "utf-8");

		// Insert after "# Changelog\n\n"
		const updated = content.replace(
			/^(# Changelog\n\n)/,
			`$1${unreleasedSection}`
		);
		writeFileSync(changelog, updated);
		console.log(`  Added [Unreleased] to ${changelog}`);
	}
}

// Main flow
console.log("\n=== Release Script ===\n");

// 1. Check for uncommitted changes
console.log("Checking for uncommitted changes...");
const status = run("git status --porcelain", { silent: true });
if (status && status.trim()) {
	console.error("Error: Uncommitted changes detected. Commit or stash first.");
	console.error(status);
	process.exit(1);
}
console.log("  Working directory clean\n");

// 2. Resolve the build number and verify npm package registration before modifying the worktree.
const version = versionFromBuildNumber(resolveBuildNumber(getVersion()));
const buildName = buildNameFromVersion(version);
console.log(`Cutting ${buildName} (package version ${version})\n`);
assertPackagesAreRegisteredWithNpm();

// Pin and verify the Nix model catalog before modifying versions, so the pin
// lands in the release commit and a failure leaves the worktree clean.
console.log("Pinning and building with the newest model catalog for Nix...");
await pinAndBuildWithNewestModelCatalog();
console.log();

// 3. Set the version
applyVersion(version);
console.log(`  New version: ${getVersion()}\n`);

// 4. Update changelogs
console.log("Updating CHANGELOG.md files...");
updateChangelogsForRelease(version);
console.log();

// 5. Regenerate release artifacts
console.log("Regenerating release artifacts...");
run("npm run generate:models");
run("npm run check:model-data");
run("npm run install-lock:coding-agent");
console.log();

// 6. Run checks and tests
console.log("Running checks...");
run("npm run check");
console.log();

console.log("Building packages for tests...");
run("npm run build:offline");
console.log();

// TOUCAN_RELEASE_SKIP_TESTS=1 skips the test suite, e.g. when it already passed in `npm run release:local`
// and an overloaded machine makes timing-sensitive tests fail. Checks and the install check still run.
if (process.env.TOUCAN_RELEASE_SKIP_TESTS === "1") {
	console.log("Skipping tests (TOUCAN_RELEASE_SKIP_TESTS=1)\n");
} else {
	console.log("Running tests...");
	run("./test.sh");
	console.log();
}

console.log("Checking the packed coding-agent consumer install...");
run("npm run check:package-install");
console.log();

// 7. Commit and tag
console.log("Committing and tagging...");
stageChangedFiles();
run(`git commit -m "Release ${buildName} (v${version})"`);
run(`git tag v${version}`);
console.log();

// 8. Add new [Unreleased] sections
console.log("Adding [Unreleased] sections for next cycle...");
addUnreleasedSection();
console.log();

// 9. Commit
console.log("Committing changelog updates...");
stageChangedFiles();
run(`git commit -m "Add [Unreleased] section for next cycle"`);
console.log();

// 10. Push
console.log("Pushing to remote...");
run("git push origin main");
run(`git push origin v${version}`);
console.log();

console.log(
	`=== Prepared ${buildName} (v${version}); CI publication and pi.dev announcement start after the tag push ===`,
);
