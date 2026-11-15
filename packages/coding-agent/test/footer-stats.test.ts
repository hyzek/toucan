// Info bar usage numbers: folded while a turn runs, re-derived only when history or the model
// moves, because the full session walk is too expensive to run per redraw.

import type { Usage } from "@hyzek/toucan-ai/compat";
import { describe, expect, it } from "vitest";
import type { AgentSession, AgentSessionEvent } from "../src/core/agent-session.ts";
import type { ContextUsage } from "../src/core/extensions/types.ts";
import { createFooterStats } from "../src/core/footer-stats.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";

interface UsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: number;
}

/** A session whose numbers the test sets, plus the counters that show how often they were read. */
class FakeSession {
	model: { id: string };
	walks = 0;
	tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	cost = 0;
	contextTokens: number | null = 100_000;
	percent: number | null = 50;

	constructor(modelId = "test-model") {
		this.model = { id: modelId };
	}

	/** Records what the session has billed so far, as the real session would after a walk. */
	record(usage: UsageLike): void {
		this.tokens.input += usage.input ?? 0;
		this.tokens.output += usage.output ?? 0;
		this.tokens.cacheRead += usage.cacheRead ?? 0;
		this.tokens.cacheWrite += usage.cacheWrite ?? 0;
		this.cost += usage.cost ?? 0;
	}

	asAgentSession(): AgentSession {
		return this as unknown as AgentSession;
	}

	getSessionStats() {
		this.walks++;
		return {
			tokens: { ...this.tokens, total: 0 },
			cost: this.cost,
		};
	}

	getContextUsage(): ContextUsage {
		return { tokens: this.contextTokens, contextWindow: 200_000, percent: this.percent };
	}
}

function usage(overrides: UsageLike = {}): Usage {
	return {
		input: overrides.input ?? 0,
		output: overrides.output ?? 0,
		cacheRead: overrides.cacheRead ?? 0,
		cacheWrite: overrides.cacheWrite ?? 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: overrides.cost ?? 0,
		},
	};
}

/** Only `entry.type` and `entry.usage` are read, so the rest of the entry is left out. */
function usageEntry(usageValue: Usage): AgentSessionEvent {
	return { type: "entry_appended", entry: { type: "usage", usage: usageValue } as unknown as SessionEntry };
}

function messageEnd(usageValue: Usage, role = "assistant"): AgentSessionEvent {
	return { type: "message_end", message: { role, usage: usageValue } } as unknown as AgentSessionEvent;
}

describe("createFooterStats", () => {
	it("walks the session on the first read only", () => {
		const session = new FakeSession();
		session.record({ input: 1000, cacheRead: 4000, cost: 0.1 });
		const stats = createFooterStats(session.asAgentSession());

		expect(stats.read().totals).toEqual({ input: 1000, output: 0, cacheRead: 4000, cacheWrite: 0, cost: 0.1 });
		expect(stats.read().totals.input).toBe(1000);
		expect(session.walks).toBe(1);
	});

	it("folds a finished assistant message in without walking", () => {
		const session = new FakeSession();
		const stats = createFooterStats(session.asAgentSession());
		stats.read();

		stats.noteEvent(messageEnd(usage({ input: 500, output: 120, cacheRead: 800, cacheWrite: 40, cost: 0.05 })));

		expect(stats.read().totals).toEqual({ input: 500, output: 120, cacheRead: 800, cacheWrite: 40, cost: 0.05 });
		expect(session.walks).toBe(1);
	});

	it("ignores non-assistant messages and non-usage entries", () => {
		const session = new FakeSession();
		const stats = createFooterStats(session.asAgentSession());
		stats.read();

		stats.noteEvent(messageEnd(usage({ input: 500 }), "user"));
		stats.noteEvent({ type: "queue_update", steering: [], followUp: [] });

		expect(stats.read().totals.input).toBe(0);
	});

	it("counts a usage entry the session appended, such as a cache warm", () => {
		const session = new FakeSession();
		const stats = createFooterStats(session.asAgentSession());
		stats.read();

		stats.noteEvent(usageEntry(usage({ input: 0, cacheRead: 0, cacheWrite: 2000, cost: 0.03 })));

		expect(stats.read().totals.cacheWrite).toBe(2000);
	});

	it("replaces folded numbers with the session's own when a turn settles", () => {
		const session = new FakeSession();
		const stats = createFooterStats(session.asAgentSession());
		stats.read();
		// A retry attempt folded in that the session did not keep: the walk drops it.
		stats.noteEvent(messageEnd(usage({ input: 5000, output: 900, cost: 0.5 })));
		stats.noteEvent({ type: "agent_settled", aborted: false });
		session.record({ input: 1000, output: 100, cost: 0.1 });

		expect(stats.read().totals).toEqual({ input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, cost: 0.1 });
		expect(session.walks).toBe(2);
	});

	it("re-derives after a compaction rewrote history", () => {
		const session = new FakeSession();
		session.record({ input: 90_000, cost: 1.5 });
		const stats = createFooterStats(session.asAgentSession());
		expect(stats.read()).toMatchObject({ contextTokens: 100_000, contextPercent: 50 });

		session.percent = 12;
		stats.noteEvent({
			type: "compaction_end",
			reason: "manual",
			result: undefined,
			aborted: false,
			willRetry: false,
		});

		expect(stats.read().contextPercent).toBe(12);
		expect(session.walks).toBe(2);
	});

	it("re-derives when the model changes, since a new window and new prices apply", () => {
		const session = new FakeSession();
		const stats = createFooterStats(session.asAgentSession());
		stats.read();
		session.record({ input: 1000, cost: 0.25 });

		session.model = { id: "other-model" };

		expect(stats.read().totals.input).toBe(1000);
		expect(session.walks).toBe(2);
	});

	it("has no context numbers while the estimate is unknown", () => {
		const session = new FakeSession();
		session.contextTokens = null;
		session.percent = null;
		const stats = createFooterStats(session.asAgentSession());

		expect(stats.read()).toMatchObject({ contextTokens: undefined, contextPercent: undefined });
	});

	it("derives the cache share from the prompt tokens of the whole session", () => {
		const session = new FakeSession();
		session.record({ input: 1000, cacheRead: 9000, cacheWrite: 0 });
		const stats = createFooterStats(session.asAgentSession());

		expect(stats.read().cacheHitPercent).toBe(90);
	});

	it("has no cache share before anything was billed", () => {
		const stats = createFooterStats(new FakeSession().asAgentSession());

		expect(stats.read().cacheHitPercent).toBeUndefined();
	});

	it("follows a different session after a resume", () => {
		const first = new FakeSession("first");
		first.record({ input: 1000 });
		const second = new FakeSession("second");
		second.record({ input: 7 });
		const stats = createFooterStats(first.asAgentSession());
		expect(stats.read().totals.input).toBe(1000);

		stats.setSession(second.asAgentSession());

		expect(stats.read().totals.input).toBe(7);
		expect(second.walks).toBe(1);
	});
});
