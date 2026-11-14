import { setCapabilityOverrides } from "@hyzek/toucan-tui";
import { describe, expect, it } from "vitest";
import {
	createInputShine,
	createInputShineBackground,
	createInputShinePlaceholderStyle,
	shouldPlayMaxShine,
} from "../src/modes/interactive/theme/input-shine.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

// The shine factories emit truecolor escapes only when the terminal reports truecolor; CI runners
// report 256 colors. Pin the capability so these assertions run on every machine.
setCapabilityOverrides({ trueColor: true });

const TRUECOLOR_BG = /^\x1b\[48;2;(\d+);(\d+);(\d+)m$/;

/** Pull the channels out of a truecolor background escape produced by the shine factories. */
function bgRgb(ansi: string): { r: number; g: number; b: number } {
	const match = TRUECOLOR_BG.exec(ansi);
	if (!match) throw new Error(`not a truecolor background: ${JSON.stringify(ansi)}`);
	return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
}

describe("input shine colors", () => {
	it("rests at the unblended band background", () => {
		initTheme("dark", false);
		const background = createInputShineBackground();
		// Byte-identical to the plain `theme.bg("editorBg", ...)` fill this decorates, so an
		// idle input band renders exactly as it did before.
		expect(background(0)).toBe(theme.getBgAnsi("editorBg"));
	});

	it("lightens the band as intensity rises, staying short of near-white", () => {
		initTheme("dark", false);
		const background = createInputShineBackground();
		const base = bgRgb(background(0));
		const half = bgRgb(background(0.5));
		const peak = bgRgb(background(1));

		expect(half.r).toBeGreaterThan(base.r);
		expect(peak.r).toBeGreaterThan(half.r);
		// The working indicator sweeps up to grayscale 255; this is deliberately a glint.
		expect(peak.r).toBeLessThan(200);
	});

	it("darkens the band on the light theme", () => {
		initTheme("light", false);
		const background = createInputShineBackground();
		expect(bgRgb(background(1)).r).toBeLessThan(bgRgb(background(0)).r);
	});

	it("rests at exactly the muted placeholder color", () => {
		initTheme("dark", false);
		const style = createInputShinePlaceholderStyle();
		expect(style("give toucan a task", 0)).toBe(theme.fg("muted", "give toucan a task"));
		expect(style("give toucan a task")).toBe(theme.fg("muted", "give toucan a task"));
	});

	it("brightens the placeholder inside the band so it stays legible", () => {
		initTheme("dark", false);
		const style = createInputShinePlaceholderStyle();
		const peak = style("x", 1);
		expect(peak).not.toBe(theme.fg("muted", "x"));
		expect(peak).toContain("x");
	});
});

describe("shouldPlayMaxShine", () => {
	it("fires on a real transition into max", () => {
		expect(shouldPlayMaxShine("high", "max")).toBe(true);
		expect(shouldPlayMaxShine("off", "max")).toBe(true);
		expect(shouldPlayMaxShine("xhigh", "max")).toBe(true);
		expect(shouldPlayMaxShine(undefined, "max")).toBe(true);
	});

	it("stays quiet when max is already active", () => {
		// Re-confirming max in /effort must not replay the glint.
		expect(shouldPlayMaxShine("max", "max")).toBe(false);
	});

	it("stays quiet on every other change", () => {
		expect(shouldPlayMaxShine("max", "high")).toBe(false);
		expect(shouldPlayMaxShine("max", "off")).toBe(false);
		expect(shouldPlayMaxShine("high", "xhigh")).toBe(false);
		// Requesting max on a model without it clamps to another level. `next` is the session's
		// level *after* clamping, never the requested one, so this must not fire.
		expect(shouldPlayMaxShine("high", "high")).toBe(false);
	});
});

describe("input shine variants", () => {
	it("plays the neutral glint until told otherwise", () => {
		initTheme("dark", false);
		const shine = createInputShine();
		const neutral = createInputShineBackground();
		// The launch glint must not change color: byte-identical at rest and at the peak.
		expect(shine.background(0)).toBe(neutral(0));
		expect(shine.background(1)).toBe(neutral(1));
	});

	it("retints the band toward max effort's color", () => {
		initTheme("dark", false);
		const shine = createInputShine();
		const base = bgRgb(shine.background(0));
		const neutralPeak = bgRgb(shine.background(1));

		shine.setVariant("max");
		const peak = bgRgb(shine.background(1));

		// thinkingMax is a fiery orange, so the blend warms up off the neutral editorBg fill,
		// while the neutral glint stays a pure gray ramp.
		expect(peak.r).toBeGreaterThan(base.r);
		expect(peak.r).toBeGreaterThan(peak.g);
		expect(peak.r - peak.g).toBeGreaterThan(neutralPeak.r - neutralPeak.g);
	});

	it("darkens the band toward max effort's color on the light theme", () => {
		initTheme("light", false);
		const shine = createInputShine();
		const base = bgRgb(shine.background(0));
		shine.setVariant("max");
		const peak = bgRgb(shine.background(1));
		expect(peak.g).toBeLessThan(base.g); // the fill darkens; red rides high, giving the warm tint
		expect(peak.r).toBeGreaterThan(peak.g); // warm, not merely darker
	});

	it("returns to the neutral glint when the variant is reset", () => {
		initTheme("dark", false);
		const shine = createInputShine();
		const neutral = bgRgb(shine.background(1));
		shine.setVariant("max");
		expect(bgRgb(shine.background(1))).not.toEqual(neutral);
		shine.setVariant("default");
		expect(bgRgb(shine.background(1))).toEqual(neutral);
	});

	it("leaves the placeholder styling untouched", () => {
		initTheme("dark", false);
		const shine = createInputShine();
		shine.setVariant("max");
		// Blending the foreground toward the effort color would put red text on a red band, so the
		// max variant deliberately shares the neutral fg fade.
		expect(shine.placeholderStyle("give toucan a task", 0)).toBe(theme.fg("muted", "give toucan a task"));
		expect(shine.placeholderStyle("x", 1)).toBe(createInputShinePlaceholderStyle()("x", 1));
	});
});
