/** Hotkey hints shown under the footer bar while the input box is empty. */

import { type Component, truncateToWidth, visibleWidth } from "@hyzek/toucan-tui";
import { theme } from "../theme/theme.ts";
import { INPUT_PROMPT } from "./custom-editor.ts";

/**
 * The hotkey hints row: visible only while the editor holds no text, so the first typed
 * character clears it and a cleared editor brings it back. It does not depend on the session,
 * unlike the launch tip. Hidden, it still takes one line, so the footer bar never moves.
 * Keys sit in bright white; what they do stays dark gray.
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
		const key = (text: string) => theme.fg("text", text);
		const effect = (text: string) => theme.fg("dim", text);
		const text =
			indent + key("\u2190") + effect(" for agents") + effect(" \u00b7 ") + key("?") + effect(" for shortcuts");
		return [truncateToWidth(text, Math.max(1, width), theme.fg("dim", "..."))];
	}
}
