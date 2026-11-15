/**
 * Toucan's version naming scheme: a build number.
 *
 * A build is numbered by its position on main: the commit that carries the release is commit N, its
 * package version is `1.N.0` (npm only accepts semver), and everything a person reads says `bN`:
 * `toucan --version`, the launch screen, the GitHub release title, the release commit, and the tag:
 * `bN`, so `git rev-list --count <tag>` equals N. Releases before this scheme carried `N.0.0`; both
 * forms map to the same build number, so installs made under the old scheme keep updating.
 */

/** Build number of a package version (`1.N.0`, or the legacy `N.0.0`), or undefined for other versions. */
export function buildNumberFromVersion(version) {
	const build = /^1\.(\d+)\.0$/.exec(version ?? "");
	// "1.0.0" cannot be build 0 (builds start at 1); read it as the legacy build 1.
	if (build && build[1] !== "0") return Number.parseInt(build[1], 10);
	const legacy = /^(\d+)\.0\.0$/.exec(version ?? "");
	return legacy ? Number.parseInt(legacy[1], 10) : undefined;
}

/** Build name of a package version, e.g. 1.23.0 or the legacy 23.0.0 -> b23. */
export function buildNameFromVersion(version) {
	return `b${buildNumberFromVersion(version) ?? String(version).split(".")[0]}`;
}

/** Package version that carries a build number, e.g. 23 -> 1.23.0. */
export function versionFromBuildNumber(buildNumber) {
	return `1.${buildNumber}.0`;
}
