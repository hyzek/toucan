import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@hyzek/toucan-ai/compat";
import type { TUI } from "@hyzek/toucan-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionToolContext } from "../src/core/extensions/types.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
	createQuestionToolDefinition,
	formatQuestionAnswers,
	type QuestionToolAnswer,
} from "../src/core/tools/question.ts";

const ENTER = "\r";

function fakeCtx(custom: (factory: unknown) => Promise<unknown>): ExtensionToolContext {
	return { mode: "tui", hasUI: true, ui: { custom } } as unknown as ExtensionToolContext;
}

const questions = [
	{
		question: "Which storage?",
		header: "Storage",
		options: [{ label: "SQLite" }, { label: "Redis" }],
	},
];

describe("question tool execute", () => {
	it("asks in non-interactive runs instead of blocking", async () => {
		const definition = createQuestionToolDefinition();
		const ctx = { mode: "print", hasUI: false, ui: {} } as unknown as ExtensionToolContext;
		const result = await definition.execute("call-1", { questions }, undefined, undefined, ctx);
		expect(result.content[0]?.type === "text" && result.content[0].text).toContain("interactive");
		expect((result.details as { dismissed?: boolean }).dismissed).toBe(true);
	});

	it("renders the form through ui.custom and returns the submitted answers", async () => {
		const definition = createQuestionToolDefinition();
		const answer: QuestionToolAnswer = {
			header: "Storage",
			question: "Which storage?",
			answers: [{ title: "SQLite", subtitle: "file" }],
			typed: false,
		};
		const result = await definition.execute(
			"call-1",
			{ questions },
			undefined,
			undefined,
			fakeCtx(async () => ({ answers: [answer], dismissed: false })),
		);
		const text = result.content[0];
		expect(text?.type === "text" && text.text).toContain("User answered:");
		expect(text?.type === "text" && text.text).toContain("- Storage: SQLite (file)");
		expect((result.details as { answers?: QuestionToolAnswer[] }).answers).toEqual([answer]);
	});

	it("ui.custom factory builds a working form for the questions", async () => {
		const definition = createQuestionToolDefinition();
		type Factory = (
			tui: TUI,
			theme: unknown,
			kb: KeybindingsManager,
			done: (r: unknown) => void,
		) => {
			render(width: number): string[];
			handleInput(data: string): void;
		};
		let factory: Factory | undefined;
		const ctx = fakeCtx(async (f) => {
			factory = f as Factory;
			return { answers: [], dismissed: true }; // cancel; we only want the factory
		});
		await definition.execute("call-1", { questions }, undefined, undefined, ctx);
		expect(factory).toBeDefined();
		let formResult: { answers: QuestionToolAnswer[] } | undefined;
		const component = factory!(
			{ requestRender: () => {} } as unknown as TUI,
			undefined,
			new KeybindingsManager(),
			(r) => {
				formResult = r as { answers: QuestionToolAnswer[] };
			},
		);
		component.handleInput(ENTER); // first option: SQLite
		expect(formResult?.answers.map((a) => a.answers)).toEqual([[{ title: "SQLite" }]]);
	});

	it("dismissal returns a proceed-without-asking note", async () => {
		const definition = createQuestionToolDefinition();
		const result = await definition.execute(
			"call-1",
			{ questions },
			undefined,
			undefined,
			fakeCtx(async () => ({ answers: [], dismissed: true })),
		);
		const text = result.content[0];
		expect(text?.type === "text" && text.text).toContain("Do not ask again");
	});

	it("formats typed and multi answers with subtitles", () => {
		const answers: QuestionToolAnswer[] = [
			{ header: "Extras", question: "q", answers: [{ title: "CLI" }, { title: "Web UI" }], typed: false },
			{ header: "Notes", question: "q", answers: [{ title: "use tabs" }], typed: true },
		];
		expect(formatQuestionAnswers(answers)).toBe("- Extras: CLI; Web UI\n- Notes: (wrote) use tabs");
	});
});

describe("question tool registration", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `toucan-question-tool-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	});

	it("is active by default and stays active in plan mode", async () => {
		const settingsManager = SettingsManager.create(tempDir, agentDir);
		const resourceLoader = new DefaultResourceLoader({ cwd: tempDir, agentDir, settingsManager });
		await resourceLoader.reload();
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			settingsManager,
			sessionManager: SessionManager.inMemory(tempDir),
			resourceLoader,
		});
		try {
			expect(session.getActiveToolNames()).toContain("question");
			session.enablePlanMode();
			expect(session.getActiveToolNames()).toContain("question");
			session.disablePlanMode();
			expect(session.getActiveToolNames()).toContain("question");
		} finally {
			session.dispose();
		}
	});
});
