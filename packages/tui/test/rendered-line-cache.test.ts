/**
 * Tests for RenderedLineCache: the lines a container keeps between frames, the array identity that
 * signals change to the parent, and the `firstChanged` offset that must point at the real difference.
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import { RenderedLineCache } from "../src/rendered-line-cache.ts";
import { type Component, Container } from "../src/tui.ts";

class LinesComponent implements Component {
	lines: string[];
	constructor(lines: string[]) {
		this.lines = lines;
	}
	render(_width: number): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

/** Component that hands back a fresh array on every render, like a component without an inner cache. */
class FreshComponent implements Component {
	prefix: string;
	constructor(prefix: string) {
		this.prefix = prefix;
	}
	render(_width: number): string[] {
		return [`${this.prefix} ${Math.random()}`];
	}
	invalidate(): void {}
}

describe("RenderedLineCache", () => {
	it("keeps the identical array and reports no change when no child changed", () => {
		const cache = new RenderedLineCache();
		const children = [new LinesComponent(["a", "b"]), new LinesComponent(["c"])];

		const first = cache.render(children, 10);
		const second = cache.render(children, 10);
		assert.strictEqual(second.lines, first.lines);
		assert.strictEqual(second.firstChanged, 3);
	});

	it("reports the changed child's start as the first changed line", () => {
		const cache = new RenderedLineCache();
		const top = new LinesComponent(["a", "b"]);
		const bottom = new LinesComponent(["c"]);
		cache.render([top, bottom], 10);

		bottom.lines = ["d"];
		const second = cache.render([top, bottom], 10);
		assert.strictEqual(second.firstChanged, 2);
		assert.deepStrictEqual(second.lines, ["a", "b", "d"]);
	});

	it("hands back a new array when content changed, so parents can use identity", () => {
		const cache = new RenderedLineCache();
		const child = new LinesComponent(["a"]);
		const first = cache.render([child], 10);

		child.lines = ["b"];
		const second = cache.render([child], 10);
		assert.notStrictEqual(second.lines, first.lines);
	});

	it("reports the change point when a fresh child's content is rebuilt every frame", () => {
		const cache = new RenderedLineCache();
		const statics = [new LinesComponent(["s1", "s2"]), new LinesComponent(["s3"])];
		const spinner = new FreshComponent("spin");
		cache.render([...statics, spinner], 10);

		const second = cache.render([...statics, spinner], 10);
		assert.strictEqual(second.firstChanged, 3);
		assert.strictEqual(second.lines.length, 4);
		assert.strictEqual(second.lines[0], "s1");
	});

	it("propagates the change offset through a nested container", () => {
		const middle = new LinesComponent(["m1", "m2"]);
		const inner = new Container();
		inner.addChild(new LinesComponent(["t1"]));
		inner.addChild(middle);
		inner.addChild(new LinesComponent(["b1"]));
		const cache = new RenderedLineCache();
		cache.render([inner], 10);

		middle.lines = ["m3", "m4"];
		const second = cache.render([inner], 10);
		// t1 did not move; the difference starts at the inner container's line 1.
		assert.strictEqual(second.firstChanged, 1);
		assert.deepStrictEqual(second.lines, ["t1", "m3", "m4", "b1"]);
	});

	it("keeps offsets valid when a child is appended at the end", () => {
		const cache = new RenderedLineCache();
		const children: Component[] = [new LinesComponent(["a", "b"]), new LinesComponent(["c"])];
		cache.render(children, 10);

		children.push(new LinesComponent(["d"]));
		const second = cache.render(children, 10);
		assert.strictEqual(second.firstChanged, 3);
	});

	it("reports line 0 when a child is inserted in the middle", () => {
		const cache = new RenderedLineCache();
		const children: Component[] = [new LinesComponent(["a"]), new LinesComponent(["c"])];
		cache.render(children, 10);

		children.splice(1, 0, new LinesComponent(["b"]));
		const second = cache.render(children, 10);
		// The lines that used to sit at 1 moved to 2, so the difference starts at the moved start.
		assert.strictEqual(second.firstChanged, 1);
		assert.deepStrictEqual(second.lines, ["a", "b", "c"]);
	});

	it("forces a full render when the width changes", () => {
		const cache = new RenderedLineCache();
		const children = [new LinesComponent(["a", "b"])];
		const first = cache.render(children, 10);

		const second = cache.render(children, 8);
		assert.strictEqual(second.firstChanged, 0);
		assert.notStrictEqual(second.lines, first.lines);
	});

	it("forces a full render after invalidate", () => {
		const cache = new RenderedLineCache();
		const children = [new LinesComponent(["a"])];
		cache.render(children, 10);

		cache.invalidate();
		const second = cache.render(children, 10);
		assert.strictEqual(second.firstChanged, 0);
	});

	it("tracks the lines each child contributed across changes", () => {
		const cache = new RenderedLineCache();
		const first = new LinesComponent(["a", "b"]);
		const second = new LinesComponent(["c"]);
		const children = [first, second];
		cache.render(children, 10);
		assert.strictEqual(cache.childLineCount(0), 2);
		assert.strictEqual(cache.childLineCount(1), 1);

		first.lines = ["only"];
		cache.render(children, 10);
		assert.strictEqual(cache.childLineCount(0), 1);
		assert.strictEqual(cache.childLineCount(1), 1);
	});
});

