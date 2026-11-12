import { Container, stripTerminalSequences, Text, TuiAltScreen, visibleWidth } from "@hyzek/toucan-tui";
import { beforeAll, describe, expect, test } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { createChatViewport } from "../src/modes/interactive/chat-viewport.ts";
import { footerHint, HotkeyHints } from "../src/modes/interactive/components/hotkey-hints.ts";
import { SessionTip } from "../src/modes/interactive/components/tip-line.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const WIDTH = 80;
const HEIGHT = 20;

function rowOf(lines: string[], needle: string): number {
	return lines.findIndex((line) => line.includes(needle));
}

describe("chat viewport", () => {
	beforeAll(() => initTheme("dark"));

	test("defaults the transcript scrollbar to auto and accepts overrides", () => {
		const automatic = createChatViewport({
			document: new Container(),
			pendingMessages: new Container(),
			status: new Container(),
			editor: new Container(),
			footer: new Container(),
		});
		const hidden = createChatViewport({
			document: new Container(),
			pendingMessages: new Container(),
			status: new Container(),
			editor: new Container(),
			footer: new Container(),
			scrollbar: "hidden",
		});

		expect(automatic.transcript.scrollbar).toBe("auto");
		expect(hidden.transcript.scrollbar).toBe("hidden");
	});

	test("shows the jump-to-latest line in the tip slot while scrolled up and jumps on click", async () => {
		const terminal = new VirtualTerminal(WIDTH, HEIGHT);
		const ui = new TuiAltScreen(terminal);
		const viewport = createChatViewport({
			document: new Text(Array.from({ length: 30 }, (_, index) => `transcript ${index + 1}`).join("\n"), 1, 0),
			pendingMessages: new Container(),
			status: new Container(),
			tip: new SessionTip(
				() => true,
				() => viewport.transcript,
			),
			editor: new Text("\u203a editor band", 1, 0),
			footer: new Text("  footer bar", 1, 0),
		});
		ui.setLayoutRoot(viewport.root);
		ui.start();
		await terminal.waitForRender();
		expect(terminal.getViewport().some((line) => line.includes("Jump to latest"))).toBe(false);

		terminal.sendInput("\x1b[<64;2;2M"); // wheel up over the transcript
		await terminal.waitForRender();
		expect(viewport.transcript.isFollowingEnd).toBe(false);

		const lines = terminal.getViewport();
		const jumpRow = lines.findIndex((line) => line.includes("Jump to latest ↓"));
		expect(jumpRow).toBeGreaterThan(-1);
		expect(stripTerminalSequences(lines[jumpRow]!).trimEnd().endsWith("Jump to latest ↓")).toBe(true);
		expect(lines[jumpRow]).not.toContain("\x1b[4"); // no background
		expect(lines[jumpRow]).not.toContain("Ctrl"); // no hotkey hint

		// Hovering the label recolors it; hovering off the row restores it.
		const labelStart = WIDTH - visibleWidth("Jump to latest ↓") - 1;
		const labelFg = terminal.getViewportCellFg(jumpRow, labelStart);
		expect(labelFg).toBeDefined();
		terminal.sendInput(`\x1b[<35;${labelStart + 6};${jumpRow + 1}M`); // motion over the label
		await terminal.waitForRender();
		expect(terminal.getViewportCellFg(jumpRow, labelStart)).not.toBe(labelFg);
		terminal.sendInput(`\x1b[<35;2;${jumpRow + 1}M`); // motion over the left padding
		await terminal.waitForRender();
		expect(terminal.getViewportCellFg(jumpRow, labelStart)).toBe(labelFg);

		// Clicking beside the label does not jump; clicking the label resumes end-following.
		terminal.sendInput(`\x1b[<0;${labelStart};${jumpRow + 1}M`);
		terminal.sendInput(`\x1b[<0;${labelStart};${jumpRow + 1}m`);
		await terminal.waitForRender();
		expect(viewport.transcript.isFollowingEnd).toBe(false);
		terminal.sendInput(`\x1b[<0;${labelStart + 5};${jumpRow + 1}M`);
		terminal.sendInput(`\x1b[<0;${labelStart + 5};${jumpRow + 1}m`);
		await terminal.waitForRender();
		expect(viewport.transcript.isFollowingEnd).toBe(true);
		expect(terminal.getViewport().some((line) => line.includes("Jump to latest"))).toBe(false);
		ui.stop();
	});

	test("hiding the hints row does not move the editor or footer", async () => {
		// Fullscreen renderer: its dock is pinned to the bottom of the viewport, so a row that
		// collapses instead of turning blank shifts everything above it down one line.
		const terminal = new VirtualTerminal(WIDTH, HEIGHT);
		const ui = new TuiAltScreen(terminal);
		let hasInput = false;
		const hints = new HotkeyHints(() => hasInput);
		hints.add("agents", () => footerHint("\u2190", "for agents"), 1);
		const viewport = createChatViewport({
			document: new Text("transcript line", 1, 0),
			pendingMessages: new Container(),
			status: new Container(),
			tip: new SessionTip(() => false),
			editor: new Text("\u203a editor band", 1, 0),
			footer: new Text("  footer bar", 1, 0),
			hints,
		});
		ui.setLayoutRoot(viewport.root);
		ui.start();
		await terminal.waitForRender();

		const before = terminal.getViewport();
		const tipRow = rowOf(before, "Tip:");
		const editorRow = rowOf(before, "editor band");
		const footerRow = rowOf(before, "footer bar");
		expect(tipRow).toBeGreaterThan(-1);
		expect(rowOf(before, "for agents")).toBe(HEIGHT - 1);

		hasInput = true;
		ui.invalidate();
		ui.requestRender();
		await terminal.waitForRender();

		const after = terminal.getViewport();
		expect(rowOf(after, "for agents")).toBe(-1); // the row is blank, not gone
		expect(rowOf(after, "Tip:")).toBe(tipRow); // typing never hides the launch tip
		expect(rowOf(after, "editor band")).toBe(editorRow);
		expect(rowOf(after, "footer bar")).toBe(footerRow);

		ui.stop();
	});
});
