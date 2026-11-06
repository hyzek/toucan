/**
 * Elapsed-time text for the transcript: the running tool group's `· 3s` tail and the collapsed
 * thinking row's `Thought for 3s` both need whole seconds, which `formatToolDuration`'s decimals
 * would make jitter on a line that redraws every second.
 */

/** `3s` up to a minute, then `1m 4s`. */
export function formatElapsedSeconds(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
