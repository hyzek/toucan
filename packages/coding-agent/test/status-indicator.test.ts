import { CombinedAutocompleteProvider, type TUI, visibleWidth } from "@hyzek/toucan-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { CustomEditor, inputBandOptions } from "../src/modes/interactive/components/custom-editor.ts";
import {
	BranchSummaryStatusIndicator,
	CompactionStatusIndicator,
	IdleStatus,
	RetryStatusIndicator,
	WorkingStatusIndicator,
} from "../src/modes/interactive/components/status-indicator.ts";
import { getEditorTheme, initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

async function flushAutocomplete(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => setImmediate(resolve));
}

describe("status indicators", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps idle status at the same height as standalone status indicators", () => {
		const idleStatus = new IdleStatus();

		const lines = idleStatus.render(20);
		expect(lines).toHaveLength(2);
		expect(lines).toEqual([" ".repeat(20), " ".repeat(20)]);
	});

	it("keeps the top border unchanged unless the editor opts in", () => {
		initTheme("dark");
		const tui = {
			requestRender: vi.fn(),
			terminal: { rows: 10 },
		} as unknown as TUI;
		const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create());
		const indicator = new WorkingStatusIndicator(tui, "Working");
		editor.setWorkingStatusIndicator(indicator);

		expect(stripAnsi(editor.render(20)[0]!)).toBe("─".repeat(20));
		const standaloneLine = indicator.render(20)[1]!;
		// The default working indicator is the fading dot, rendered verbatim in grayscale.
		expect(stripAnsi(standaloneLine)).toContain("•");
		expect(standaloneLine).toContain("\x1b[38;5;");
		indicator.dispose();
	});

	it("embeds the working indicator when the editor opts in", () => {
		initTheme("dark");
		const tui = {
			requestRender: vi.fn(),
			terminal: { rows: 10 },
		} as unknown as TUI;
		const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create(), {
			embedWorkingStatus: true,
		});
		expect(editor.embedWorkingStatus).toBe(true);
		editor.borderColor = theme.getThinkingBorderColor("high");
		const indicator = new WorkingStatusIndicator(tui, "Working", undefined, (text) => editor.borderColor(text));
		editor.setWorkingStatusIndicator(indicator);

		const topBorder = editor.render(20)[0]!;
		expect(stripAnsi(topBorder)).toBe("── • Working ───────");
		expect(visibleWidth(topBorder)).toBe(20);
		// The border rule keeps the band's border color; the dot and label are grayscale.
		expect(topBorder).toContain(theme.getFgAnsi("thinkingHigh"));
		indicator.dispose();
	});

	it("renders an engine line with a swept label and a bracketed muted tail", () => {
		initTheme("dark");
		const tui = { requestRender: vi.fn(), terminal: { rows: 10 } } as unknown as TUI;
		const indicator = new WorkingStatusIndicator(tui, "Working");
		indicator.setLine({ label: "Thinking", status: "1.000 tokens · 4s" });

		const line = indicator.render(120)[1]!;
		expect(stripAnsi(line).trim()).toBe("• Thinking (1.000 tokens · 4s)");
		// The label rides the shine curve (256-color gray ramp), the tail stays muted.
		expect(line).toContain("\x1b[38;5;");
		expect(line).toContain(theme.getFgAnsi("muted"));
		indicator.dispose();
	});

	it("keeps the working status above an open slash menu", async () => {
		initTheme("dark");
		const tui = { requestRender: vi.fn(), terminal: { rows: 20 } } as unknown as TUI;
		const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create(), {
			...inputBandOptions(),
			embedWorkingStatus: true,
		});
		editor.setAutocompleteProvider(
			new CombinedAutocompleteProvider([{ name: "model", description: "choose what model" }], process.cwd(), null),
		);
		const indicator = new WorkingStatusIndicator(tui, "Working");
		indicator.setLine({ label: "Working", status: "1.000 tokens · 4s" });
		editor.setWorkingStatusIndicator(indicator);

		editor.handleInput("/");
		await flushAutocomplete();
		const lines = editor.render(60).map(stripAnsi);
		const statusRow = lines.findIndex((line) => line.includes("Working (1.000 tokens"));
		const menuRow = lines.findIndex((line) => line.includes("choose what model"));
		const bandRow = lines.findIndex((line) => line.includes("› /") && !line.includes("/model"));

		expect(statusRow).toBe(0);
		expect(menuRow).toBeGreaterThan(statusRow);
		expect(bandRow).toBeGreaterThan(menuRow);
		indicator.dispose();
	});

	it("floats the status line above the band, blank row below, no band background", () => {
		initTheme("dark");
		const tui = { requestRender: vi.fn(), terminal: { rows: 10 } } as unknown as TUI;
		const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create(), {
			...inputBandOptions(),
			embedWorkingStatus: true,
		});
		const indicator = new WorkingStatusIndicator(tui, "Working");
		indicator.setLine({ label: "Working", status: "177 tokens · 3s" });
		editor.setWorkingStatusIndicator(indicator);

		const lines = editor.render(40);
		expect(stripAnsi(lines[0]!).trim()).toBe("• Working (177 tokens · 3s)");
		expect(lines[0]!).not.toContain(theme.getBgAnsi("editorBg"));
		expect(lines[1]!.trim()).toBe(""); // the gap that keeps the status row off the band
		expect(lines[1]!).not.toContain(theme.getBgAnsi("editorBg"));
		expect(lines[2]!).toContain(theme.getBgAnsi("editorBg")); // input rows keep the fill
		indicator.dispose();
	});

	it("embeds compaction, summary, and retry labels within the border width", () => {
		initTheme("dark");
		vi.useFakeTimers();
		const tui = { requestRender: vi.fn(), terminal: { rows: 10 } } as unknown as TUI;
		const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create(), {
			embedWorkingStatus: true,
		});
		const indicators = [
			new CompactionStatusIndicator(tui, "manual"),
			new CompactionStatusIndicator(tui, "threshold"),
			new CompactionStatusIndicator(tui, "overflow"),
			new BranchSummaryStatusIndicator(tui),
			new RetryStatusIndicator(tui, 1, 3, 3000),
		];
		try {
			for (const indicator of indicators) {
				editor.setWorkingStatusIndicator(indicator);
				const label = stripAnsi(indicator.render(120)[1]!).trim();
				expect(stripAnsi(editor.render(120)[0]!)).toContain(`── ${label} `);
				for (const width of [1, 4, 10, 20, 80, 120]) {
					expect(visibleWidth(editor.render(width)[0]!)).toBe(width);
				}
			}
			vi.advanceTimersByTime(1000);
			expect(stripAnsi(editor.render(120)[0]!)).toContain("Retrying (1/3) in 2s");
			editor.setWorkingStatusIndicator(undefined);
			expect(stripAnsi(editor.render(120)[0]!)).toBe("─".repeat(120));
		} finally {
			for (const indicator of indicators) indicator.dispose();
		}
	});

	it("disposes retry countdown updates", () => {
		initTheme("dark");
		vi.useFakeTimers();
		const requestRender = vi.fn();
		const tui = { requestRender } as unknown as TUI;
		const indicator = new RetryStatusIndicator(tui, 1, 3, 1000);
		const callsBeforeDispose = requestRender.mock.calls.length;

		indicator.dispose();
		vi.advanceTimersByTime(2000);

		expect(requestRender).toHaveBeenCalledTimes(callsBeforeDispose);
	});

	it("cycles 24 grayscale fade-dot frames every 40ms", () => {
		initTheme("dark");
		vi.useFakeTimers();
		const tui = { requestRender: vi.fn(), terminal: { rows: 10 } } as unknown as TUI;
		const indicator = new WorkingStatusIndicator(tui, "Working");
		try {
			const shades = new Set<string>();
			for (let i = 0; i < 24; i++) {
				shades.add(indicator.render(120)[1]!.match(/\x1b\[38;5;(\d+)m/)![1]!);
				vi.advanceTimersByTime(40);
			}
			// The pulse ramps up and back down within one 24-frame cycle.
			expect(shades.size).toBeGreaterThan(6);
			for (const shade of shades) expect(Number(shade)).toBeGreaterThanOrEqual(244);
		} finally {
			indicator.dispose();
		}
	});

	it("stops sweeping after setLabel hands the line to the caller", () => {
		initTheme("dark");
		const tui = { requestRender: vi.fn(), terminal: { rows: 10 } } as unknown as TUI;
		const indicator = new WorkingStatusIndicator(tui, "Working");
		indicator.setLabel("Compacting");
		const line = indicator.render(120)[1]!;
		expect(stripAnsi(line).trim()).toBe("• Compacting");
		expect(line).toContain(theme.getFgAnsi("muted")); // styled by setLabel, not swept
		indicator.dispose();
	});
});
