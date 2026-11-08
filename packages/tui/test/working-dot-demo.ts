/**
 * Demo (not a test): the flux working indicator — a fading bullet dot instead of the
 * braille spinner, with the working word swept white→gray by the shared shine curve.
 *
 * Shows three rows:
 *   1. the current default braille spinner, for comparison
 *   2. the fading dot: a "•" pulsing over the 256-color gray ramp 244→255, 24 frames x 40ms
 *   3. the full working line: dot + elapsed seconds + "esc to interrupt", with the word
 *      "Working" sweeping white→gray left→right on one cycle
 *
 * Run from packages/tui: node test/working-dot-demo.ts    (Ctrl+C to exit)
 */

import { Loader } from "../src/components/loader.ts";
import { ProcessTerminal } from "../src/terminal.ts";
import type { Component, TUI } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";

// Ported verbatim from flux branch openai-alike:
//   packages/tui/src/shine.ts (shinePhase, clamp01, smoothstep)
//   packages/coding-agent/src/modes/interactive/components/status-indicator.ts (dot frames, sweep)

const DOT = "•";
const FRAMES = 24;
const INTERVAL_MS = 40;
const GRAY_INDEX_MIN = 244; // #808080 (secondary-text gray)
const GRAY_INDEX_MAX = 255; // near-white
const GRAY_RANGE = GRAY_INDEX_MAX - GRAY_INDEX_MIN;

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function smoothstep(u: number): number {
	return u * u * (3 - 2 * u);
}

/** Shine center (0..1 across the surface) and fade envelope (0..1) at frame phase u in [0,1]. */
function shinePhase(u: number): { position: number; envelope: number } {
	const t = clamp01(u);
	return { position: smoothstep(t), envelope: Math.sin(Math.PI * t) };
}

function grayIndex(brightness: number): number {
	return Math.round(GRAY_INDEX_MIN + clamp01(brightness) * GRAY_RANGE);
}

/** Brightness (0 = gray, 1 = white) for the dot pulse: bright-biased raised cosine. */
function workingDotBrightness(t: number): number {
	const s = 0.5 + 0.5 * Math.cos(2 * Math.PI * t);
	return s ** 0.6;
}

/** Fade-dot frames. Loader renders custom frames verbatim, so each carries its own shade. */
const dotFrames: string[] = [];
for (let i = 0; i < FRAMES; i++) {
	const t = i / (FRAMES - 1);
	dotFrames.push(`\x1b[38;5;${grayIndex(workingDotBrightness(t))}m${DOT}\x1b[39m`);
}

/** Color each character white near the sweep center, gray away from it (scaled by envelope). */
function sweepWord(word: string, position: number, envelope: number): string {
	if (word.length === 0) return "";
	let out = "";
	for (let i = 0; i < word.length; i++) {
		const pos = word.length <= 1 ? 1 : i / (word.length - 1);
		const brightness = clamp01(1 - Math.abs(pos - position) / 0.35) * envelope;
		out += `\x1b[38;5;${grayIndex(brightness)}m${word[i]}\x1b[39m`;
	}
	return out;
}

/** The full flux working line: fading dot + swept word + elapsed-seconds suffix. */
class WorkingLine implements Component {
	private frame = 0;
	private readonly startedAt = Date.now();
	private readonly timer: ReturnType<typeof setInterval>;

	constructor(ui: TUI) {
		this.timer = setInterval(() => {
			this.frame = (this.frame + 1) % FRAMES;
			ui.requestRender();
		}, INTERVAL_MS);
	}

	dispose(): void {
		clearInterval(this.timer);
	}

	invalidate(): void {}

	render(): string[] {
		const { position, envelope } = shinePhase(this.frame / (FRAMES - 1));
		const dot = dotFrames[this.frame] ?? DOT;
		const swept = sweepWord("Working", position, envelope);
		const seconds = Math.max(1, Math.ceil((Date.now() - this.startedAt) / 1000));
		const suffix = `\x1b[38;5;245m (${seconds}s • esc to interrupt)\x1b[39m`;
		// Loader renders a leading blank row; match it so rows sit like in the app.
		return ["", `${dot} ${swept}${suffix}`];
	}
}

// --- demo wiring

const terminal = new ProcessTerminal();
const tui = new TuiMainScreen(terminal);

tui.addChild(
	new Loader(
		tui,
		(s) => `\x1b[38;5;39m${s}\x1b[39m`,
		(s) => `\x1b[38;5;245m${s}\x1b[39m`,
		"Loading... (current spinner)",
	),
);
tui.addChild(
	new Loader(
		tui,
		(s) => s,
		(s) => `\x1b[38;5;245m${s}\x1b[39m`,
		"Loading... (fading dot)",
		{
			frames: dotFrames,
			intervalMs: INTERVAL_MS,
		},
	),
);
tui.addChild(new WorkingLine(tui));

tui.addChild(
	// dim hint, not animated
	{ render: () => ["", "\x1b[2mCtrl+C to exit\x1b[22m"], invalidate: () => {} },
);

tui.start();
