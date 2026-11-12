// The footer hint row is a dynamic list: items register by id with an
// explicit display order, and a feature can add or remove its hint without
// the bar knowing it. The interrupt hint leads, then agents, then shortcuts.
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

	test("renders hints by display order, not insertion order", () => {
		const hints = new HotkeyHints(() => false);
		hints.add("shortcuts", () => footerHint("?", "for shortcuts"), 2);
		hints.add("agents", () => footerHint("\u2190", "for agents"), 1);
		expect(renderRow(hints)).toEqual(["  \u2190 for agents \u00b7 ? for shortcuts"]);
	});

	test("the interrupt hint leads the row even when registered last", () => {
		const hints = new HotkeyHints(() => false);
		hints.add("shortcuts", () => footerHint("?", "for shortcuts"), 2);
		hints.add("agents", () => footerHint("\u2190", "for agents"), 1);
		hints.add("interrupt", () => footerHint("esc", "to interrupt"), 0);
		expect(renderRow(hints)).toEqual(["  esc to interrupt \u00b7 \u2190 for agents \u00b7 ? for shortcuts"]);
	});

	test("removing and re-adding the interrupt hint leaves the other items in place", () => {
		const hints = new HotkeyHints(() => false);
		hints.add("interrupt", () => footerHint("esc", "to interrupt"), 0);
		hints.add("agents", () => footerHint("\u2190", "for agents"), 1);
		hints.add("shortcuts", () => footerHint("?", "for shortcuts"), 2);
		hints.remove("interrupt");
		expect(renderRow(hints)).toEqual(["  \u2190 for agents \u00b7 ? for shortcuts"]);
		hints.add("interrupt", () => footerHint("esc", "to interrupt"), 0);
		expect(renderRow(hints)).toEqual(["  esc to interrupt \u00b7 \u2190 for agents \u00b7 ? for shortcuts"]);
	});

	test("re-adding an id replaces the content in place", () => {
		const hints = new HotkeyHints(() => false);
		hints.add("agents", () => footerHint("\u2190", "for agents"), 1);
		hints.add("shortcuts", () => footerHint("?", "for shortcuts"), 2);
		hints.add("agents", () => footerHint("\u2190", "to manage agents"), 1);
		expect(renderRow(hints)).toEqual(["  \u2190 to manage agents \u00b7 ? for shortcuts"]);
	});

	test("equal order keeps insertion order", () => {
		const hints = new HotkeyHints(() => false);
		hints.add("first", () => footerHint("a", "first"), 5);
		hints.add("second", () => footerHint("b", "second"), 5);
		expect(renderRow(hints)).toEqual(["  a first \u00b7 b second"]);
	});

	test("remove drops the hint", () => {
		const hints = new HotkeyHints(() => false);
		hints.add("agents", () => footerHint("\u2190", "for agents"), 1);
		hints.add("shortcuts", () => footerHint("?", "for shortcuts"), 2);
		hints.remove("agents");
		expect(renderRow(hints)).toEqual(["  ? for shortcuts"]);
	});

	test("blank segments are skipped", () => {
		const hints = new HotkeyHints(() => false);
		hints.add("agents", () => "", 1);
		hints.add("shortcuts", () => footerHint("?", "for shortcuts"), 2);
		expect(renderRow(hints)).toEqual(["  ? for shortcuts"]);
	});

	test("hides the row while the prompt has input, keeping one line", () => {
		const hints = new HotkeyHints(() => true);
		hints.add("agents", () => footerHint("\u2190", "for agents"), 1);
		expect(renderRow(hints)).toEqual([""]);
	});
});
