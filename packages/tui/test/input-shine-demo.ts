/**
 * Demo (not a test): the flux input block startup shine — a one-shot "light sweeps
 * across the block" glint on the filled prompt box, replayed in the max-effort color.
 *
 * The toucan Editor has no blockFill/blockShine yet, so this renders a stand-in of the
 * filled block (flux rows: gray fill / "› placeholder" / gray fill) and applies the
 * shine the same way the flux Editor does: per-column background levels from the shared
 * shine curve, 24 frames x 40ms, placeholder text brightening inside the band.
 *
 * Keys: m = replay the glint tinted with the max-effort color (#ff5f3c), q = quit.
 * Run from packages/tui: node test/input-shine-demo.ts    (Ctrl+C also exits)
 */

import { ProcessTerminal } from "../src/terminal.ts";
import type { Component } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";

// Ported verbatim from flux branch openai-alike:
//   packages/tui/src/shine.ts (curve + geometry)
//   packages/coding-agent/src/modes/interactive/theme/input-shine.ts (colors, peaks)
// Cadence/geometry defaults from packages/tui/src/components/editor.ts (24 x 40ms, rowOffset 0).

const SHINE_LEVELS = 24;
const SHINE_FALLOFF_FRACTION = 0.25;
const SHINE_FALLOFF_MIN_COLS = 6;
const SHINE_FALLOFF_MAX_COLS = 28;
const FRAMES = 24;
const INTERVAL_MS = 40;

const INPUT_SHINE_BG_PEAK = 0.42;
const INPUT_SHINE_FG_PEAK = 0.75;

// Flux dark theme values.
const INPUT_BG = "#3c3c3c";
const NEUTRAL_TARGET = "#ffffff";
const MAX_TARGET = "#ff5f3c"; // thinkingMax (dark)
const MUTED = "#808080"; // placeholder at rest
const TEXT = "#e7e7ea"; // placeholder fades toward the normal text color

const PROMPT = "› ";
const PLACEHOLDER = "Ask toucan anything";

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function smoothstep(u: number): number {
	return u * u * (3 - 2 * u);
}

function shinePhase(u: number): { position: number; envelope: number } {
	const t = clamp01(u);
	return { position: smoothstep(t), envelope: Math.sin(Math.PI * t) };
}

function shineFalloffCols(rowWidth: number, falloffFraction: number = SHINE_FALLOFF_FRACTION): number {
	const fraction = Number.isFinite(falloffFraction) ? Math.max(0, falloffFraction) : SHINE_FALLOFF_FRACTION;
	const cols = Math.round(Math.max(0, rowWidth) * fraction);
	return Math.max(SHINE_FALLOFF_MIN_COLS, Math.min(cols, SHINE_FALLOFF_MAX_COLS));
}

function shineIntensityAt(col: number, width: number, position: number, envelope: number, falloffCols: number): number {
	if (!(envelope > 0) || width <= 1 || falloffCols <= 0) return 0;
	const center = position * (width - 1);
	return clamp01(1 - Math.abs(col - center) / falloffCols) * envelope;
}

function quantizeShine(intensity: number): number {
	return Math.round(clamp01(intensity) * SHINE_LEVELS) / SHINE_LEVELS;
}

