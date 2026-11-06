/**
 * The one-sentence summary of a run of consecutive tool calls: `Read 2 files, ran 1 shell command`.
 *
 * A group of tool calls collapses to this sentence instead of one row per call. It counts calls by
 * family; rendering the running ellipsis, the elapsed tail and the failed suffix is the row's job,
 * not this file's.
 */

import type { ToolRowStatus } from "./render-utils.ts";

/** One call inside a group: its registered name and the state its row's marker shows. */
export interface GroupedToolCall {
	name: string;
	status: ToolRowStatus;
}

/** What a group of calls says about itself. */
export interface ToolGroupSummary {
	/** Family parts joined by `, `, first letter capitalized: `Read 2 files, ran 1 shell command`. */
	sentence: string;
	/** True while any call in the group is still pending. */
	running: boolean;
	/** Calls that ended in error. */
	failed: number;
}

/** Verb forms per family: finished, running, singular noun, plural noun. */
const GROUP_VERBS = new Map<string, readonly [string, string, string, string]>([
	["read", ["read", "reading", "file", "files"]],
	["bash", ["ran", "running", "shell command", "shell commands"]],
	["grep", ["searched", "searching", "pattern", "patterns"]],
	["ls", ["listed", "listing", "directory", "directories"]],
	["edit", ["edited", "editing", "file", "files"]],
	["write", ["wrote", "writing", "file", "files"]],
]);

/** Tools that count as another family: `find` reads as a search beside `grep`, `powershell` as a shell. */
const GROUP_FAMILIES = new Map<string, string>([
	["find", "grep"],
	["powershell", "bash"],
]);

/** Bucket for tools with no family of their own, rendered `called <name>`. */
const CALLED_FAMILY = "called";

/**
 * Summarize a group of consecutive tool calls as one sentence. Empty groups summarize to nothing.
 */
export function summarizeToolGroup(calls: readonly GroupedToolCall[]): ToolGroupSummary {
	const counts = new Map<string, number>();
	const calledNames = new Map<string, number>();
	let running = false;
	let failed = 0;

	for (const call of calls) {
		if (call.status === "pending") running = true;
		if (call.status === "failed") failed += 1;
		const family = GROUP_FAMILIES.get(call.name) ?? call.name;
		if (GROUP_VERBS.has(family)) {
			counts.set(family, (counts.get(family) ?? 0) + 1);
		} else {
			counts.set(CALLED_FAMILY, (counts.get(CALLED_FAMILY) ?? 0) + 1);
			calledNames.set(call.name, (calledNames.get(call.name) ?? 0) + 1);
		}
	}

	const parts = [...counts].map(([family, count]) => {
		const verbs = GROUP_VERBS.get(family);
		if (!verbs) {
			const names = [...calledNames].map(([name, times]) => (times > 1 ? `${name} ×${times}` : name));
			return `${running ? "calling" : "called"} ${names.join(", ")}`;
		}
		const [finished, active, one, many] = verbs;
		const noun = count === 1 ? one : many;
		return `${running ? active : finished} ${count} ${noun}`;
	});

	const sentence = parts.join(", ");
	return {
		sentence: sentence.length === 0 ? "" : `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`,
		running,
		failed,
	};
}
