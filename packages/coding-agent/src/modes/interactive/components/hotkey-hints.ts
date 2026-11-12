/**
 * The hint row shown under the footer bar while the input box is empty.
 * Items are registered dynamically by id — `add("agents", ...)` — so features
 * contribute hints without this component knowing about them. Keys sit in
 * bright white; what they do stays dark gray. Hidden, it still takes one
 * line, so the footer bar never moves.
 */

import { type Component, truncateToWidth, visibleWidth } from "@hyzek/toucan-tui";
import { theme } from "../theme/theme.ts";
import { INPUT_PROMPT } from "./custom-editor.ts";

/** Style one hint segment: the key bright white, its effect dark gray. */
export function footerHint(key: string, effect: string): string {
	return theme.fg("text", key) + theme.fg("dim", ` ${effect}`);
}

export class HotkeyHints implements Component {
	private readonly hasInput: () => boolean;
	/** Insertion order is display order, except for hints registered with `addFront`. */
	private readonly items = new Map<string, () => string>();

	constructor(hasInput: () => boolean) {
		this.hasInput = hasInput;
	}

	/** Register a hint; re-adding an id replaces its content in place. */
	add(id: string, render: () => string): void {
		this.items.set(id, render);
	}

	/** Register a hint in front of the others; re-adding an id moves it to the front. */
	addFront(id: string, render: () => string): void {
		const entries = [...this.items.entries()];
		this.items.clear();
		this.items.set(id, render);
		for (const [entryId, entryRender] of entries) {
			if (entryId !== id) this.items.set(entryId, entryRender);
		}
	}

	remove(id: string): void {
		this.items.delete(id);
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (this.hasInput()) return [""];
		const segments = [...this.items.values()].map((render) => render()).filter((segment) => segment.trim() !== "");
		if (segments.length === 0) return [""];
		const indent = " ".repeat(visibleWidth(INPUT_PROMPT));
		const text = indent + segments.join(theme.fg("dim", " \u00b7 "));
		return [truncateToWidth(text, Math.max(1, width), theme.fg("dim", "..."))];
	}
}
