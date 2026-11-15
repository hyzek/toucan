// Whether the running toucan build could update, and whether to say so. A channel build asks
// its own git remote (the same resolution `toucan update` uses); any other install asks the
// GitHub release feed. Lookups are cached in update-check.json for the build that made them, and
// an available build is announced once.

import { getBuildName, RELEASE_FEED_URL, VERSION } from "../config.ts";
import { spawnProcess, waitForChildProcess } from "../utils/child-process.ts";
import { fetchWithRetry } from "../utils/management-http.ts";
import { getToucanUserAgent } from "../utils/toucan-user-agent.ts";
import {
	type ChannelBuildInfo,
	channelRepoUrl,
	channelTrackedRef,
	detectChannelInstall,
	parseRemoteCommit,
	resolveLatestBuildTag,
} from "./channel-manager.ts";
import {
	isUpdateCheckFresh,
	type RemotePosition,
	readUpdateCheckState,
	remotePositionOf,
	updateCheckRecord,
	writeUpdateCheckState,
} from "./update-check-state.ts";

/** A build the user could move to, and how to name it. */
export type AvailableBuild =
	| {
			kind: "release";
			/** Release label, e.g. `b70`. */
			label: string;
			/** Release page; absent when the remote has no web UI (local clones). */
			url?: string;
	  }
	| {
			kind: "branch";
			/** Branch the build follows, e.g. `dev`. */
			ref: string;
			/** Commit the branch points at now, shortened. */
			commit: string;
			/** Commit page; absent when the remote has no web UI (local clones). */
			url?: string;
	  };

/** Git seam for the lookups, so tests do not need git. Undefined means the remote was unreachable. */
export interface BuildUpdateCheckProcess {
	lsRemote(args: string[]): Promise<string | undefined>;
}

export interface BuildUpdateCheckOptions {
	process?: BuildUpdateCheckProcess;
	/** Channel build to compare against. Defaults to the build this process runs from. */
	install?: ChannelBuildInfo | undefined;
	/** Clock override for cache tests. */
	nowMs?: number;
}

const GIT_TIMEOUT_MS = 5_000;
const HTTP_TIMEOUT_MS = 5_000;
const SHORT_COMMIT_LENGTH = 7;
const BUILD_TAG_RE = /^b\d+$/;

/**
 * Available build for this launch, or undefined when the build is current, the lookup failed,
 * or the announcement already happened. Never throws: an update notice must not break startup.
 */
export async function checkForAvailableBuild(
	options: BuildUpdateCheckOptions = {},
): Promise<AvailableBuild | undefined> {
	if (process.env.TOUCAN_OFFLINE || process.env.TOUCAN_SKIP_VERSION_CHECK) return undefined;

	const nowMs = options.nowMs ?? Date.now();
	const install = options.install ?? detectChannelInstall();
	// A build pinned with `@<ref>` never moves under `toucan update`, so there is nothing to announce.
	if (install?.pinnedRef !== undefined) return undefined;

	const source = install ? `channel:${install.channel}` : "release";
	// The channel build's commit: an answer written before `toucan update` describes the build that
	// is gone, so a record from another commit is never reused. Non-channel installs have no commit
	// to name themselves by (a source checkout moves on its own); they compare on the feed alone.
	const localIdentity = install?.commit;
	const cached = readUpdateCheckState(source, localIdentity);
	const remote =
		cached && isUpdateCheckFresh(cached, nowMs)
			? remotePositionOf(cached)
			: await lookupRemote(install, options.process);
	if (!remote) return undefined;

	if (isCurrentBuild(remote, install)) {
		// Cache the "nothing to do" answer too, so most launches never reach the network.
		if (!cached) writeUpdateCheckState(updateCheckRecord(source, remote, false, nowMs, localIdentity));
		return undefined;
	}
	if (cached?.notifiedIdentity === remote.identity) return undefined;

	writeUpdateCheckState(updateCheckRecord(source, remote, true, nowMs, localIdentity));
	return availableBuild(remote);
}

/** Remote position this build would update to; undefined when the remote could not be read. */
async function lookupRemote(
	install: ChannelBuildInfo | undefined,
	process: BuildUpdateCheckProcess | undefined,
): Promise<RemotePosition | undefined> {
	if (install) return lookupChannelRemote(install, process ?? defaultGitProcess);
	return lookupReleaseRemote();
}

