// Token counts narrow enough to sit beside other text. The info bar, `/status`, and the usage
// tables all print totals where `128457` would push the line past the terminal edge.

/** `950` as `950`, `1234` as `1.2k`, `23456` as `23k`, `1234567` as `1.2M`. */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}
