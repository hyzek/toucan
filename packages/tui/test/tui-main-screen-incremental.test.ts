/**
 * Tests for TuiMainScreen's incremental frame: what the cache makes possible — rewriting only the
 * changed lines and still placing the hardware cursor when the line holding it was not rewritten.
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import { CURSOR_MARKER, FAKE_CURSOR_START, renderFakeCursor } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

class LoggingVirtualTerminal extends VirtualTerminal {
	private writes: string[] = [];

	override write(data: string): void {
		this.writes.push(data);
		super.write(data);
	}

	getWrites(): string {
		return this.writes.join("");
	}

	clearWrites(): void {
		this.writes = [];
	}
}

/** Component whose render hands back the same array until `lines` is replaced, like a cached leaf. */
class StaticComponent {
	lines: string[] = [];
	render(_width: number): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

/** Component that produces a new array with new content on every render, like a live spinner. */
class LiveComponent {
	frame = 0;
	render(_width: number): string[] {
		this.frame += 1;
		return [`tick ${this.frame}`];
	}
	invalidate(): void {}
}

describe("TuiMainScreen incremental frames", () => {
	it("rewrites only the lines below the first changed one", async () => {
		const terminal = new LoggingVirtualTerminal(40, 10);
		const tui = new TuiMainScreen(terminal);
		const transcript = new StaticComponent();
		transcript.lines = Array.from({ length: 20 }, (_, index) => `transcript line ${index}`);
		const spinner = new LiveComponent();
		tui.addChild(transcript as never);
		tui.addChild(spinner as never);
		tui.start();
		await terminal.waitForRender();
		terminal.clearWrites();

		tui.requestRender();
		await terminal.waitForRender();

		const writes = terminal.getWrites();
		assert.ok(writes.includes("tick 2"), "the changed spinner line must be rewritten");
		assert.ok(!writes.includes("transcript line 5"), "untouched transcript lines must not be written");
		tui.stop();
	});

	it("places the hardware cursor from a line that was not rewritten this frame", async () => {
		const terminal = new LoggingVirtualTerminal(40, 10);
		const tui = new TuiMainScreen(terminal);
		const input = new StaticComponent();
		input.lines = ["typed", `a${CURSOR_MARKER}b`];
		const spinner = new LiveComponent();
		tui.addChild(input as never);
		tui.addChild(spinner as never);
		tui.start();
		await terminal.waitForRender();

		assert.deepStrictEqual(terminal.getCursorPosition(), { x: 1, y: 1 });

		// The spinner changes on every frame; the input, which carries the cursor, stays cached.
		tui.requestRender();
		await terminal.waitForRender();

		assert.deepStrictEqual(terminal.getCursorPosition(), { x: 1, y: 1 });
		tui.stop();
	});

	it("resolves a fake cursor on a line that was not rewritten this frame", async () => {
		const terminal = new LoggingVirtualTerminal(40, 10);
		const tui = new TuiMainScreen(terminal);
		tui.setShowHardwareCursor(true);
		const input = new StaticComponent();
		input.lines = [`ab${CURSOR_MARKER}${renderFakeCursor("c")}def`, "second"];
		const spinner = new LiveComponent();
		tui.addChild(input as never);
		tui.addChild(spinner as never);
		tui.start();
		await terminal.waitForRender();
		terminal.clearWrites();

		tui.requestRender();
		await terminal.waitForRender();

		const writes = terminal.getWrites();
		assert.ok(!writes.includes(FAKE_CURSOR_START), "the fake cursor marker must not reach the terminal");
		assert.ok(!writes.includes(CURSOR_MARKER), "the cursor marker must not reach the terminal");
		assert.deepStrictEqual(terminal.getCursorPosition(), { x: 2, y: 0 });
		tui.stop();
	});
});
