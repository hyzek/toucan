import { Editor, stripTerminalSequences, TuiMainScreen } from "@hyzek/toucan-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { inputBandOptions } from "../src/modes/interactive/components/custom-editor.ts";
import { FooterComponent } from "../src/modes/interactive/components/footer.ts";
import { TipLine } from "../src/modes/interactive/components/tip-line.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";

/** Fixed tip so the snapshot is deterministic (production picks one at random per launch). */
const TIP = "Tip: Use /new for a fresh context for fresh tasks.";
const WIDTH = 90;

function createSession(): AgentSession {
	const session = {
		state: {
			model: {
				id: "gpt-6.1-sol",
				provider: "openai",
				contextWindow: 200_000,
				reasoning: true,
			},
			thinkingLevel: "high",
		},
		sessionManager: {
			getEntries: () => [],
			getEntryCount: () => 0,
			getSessionId: () => "test-session",
			getLeafId: () => null,
			getSessionName: () => "layout test",
			getCwd: () => "/tmp/project",
		},
		getContextUsage: () => ({ contextWindow: 200_000, percent: 0 }),
		routedModel: undefined,
		modelRuntime: {
			isUsingSubscription: () => false,
		},
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

function renderBottomStack(): string[] {
	const ui = new TuiMainScreen(new VirtualTerminal(WIDTH, 24));
	const tip = new TipLine(TIP);
	const editor = new Editor(ui, getEditorTheme(), inputBandOptions());
	const footer = new FooterComponent(createSession(), createFooterData());
	return [...tip.render(WIDTH), ...editor.render(WIDTH), ...footer.render(WIDTH)].map((line) =>
		stripTerminalSequences(line),
	);
}

describe("launch bottom layout", () => {
	beforeAll(() => initTheme("dark"));

	it("renders tip, input band, and footer", async () => {
		const lines = renderBottomStack();
		await expect(lines.join("\n")).toMatchFileSnapshot("snapshots/launch-layout.txt");
	});

	it("shows the tip right-aligned above the input band", () => {
		const lines = renderBottomStack();
		expect(lines[0]!.trimEnd().endsWith(TIP)).toBe(true);
		expect(lines[0]!.startsWith(" ")).toBe(true);
	});

	it("renders a 3-row borderless band with the text row vertically centered", () => {
		const lines = renderBottomStack();
		const band = lines.slice(1, 4);
		expect(band).toHaveLength(3);
		expect(band[0]!.trim()).toBe("");
		expect(band[1]!.startsWith("› ")).toBe(true);
		expect(band[2]!.trim()).toBe("");
		for (const line of band) {
			expect(line).not.toContain("─");
			expect(line.trimEnd().length).toBeLessThanOrEqual(WIDTH);
		}
	});

	it("renders the footer as a single bar led by the model and effort", () => {
		const lines = renderBottomStack();
		const footer = lines.slice(4);
		expect(footer).toHaveLength(1);
		expect(footer[0]!.startsWith("  ")).toBe(true);
		expect(footer[0]!.trimStart().startsWith("gpt-6.1-sol • high")).toBe(true);
	});
});
