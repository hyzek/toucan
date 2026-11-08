/**
 * Toucan's version naming scheme: a build number.
 *
 * A build is numbered by its position on main: the commit that carries the release is commit N and its
 * package version is `N.0.0`, because npm only accepts semver. Everything a person reads says `bN`:
 * `toucan --version`, the launch screen, the GitHub release title, the release commit. The tag stays
 * `vN.0.0`, so `git rev-list --count <tag>` equals N.
 */

/** Build number of a package version, or undefined when the version is not a build (e.g. 1.5.0). */
export function buildNumberFromVersion(version) {
	const match = /^(\d+)\.0\.0$/.exec(version ?? "");
	return match ? Number.parseInt(match[1], 10) : undefined;
}

/** Build name of a package version, e.g. 23.0.0 -> b23. */
export function buildNameFromVersion(version) {
	return `b${String(version).split(".")[0]}`;
}

/** Package version that carries a build number, e.g. 23 -> 23.0.0. */
export function versionFromBuildNumber(buildNumber) {
	return `${buildNumber}.0.0`;
}
