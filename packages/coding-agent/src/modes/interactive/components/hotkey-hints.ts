/** Hotkey hints shown under the footer bar while the input box is empty. */

import { type Component, truncateToWidth, visibleWidth } from "@hyzek/toucan-tui";
import { theme } from "../theme/theme.ts";
import { INPUT_PROMPT } from "./custom-editor.ts";

/** Hints for the keys that open agent selection and the shortcut list. Naming a key here binds nothing. */
const HINTS = "\u2190 for agents \u00b7 ? for shortcuts";

/**
 * The hotkey hints row: visible only while the editor holds no text, so the first typed
 * character clears it and a cleared editor brings it back. It does not depend on the session,
 * unlike the launch tip. Hidden, it still takes one line, so the footer bar never moves.
 */
export class HotkeyHints implements Component {
	private readonly hasInput: () => boolean;

	constructor(hasInput: () => boolean) {
		this.hasInput = hasInput;
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (this.hasInput()) return [""];
		const indent = " ".repeat(visibleWidth(INPUT_PROMPT));
		const text = theme.fg("dim", `${indent}${HINTS}`);
		return [truncateToWidth(text, Math.max(1, width), theme.fg("dim", "..."))];
	}
}
