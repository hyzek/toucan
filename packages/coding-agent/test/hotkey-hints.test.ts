// The footer hint row is a dynamic list: items register by id, in insertion
// order, and a feature can add or remove its hint without the bar knowing it.
import { beforeAll, describe, expect, test } from "vitest";
import { footerHint, HotkeyHints } from "../src/modes/interactive/components/hotkey-hints.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function renderRow(hints: HotkeyHints): string[] {
	return hints.render(200).map((line) => stripAnsi(line).trimEnd());
}

describe("HotkeyHints", () => {
	beforeAll(() => initTheme("dark"));

	test("renders nothing but a blank line when no hints are registered", () => {
		const hints = new HotkeyHints(() => false);
		expect(renderRow(hints)).toEqual([""]);
	});

	test("renders registered hints in insertion order", () => {
		const hints = new HotkeyHints(() => false);
		hints.add("shortcuts", () => footerHint("?", "for shortcuts"));
		hints.add("agents", () => footerHint("\u2190", "for agents"));
		expect(renderRow(hints)).toEqual(["  ? for shortcuts \u00b7 \u2190 for agents"]);
	});

	test("re-adding an id replaces the content in place", () => {
		const hints = new HotkeyHints(() => false);
		hints.add("agents", () => footerHint("\u2190", "for agents"));
		hints.add("shortcuts", () => footerHint("?", "for shortcuts"));
		hints.add("agents", () => footerHint("\u2190", "to manage agents"));
		expect(renderRow(hints)).toEqual(["  \u2190 to manage agents \u00b7 ? for shortcuts"]);
	});

	test("addFront puts a hint first, even when registered later", () => {
		const hints = new HotkeyHints(() => false);
		hints.add("shortcuts", () => footerHint("?", "for shortcuts"));
		hints.addFront("agents", () => footerHint("\u2190", "for agents"));
		expect(renderRow(hints)).toEqual(["  \u2190 for agents \u00b7 ? for shortcuts"]);
	});

	test("re-adding with addFront moves the hint to the front", () => {
		const hints = new HotkeyHints(() => false);
		hints.add("agents", () => footerHint("\u2190", "for agents"));
		hints.add("shortcuts", () => footerHint("?", "for shortcuts"));
		hints.addFront("agents", () => footerHint("\u2190", "for agents"));
		expect(renderRow(hints)).toEqual(["  \u2190 for agents \u00b7 ? for shortcuts"]);
	});

	test("remove drops the hint", () => {
		const hints = new HotkeyHints(() => false);
		hints.add("agents", () => footerHint("\u2190", "for agents"));
		hints.add("shortcuts", () => footerHint("?", "for shortcuts"));
		hints.remove("agents");
		expect(renderRow(hints)).toEqual(["  ? for shortcuts"]);
	});

	test("blank segments are skipped", () => {
		const hints = new HotkeyHints(() => false);
		hints.add("agents", () => "");
		hints.add("shortcuts", () => footerHint("?", "for shortcuts"));
		expect(renderRow(hints)).toEqual(["  ? for shortcuts"]);
	});

	test("hides the row while the prompt has input, keeping one line", () => {
		const hints = new HotkeyHints(() => true);
		hints.add("agents", () => footerHint("\u2190", "for agents"));
		expect(renderRow(hints)).toEqual([""]);
	});
});
