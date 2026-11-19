import type { Component } from "./tui.ts";

/** The half-open document line range `[from, to)` a scrolling layout currently shows. */
export interface RenderWindow {
	from: number;
	to: number;
}

export interface RenderedLines {
	/**
	 * The children's lines concatenated. The array is owned by the cache and reused across frames: callers
	 * must treat it as read-only, because writing into it corrupts the next frame's render.
	 */
	lines: string[];
	/**
	 * Index of the first line that differs from the previous render at the same width, or `lines.length`
	 * when the render is identical. Renderers start looking for what to redraw here instead of at line 0.
	 */
	firstChanged: number;
	/** The exact snapshot that `firstChanged` is relative to, when known. */
	previousLines?: readonly string[];
}

/**
 * A container's concatenated render, kept across frames.
 *
 * A child whose `render()` hands back the same array it handed back last frame produced identical lines, so
 * those lines are reused and never re-normalized, re-diffed or re-scanned. Per-frame cost is then
 * proportional to what changed instead of to the size of the transcript: when the last message of a
 * 40 000-line session grows by one line, only that message's lines are rebuilt.
 *
 * The rule a child follows is that the array it caches stays immutable while the cache can see it. A
 * component that edits lines it received from a child, or from `super.render()`, builds its own array.
 *
 * With a {@link RenderWindow} the pass skips rendering children that lie entirely outside the window and
 * keeps their lines and line counts from the last frame: a scrolling transcript then renders what is in
 * sight, not the whole document. The kept lines can go stale while a changed child is off-screen, and the
 * next frame that brings it back into the window renders it again.
 */
export class RenderedLineCache {
	private lines: string[] = [];
	private width = -1;
	/** The array each child returned during the last render; identity decides whether its lines were reused. */
	private childLines: (readonly string[])[] = [];
	/** Whether each child's array differs from the frame before, set by the render pass that found it. */
	private changed: boolean[] = [];
	/** Line index in {@link lines} where each child's lines start. */
	private childStarts: number[] = [];
	/** The component each {@link childLines} entry was rendered from; a different component renders again. */
	private childOwners: (Component | undefined)[] = [];

	/** Width the last {@link render} used, or -1 when nothing has been rendered yet. */
	get renderedWidth(): number {
		return this.width;
	}

	/** Number of children the last {@link render} saw. */
	get renderedChildCount(): number {
		return this.childLines.length;
	}

	/** Lines the child at `index` contributed to the last render. */
	childLineCount(index: number): number {
		const start = this.childStarts[index];
		if (start === undefined) return 0;
		return (this.childStarts[index + 1] ?? this.lines.length) - start;
	}

	/** Drops the cache so the next render rebuilds everything. */
	invalidate(): void {
		this.width = -1;
		this.childLines = [];
		this.childOwners = [];
	}

	/**
	 * Renders `children` at `width`, reusing the lines of the children that did not change. With `visible`,
	 * children entirely outside that line window are not rendered at all (see the class comment).
	 */
	render(children: readonly Component[], width: number, visible?: RenderWindow): RenderedLines {
		if (this.width !== width) {
			// Lines from another width are not comparable, so nothing is known about what changed — and a
			// window is useless, because every child's line count has to be measured again anyway.
			return this.fullRender(children, width, false);
		}
		if (this.childLines.length !== children.length) {
			return this.fullRender(children, width, true, visible);
		}
		return this.patchRender(children, width, visible);
	}

	/**
	 * Renders one child, taking its reported change offset when it caches, or 0 when its whole block is
	 * new. The child is armed with `childWindow` — the parent's window moved into the child's own line
	 * coordinates — so a container child culls its grandchildren the same way the parent culls it. The
	 * arm is written on every render call, so a pending value is never older than the frame that renders.
	 */
	private childRender(
		child: Component,
		width: number,
		childWindow: RenderWindow | undefined,
		previousLines: readonly string[] | undefined,
	): { lines: readonly string[]; firstChanged: number } {
		child.setRenderWindow?.(childWindow);
		const cached = child.renderCached?.(width);
		if (cached) {
			// A replacement or an intervening render may have used a different baseline than this parent.
			const firstChanged =
				previousLines !== undefined && cached.previousLines === previousLines ? cached.firstChanged : 0;
			return { lines: cached.lines, firstChanged };
		}
		return { lines: child.render(width), firstChanged: 0 };
	}

	/** The parent's window moved into the coordinates of the child block starting at `childStart`. */
	private static localWindow(visible: RenderWindow | undefined, childStart: number): RenderWindow | undefined {
		if (visible === undefined) return undefined;
		return { from: visible.from - childStart, to: visible.to - childStart };
	}

	/** Uses the current start and cached height; a child measured as empty can have grown anywhere. */
	private static outsideWindow(start: number, height: number, visible: RenderWindow): boolean {
		return height > 0 && (start >= visible.to || start + height <= visible.from);
	}

