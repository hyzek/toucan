import {
	Container,
	Editor,
	ScrollView,
	Spacer,
	stripTerminalSequences,
	Text,
	TuiMainScreen,
	type TuiMouseEvent,
	visibleWidth,
} from "@hyzek/toucan-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { ChatNotice, hasChatTranscript } from "../src/modes/interactive/components/chat-notice.ts";
import { inputBandOptions } from "../src/modes/interactive/components/custom-editor.ts";
import { FooterComponent } from "../src/modes/interactive/components/footer.ts";
import { footerHint, HotkeyHints } from "../src/modes/interactive/components/hotkey-hints.ts";
import { SessionTip, TipLine } from "../src/modes/interactive/components/tip-line.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";

/** Fixed tip so the snapshot is deterministic (production picks one at random per launch). */
const TIP = "Tip: Use /new for a fresh context for fresh tasks.";
const WIDTH = 90;

function createSession(): AgentSession {
	const session = {
		state: {
			model: {
				id: "gpt-6.1-sol",
				name: "GPT-6.1 Sol",
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
	const hints = new HotkeyHints(() => false);
	hints.add("agents", () => footerHint("\u2190", "for agents"), 1);
	hints.add("shortcuts", () => footerHint("?", "for shortcuts"), 2);
	return [...tip.render(WIDTH), ...editor.render(WIDTH), ...footer.render(WIDTH), ...hints.render(WIDTH)].map((line) =>
		stripTerminalSequences(line),
	);
}

describe("launch bottom layout", () => {
	beforeAll(() => initTheme("dark"));

	it("renders tip, input band, footer, and hints", async () => {
		const lines = renderBottomStack();
		await expect(lines.join("\n")).toMatchFileSnapshot("snapshots/launch-layout.txt");
	});

	it("shows the tip right-aligned above the input band", () => {
		const lines = renderBottomStack();
		expect(lines[0]!.trimEnd().endsWith(TIP)).toBe(true);
		expect(lines[0]!.startsWith(" ")).toBe(true);
	});

	it("hides the session tip once the chat has content", () => {
		let hasTranscript = false;
		const tip = new SessionTip(() => hasTranscript);
		expect(tip.render(WIDTH)).toHaveLength(1);
		hasTranscript = true;
		expect(tip.render(WIDTH)).toHaveLength(0);
		hasTranscript = false; // /new clears the transcript
		expect(tip.render(WIDTH)).toHaveLength(1);
	});

	it("shows a right-aligned jump-to-latest line while the transcript is scrolled up", () => {
		const transcript = new ScrollView(
			new Text(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n"), 0, 0),
			{
				follow: "end",
			},
		);
		transcript.updateLayout(12, 4, () => {});
		const tip = new SessionTip(
			() => true,
			() => transcript,
		);
		expect(tip.render(WIDTH)).toHaveLength(0);
		transcript.scrollBy(-2);
		const [line] = tip.render(WIDTH);
		expect(
			stripTerminalSequences(line ?? "")
				.trimEnd()
				.endsWith("Jump to latest ↓"),
		).toBe(true);
		expect(line).not.toContain("\x1b[4"); // no background
		expect(line).not.toContain("Ctrl"); // no hotkey hint
		const hoverMove = (x: number): TuiMouseEvent => ({
			type: "move",
			button: "none",
			x,
			y: 0,
			screenX: x,
			screenY: 0,
			width: WIDTH,
			height: 1,
			shift: false,
			alt: false,
			ctrl: false,
		});
		const labelStart = WIDTH - visibleWidth("Jump to latest ↓") - 1;
		expect(tip.handleMouse(hoverMove(labelStart + 5))?.render).toBe(true); // hovered
		const hovered = tip.render(WIDTH)[0]!;
		expect(hovered).not.toBe(line); // a different color while hovered
		expect(stripTerminalSequences(hovered)).toBe(stripTerminalSequences(line!));
		tip.handleMouse(hoverMove(2)); // padding beside the label does not highlight
		expect(tip.render(WIDTH)[0]).toBe(line);
		transcript.scrollToEnd();
		expect(tip.render(WIDTH)).toHaveLength(0);
	});

	it("hides the tip on any chat history, keeps it above notices", () => {
		// Interactive mode passes hasChatTranscript: prompts, model replies, `!` bash rows and
		// built-in command output hide the tip; startup banners and the /new confirmation do not.
		const chat = new Container();
		const tip = new SessionTip(() => hasChatTranscript(chat.children));
		chat.addChild(new ChatNotice());
		expect(tip.render(WIDTH)).toHaveLength(1);
		chat.addChild(new Spacer(1));
		chat.addChild(new Text("Session Info", 1, 0)); // e.g. /session output
		expect(tip.render(WIDTH)).toHaveLength(0);
		chat.clear(); // /new clears the transcript
		chat.addChild(new ChatNotice());
		expect(tip.render(WIDTH)).toHaveLength(1);
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

	it("renders the footer as a single bar led by the model name and effort", () => {
		const lines = renderBottomStack();
		const footer = lines.slice(4, 5);
		expect(footer).toHaveLength(1);
		expect(footer[0]!.startsWith("  ")).toBe(true);
		expect(footer[0]!.trimStart().startsWith("GPT-6.1 Sol \u00b7 high")).toBe(true);
		expect(footer[0]!.trimEnd().endsWith("/tmp/project")).toBe(true);
	});

	it("renders the hints row under the footer bar and hides it once the editor has text", () => {
		const lines = renderBottomStack();
		expect(lines[5]!.trimStart()).toBe("← for agents · ? for shortcuts");
		// Hidden, the row is still reserved, so the footer bar does not move while typing.
		expect(new HotkeyHints(() => true).render(WIDTH)).toEqual([""]);
	});
});
