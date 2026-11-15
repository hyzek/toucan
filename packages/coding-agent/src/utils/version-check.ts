import { compare, valid } from "semver";
import { numericVersion, PACKAGE_NAME, RELEASE_FEED_URL } from "../config.ts";
import { fetchWithRetry } from "./management-http.ts";
import { getToucanUserAgent } from "./toucan-user-agent.ts";

const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 10000;

export interface LatestToucanRelease {
	version: string;
	packageName?: string;
	note?: string;
}

/** Include useful errno details hidden behind Node's generic "fetch failed" error. */
export function formatVersionCheckError(error: unknown): string {
	const rootMessage = error instanceof Error && error.message ? error.message : String(error);
	const cause = error instanceof Error ? error.cause : undefined;
	const causes = cause instanceof AggregateError ? cause.errors : cause === undefined ? [] : [cause];
	const codes = causes
		.map((value) =>
			typeof value === "object" && value !== null && "code" in value && typeof value.code === "string"
				? value.code
				: undefined,
		)
		.filter((code): code is string => code !== undefined);

	if (codes.length > 0) return `${rootMessage} (${[...new Set(codes)].join(", ")})`;
	const causeMessage = causes.find(
		(value): value is Error => value instanceof Error && Boolean(value.message),
	)?.message;
	return causeMessage ? `${rootMessage} (cause: ${causeMessage})` : rootMessage;
}

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
	const left = valid(leftVersion.trim());
	const right = valid(rightVersion.trim());
	if (!left || !right) {
		return undefined;
	}
	return compare(left, right);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
	const comparison = comparePackageVersions(candidateVersion, currentVersion);
	if (comparison !== undefined) {
		return comparison > 0;
	}
	return candidateVersion.trim() !== currentVersion.trim();
}

/**
 * Newest Toucan release, from the GitHub release feed. Its `b<N>` tag answers as the numeric
 * version npm and self-update compare, and the package name is always this package's own:
 * a version feed must never decide what gets installed.
 */
export async function getLatestToucanRelease(
	currentVersion: string,
	options: { timeoutMs?: number; retry?: boolean } = {},
): Promise<LatestToucanRelease | undefined> {
	// TOUCAN_OFFLINE covers explicit update work too, like package-manager.ts.
	if (process.env.TOUCAN_OFFLINE) return undefined;

	const response = await fetchWithRetry(
		RELEASE_FEED_URL,
		{
			headers: {
				"User-Agent": getToucanUserAgent(currentVersion),
				accept: "application/vnd.github+json",
			},
		},
		{
			maxRetries: options.retry ? 2 : 0,
			timeoutMs: options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS,
		},
	);
	if (!response.ok) return undefined;

	const data = (await response.json()) as { tag_name?: unknown; body?: unknown };
	// Only Toucan's `b<N>` tags name a build; anything else must not become an install spec.
	if (typeof data.tag_name !== "string" || !/^b\d+$/.test(data.tag_name.trim())) {
		return undefined;
	}
	const note = typeof data.body === "string" && data.body.trim() ? data.body.trim() : undefined;
	return {
		version: numericVersion(data.tag_name),
		packageName: PACKAGE_NAME,
		...(note ? { note } : {}),
	};
}
