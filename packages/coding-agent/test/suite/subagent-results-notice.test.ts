/**
 * Tests for the `<subagent-results>` user-message notice: recognition,
 * per-agent parsing, and the tool-style row rendering.
 */

import { describe, expect, it } from "vitest";
import {
	isSubagentResultsMessage,
	parseSubagentResults,
	SubagentResultsNoticeComponent,
} from "../../src/modes/interactive/components/subagent-results-message.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";

initTheme("dark");

const NOTE = [
	"<subagent-results>",
	"2 background subagents finished. Summarize what matters for the current work.",
	"",
	"completed: explore (agent-1hfk3; 2 turns, 1.1k tokens, mock/mock-agents)",
	"## Subagent run complete",
	"- **explore** mapped the auth files.",
	"",
	"stopped: general-purpose (agent-2xk9d; 1 turns, 900 tokens, mock/mock-agents)",
	"partial answer here",
	"</subagent-results>",
].join("\n");

describe("subagent results notice", () => {
	it("recognizes the wrapped message", () => {
		expect(isSubagentResultsMessage(NOTE)).toBe(true);
		expect(isSubagentResultsMessage("plain user text")).toBe(false);
	});

	it("parses one block per agent with stats and result", () => {
		const blocks = parseSubagentResults(NOTE);
		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toMatchObject({
			status: "completed",
			agent: "explore",
			id: "agent-1hfk3",
			stats: "2 turns, 1.1k tokens, mock/mock-agents",
		});
		expect(blocks[0].result).toContain("## Subagent run complete");
		expect(blocks[1]).toMatchObject({ status: "stopped", agent: "general-purpose" });
		expect(blocks[1].result).toBe("partial answer here");
	});

	it("renders one row per agent, tool-style", () => {
		const component = new SubagentResultsNoticeComponent(NOTE);
		const lines = component
			.render(120)
			.map((line) => line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, ""));
		// No banner row: each agent is one row, and the model name is left out of the stats.
		expect(lines.some((line) => line.includes("Subagent results"))).toBe(false);
		expect(lines.some((line) => line.includes("Subagent explore · completed · 2 turns, 1.1k tokens"))).toBe(true);
		expect(lines.some((line) => line.includes("mock/mock-agents"))).toBe(false);
		// The guide sits under the title's "Subagent", and the `##` heading is
		// demoted to a plain line, like an edit call's output.
		expect(lines.some((line) => line.includes("  └─ Subagent run complete"))).toBe(true);
		expect(lines.some((line) => line.includes("##"))).toBe(false);
		expect(lines.some((line) => line.includes("Subagent general-purpose · stopped"))).toBe(true);
	});

	it("keeps wrapped body lines aligned under the guide", () => {
		const long = [
			"<subagent-results>",
			"1 background subagent finished.",
			"",
			"completed: explore (agent-1; 1 turns, 10 tokens, mock/mock-agents)",
			"word ".repeat(40).trim(),
			"</subagent-results>",
		].join("\n");
		const component = new SubagentResultsNoticeComponent(long);
		const lines = component
			.render(60)
			.map((line) => line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, ""))
			.filter((line) => line.includes("word"));
		expect(lines.length).toBeGreaterThan(1);
		// Every body line, wrapped or not, sits at the same column: the indented
		// guide column (4) plus one gap.
		for (const line of lines) expect(line).toMatch(/^( {2}└─ | {5})word/);
	});

	it("folds long answers until expanded, like a read row", () => {
		const long = [
			"<subagent-results>",
			"1 background subagent finished.",
			"",
			"completed: explore (agent-1; 1 turns, 10 tokens, mock/mock-agents)",
			...Array.from({ length: 20 }, (_, i) => `line ${i + 1}`),
			"</subagent-results>",
		].join("\n");
		const component = new SubagentResultsNoticeComponent(long);
		const collapsed = component
			.render(120)
			.map((line) => line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, ""));
		expect(collapsed.some((line) => line.includes("line 3"))).toBe(true);
		expect(collapsed.some((line) => line.includes("line 4"))).toBe(false);
		expect(collapsed.some((line) => line.includes("more lines"))).toBe(true);
		component.setExpanded(true);
		const expanded = component
			.render(120)
			.map((line) => line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, ""));
		expect(expanded.some((line) => line.includes("line 20"))).toBe(true);
		expect(expanded.some((line) => line.includes("more lines"))).toBe(false);
	});
});
