// Shared "a light sweeps across a surface" primitives, used by the working indicator's fading
// text and by the input band's one-shot startup shine. Pure math: no ANSI, no timers, no theme.

/** Discrete intensity levels used for per-column ANSI emission (keeps output small). */
export const SHINE_LEVELS = 24;
/** Default shine half-width as a fraction of the swept surface width. */
export const SHINE_FALLOFF_FRACTION = 0.25;
/** Falloff half-width is clamped to this column range so narrow/ultrawide rows still read. */
export const SHINE_FALLOFF_MIN_COLS = 6;
export const SHINE_FALLOFF_MAX_COLS = 28;

export function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

export function smoothstep(u: number): number {
	return u * u * (3 - 2 * u);
}

/**
 * Shine center (0..1 across the surface) and fade envelope (0..1) at frame phase `u` in [0,1].
 * The position eases with smoothstep; the envelope is a sine hump so the shine fades in and out
 * instead of cutting abruptly, which is what keeps a repeating sweep from looking like a stutter.
 */
export function shinePhase(u: number): { position: number; envelope: number } {
	const t = clamp01(u);
	return { position: smoothstep(t), envelope: Math.sin(Math.PI * t) };
}

/** Column half-width of the falloff for a row `rowWidth` columns wide. */
export function shineFalloffCols(rowWidth: number, falloffFraction: number = SHINE_FALLOFF_FRACTION): number {
	const fraction = Number.isFinite(falloffFraction) ? Math.max(0, falloffFraction) : SHINE_FALLOFF_FRACTION;
	const cols = Math.round(Math.max(0, rowWidth) * fraction);
	return Math.max(SHINE_FALLOFF_MIN_COLS, Math.min(cols, SHINE_FALLOFF_MAX_COLS));
}

/** Shine intensity at integer column `col`: 0 at rest, 1 at the peak of the band. */
export function shineIntensityAt(
	col: number,
	width: number,
	position: number,
	envelope: number,
	falloffCols: number,
): number {
	if (!(envelope > 0) || width <= 1 || falloffCols <= 0) return 0;
	const center = position * (width - 1);
	return clamp01(1 - Math.abs(col - center) / falloffCols) * envelope;
}

/** Snap an intensity to the discrete ANSI levels. */
export function quantizeShine(intensity: number): number {
	return Math.round(clamp01(intensity) * SHINE_LEVELS) / SHINE_LEVELS;
}
