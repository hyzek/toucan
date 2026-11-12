import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BeforeToolCallContext } from "@hyzek/toucan-agent-core";
import { getModel } from "@hyzek/toucan-ai/compat";
import { visibleWidth } from "@hyzek/toucan-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { KEYBINDINGS } from "../src/core/keybindings.ts";
import { isReadOnlyBashCommand } from "../src/core/plan-mode.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { FooterComponent } from "../src/modes/interactive/components/footer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("plan mode bash allowlist", () => {
	it("allows read-only commands", () => {
		expect(isReadOnlyBashCommand("git log --oneline -5")).toBe(true);
		expect(isReadOnlyBashCommand("ls -la src")).toBe(true);
		expect(isReadOnlyBashCommand("rg plan-mode src")).toBe(true);
	});

	it("blocks state-changing commands", () => {
		expect(isReadOnlyBashCommand("rm -rf build")).toBe(false);
		expect(isReadOnlyBashCommand("git commit -m x")).toBe(false);
		expect(isReadOnlyBashCommand("echo hi > file.txt")).toBe(false);
		expect(isReadOnlyBashCommand("npm install left-pad")).toBe(false);
	});
});

describe("plan mode keybinding defaults", () => {
	it("shift+tab toggles plan mode and alt+t cycles thinking", () => {
		expect(KEYBINDINGS["app.planMode.toggle"].defaultKeys).toBe("shift+tab");
		expect(KEYBINDINGS["app.thinking.cycle"].defaultKeys).toBe("alt+t");
	});
});

describe("AgentSession plan mode", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `toucan-plan-mode-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	});

	async function makeSession(sessionManager: SessionManager): Promise<AgentSession> {
		const settingsManager = SettingsManager.create(tempDir, agentDir);
		const resourceLoader = new DefaultResourceLoader({ cwd: tempDir, agentDir, settingsManager });
		await resourceLoader.reload();
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			settingsManager,
			sessionManager,
			resourceLoader,
		});
		return session;
	}

	it("swaps tools and adds the plan_mode prompt section, then restores both", async () => {
		const session = await makeSession(SessionManager.inMemory(tempDir));
		try {
			expect(session.planMode).toBe(false);
			expect(session.getActiveToolNames()).toContain("edit");

			session.enablePlanMode();
			const active = session.getActiveToolNames();
			expect(session.planMode).toBe(true);
			expect(active).not.toContain("edit");
			expect(active).not.toContain("write");
			expect(active).toEqual(expect.arrayContaining(["read", "grep", "find", "ls", "bash"]));
			expect(session.systemPrompt).toContain("<plan_mode>");
			expect(session.systemPrompt).toContain("read-only research and planning mode");

			session.disablePlanMode();
			expect(session.planMode).toBe(false);
			expect(session.getActiveToolNames()).toEqual(expect.arrayContaining(["read", "bash", "edit", "write"]));
			expect(session.systemPrompt).not.toContain("<plan_mode>");
		} finally {
			session.dispose();
		}
	});

	it("blocks non-read-only bash calls through the tool-call hook", async () => {
		const session = await makeSession(SessionManager.inMemory(tempDir));
		try {
			session.enablePlanMode();
			const beforeToolCall = session.agent.beforeToolCall;
			expect(beforeToolCall).toBeDefined();
			const context = (command: string): BeforeToolCallContext =>
				({
					assistantMessage: {
						role: "assistant",
						content: [],
						api: "anthropic",
						provider: "anthropic",
						model: "m",
						stopReason: "toolUse",
						usage: {},
						timestamp: 0,
					},
					toolCall: { type: "toolCall", id: "call-1", name: "bash", arguments: { command } },
					args: { command },
					context: { messages: [], tools: [] },
				}) as unknown as BeforeToolCallContext;

			const blocked = await beforeToolCall!(context("rm -rf build"));
			expect(blocked?.block).toBe(true);
			expect(blocked?.reason).toContain("rm -rf build");

			const allowed = await beforeToolCall!(context("git status"));
			expect(allowed?.block).not.toBe(true);
		} finally {
			session.dispose();
		}
	});

	it("restores plan mode and its tool set when the session is reopened", async () => {
		const sessionManager = SessionManager.create(tempDir, join(agentDir, "sessions"), { id: "plan-restore" });
		sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "plan this" }],
			timestamp: Date.now(),
		});
		const first = await makeSession(sessionManager);
		try {
			first.enablePlanMode();
		} finally {
			first.dispose();
		}

		const sessionFile = sessionManager.getSessionFile();
		expect(sessionFile).toBeDefined();
		const reopened = await makeSession(SessionManager.open(sessionFile!));
		try {
			expect(reopened.planMode).toBe(true);
			expect(reopened.getActiveToolNames()).not.toContain("edit");
			expect(reopened.systemPrompt).toContain("<plan_mode>");
		} finally {
			reopened.dispose();
		}
	});
});

function createFooterSession(planMode: boolean): AgentSession {
	const session = {
		state: {
			model: { id: "test-model", name: "Test Model", provider: "test", contextWindow: 200_000, reasoning: false },
			thinkingLevel: "off",
		},
		sessionManager: {
			getSessionName: () => "",
			getCwd: () => "/tmp/project",
		},
		routedModel: undefined,
		planMode,
	};
	return session as unknown as AgentSession;
}

function createFooterData(): ReadonlyFooterDataProvider {
	return {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => 1,
		onBranchChange: () => () => {},
	};
}

describe("FooterComponent plan mode badge", () => {
	beforeEach(() => {
		initTheme(undefined, false);
	});

	it("renders the badge right-aligned on the model bar within width", () => {
		const line = new FooterComponent(createFooterSession(true), createFooterData()).render(120)[0]!;
		const text = stripAnsi(line);
		expect(text.endsWith("◇ Plan mode")).toBe(true);
		expect(visibleWidth(line)).toBeLessThanOrEqual(120);
	});

	it("drops the badge when the width is too tight", () => {
		const line = new FooterComponent(createFooterSession(true), createFooterData()).render(30)[0]!;
		const text = stripAnsi(line);
		expect(text).not.toContain("Plan mode");
		expect(visibleWidth(line)).toBeLessThanOrEqual(30);
	});

	it("renders no badge when plan mode is off", () => {
		const line = new FooterComponent(createFooterSession(false), createFooterData()).render(120)[0]!;
		expect(stripAnsi(line)).not.toContain("Plan mode");
	});
});
