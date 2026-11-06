import { Container, Text, TuiAltScreen } from "@hyzek/toucan-tui";
import { beforeAll, describe, expect, test } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { createChatViewport } from "../src/modes/interactive/chat-viewport.ts";
import { HotkeyHints } from "../src/modes/interactive/components/hotkey-hints.ts";
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

	test("hiding the hints row does not move the editor or footer", async () => {
		// Fullscreen renderer: its dock is pinned to the bottom of the viewport, so a row that
		// collapses instead of turning blank shifts everything above it down one line.
		const terminal = new VirtualTerminal(WIDTH, HEIGHT);
		const ui = new TuiAltScreen(terminal);
		let hasInput = false;
		const viewport = createChatViewport({
			document: new Text("transcript line", 1, 0),
			pendingMessages: new Container(),
			status: new Container(),
			tip: new SessionTip(() => false),
			editor: new Text("\u203a editor band", 1, 0),
			footer: new Text("  footer bar", 1, 0),
			hints: new HotkeyHints(() => hasInput),
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
