/**
 * Elapsed-time text for the transcript: the running tool group's `· 3s` tail and the collapsed
 * thinking row's `Thought for 3s` both need whole seconds, which `formatToolDuration`'s decimals
 * would make jitter on a line that redraws every second. A run that has finished takes the decimals
 * back, because a `0s` there reads as a broken timer.
 */

/** `3s` up to a minute, then `1m 4s`. */
export function formatElapsedSeconds(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * How long something that has finished took: one decimal under a second, where a rounded `0s` reads as a
 * broken timer, and `formatElapsedSeconds` from a second up. A number that counts up while the thing runs
 * keeps whole seconds: its `0s` says "just started", not "failed to measure".
 */
export function formatFinishedDuration(ms: number): string {
	if (ms < 1000) return `${Math.max(0, ms / 1000).toFixed(1)}s`;
	return formatElapsedSeconds(ms);
}
