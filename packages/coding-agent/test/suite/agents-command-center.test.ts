/**
 * Tests for the agent command center screen: tree cycling, tab filtering,
 * transcript opening, and closing.
 */

import { describe, expect, it } from "vitest";
import type { AgentSession } from "../../src/core/agent-session.ts";
import type { SubagentManager, SubagentRecord } from "../../src/core/subagents/subagent-manager.ts";
import { AgentsCommandCenterComponent } from "../../src/modes/interactive/components/agents-command-center.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";

initTheme("dark");

function record(id: string, task: string, status: SubagentRecord["status"]): SubagentRecord {
	return {
		id,
		agent: "explore",
		description: task,
		task,
		background: true,
		status,
		turns: 2,
		usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0 },
		startedAt: Date.now(),
		model: "mock/mock",
		result: `answer from ${id}`,
	};
}

function makeScreen(): AgentsCommandCenterComponent {
	const records = [record("agent-a", "first task", "completed"), record("agent-b", "second task", "running")];
	const manager = {
		list: () => records,
		subscribe: () => () => {},
		liveSession: () => undefined,
	} as unknown as SubagentManager;
	const session = {
		subagentManager: manager,
		sessionName: "test session",
	} as unknown as AgentSession;
	return new AgentsCommandCenterComponent(session, {
		ui: { terminal: { rows: 40 } } as never,
		onClose: () => {},
		requestRender: () => {},
	});
}

describe("agents command center", () => {
	it("cycles the tree selection with up and down", () => {
		const screen = makeScreen();
		expect(screen.selectedRecord()?.id).toBe("agent-a");
		screen.handleInput("\x1b[B"); // down
		expect(screen.selectedRecord()?.id).toBe("agent-b");
		screen.handleInput("\x1b[B"); // down wraps
		expect(screen.selectedRecord()?.id).toBe("agent-a");
		screen.handleInput("\x1b[A"); // up wraps back
		expect(screen.selectedRecord()?.id).toBe("agent-b");
	});

	it("cycles tabs with tab and shift+tab", () => {
		const screen = makeScreen();
		expect(screen.filter).toBe("all");
		screen.handleInput("\t");
		expect(screen.filter).toBe("working");
		screen.handleInput("\x1b[Z"); // shift+tab
		expect(screen.filter).toBe("all");
	});

	it("opens the transcript of the selected agent on enter", () => {
		const screen = makeScreen();
		screen.handleInput("\r");
		expect(screen.transcript?.recordId).toBe("agent-a");
	});

	it("renders title, tabs, tree rows with aligned dots, and a footer", () => {
		const screen = makeScreen();
		const plain = (line: string) => line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
		const lines = screen.render(120).map(plain);
		expect(lines.some((line) => line.includes("Agent command center"))).toBe(true);
		expect(lines.some((line) => line.includes("All 2   Working 1   Ready 1"))).toBe(true);
		const treeLines = lines.filter((line) => /task.*●/.test(line));
		expect(treeLines).toHaveLength(2);
		// Status dots sit in the same column even though the labels differ in length.
		expect(treeLines[0]!.indexOf("●")).toBe(treeLines[1]!.indexOf("●"));
		// The footer is pinned to the last rendered row.
		expect(lines[lines.length - 1]).toContain("tabs");
	});
});
