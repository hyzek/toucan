/**
 * The line that closes a turn in the transcript.
 *
 * A turn is one prompt through the agent loop: the prompt, the tool calls it causes, the answer. Saying
 * how long it took marks where a turn ends without drawing a rule across the transcript, and the running
 * total says what the session has cost so far.
 */

import { formatFinishedDuration } from "../../../utils/duration.ts";
import type { Theme } from "../theme/theme.ts";

const GLYPH = "✻";

/** `✻ Turn took 6s (Total time 2m 4s · 3 turns)`, with the turn's own time first. */
export function turnDurationLine(turnMs: number, totalMs: number, turns: number, theme: Theme): string {
	const turnsText = `${turns} turn${turns === 1 ? "" : "s"}`;
	const text = `Turn took ${formatFinishedDuration(turnMs)} (Total time ${formatFinishedDuration(totalMs)} · ${turnsText})`;
	return `${theme.fg("accent", GLYPH)} ${theme.fg("muted", text)}`;
}