/** Component that counts its renders, so a test can see what a windowed pass skipped. */
class CountingComponent implements Component {
	renders = 0;
	lines: string[];
	constructor(lines: string[]) {
		this.lines = lines;
	}
	render(_width: number): string[] {
		this.renders++;
		return this.lines;
	}
	invalidate(): void {}
}

describe("RenderedLineCache render window", () => {
	it("skips rendering children entirely outside the window and keeps their lines", () => {
		const cache = new RenderedLineCache();
		const top = new CountingComponent(["t1", "t2"]);
		const bottom = new CountingComponent(["b1", "b2", "b3"]);
		const children = [top, bottom];
		cache.render(children, 10);
		assert.strictEqual(bottom.renders, 1);

		const windowed = cache.render(children, 10, { from: 0, to: 2 });
		assert.strictEqual(bottom.renders, 1, "the off-window child must not render");
		assert.strictEqual(top.renders, 2);
		assert.deepStrictEqual(windowed.lines, ["t1", "t2", "b1", "b2", "b3"], "kept lines stay in place");
		assert.strictEqual(cache.childLineCount(1), 3, "the kept child still contributes its height");
	});

	/**
	 * The rule the fullscreen path accepts in exchange: a changed child nobody looks at keeps stale lines
	 * until a window shows it again — the frame after that is correct and costs only that child.
	 */
	it("renders a changed child again once a window covers it", () => {
		const cache = new RenderedLineCache();
		const top = new CountingComponent(["t1", "t2"]);
		const bottom = new CountingComponent(["b1"]);
		const children = [top, bottom];
		cache.render(children, 10);

		bottom.lines = ["new"];
		cache.render(children, 10, { from: 0, to: 2 });
		assert.strictEqual(cache.childLineCount(1), 1, "height stays measured while off-window");

		const second = cache.render(children, 10, { from: 2, to: 3 });
		assert.deepStrictEqual(second.lines, ["t1", "t2", "new"]);
		assert.strictEqual(second.firstChanged, 2, "the refresh is reported to the parent");
	});

	it("renders children with no measured height even outside the window", () => {
		const cache = new RenderedLineCache();
		const top = new CountingComponent(["t1"]);
		const children: Component[] = [top];
		cache.render(children, 10, { from: 0, to: 1 });

		const bottom = new CountingComponent(["b1", "b2"]);
		children.push(bottom);
		// The appended child has no cached height, so it renders once to measure; the old one is skipped.
		const second = cache.render(children, 10, { from: 0, to: 1 });
		assert.strictEqual(bottom.renders, 1);
		assert.strictEqual(top.renders, 2, "in-window children render every frame; measured off-window ones do not");
		assert.strictEqual(second.lines.length, 3);
	});

	it("renders again when the component at an index is swapped", () => {
		const cache = new RenderedLineCache();
		const first = new CountingComponent(["a"]);
		const children: Component[] = [first, new CountingComponent(["b"])];
		cache.render(children, 10);

		const replacement = new CountingComponent(["c"]);
		children[1] = replacement;
		const second = cache.render(children, 10, { from: 0, to: 1 });
		assert.strictEqual(replacement.renders, 1);
		assert.deepStrictEqual(second.lines, ["a", "c"]);
	});

	it("renders a child that was empty in the cached geometry, then grew", () => {
		const cache = new RenderedLineCache();
		const header = new CountingComponent([]);
		const children = [header];
		// A child measured as zero lines sits "outside" every window's line range; the skip must not
		// believe that geometry, or a header arriving after the first paint stays invisible forever.
		cache.render(children, 10, { from: 0, to: 10 });
		assert.strictEqual(header.renders, 1);

		header.lines = ["welcome"];
		const grown = cache.render(children, 10, { from: 0, to: 10 });
		assert.strictEqual(header.renders, 2, "an empty-measured child renders every frame");
		assert.deepStrictEqual(grown.lines, ["welcome"]);
	});

	it("ignores the window when the width changed and re-measures every child", () => {
		const cache = new RenderedLineCache();
		const top = new CountingComponent(["t1", "t2"]);
		const bottom = new CountingComponent(["b1"]);
		const children = [top, bottom];
		cache.render(children, 10);
		top.renders = 0;
		bottom.renders = 0;

		cache.render(children, 8, { from: 0, to: 1 });
		assert.strictEqual(top.renders, 1);
		assert.strictEqual(bottom.renders, 1);
	});
});