function parseHex(color: string): [number, number, number] {
	const n = Number.parseInt(color.slice(1), 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Blend two hex colors by t and emit a truecolor ANSI code (bg=48;2, fg=38;2). */
function blendAnsi(mode: 38 | 48, from: string, to: string, t: number): string {
	const a = parseHex(from);
	const b = parseHex(to);
	const mix = (i: number) => Math.round(a[i] + (b[i] - a[i]) * clamp01(t));
	return `\x1b[${mode};2;${mix(0)};${mix(1)};${mix(2)}m`;
}

type ShineVariant = "default" | "max";

/** The fake filled input block with the one-shot shine swept over it. */
class ShineBlock implements Component {
	private frame = -1;
	private timer: ReturnType<typeof setInterval> | undefined;
	private variant: ShineVariant = "default";
	private readonly requestRender: () => void;
	private readonly onQuit: () => void;

	constructor(requestRender: () => void, onQuit: () => void) {
		this.requestRender = requestRender;
		this.onQuit = onQuit;
	}

	/** Play the glint once. Mirrors flux: replaying cancels an in-flight glint first. */
	startShine(variant: ShineVariant): void {
		this.stopShine();
		this.variant = variant;
		this.frame = 0;
		this.timer = setInterval(() => {
			this.frame++;
			if (this.frame >= FRAMES) {
				this.stopShine();
				this.requestRender();
				return;
			}
			this.requestRender();
		}, INTERVAL_MS);
	}

	stopShine(): void {
		if (this.timer !== undefined) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.frame = -1;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		if (data === "q" || data === "\x03") {
			this.onQuit();
			return;
		}
		if (data === "m") {
			this.startShine("max");
			return;
		}
		// flux stops the launch glint early on the first keystroke
		if (this.frame >= 0) {
			this.stopShine();
			this.requestRender();
		}
	}

	render(width: number): string[] {
		const shine = this.shineRow(width);
		const bgTarget = this.variant === "max" ? MAX_TARGET : NEUTRAL_TARGET;
		return [
			this.renderFill(width, shine, bgTarget),
			this.renderPromptLine(width, shine, bgTarget),
			this.renderFill(width, shine, bgTarget),
		];
	}

	private shineRow(width: number): { position: number; envelope: number; falloffCols: number } | undefined {
		if (this.frame < 0 || width <= 1) return undefined;
		const u = clamp01(this.frame / (FRAMES - 1));
		const { position, envelope } = shinePhase(u);
		return { position, envelope, falloffCols: shineFalloffCols(width) };
	}

	private levelAt(shine: ReturnType<ShineBlock["shineRow"]>, col: number, width: number): number {
		if (!shine) return 0;
		return quantizeShine(shineIntensityAt(col, width, shine.position, shine.envelope, shine.falloffCols));
	}

	/** One filled row: full-width background, shine levels emitted per column run. */
	private renderFill(width: number, shine: ReturnType<ShineBlock["shineRow"]>, bgTarget: string): string {
		let out = blendAnsi(48, INPUT_BG, INPUT_BG, 0);
		let level = 0;
		for (let col = 0; col < width; col++) {
			const next = this.levelAt(shine, col, width);
			if (next !== level) {
				out += blendAnsi(48, INPUT_BG, bgTarget, next * INPUT_SHINE_BG_PEAK);
				level = next;
			}
			out += " ";
		}
		return `${out}\x1b[49m`;
	}

	/** The input row: "› placeholder" padded to width; placeholder brightens inside the band. */
	private renderPromptLine(width: number, shine: ReturnType<ShineBlock["shineRow"]>, bgTarget: string): string {
		// Resting fill first, like renderFill: the run logic below only writes a bg code
		// when the level changes, so without this the idle row would have no background.
		let out = blendAnsi(48, INPUT_BG, INPUT_BG, 0);
		let level = 0;
		const text = `${PROMPT}${PLACEHOLDER}`;
		for (let col = 0; col < width; col++) {
			const next = this.levelAt(shine, col, width);
			if (next !== level) {
				out += blendAnsi(48, INPUT_BG, bgTarget, next * INPUT_SHINE_BG_PEAK);
				level = next;
			}
			const char = text[col] ?? " ";
			if (col >= PROMPT.length && col < text.length) {
				// placeholder glyph: fg fades muted → text color with the band
				out += `${blendAnsi(38, MUTED, TEXT, next * INPUT_SHINE_FG_PEAK) + char}\x1b[39m`;
			} else if (col < PROMPT.length) {
				out += `\x1b[38;2;231;231;234m${char}\x1b[39m`;
			} else {
				out += char;
			}
		}
		return `${out}\x1b[49m`;
	}
}

// --- demo wiring

const terminal = new ProcessTerminal();
const tui = new TuiMainScreen(terminal);

const block = new ShineBlock(
	() => tui.requestRender(),
	() => {
		tui.stop();
		process.exit(0);
	},
);

tui.addChild({
	render: () => ["", "\x1b[2minput block shine demo — press m for the max-effort glint, q to quit\x1b[22m", ""],
	invalidate: () => {},
});
tui.addChild(block);
tui.addChild({ render: () => [""], invalidate: () => {} });
tui.setFocus(block);
tui.start();

// flux arms the launch glint from init() after ui.start()
block.startShine("default");
