/**
 * Tests for the subagent manager: background runs, the concurrency queue,
 * steering, stopping, and completion notifications to the parent.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from "@hyzek/toucan-ai";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../../src/config.ts";
import { type AgentDefinition, discoverAgentDefinitions } from "../../src/core/subagents/agent-registry.ts";
import { SubagentManager } from "../../src/core/subagents/subagent-manager.ts";
import { createHarness, type Harness } from "./harness.ts";

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

function builtinAgent(name: string): AgentDefinition {
	const { definitions } = discoverAgentDefinitions({
		cwd: process.cwd(),
		agentDir: process.cwd(),
		projectTrusted: false,
	});
	const definition = definitions.find((candidate) => candidate.name === name);
	if (!definition) throw new Error(`No builtin agent ${name}`);
	return definition;
}

describe("subagent manager", () => {
	let harness: Harness | undefined;
	let agentDir: string | undefined;
	const previousAgentDir = process.env[ENV_AGENT_DIR];
	const notes: string[] = [];

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
		notes.length = 0;
		if (agentDir && existsSync(agentDir)) rmSync(agentDir, { recursive: true });
		agentDir = undefined;
		if (previousAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
		else process.env[ENV_AGENT_DIR] = previousAgentDir;
	});

	/** Point the agent dir at a temp directory so the test never reads the machine's ~/.toucan. */
	async function setup(): Promise<Harness> {
		agentDir = mkdtempSync(join(tmpdir(), "toucan-subagent-mgr-"));
		process.env[ENV_AGENT_DIR] = agentDir;
		harness = await createHarness();
		return harness;
	}

	function makeManager(h: Harness, maxConcurrent: number): SubagentManager {
		return new SubagentManager({
			runtime: () => ({
				cwd: h.tempDir,
				modelRuntime: h.modelRuntime,
				settingsManager: h.settingsManager,
				sessionManager: h.sessionManager,
				model: h.getModel(),
				thinkingLevel: "off",
			}),
			maxConcurrent: () => maxConcurrent,
			notifyParent: async (text) => {
				notes.push(text);
			},
		});
	}

	it("notifies subscribers when records change", async () => {
		const h = await setup();
		const manager = makeManager(h, 2);
		h.setResponses([fauxAssistantMessage("subscribed answer"), fauxAssistantMessage("stray answer")]);
		let changes = 0;
		const unsubscribe = manager.subscribe(() => {
			changes += 1;
		});
		const record = manager.spawn({
			definition: builtinAgent("general-purpose"),
			task: "note me",
			description: "note me",
			background: true,
			model: h.getModel(),
			thinkingLevel: "off",
		});
		expect(changes).toBeGreaterThan(0); // spawn changed the list
		await waitFor(() => manager.get(record.id)?.status === "completed");
		const settledCount = changes;
		expect(settledCount).toBeGreaterThan(1); // settling changed it again
		unsubscribe();
		const stray = manager.spawn({
			definition: builtinAgent("general-purpose"),
			task: "ignored",
			description: "ignored",
			background: true,
			model: h.getModel(),
			thinkingLevel: "off",
		});
		await manager.waitFor(stray.id);
		expect(changes).toBe(settledCount); // the unsubscribed listener saw nothing
		// Drain the batched completion notification before the next test starts.
		await waitFor(() => notes.length > 0);
	});

	it("completes background runs and notes the parent once per batch", async () => {
		const h = await setup();
		const manager = makeManager(h, 4);
		h.setResponses([fauxAssistantMessage("answer A"), fauxAssistantMessage("answer B")]);

		const a = manager.spawn({
			definition: builtinAgent("explore"),
			task: "task a",
			background: true,
			model: h.getModel(),
			thinkingLevel: "off",
		});
		const b = manager.spawn({
			definition: builtinAgent("explore"),
			task: "task b",
			background: true,
			model: h.getModel(),
			thinkingLevel: "off",
		});

		const settledA = await manager.waitFor(a.id);
		const settledB = await manager.waitFor(b.id);
		expect(settledA.status).toBe("completed");
		expect(settledB.status).toBe("completed");
		expect(settledA.result).toContain("answer A");

		await waitFor(() => notes.length > 0);
		const batch = notes.join("\n");
		expect(batch).toContain("<subagent-results>");
		expect(batch).toContain("answer A");
		expect(batch).toContain("answer B");
	});

	it("queues background spawns behind the concurrency limit", async () => {
		const h = await setup();
		const manager = makeManager(h, 1);
		h.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);

		const first = manager.spawn({
			definition: builtinAgent("explore"),
			task: "one",
			background: true,
			model: h.getModel(),
			thinkingLevel: "off",
		});
		const second = manager.spawn({
			definition: builtinAgent("explore"),
			task: "two",
			background: true,
			model: h.getModel(),
			thinkingLevel: "off",
		});
		expect(first.status).toBe("running");
		expect(second.status).toBe("queued");

		await manager.waitFor(first.id);
		const settledSecond = await manager.waitFor(second.id);
		expect(settledSecond.status).toBe("completed");
		expect(settledSecond.result).toContain("second");
	});

	it("stops a queued spawn before it starts", async () => {
		const h = await setup();
		const manager = makeManager(h, 1);
		h.setResponses([fauxAssistantMessage("slow")]);

		const first = manager.spawn({
			definition: builtinAgent("explore"),
			task: "one",
			background: true,
			model: h.getModel(),
			thinkingLevel: "off",
		});
		const queued = manager.spawn({
			definition: builtinAgent("explore"),
			task: "two",
			background: true,
			model: h.getModel(),
			thinkingLevel: "off",
		});
		manager.stop(queued.id);
		expect(manager.get(queued.id)?.status).toBe("stopped");

		await manager.waitFor(first.id);
		await waitFor(() => notes.some((note) => note.includes("stopped: explore")));
		expect(queued.status).toBe("stopped");
	});

	it("stops a child immediately during startup", async () => {
		const h = await setup();
		const manager = makeManager(h, 1);
		h.setResponses([fauxAssistantMessage("must not run")]);
		const record = manager.spawn({
			definition: builtinAgent("explore"),
			task: "stop",
			background: true,
			model: h.getModel(),
			thinkingLevel: "off",
		});
		manager.stop(record.id);
		expect((await manager.waitFor(record.id)).status).toBe("stopped");
	});

	it("acknowledges a notification delivered before notifyParent returns", async () => {
		const h = await setup();
		let offers = 0;
		let manager: SubagentManager;
		manager = new SubagentManager({
			runtime: () => ({
				cwd: h.tempDir,
				modelRuntime: h.modelRuntime,
				settingsManager: h.settingsManager,
				sessionManager: h.sessionManager,
				model: h.getModel(),
				thinkingLevel: "off",
			}),
			maxConcurrent: () => 1,
			notifyParent: async (text) => {
				offers++;
				manager.noteParentActivity({ type: "message_start", message: { role: "user", content: text } });
				manager.noteParentActivity({ type: "agent_end" });
			},
		});
		h.setResponses([fauxAssistantMessage("done")]);
		const record = manager.spawn({
			definition: builtinAgent("explore"),
			task: "test",
			background: true,
			model: h.getModel(),
			thinkingLevel: "off",
		});
		await manager.waitFor(record.id);
		await waitFor(() => offers === 1);
		manager.noteParentActivity({ type: "agent_end" });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(offers).toBe(1);
	});

	it("rejects concurrent continuations of the same session", async () => {
		const h = await setup();
		const manager = makeManager(h, 1);
		const request = {
			definition: builtinAgent("explore"),
			task: "resume",
			background: true,
			model: h.getModel(),
			thinkingLevel: "off" as const,
			resumeSessionFile: join(h.tempDir, "session.jsonl"),
		};
		const first = manager.spawn(request);
		expect(() => manager.spawn(request)).toThrow("already being resumed");
		await manager.waitFor(first.id);
	});

	it("steers a running agent into its next request", async () => {
		const h = await setup();
		const manager = makeManager(h, 4);
		// The child calls bash (sleep) so the steer lands while the tool runs.
		h.setResponses([fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 1" })], { stopReason: "toolUse" })]);
		let steerSeen = false;
		const secondStep = (context: TranscriptContext) => {
			steerSeen = context.messages.some((message) => {
				if (message.role !== "user") return false;
				if (typeof message.content === "string") return message.content.includes("check the tests instead");
				return message.content.some(
					(part) => part.type === "text" && part.text.includes("check the tests instead"),
				);
			});
			return fauxAssistantMessage("steered answer");
		};

		const record = manager.spawn({
			definition: builtinAgent("general-purpose"),
			task: "run the long thing",
			background: true,
			model: h.getModel(),
			thinkingLevel: "off",
		});
		await waitFor(() => record.status === "running" && h.getPendingResponseCount() === 0);
		await manager.steer(record.id, "check the tests instead");
		h.appendResponses([secondStep]);
		const settled = await manager.waitFor(record.id);
		expect(settled.result).toContain("steered answer");
		expect(steerSeen).toBe(true);
	});

	it("stops a running agent", async () => {
		const h = await setup();
		const manager = makeManager(h, 4);
		h.setResponses([fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 5" })], { stopReason: "toolUse" })]);

		const record = manager.spawn({
			definition: builtinAgent("general-purpose"),
			task: "run the long thing",
			background: true,
			model: h.getModel(),
			thinkingLevel: "off",
		});
		await waitFor(() => record.status === "running" && h.getPendingResponseCount() === 0);
		manager.stop(record.id);

		const settled = await manager.waitFor(record.id);
		expect(settled.status).toBe("stopped");
		await waitFor(() => notes.some((note) => note.includes("stopped: general-purpose")));
	});

	it("re-offers a completion note when a turn ends without reading it", async () => {
		const h = await setup();
		const delivered: string[] = [];
		const manager = new SubagentManager({
			runtime: () => ({
				cwd: h.tempDir,
				modelRuntime: h.modelRuntime,
				settingsManager: h.settingsManager,
				sessionManager: h.sessionManager,
				model: h.getModel(),
				thinkingLevel: "off",
			}),
			maxConcurrent: () => 4,
			notifyParent: async (text) => {
				notes.push(text);
				delivered.push(text);
			},
		});
		h.setResponses([fauxAssistantMessage("dropped answer")]);
		const record = manager.spawn({
			definition: builtinAgent("explore"),
			task: "orphan note",
			background: true,
			model: h.getModel(),
			thinkingLevel: "off",
		});
		await manager.waitFor(record.id);
		// First boundary: the note is offered.
		manager.noteParentActivity({ type: "agent_start" });
		await waitFor(() => notes.length > 0);
		const firstOffer = notes.length;
		// The turn ends without delivering the queued message: re-offer it.
		manager.noteParentActivity({ type: "agent_end" });
		await waitFor(() => notes.length > firstOffer);
		// This turn delivers it (the queued message arrives as a user message start).
		const secondText = delivered[1];
		manager.noteParentActivity({ type: "agent_start" });
		manager.noteParentActivity({ type: "message_start", message: { role: "user", content: secondText } });
		manager.noteParentActivity({ type: "agent_end" });
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(notes.length).toBe(firstOffer + 1);
	});

	it("aborts background children when the parent session disposes", async () => {
		const h = await setup();
		const manager = makeManager(h, 4);
		h.setResponses([fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 5" })], { stopReason: "toolUse" })]);

		const record = manager.spawn({
			definition: builtinAgent("general-purpose"),
			task: "long",
			background: true,
			model: h.getModel(),
			thinkingLevel: "off",
		});
		await waitFor(() => record.status === "running" && h.getPendingResponseCount() === 0);
		manager.stopAll();
		const settled = await manager.waitFor(record.id);
		expect(settled.status).toBe("stopped");
	});
});
