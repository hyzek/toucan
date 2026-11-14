import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// `test` is skipped because package.json files under test/ trees are fixtures (plugin fixtures, the chord
// tutorial app) whose versions and dependencies are asserted verbatim by tests and docs; release tooling must
// never rewrite them. A real package must not be placed under a test/ directory.
const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules", "test"]);

export function findPackageDirectories(root = "packages") {
	const packageDirectories = [];

	function visit(directory) {
		if (existsSync(join(directory, "package.json"))) {
			packageDirectories.push(directory);
		}

		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) {
				continue;
			}
			visit(join(directory, entry.name));
		}
	}

	visit(root);
	return packageDirectories.sort();
}
