// Local git repository fixture for channel tests: branches dev/nightly/main, b<N>
// tags, and workspace packages whose build scripts finish instantly. Real git and
// npm run against it; nothing reaches the network.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GIT_IDENTITY = ["-c", "user.name=Channel Fixture", "-c", "user.email=channel-fixture@example.invalid"];

export interface ChannelRepoOptions {
	/** engines.node written into the root package.json. */
	enginesNode?: string;
}

// Read by the generated build script at build time so failure and delay can be
// turned on per install without rebuilding the repository (see integration tests).
const BUILD_SCRIPT = `import { mkdirSync, writeFileSync } from "node:fs";
if (process.env.FIXTURE_BUILD_FAILS === "1") process.exit(1);
const delay = Number(process.env.FIXTURE_BUILD_DELAY_MS ?? 0);
const deadline = Date.now() + delay;
while (Date.now() < deadline) {}
mkdirSync("dist/bundle", { recursive: true });
writeFileSync("dist/bundle/cli.js", CLI_SOURCE);
`;

// Echoes its arguments and implements the \`launcher\` subcommand the bootstrap
// installer invokes to create the PATH launcher script.
const CLI_STUB = `const fs = require("node:fs");
const path = require("node:path");
if (process.argv[2] === "launcher") {
  const home = process.env.TOUCAN_HOME;
  const dir = path.join(home, "bin");
  fs.mkdirSync(dir, { recursive: true });
  const launcher = path.join(dir, "toucan");
  fs.writeFileSync(launcher, "#!/bin/sh\\nexec node \\"" + process.argv[1] + "\\" \\"$@\\"\\n");
  fs.chmodSync(launcher, 0o755);
  console.log(launcher);
  process.exit(0);
}
console.log("fixture-cli", ...process.argv.slice(2));
`;

export interface ChannelRepoFixture {
	readonly repoDir: string;
	/** Current commit of a branch. */
	headOf(branch: string): string;
	/** Commit an annotated tag peels to. */
	commitOfTag(tag: string): string;
	/** Append an empty commit to a branch; returns the new commit. */
	commitOnBranch(branch: string, message: string): string;
	destroy(): void;
}

function run(command: string, args: string[], cwd: string): string {
	const result = spawnSync(command, args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr.trim()}`);
	}
	return result.stdout.trim();
}

function git(args: string[], cwd: string): string {
	return run("git", [...GIT_IDENTITY, ...args], cwd);
}

const WORKSPACE_PACKAGES = ["tui", "telemetry", "ai", "agent"] as const;

/** Create a throwaway repository that behaves like the toucan remote for channel builds. */
export function createChannelRepoFixture(options: ChannelRepoOptions = {}): ChannelRepoFixture {
	const repoDir = mkdtempSync(join(tmpdir(), "toucan-channel-remote-"));
	const engines = { node: options.enginesNode ?? ">=18.0.0" };

	writeFileSync(
		join(repoDir, "package.json"),
		JSON.stringify(
			{ name: "toucan-fixture", version: "0.0.1", private: true, engines, workspaces: ["packages/*"] },
			null,
			2,
		),
	);
	for (const workspacePackage of WORKSPACE_PACKAGES) {
		const packageDir = join(repoDir, "packages", workspacePackage);
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify(
				{
					name: `@fixture/${workspacePackage}`,
					version: "0.0.1",
					engines,
					scripts: {
						build: `node -e ${JSON.stringify("require('node:fs').mkdirSync('dist',{recursive:true});")}`,
					},
				},
				null,
				2,
			),
		);
	}
	const agentDir = join(repoDir, "packages", "coding-agent");
	mkdirSync(join(agentDir, "scripts"), { recursive: true });
	writeFileSync(
		join(agentDir, "package.json"),
		JSON.stringify(
			{ name: "@fixture/coding-agent", version: "0.0.1", engines, scripts: { build: "node scripts/build.mjs" } },
			null,
			2,
		),
	);
	const buildScript = BUILD_SCRIPT.replace("CLI_SOURCE", JSON.stringify(CLI_STUB));
	writeFileSync(join(agentDir, "scripts", "build.mjs"), buildScript);

	// The channel builder runs `npm ci --ignore-scripts`, so the clone needs a lockfile.
	run("npm", ["install", "--package-lock-only", "--ignore-scripts"], repoDir);

	git(["init", "-b", "main"], repoDir);
	git(["add", "-A"], repoDir);
	git(["commit", "-m", "initial"], repoDir);
	git(["branch", "dev"], repoDir);
	git(["branch", "nightly"], repoDir);
	git(["tag", "b2"], repoDir);
	git(["commit", "--allow-empty", "-m", "release"], repoDir);
	git(["tag", "-a", "b10", "-m", "annotated release"], repoDir);

	return {
		repoDir,
		headOf(branch) {
			return git(["rev-parse", `refs/heads/${branch}`], repoDir);
		},
		commitOfTag(tag) {
			return git(["rev-list", "-n", "1", `refs/tags/${tag}`], repoDir);
		},
		commitOnBranch(branch, message) {
			git(["checkout", branch], repoDir);
			git(["commit", "--allow-empty", "-m", message], repoDir);
			const commit = git(["rev-parse", "HEAD"], repoDir);
			git(["checkout", "main"], repoDir);
			return commit;
		},
		destroy() {
			rmSync(repoDir, { force: true, recursive: true });
		},
	};
}