async function lookupChannelRemote(
	install: ChannelBuildInfo,
	git: BuildUpdateCheckProcess,
): Promise<RemotePosition | undefined> {
	const repoUrl = channelRepoUrl(install.channel);
	const trackedRef = channelTrackedRef(install);
	const ref = trackedRef === undefined ? await latestTagRemote(repoUrl, git) : trackedRef;
	if (ref === undefined) return undefined;

	const listing = await git.lsRemote([repoUrl, ref]);
	if (listing === undefined) return undefined;
	const commit = parseRemoteCommit(listing, ref);
	if (!commit) return undefined;

	const label = BUILD_TAG_RE.test(ref) ? ref : commit.slice(0, SHORT_COMMIT_LENGTH);
	const url = webPageFor(repoUrl, ref, commit);
	return { identity: commit, label, ref, ...(url !== undefined ? { url } : {}) };
}

/** Newest release tag in a remote; the ref an unpinned `stable` build tracks. */
async function latestTagRemote(repoUrl: string, git: BuildUpdateCheckProcess): Promise<string | undefined> {
	const tagList = await git.lsRemote(["--tags", repoUrl, "refs/tags/b*"]);
	if (tagList === undefined) return undefined;
	return resolveLatestBuildTag(tagList);
}

/** Newest release on GitHub, for installs that are not channel builds (source checkouts, npm). */
async function lookupReleaseRemote(): Promise<RemotePosition | undefined> {
	try {
		const response = await fetchWithRetry(
			RELEASE_FEED_URL,
			{ headers: { "User-Agent": getToucanUserAgent(VERSION), accept: "application/vnd.github+json" } },
			{ maxRetries: 0, timeoutMs: HTTP_TIMEOUT_MS },
		);
		if (!response.ok) return undefined;
		const release = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
		if (typeof release.tag_name !== "string" || !BUILD_TAG_RE.test(release.tag_name)) return undefined;
		const url = typeof release.html_url === "string" && release.html_url ? release.html_url : undefined;
		return { identity: release.tag_name, label: release.tag_name, ...(url ? { url } : {}) };
	} catch {
		return undefined;
	}
}

/** True when the running build already is `remote`. */
function isCurrentBuild(remote: RemotePosition, install: ChannelBuildInfo | undefined): boolean {
	const remoteNumber = buildNumber(remote.label);
	if (remoteNumber === undefined) return install ? remote.identity === install.commit : true;
	// The build's own number: the tag a stable build was cut from, else the checkout's name.
	const localNumber = buildNumber(install?.ref ?? "") ?? buildNumber(getBuildName());
	// A release tag is never an update over a build of the same or a newer number. Without
	// this, a channel install whose cached remote position went stale while the build updated
	// announces the older tag (its identity no longer matches the checkout).
	if (localNumber !== undefined && remoteNumber <= localNumber) return true;
	return install ? remote.identity === install.commit : false;
}

/** Announcement for a remote position: a named release, or new commits on a branch. */
function availableBuild(remote: RemotePosition): AvailableBuild {
	const url = remote.url !== undefined ? { url: remote.url } : {};
	if (remote.ref === undefined || BUILD_TAG_RE.test(remote.ref))
		return { kind: "release", label: remote.label, ...url };
	return { kind: "branch", ref: remote.ref, commit: remote.label, ...url };
}

function buildNumber(label: string): number | undefined {
	const match = /^b(\d+)$/.exec(label.trim());
	return match ? Number.parseInt(match[1], 10) : undefined;
}

const defaultGitProcess: BuildUpdateCheckProcess = {
	async lsRemote(args) {
		// Trust boundary: a missing, offline, or slow remote. Every failure is a silent no-op.
		try {
			const child = spawnProcess("git", ["ls-remote", ...args], {
				stdio: ["ignore", "pipe", "pipe"],
				signal: AbortSignal.timeout(GIT_TIMEOUT_MS),
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
			});
			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			const code = await waitForChildProcess(child);
			return code === 0 ? stdout : undefined;
		} catch {
			return undefined;
		}
	},
};

/** Web root of a github.com clone URL; undefined for local or non-GitHub remotes. */
function githubWebRepoUrl(cloneUrl: string): string | undefined {
	const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(cloneUrl.trim());
	return match ? `https://github.com/${match[1]}/${match[2]}` : undefined;
}

/** Page for the available build: its release when it is a tag, its commit otherwise. */
function webPageFor(cloneUrl: string, ref: string, commit: string): string | undefined {
	const web = githubWebRepoUrl(cloneUrl);
	if (!web) return undefined;
	return BUILD_TAG_RE.test(ref) ? `${web}/releases/tag/${ref}` : `${web}/commit/${commit}`;
}
