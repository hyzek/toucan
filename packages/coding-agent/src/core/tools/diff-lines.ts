/**
 * The display diff as data rather than text.
 *
 * Tools store a diff for display as a string, one line per changed or context line, written by
 * `generateDiffString` as `sign + padded number + " " + text`. A view that colours, highlights and
 * folds a diff needs the pieces that string hides: which side a line belongs to, its number, its
 * text, which runs of lines form one change, and which characters inside a changed pair actually
 * differ. This file recovers them.
 */

import * as Diff from "diff";

/** Which side of the change a diff line is on. */
export type DiffLineKind = "context" | "removed" | "added" | "separator";

/**
 * One line of a display diff. A separator marks context the diff left out, so its line numbers jump.
 */
export interface DiffLine {
	kind: DiffLineKind;
	/** Number in the old file; absent on added lines and separators. */
	oldNumber?: number;
	/** Number in the new file; absent on removed lines and separators. */
	newNumber?: number;
	/** The line as it is on its side, without the sign or the number. */
	text: string;
}

/** Where a removed line and the added line that replaced it differ, as character ranges. */
export interface WordMarks {
	/** Characters the two lines share, over the length of the longer one. */
	similarity: number;
	/** Ranges of the removed line to mark. */
	removed: Array<[number, number]>;
	/** Ranges of the added line to mark. */
	added: Array<[number, number]>;
}

/** The marker a display diff uses for context it left out. */
const ELLIPSIS = "...";

/** Reads back what `generateDiffString` wrote. Unrecognised lines keep their text as context. */
export function parseDisplayDiff(diff: string): DiffLine[] {
	const lines: DiffLine[] = [];
	for (const raw of diff.split("\n")) {
		const sign = raw[0];
		const body = raw.slice(1);
		const numbered = /^( *\d+) (.*)$/.exec(body);
		if (!numbered) {
			if (sign === " " && body.trim() === ELLIPSIS) {
				lines.push({ kind: "separator", text: ELLIPSIS });
			} else {
				lines.push({ kind: "context", text: raw });
			}
			continue;
		}
		const line = Number(numbered[1]);
		const text = numbered[2];
		if (sign === "-") {
			lines.push({ kind: "removed", oldNumber: line, text });
		} else if (sign === "+") {
			lines.push({ kind: "added", newNumber: line, text });
		} else if (text === ELLIPSIS) {
			lines.push({ kind: "separator", text: ELLIPSIS });
		} else {
			lines.push({ kind: "context", oldNumber: line, newNumber: line, text });
		}
	}
	return lines;
}

/**
 * Compares one removed line with the added line that replaced it.
 *
 * Highlighting a diff line by line would lose syntax context that spans lines, so the pair is
 * marked by character range instead of rebuilt: the ranges say where the two lines differ, and the
 * view decides how to show them. Leading whitespace both lines share is skipped before comparing, so
 * an insertion at the start of a line does not swallow the indentation.
 */
export function wordMarks(oldText: string, newText: string): WordMarks {
	if (!oldText && !newText) {
		return { similarity: 1, removed: [], added: [] };
	}
	const indent = sharedIndent(oldText, newText);
	const parts = Diff.diffWords(oldText.slice(indent), newText.slice(indent));
	const removed: Array<[number, number]> = [];
	const added: Array<[number, number]> = [];
	let oldPos = indent;
	let newPos = indent;
	let shared = indent;
	for (const part of parts) {
		if (part.removed) {
			removed.push([oldPos, oldPos + part.value.length]);
			oldPos += part.value.length;
		} else if (part.added) {
			added.push([newPos, newPos + part.value.length]);
			newPos += part.value.length;
		} else {
			shared += part.value.length;
			oldPos += part.value.length;
			newPos += part.value.length;
		}
	}
	const longest = Math.max(oldText.length, newText.length);
	return { similarity: longest > 0 ? shared / longest : 1, removed, added };
}

/** Length of the whitespace both lines start with. */
function sharedIndent(oldText: string, newText: string): number {
	let index = 0;
	while (
		index < oldText.length &&
		index < newText.length &&
		oldText[index] === newText[index] &&
		/\s/.test(oldText[index])
	) {
		index++;
	}
	return index;
}

/** A run of diff lines the display shows together; separators divide them. */
export interface DiffHunk {
	/** Index in the parsed lines where the hunk starts. */
	start: number;
	/** Parsed lines the hunk covers, its separators excluded. */
	length: number;
	/**
	 * Where the change sits: the number of the hunk's first changed line, in the old file when the
	 * hunk starts by removing lines. Zero when the hunk holds no change.
	 */
	line: number;
	added: number;
	removed: number;
}

/** The counts a diff block states about itself, for its summary line and its footer. */
export interface DiffStats {
	/** Every line of the display, separators included. */
	lines: number;
	added: number;
	removed: number;
	hunks: DiffHunk[];
}

/**
 * Groups parsed lines into hunks and counts what a diff block says about itself.
 *
 * A hunk is a run of lines with no separator in it, which is how a display diff already divides a
 * change that touches several places.
 */
export function diffStats(lines: readonly DiffLine[]): DiffStats {
	const hunks: DiffHunk[] = [];
	let added = 0;
	let removed = 0;
	let index = 0;
	while (index < lines.length) {
		if (lines[index].kind === "separator") {
			index++;
			continue;
		}
		const hunk: DiffHunk = { start: index, length: 0, line: 0, added: 0, removed: 0 };
		while (index < lines.length && lines[index].kind !== "separator") {
			const line = lines[index];
			hunk.length++;
			if (line.kind === "added") {
				hunk.added++;
				added++;
				hunk.line ||= line.newNumber ?? 0;
			} else if (line.kind === "removed") {
				hunk.removed++;
				removed++;
				hunk.line ||= line.oldNumber ?? 0;
			}
			index++;
		}
		hunks.push(hunk);
	}
	return { lines: lines.length, added, removed, hunks };
}

/**
 * Pairs the removed lines of a change with its added lines.
 *
 * Only runs of the same length pair up: a 3-line deletion followed by 1 line is a rewrite, and
 * drawing word marks between unrelated lines reads as noise.
 */
export function pairChanges(removed: readonly DiffLine[], added: readonly DiffLine[]): Array<[DiffLine, DiffLine]> {
	if (removed.length === 0 || added.length === 0 || removed.length !== added.length) {
		return [];
	}
	return removed.map((line, index): [DiffLine, DiffLine] => [line, added[index]]);
}
