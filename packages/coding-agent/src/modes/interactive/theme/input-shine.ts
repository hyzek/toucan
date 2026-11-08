// Colors for the input band's one-shot shine. The editor owns the geometry and the
// timing; these factories only answer "what color is intensity N", so all theme knowledge
// stays on this side of the package boundary.
//
// The band glint is deliberately softer than the working indicator's sweep (which runs the
// grayscale ramp 244->255, i.e. gray to near-white): that effect repeats every second on the
// terminal background, while this one fires once on the input band's own fill.
//
// It plays on launch, and again — recolored to the effort color — whenever reasoning effort
// becomes "max". See `createInputShine` for the variant state and `shouldPlayMaxShine` for the
// trigger rule.

import type { ThinkingLevel } from "@hyzek/toucan-agent-core";
import { backgroundAnsi, type Color, colorToOklch, foregroundAnsi, mixColors, parseColor } from "@hyzek/toucan-tui";
import { theme } from "./theme.ts";

/** Peak blend of the band background toward the shine target. Tune by eye: 0.30 subtle .. 0.55 bold. */
export const INPUT_SHINE_BG_PEAK = 0.42;
/** Peak fade of the placeholder foreground toward the normal text color. */
export const INPUT_SHINE_FG_PEAK = 0.75;

// Dark bands glint brighter; light bands glint darker, since blending a light fill toward
// white is invisible to the eye.
const DARK_TARGET = parseColor("#ffffff");
const LIGHT_TARGET = parseColor("#3c3c3c");

/** Which palette a glint uses: the neutral launch glint, or max effort's own color. */
export type InputShineVariant = "default" | "max";

/**
 * Whether the max-effort glint should play. Only on a real transition into "max" — re-confirming
 * max while it is already active must not replay.
 *
 * `next` must be the *effective* level (the session's level after clamping), not the requested
 * one: picking "max" on a model that does not support it clamps to "high" and must stay silent.
 */
export function shouldPlayMaxShine(previous: ThinkingLevel | undefined, next: ThinkingLevel | undefined): boolean {
	return next === "max" && previous !== "max";
}

/**
 * Blend target for the resting glint: brighter on a dark band, darker on a light one. The
 * direction is chosen from the band fill's own lightness, so custom themes work too.
 */
function resolveTarget(base: Color): Color {
	return colorToOklch(base).l > 0.5 ? LIGHT_TARGET : DARK_TARGET;
}

/**
 * `background` callback for `EditorOptions.bandShine`. Re-reads the theme on every call so a
 * theme swap mid-animation is picked up; the resolved target is cached against the theme's
 * color record, which is replaced (never mutated) on any theme or terminal-color change.
 */
export function createInputShineBackground(
	getVariant: () => InputShineVariant = () => "default",
): (intensity: number) => string {
	let cache: { colors: object; variant: InputShineVariant; base: Color; target: Color } | undefined;
	return (intensity: number) => {
		const colors = theme.colors;
		const variant = getVariant();
		let entry = cache;
		if (!entry || entry.colors !== colors || entry.variant !== variant) {
			const base = colors.editorBg;
			entry = {
				colors,
				variant,
				base,
				// The max-effort target is the effort color itself; `thinkingMax` resolves against
				// `thinkingXhigh` when a theme omits it, so custom themes get a color here too.
				target: variant === "max" ? colors.thinkingMax : resolveTarget(base),
			};
			cache = entry;
		}
		return backgroundAnsi(
			mixColors(entry.base, entry.target, intensity * INPUT_SHINE_BG_PEAK, "srgb"),
			theme.getColorMode(),
		);
	};
}

/**
 * `placeholderStyle` for the input band: muted at rest, fading toward the normal text color
 * inside the band. The foreground must brighten with the background — a muted placeholder on a
 * lightened band is barely 1.2:1 contrast, so a background-only shine would wash the placeholder
 * out exactly when the glint is at its peak.
 */
export function createInputShinePlaceholderStyle(): (text: string, shine?: number) => string {
	return (text: string, shine = 0) => {
		if (shine <= 0) return theme.fg("muted", text);
		const color = mixColors(theme.colors.muted, theme.colors.text, shine * INPUT_SHINE_FG_PEAK, "srgb");
		return `${foregroundAnsi(color, theme.getColorMode())}${text}\x1b[39m`;
	};
}

/**
 * The input band's glint callbacks, sharing one variant. The editor holds these by reference and
 * re-reads `background` on every row of every render, so `setVariant` retints a glint that is
 * already in flight — pick the variant *before* calling `startBandShine`.
 */
export interface InputShine {
	background: (intensity: number) => string;
	placeholderStyle: (text: string, shine?: number) => string;
	setVariant(variant: InputShineVariant): void;
}

export function createInputShine(): InputShine {
	let variant: InputShineVariant = "default";
	return {
		background: createInputShineBackground(() => variant),
		// Deliberately variant-independent: it keeps brightening the placeholder toward the normal
		// text color, because blending it toward the effort color would put red text on a red band.
		placeholderStyle: createInputShinePlaceholderStyle(),
		setVariant(next: InputShineVariant): void {
			variant = next;
		},
	};
}
