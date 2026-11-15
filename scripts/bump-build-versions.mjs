// Set every workspace package to build version 1.N.0 in lockstep (usage:
// node scripts/bump-build-versions.mjs <N>). Called by the auto-release
// workflow on each push to main; the bumped commit is the bN release commit.
// The workspace set comes from the root package.json ("workspaces"), including
// apps and the example packages, because their exact pins of unpublished
// workspace packages must resolve locally. The private root package keeps its
// own version; it is never published.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const buildNumber = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isSafeInteger(buildNumber) || buildNumber <= 0) {
	console.error("usage: node scripts/bump-build-versions.mjs <build number>");
	process.exit(1);
}

const version = `1.${buildNumber}.0`;
const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

function workspaceDirs(rootPackageJsonPath = "package.json") {
	const root = JSON.parse(readFileSync(rootPackageJsonPath, "utf8"));
	const dirs = [];
	for (const entry of root.workspaces ?? []) {
		if (entry.endsWith("/*")) {
			const base = entry.slice(0, -2);
			for (const child of readdirSync(base, { withFileTypes: true })) {
				if (child.isDirectory()) dirs.push(join(base, child.name));
			}
		} else {
			dirs.push(entry);
		}
	}
	return dirs;
}

const packageJsons = workspaceDirs()
	.map((dir) => join(dir, "package.json"))
	.filter((path) => existsSync(path))
	.map((path) => ({ path, json: JSON.parse(readFileSync(path, "utf8")) }));

// Workspace dependencies are pinned to exact versions, so they move with the packages.
const workspaceNames = new Set(packageJsons.map(({ json }) => json.name));

let changed = 0;
for (const { path, json } of packageJsons) {
	let touched = json.version !== version;
	json.version = version;
	for (const field of dependencyFields) {
		const deps = json[field];
		if (!deps) continue;
		for (const [name, spec] of Object.entries(deps)) {
			if (workspaceNames.has(name) && /^\d+\.\d+\.\d+$/.test(spec) && spec !== version) {
				deps[name] = version;
				touched = true;
			}
		}
	}
	if (!touched) continue;
	// Tabs match the checked-in formatting, so the diff stays minimal per package.
	writeFileSync(path, `${JSON.stringify(json, null, "\t")}\n`);
	console.log(`${json.name} -> ${version}`);
	changed++;
}

console.log(changed === 0 ? `All packages already at ${version}.` : `Bumped ${changed} packages to ${version}.`);
