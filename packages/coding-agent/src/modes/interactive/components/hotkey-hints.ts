/**
 * The hint row shown under the footer bar while the input box is empty.
 * Items are registered dynamically by id — `add("agents", ...)` — so features
 * contribute hints without this component knowing about them, and each item
 * carries an explicit display order so add/remove timing cannot shuffle the
 * row. Keys sit in bright white; what they do stays dark gray. The row hides
 * while the prompt has input, unless an item opts out with `showWithInput`;
 * hidden, it still takes one line, so the footer bar never moves.
 */

import { type Component, truncateToWidth, visibleWidth } from "@hyzek/toucan-tui";
import { theme } from "../theme/theme.ts";
import { INPUT_PROMPT } from "./custom-editor.ts";

/** Style one hint segment: the key bright white, its effect dark gray. */
export function footerHint(key: string, effect: string): string {
	return theme.fg("text", key) + theme.fg("dim", ` ${effect}`);
}

interface HotkeyHintItem {
	render: () => string;
	order: number;
	/** Renders while the prompt has input, unlike the rest of the row. */
	showWithInput: boolean;
}

export class HotkeyHints implements Component {
	private readonly hasInput: () => boolean;
	/** Map iteration keeps insertion order; `render` sorts by `order`, and the sort is stable. */
	private readonly items = new Map<string, HotkeyHintItem>();

	constructor(hasInput: () => boolean) {
		this.hasInput = hasInput;
	}

	/** Register a hint at a fixed display position; re-adding an id replaces its content in place. */
	add(id: string, render: () => string, order: number, options?: { showWithInput?: boolean }): void {
		this.items.set(id, { render, order, showWithInput: options?.showWithInput ?? false });
	}

	remove(id: string): void {
		this.items.delete(id);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const showAll = !this.hasInput();
		const segments = [...this.items.values()]
			.filter((item) => showAll || item.showWithInput)
			.sort((a, b) => a.order - b.order)
			.map((item) => item.render())
			.filter((segment) => segment.trim() !== "");
		if (segments.length === 0) return [""];
		const indent = " ".repeat(visibleWidth(INPUT_PROMPT));
		const text = indent + segments.join(theme.fg("dim", " · "));
		return [truncateToWidth(text, Math.max(1, width), theme.fg("dim", "..."))];
	}
}
