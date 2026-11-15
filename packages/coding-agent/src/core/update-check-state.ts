// Cached result of the build update check: when we last looked, what the remote held, and
// which build we already announced. Stored under TOUCAN_HOME so every channel build on the
// machine shares one answer and a build is announced at most once.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripBom } from "../utils/text.ts";
import { getToucanHome } from "./channel-manager.ts";

const STATE_FILE = "update-check.json";
/** A lookup younger than this is reused without touching the network. */
export const UPDATE_CHECK_TTL_MS = 20 * 60 * 60_000;

export interface UpdateCheckState {
	kind: "toucan-update-check";
	schemaVersion: 1;
	/** What was checked: `channel:<name>` for a channel build, `release` for any other install. */
	source: string;
	/** ISO timestamp of the lookup that produced this record. */
	checkedAt: string;
	/** Remote position found then: a release tag, or the commit of a branch channel. */
	remoteIdentity: string;
	/** Label announced for that remote position (`b70`, or a short commit). */
	remoteLabel: string;
	/** Ref the build follows (`dev`, `b70`); absent for installs that track the release feed. */
	remoteRef?: string;
	/** Release or commit page for that remote position, when the remote has a web UI. */
	remoteUrl?: string;
	/** Set once the user has been told about `remoteIdentity`; that build is not announced again. */
	notifiedIdentity?: string;
}

/** A remote position a build could update to, and how to point at it. */
export interface RemotePosition {
	/** Compared against the running build: a commit for channels, a release tag otherwise. */
	identity: string;
	/** Label to announce (`b70`, or a short commit). */
	label: string;
	/** Ref the build follows (`dev`, `b70`); absent for installs that track the release feed. */
	ref?: string;
	/** Release or commit page, absent when the remote has no web UI (local clones). */
	url?: string;
}

export function updateCheckStatePath(): string {
	return join(getToucanHome(), STATE_FILE);
}

/** Cached lookup for `source`; undefined when absent, unreadable, or for another source. */
export function readUpdateCheckState(source: string): UpdateCheckState | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripBom(readFileSync(updateCheckStatePath(), "utf8")));
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null) return undefined;
	// Trust boundary: the state file on disk (hand-edited or written by another version).
	const value = parsed as Partial<UpdateCheckState>;
	if (
		value.kind !== "toucan-update-check" ||
		value.schemaVersion !== 1 ||
		value.source !== source ||
		typeof value.checkedAt !== "string" ||
		typeof value.remoteIdentity !== "string" ||
		typeof value.remoteLabel !== "string"
	) {
		return undefined;
	}
	const notifiedIdentity =
		typeof value.notifiedIdentity === "string" && value.notifiedIdentity ? value.notifiedIdentity : undefined;
	const remoteUrl = typeof value.remoteUrl === "string" && value.remoteUrl ? value.remoteUrl : undefined;
	const remoteRef = typeof value.remoteRef === "string" && value.remoteRef ? value.remoteRef : undefined;
	return {
		kind: "toucan-update-check",
		schemaVersion: 1,
		source,
		checkedAt: value.checkedAt,
		remoteIdentity: value.remoteIdentity,
		remoteLabel: value.remoteLabel,
		...(remoteRef !== undefined ? { remoteRef } : {}),
		...(remoteUrl !== undefined ? { remoteUrl } : {}),
		...(notifiedIdentity !== undefined ? { notifiedIdentity } : {}),
	};
}

/** Replace the cached lookup. Failures are ignored: the cache is an optimization, not state. */
export function writeUpdateCheckState(state: UpdateCheckState): void {
	try {
		mkdirSync(getToucanHome(), { recursive: true });
		writeFileSync(updateCheckStatePath(), `${JSON.stringify(state, null, "\t")}\n`);
	} catch {
		// A read-only state root only costs one extra lookup on the next launch.
	}
}

/** True when the record is young enough to answer without a lookup. */
export function isUpdateCheckFresh(state: UpdateCheckState, nowMs: number): boolean {
	const checkedAt = Date.parse(state.checkedAt);
	if (Number.isNaN(checkedAt)) return false;
	return nowMs - checkedAt < UPDATE_CHECK_TTL_MS;
}

/**
 * Turn a cached record back into the remote position it describes, so a fresh cache answers
 * a launch without a lookup.
 */
export function remotePositionOf(state: UpdateCheckState): RemotePosition {
	return {
		identity: state.remoteIdentity,
		label: state.remoteLabel,
		...(state.remoteRef !== undefined ? { ref: state.remoteRef } : {}),
		...(state.remoteUrl !== undefined ? { url: state.remoteUrl } : {}),
	};
}

/** State record for a lookup of `source`; `announced` is set only when the user was told. */
export function updateCheckRecord(
	source: string,
	remote: RemotePosition,
	announced: boolean,
	nowMs: number,
): UpdateCheckState {
	return {
		kind: "toucan-update-check",
		schemaVersion: 1,
		source,
		checkedAt: new Date(nowMs).toISOString(),
		remoteIdentity: remote.identity,
		remoteLabel: remote.label,
		...(remote.ref !== undefined ? { remoteRef: remote.ref } : {}),
		...(remote.url !== undefined ? { remoteUrl: remote.url } : {}),
		...(announced ? { notifiedIdentity: remote.identity } : {}),
	};
}
