import { Container, stripTerminalSequences, Text, TuiAltScreen } from "@hyzek/toucan-tui";
import { beforeAll, describe, expect, test } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { createChatViewport } from "../src/modes/interactive/chat-viewport.ts";
import { type ShortcutColumn, ShortcutsPanel } from "../src/modes/interactive/components/shortcuts-panel.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const columns: ShortcutColumn[] = [
	{
		title: "Compose",
		rows: [
			{ key: "/", description: "Commands" },
			{ key: "@", description: "Mention files" },
		],
	},
	{
		title: "Session",
		rows: [
			{ key: "esc", description: "Cancel / abort streaming" },
			{ key: "ctrl+c", description: "Clear editor" },
		],
	},
];

function plain(lines: string[]): string[] {
	return lines.map((line) => stripTerminalSequences(line));
}

describe("shortcuts panel", () => {
	beforeAll(() => initTheme("dark"));

	test("renders nothing while closed and the panel while open", () => {
		const panel = new ShortcutsPanel({ footer: () => "~/.toucan/keybindings.json customize" });
		expect(panel.render(100)).toEqual([]);

		panel.setColumns(columns);
		panel.setOpen(true);
		const lines = plain(panel.render(100));
		expect(lines[0]).toBe("");
		expect(lines[1]).toBe("Keyboard shortcuts");
		expect(lines.some((line) => line.includes("Compose") && line.includes("Session"))).toBe(true);
		expect(lines.some((line) => line.includes("/") && line.includes("Commands"))).toBe(true);
		expect(lines[lines.length - 1]).toContain("keybindings.json customize");
	});

	test("stacks columns into bands when they do not fit the width", () => {
		const panel = new ShortcutsPanel();
		panel.setColumns(columns);
		panel.setOpen(true);
		// Too narrow for both columns side by side: each header starts its own band.
		const lines = plain(panel.render(24));
		const composeRow = lines.findIndex((line) => line.includes("Compose"));
		const sessionRow = lines.findIndex((line) => line.includes("Session"));
		expect(composeRow).toBeGreaterThan(-1);
		expect(sessionRow).toBeGreaterThan(composeRow);
		expect(lines[composeRow]).not.toContain("Session");
	});

	test("truncates descriptions instead of overflowing the width", () => {
		const panel = new ShortcutsPanel();
		panel.setColumns([{ title: "Session", rows: [{ key: "esc", description: "Cancel / abort streaming" }] }]);
		panel.setOpen(true);
		for (const line of panel.render(12)) {
			expect(stripTerminalSequences(line).length).toBeLessThanOrEqual(12);
		}
	});

	test("stays inside the height budget, dropping columns and marking truncated rows", () => {
		const many: ShortcutColumn[] = Array.from({ length: 4 }, (_, section) => ({
			title: `Section ${section}`,
			rows: Array.from({ length: 10 }, (_, row) => ({ key: `k${section}-${row}`, description: `action ${row}` })),
		}));

		// Narrow enough for two columns per band, short enough to need truncation.
		const panel = new ShortcutsPanel({ maxRows: () => 16 });
		panel.setColumns(many);
		panel.setOpen(true);
		const lines = plain(panel.render(30));
		expect(lines.length).toBeLessThanOrEqual(16);
		expect(lines.filter((line) => /^Section \d/.test(line))).toHaveLength(2);
		expect(lines.some((line) => line.includes("⋯"))).toBe(true);

		// Too short for three bands: the trailing column is dropped instead of squeezing rows.
		const small = new ShortcutsPanel({ maxRows: () => 10 });
		small.setColumns(many);
		small.setOpen(true);
		const dropped = plain(small.render(15));
		expect(dropped.length).toBeLessThanOrEqual(10);
		expect(dropped.filter((line) => /^Section \d/.test(line))).toHaveLength(2);
	});

	test("renders above the editor in the fullscreen dock", async () => {
		const terminal = new VirtualTerminal(80, 20);
		const ui = new TuiAltScreen(terminal);
		const panel = new ShortcutsPanel();
		panel.setColumns(columns);
		panel.setOpen(true);
		const viewport = createChatViewport({
			document: new Text("transcript line", 1, 0),
			pendingMessages: new Container(),
			status: new Container(),
			shortcuts: panel,
			editor: new Text("\u203a editor band", 1, 0),
			footer: new Text("  footer bar", 1, 0),
		});
		ui.setLayoutRoot(viewport.root);
		ui.start();
		await terminal.waitForRender();

		const lines = terminal.getViewport();
		const panelRow = lines.findIndex((line) => stripTerminalSequences(line).includes("Keyboard shortcuts"));
		const editorRow = lines.findIndex((line) => line.includes("editor band"));
		expect(panelRow).toBeGreaterThan(-1);
		expect(panelRow).toBeLessThan(editorRow);
		ui.stop();
	});
});
