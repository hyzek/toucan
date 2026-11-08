import assert from "node:assert";
import { describe, it } from "node:test";
import {
	clamp01,
	quantizeShine,
	SHINE_FALLOFF_MAX_COLS,
	SHINE_FALLOFF_MIN_COLS,
	SHINE_LEVELS,
	shineFalloffCols,
	shineIntensityAt,
	shinePhase,
	smoothstep,
} from "../src/shine.ts";

describe("shine math", () => {
	describe("clamp01 / smoothstep", () => {
		it("clamps to 0..1", () => {
			assert.equal(clamp01(-1), 0);
			assert.equal(clamp01(0.25), 0.25);
			assert.equal(clamp01(2), 1);
		});

		it("eases with fixed endpoints and a midpoint", () => {
			assert.equal(smoothstep(0), 0);
			assert.equal(smoothstep(1), 1);
			assert.equal(smoothstep(0.5), 0.5);
			assert.ok(smoothstep(0.25) < 0.25); // slow at the start
			assert.ok(smoothstep(0.75) > 0.75); // fast through the middle
		});
	});

	describe("shinePhase", () => {
		it("starts faded and ends faded", () => {
			assert.deepEqual(shinePhase(0), { position: 0, envelope: 0 });
			const end = shinePhase(1);
			assert.equal(end.position, 1);
			// sin(PI) is a hair above zero rather than exactly zero.
			assert.ok(end.envelope < 1e-9);
		});

		it("peaks in the middle", () => {
			assert.deepEqual(shinePhase(0.5), { position: 0.5, envelope: 1 });
		});

		it("clamps out-of-range input", () => {
			assert.deepEqual(shinePhase(-5), { position: 0, envelope: 0 });
			assert.equal(shinePhase(5).position, 1);
			assert.ok(shinePhase(5).envelope < 1e-9);
		});
	});

	describe("shineFalloffCols", () => {
		it("scales with the row width and clamps at both ends", () => {
			assert.equal(shineFalloffCols(10), SHINE_FALLOFF_MIN_COLS);
			assert.equal(shineFalloffCols(80), 20); // 80 * the 0.25 default fraction
			assert.equal(shineFalloffCols(4000), SHINE_FALLOFF_MAX_COLS);
		});

		it("honours a custom fraction and falls back on a bad one", () => {
			assert.equal(shineFalloffCols(80, 0.5), SHINE_FALLOFF_MAX_COLS);
			assert.equal(shineFalloffCols(80, Number.NaN), 20);
			assert.equal(shineFalloffCols(80, -1), SHINE_FALLOFF_MIN_COLS);
		});
	});

	describe("shineIntensityAt", () => {
		const width = 81;
		const mid = shinePhase(0.5); // position 0.5, envelope 1
		const falloff = 20;
		const center = 40; // mid.position * (width - 1)

		it("peaks at the shine center and is symmetric around it", () => {
			assert.equal(shineIntensityAt(center, width, mid.position, mid.envelope, falloff), 1);
			assert.equal(
				shineIntensityAt(center - 5, width, mid.position, mid.envelope, falloff),
				shineIntensityAt(center + 5, width, mid.position, mid.envelope, falloff),
			);
		});

		it("reaches zero outside the falloff", () => {
			assert.equal(shineIntensityAt(0, width, mid.position, mid.envelope, falloff), 0);
			assert.equal(shineIntensityAt(width - 1, width, mid.position, mid.envelope, falloff), 0);
		});

		it("scales with the envelope", () => {
			const full = shineIntensityAt(center, width, mid.position, 1, falloff);
			const half = shineIntensityAt(center, width, mid.position, 0.5, falloff);
			assert.equal(half, full * 0.5);
			assert.equal(shineIntensityAt(center, width, 0, 0, falloff), 0);
		});

		it("guards degenerate geometry", () => {
			assert.equal(shineIntensityAt(0, 1, 0.5, 1, falloff), 0); // width <= 1
			assert.equal(shineIntensityAt(0, width, 0.5, 1, 0), 0); // no falloff
		});
	});

	describe("quantizeShine", () => {
		it("snaps to the discrete levels", () => {
			assert.equal(quantizeShine(0), 0);
			assert.equal(quantizeShine(1), 1);
			assert.equal(quantizeShine(0.5), 12 / SHINE_LEVELS);
		});

		it("clamps out-of-range intensities", () => {
			assert.equal(quantizeShine(2), 1);
			assert.equal(quantizeShine(-1), 0);
		});
	});
});
