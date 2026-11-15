// Session token, cache, and context numbers for the info bar. `AgentSession.getSessionStats()`
// walks every entry and `getContextUsage()` rebuilds the session projection, so the bar cannot
// call them on every redraw: usage folds in as messages finish, and the full walk runs when a
// turn settles, when a compaction rewrites history, or when the model changes.

import type { AgentSession, AgentSessionEvent } from "./agent-session.ts";
import { addUsageToTotals, createUsageTotals, type UsageTotals } from "./usage-totals.ts";

/** What the info bar shows about this session, as of one read. */
export interface FooterSnapshot {
	totals: UsageTotals;
	/** Estimated tokens in context, and the percent of the window they fill. */
	contextTokens: number | undefined;
	contextPercent: number | undefined;
	/** Prompt tokens served from cache, as a rounded percent; undefined until anything was billed. */
	cacheHitPercent: number | undefined;
}

export interface FooterStats {
	/** Current numbers, re-derived first when history or the model moved since the last read. */
	read(): FooterSnapshot;
	/** Keep up with one session event. Cheap: it folds usage and notes boundaries. */
	noteEvent(event: AgentSessionEvent): void;
	/** Follow a different session (resume, `/new`, `/tree` branch switch). */
	setSession(session: AgentSession): void;
}

/**
 * Live info-bar numbers for one session. The first read walks the session, so a hidden bar costs
 * nothing at startup.
 */
export function createFooterStats(session: AgentSession): FooterStats {
	let currentSession = session;
	const totals = createUsageTotals();
	let contextTokens: number | undefined;
	let contextPercent: number | undefined;
	let lastModel = currentSession.model;
	let stale = true;

	const refresh = () => {
		if (!stale && currentSession.model === lastModel) return;
		stale = false;
		lastModel = currentSession.model;
		const stats = currentSession.getSessionStats();
		totals.input = stats.tokens.input;
		totals.output = stats.tokens.output;
		totals.cacheRead = stats.tokens.cacheRead;
		totals.cacheWrite = stats.tokens.cacheWrite;
		totals.cost = stats.cost;
		// Both sides of the estimate are null together, right after a compaction and before the
		// next response; the block hides itself rather than printing half of them.
		const context = currentSession.getContextUsage();
		contextTokens = context?.tokens ?? undefined;
		const percent = context?.percent ?? undefined;
		contextPercent = percent === undefined ? undefined : Math.round(percent);
	};

	return {
		read() {
			refresh();
			const promptTokens = totals.input + totals.cacheRead + totals.cacheWrite;
			return {
				totals,
				contextTokens,
				contextPercent,
				cacheHitPercent: promptTokens > 0 ? Math.round((totals.cacheRead / promptTokens) * 100) : undefined,
			};
		},
		noteEvent(event) {
			switch (event.type) {
				case "message_end":
					// Folding keeps the bar moving while a turn runs; the settled resync replaces
					// the folded numbers with what the session recorded, so a discarded retry
					// attempt or an unpersisted usage entry cannot drift the bar.
					if (event.message.role === "assistant") addUsageToTotals(totals, event.message.usage);
					return;
				case "entry_appended":
					if (event.entry.type === "usage") addUsageToTotals(totals, event.entry.usage);
					return;
				case "agent_settled":
				case "compaction_end":
					stale = true;
					return;
			}
		},
		setSession(session) {
			currentSession = session;
			stale = true;
		},
	};
}
