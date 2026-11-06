import { formatUserAgent } from "@hyzek/toucan-ai";

/** toucan's `User-Agent` for its own network requests; the same detailed form toucan-ai sends to providers. */
export function getToucanUserAgent(version: string): string {
	return formatUserAgent({ userAgent: "detailed", version });
}
