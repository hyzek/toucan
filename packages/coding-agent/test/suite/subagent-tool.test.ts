/**
 * Tests for the built-in `subagent` tool: spawning built-in and custom agent
 * types as isolated child sessions with their own tools and prompts.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools, type TranscriptContext } from "@hyzek/toucan-ai";
import type { ToolResultMessage } from "@hyzek/toucan-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../../src/config.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createHarness, getAssistantTexts, getToolResult, getUserTexts, type Harness } from "./harness.ts";

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
	const part = result.content.find((item) => item.type === "text");
	return part?.text ?? "";
}

function subagentCall(agent: string, extra: Record<string, unknown> = {}, task = "do the thing") {
	return fauxToolCall("subagent", { agent, task, description: "test task", ...extra });
}

describe("subagent tool", () => {
	let harness: Harness | undefined;
	let agentDir: string | undefined;
	const previousAgentDir = process.env[ENV_AGENT_DIR];

	/** Point the agent dir at an empty temp directory so the test never reads the machine's ~/.toucan. */
	function isolateAgentDir(): string {
		agentDir = mkdtempSync(join(tmpdir(), "toucan-subagent-agents-"));
		process.env[ENV_AGENT_DIR] = agentDir;
		return agentDir;
	}

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
		if (agentDir && existsSync(agentDir)) rmSync(agentDir, { recursive: true });
		agentDir = undefined;
		if (previousAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
		else process.env[ENV_AGENT_DIR] = previousAgentDir;
	});

	it("runs a built-in agent and returns its final answer", async () => {
		isolateAgentDir();
		harness = await createHarness();

		let childTools: string[] = [];
		harness.setResponses([
			fauxAssistantMessage([subagentCall("explore", { background: false })], { stopReason: "toolUse" }),
			(context: TranscriptContext) => {
				childTools = getCurrentTools(context.messages).map((tool) => tool.name);
				return fauxAssistantMessage("found 3 files");
			},
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");

		const result = getToolResult(harness, "subagent");
		expect(result.isError ?? false).toBe(false);
		expect(resultText(result)).toContain("found 3 files");
		// The explore agent runs with its own read-only tool set, not the parent's.
		expect(childTools.sort()).toEqual(["find", "grep", "ls", "read"]);
	});

	it("fails unknown agent types, listing what is available", async () => {
		isolateAgentDir();
		harness = await createHarness();

		harness.setResponses([
			fauxAssistantMessage([subagentCall("nope")], { stopReason: "toolUse" }),
			fauxAssistantMessage("ok"),
		]);

		await harness.session.prompt("go");

		const result = getToolResult(harness, "subagent");
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain('Unknown subagent type "nope"');
		expect(resultText(result)).toContain("explore");
	});

	it("spawns a custom agent defined in the user agents directory", async () => {
		const dir = isolateAgentDir();
		mkdirSync(join(dir, "agents"), { recursive: true });
		writeFileSync(
			join(dir, "agents", "reviewer.md"),
			[
				"---",
				"description: Reviews code",
				"tools: read",
				"---",
				"You are a code reviewer. Report findings as a list.",
			].join("\n"),
		);
		harness = await createHarness();

		let childTools: string[] = [];
		harness.setResponses([
			fauxAssistantMessage([subagentCall("reviewer", { background: false }, "check this diff")], {
				stopReason: "toolUse",
			}),
			(context: TranscriptContext) => {
				childTools = getCurrentTools(context.messages).map((tool) => tool.name);
				return fauxAssistantMessage("two issues found");
			},
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");

		const result = getToolResult(harness, "subagent");
		expect(result.isError ?? false).toBe(false);
		expect(resultText(result)).toContain("two issues found");
		expect(childTools).toEqual(["read"]);
	});

	it("does not load project agents while the project is untrusted", async () => {
		isolateAgentDir();
		harness = await createHarness();
		mkdirSync(join(harness.tempDir, ".toucan", "agents"), { recursive: true });
		writeFileSync(
			join(harness.tempDir, ".toucan", "agents", "project-agent.md"),
			["---", "description: A project agent", "---", "Do the project thing.", ""].join("\n"),
		);
		harness.settingsManager.setProjectTrusted(false);

		harness.setResponses([
			fauxAssistantMessage([subagentCall("project-agent")], { stopReason: "toolUse" }),
			fauxAssistantMessage("ok"),
		]);

		await harness.session.prompt("go");

		const result = getToolResult(harness, "subagent");
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain('Unknown subagent type "project-agent"');
	});

	it("loads project agents once the project is trusted", async () => {
		isolateAgentDir();
		harness = await createHarness();
		mkdirSync(join(harness.tempDir, ".toucan", "agents"), { recursive: true });
		writeFileSync(
			join(harness.tempDir, ".toucan", "agents", "project-agent.md"),
			["---", "description: A project agent", "---", "Do the project thing.", ""].join("\n"),
		);
		harness.settingsManager.setProjectTrusted(true);

		harness.setResponses([
			fauxAssistantMessage([subagentCall("project-agent", { background: false })], { stopReason: "toolUse" }),
			fauxAssistantMessage("project thing done"),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");

		const result = getToolResult(harness, "subagent");
		expect(result.isError ?? false).toBe(false);
		expect(resultText(result)).toContain("project thing done");
	});
	it("notifies the parent when a background agent finishes", async () => {
		isolateAgentDir();
		harness = await createHarness();

		// The parent's second request is queued before the child's, so responses land in order.
		harness.setResponses([
			fauxAssistantMessage([subagentCall("explore", {}, "find things")], { stopReason: "toolUse" }),
			fauxAssistantMessage("started it"),
			fauxAssistantMessage("found them"),
			fauxAssistantMessage("noted"),
		]);

		await harness.session.prompt("go");
		expect(resultText(getToolResult(harness, "subagent"))).toContain("background");

		const deadline = Date.now() + 4000;
		while (!getUserTexts(harness).some((text) => text.includes("<subagent-results>"))) {
			if (Date.now() > deadline) throw new Error("No completion notification reached the parent");
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		await harness.session.waitForIdle();

		const note = getUserTexts(harness).find((text) => text.includes("<subagent-results>"));
		expect(note).toContain("found them");
		expect(getAssistantTexts(harness)).toContain("noted");
	});
	it("steers a wrap-up at the turn limit instead of cutting the agent off", async () => {
		isolateAgentDir();
		harness = await createHarness();

		harness.setResponses([
			fauxAssistantMessage([subagentCall("explore", { background: false, max_turns: 1 })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage([fauxToolCall("ls", { path: "." })], { stopReason: "toolUse" }),
			fauxAssistantMessage("wrapping up now"),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");

		const result = getToolResult(harness, "subagent");
		expect(result.isError ?? false).toBe(false);
		expect(resultText(result)).toContain("wrapping up now");
	});

	it("aborts an agent that keeps going past the grace period", async () => {
		isolateAgentDir();
		harness = await createHarness();

		const keepGoing = () => fauxAssistantMessage([fauxToolCall("ls", { path: "." })], { stopReason: "toolUse" });
		harness.setResponses([
			fauxAssistantMessage([subagentCall("explore", { background: false, max_turns: 1 })], {
				stopReason: "toolUse",
			}),
			keepGoing(),
			keepGoing(),
			keepGoing(),
			keepGoing(),
			keepGoing(),
			keepGoing(),
		]);

		await harness.session.prompt("go");

		const result = getToolResult(harness, "subagent");
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain("turn limit exceeded");
	});

	it("resumes a finished agent's conversation with a new task", async () => {
		isolateAgentDir();
		// Resume needs saved sessions, so the parent persists to its own session dir.
		const parentDir = mkdtempSync(join(tmpdir(), "toucan-subagent-parent-"));
		try {
			await runResumeTest(parentDir);
		} finally {
			rmSync(parentDir, { recursive: true, force: true });
		}
	});

	async function runResumeTest(parentDir: string): Promise<void> {
		harness = await createHarness({ sessionManager: SessionManager.create(parentDir, join(parentDir, "sessions")) });

		let resumedSawFirstAnswer = false;
		harness.setResponses([
			fauxAssistantMessage([subagentCall("explore", { background: false })], { stopReason: "toolUse" }),
			fauxAssistantMessage("first answer"),
			(context: TranscriptContext) => {
				const id = findAgentId(context.messages);
				if (!id) throw new Error("No agent id in the parent transcript");
				return fauxAssistantMessage(
					[fauxToolCall("subagent", { resume: id, task: "keep going", background: false })],
					{
						stopReason: "toolUse",
					},
				);
			},
			(context: TranscriptContext) => {
				resumedSawFirstAnswer = JSON.stringify(context.messages).includes("first answer");
				return fauxAssistantMessage("second answer");
			},
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");

		const results = harness.session.messages.filter(
			(message): message is ToolResultMessage => message.role === "toolResult" && message.toolName === "subagent",
		);
		expect(results).toHaveLength(2);
		expect(resultText(results[1])).toContain("second answer");
		expect(resumedSawFirstAnswer).toBe(true);
	}
});

function findAgentId(messages: unknown[]): string | undefined {
	for (const message of messages as ToolResultMessage[]) {
		if (message.role !== "toolResult" || message.toolName !== "subagent") continue;
		for (const part of message.content) {
			if (part.type !== "text") continue;
			const match = /\((agent-[a-z0-9]+);/.exec(part.text);
			if (match) return match[1];
		}
	}
	return undefined;
}
