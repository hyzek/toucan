/**
 * Sampling a text file so a change can be shown as a diff.
 *
 * Tools that rewrite a file (shell edits, write) read it before and after the change and diff the two
 * texts. A file that cannot take part in that says so instead of passing as empty: a missing file is a
 * create, while a directory, a binary or an over-large file means the change cannot be shown honestly.
 */

import { stat as fsStat, readFile } from "fs/promises";

/** Files above this size are not diffed. */
export const DIFF_SNAPSHOT_MAX_BYTES = 256 * 1024;

/** What the file looked like when it was sampled. */
export type FileSnapshot = { kind: "content"; text: string } | { kind: "missing" } | { kind: "unusable" };

/**
 * Reads a file for a before-and-after diff. A missing file is a create; a directory, a binary or
 * an over-large file says it cannot be shown, rather than passing as empty.
 */
export async function snapshotFile(path: string): Promise<FileSnapshot> {
	try {
		const info = await fsStat(path);
		if (!info.isFile() || info.size > DIFF_SNAPSHOT_MAX_BYTES) {
			return { kind: "unusable" };
		}
		const text = await readFile(path, "utf8");
		return text.includes("\0") ? { kind: "unusable" } : { kind: "content", text };
	} catch {
		return { kind: "missing" };
	}
}
