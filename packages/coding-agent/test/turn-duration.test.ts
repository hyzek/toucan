import { beforeAll, describe, expect, it } from "vitest";
import { turnDurationLine } from "../src/modes/interactive/components/turn-duration.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("turnDurationLine", () => {
	beforeAll(() => initTheme("dark"));

	it("states the turn first, then the session total and how many turns it covers", () => {
		expect(stripAnsi(turnDurationLine(6_000, 6_000, 1, theme))).toBe("✻ Turn took 6s (Total time 6s · 1 turn)");
		expect(stripAnsi(turnDurationLine(65_000, 200_000, 4, theme))).toBe(
			"✻ Turn took 1m 5s (Total time 3m 20s · 4 turns)",
		);
		expect(stripAnsi(turnDurationLine(400, 400, 1, theme))).toBe("✻ Turn took 0.4s (Total time 0.4s · 1 turn)");
	});

	it("keeps the turn's own time and the total in the muted line colour, and the mark in the accent", () => {
		const line = turnDurationLine(6_000, 6_000, 1, theme);

		expect(line).toContain(theme.getFgAnsi("accent"));
		expect(line).toContain(theme.getFgAnsi("muted"));
	});
});