	/**
	 * Renders every child. Offsets may be reported when only the children's count changed: lines still
	 * compare against the previous render at the same width, and only children whose lines differ or
	 * whose start moved count as changed. On a width change, offsets are off: nothing is known.
	 * With `visible`, unchanged child slots can reuse their lines when their current position is offscreen.
	 */
	private fullRender(
		children: readonly Component[],
		width: number,
		offsetsValid: boolean,
		visible?: RenderWindow,
	): RenderedLines {
		const count = children.length;
		const previousLines = offsetsValid ? this.lines : undefined;
		const oldLines = offsetsValid ? this.childLines : [];
		const oldStarts = offsetsValid ? this.childStarts : [];
		const oldOwners = offsetsValid ? this.childOwners : [];
		this.width = width;
		this.childLines = new Array<readonly string[]>(count);
		this.changed = new Array<boolean>(count).fill(true);
		this.childStarts = new Array<number>(count);
		this.childOwners = new Array<Component | undefined>(count);
		const lines: string[] = [];
		let firstChanged = offsetsValid ? Number.POSITIVE_INFINITY : 0;
		for (let index = 0; index < count; index++) {
			const child = children[index]!;
			const previousChildLines = oldLines[index];
			const skipped =
				visible !== undefined &&
				oldOwners[index] === child &&
				previousChildLines !== undefined &&
				RenderedLineCache.outsideWindow(lines.length, previousChildLines.length, visible);
			const rendered = skipped
				? { lines: previousChildLines, firstChanged: previousChildLines.length }
				: this.childRender(child, width, RenderedLineCache.localWindow(visible, lines.length), previousChildLines);
			this.childOwners[index] = child;
			this.childLines[index] = rendered.lines;
			this.childStarts[index] = lines.length;
			if (offsetsValid) {
				if (oldStarts[index] !== lines.length) {
					firstChanged = Math.min(firstChanged, lines.length);
				} else if (rendered.lines !== previousChildLines) {
					firstChanged = Math.min(
						firstChanged,
						lines.length + Math.min(rendered.firstChanged, rendered.lines.length),
					);
				}
			}
			for (const line of rendered.lines) lines.push(line);
		}
		this.lines = lines;
		return { lines, firstChanged: offsetsValid ? Math.min(firstChanged, lines.length) : 0, previousLines };
	}

	/**
	 * Renders every child and rewrites only the lines from the first changed child onwards. A child that
	 * neither changed nor moved keeps the lines already in place; a child whose line count changed moves
	 * the children behind it, and their lines are copied without being rendered again.
	 *
	 * A changed render hands back a fresh array so callers up the tree can use array identity to tell
	 * changed content from unchanged content; an unchanged render hands back the very same array again.
	 */
	private patchRender(children: readonly Component[], width: number, visible?: RenderWindow): RenderedLines {
		const count = children.length;
		const previousLines = this.lines;
		let childStart = 0;
		let firstChangedChild = -1;
		let firstChanged = Number.POSITIVE_INFINITY;
		for (let index = 0; index < count; index++) {
			const child = children[index]!;
			const previousChildLines = this.childLines[index]!;
			const skipped =
				visible !== undefined &&
				this.childOwners[index] === child &&
				RenderedLineCache.outsideWindow(childStart, previousChildLines.length, visible);
			const rendered = skipped
				? { lines: previousChildLines, firstChanged: previousChildLines.length }
				: this.childRender(child, width, RenderedLineCache.localWindow(visible, childStart), previousChildLines);
			childStart += rendered.lines.length;
			const changed = rendered.lines !== previousChildLines;
			this.childOwners[index] = child;
			this.childLines[index] = rendered.lines;
			this.changed[index] = changed;
			if (changed) {
				if (firstChangedChild === -1) firstChangedChild = index;
				// The child's own offset says where inside its lines the difference starts; a plain
				// component reports 0, which means its whole line block is new.
				firstChanged = Math.min(
					firstChanged,
					this.childStarts[index]! + Math.min(rendered.firstChanged, rendered.lines.length),
				);
			}
		}
		if (firstChangedChild === -1) {
			return { lines: previousLines, firstChanged: previousLines.length, previousLines };
		}

		const lines = previousLines.slice();
		let write = this.childStarts[firstChangedChild]!;
		for (let index = firstChangedChild; index < count; index++) {
			const childLines = this.childLines[index]!;
			const oldStart = this.childStarts[index]!;
			this.childStarts[index] = write;
			if (write !== oldStart || this.changed[index]) {
				for (let offset = 0; offset < childLines.length; offset++) {
					lines[write + offset] = childLines[offset]!;
				}
			}
			write += childLines.length;
		}
		lines.length = write;
		this.lines = lines;
		return { lines, firstChanged: Math.min(firstChanged, write), previousLines };
	}
}
