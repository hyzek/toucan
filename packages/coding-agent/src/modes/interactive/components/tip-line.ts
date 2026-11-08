/** A single startup tip shown directly above the input box for the whole session. */

import { type Component, visibleWidth } from "@hyzek/toucan-tui";
import { APP_NAME } from "../../../config.ts";
import { theme } from "../theme/theme.ts";

/** Startup tips, chosen at random for each launch. Keep these to slash commands and @file syntax: key names live in the keybinding config, not here. */
const TIPS = [
	"Tip: Use /new for a fresh context for fresh tasks.",
	"Tip: Reference files with @path, or drop them into the terminal.",
	"Tip: Start a line with ! to run bash, !! to run it without context.",
	"Tip: /model switches models and /settings opens configuration.",
	`Tip: ${APP_NAME} can explain its own features and look up its docs. Ask it how to use or extend ${APP_NAME}.`,
];

export function pickLaunchTip(): string {
	return TIPS[Math.floor(Math.random() * TIPS.length)]!;
}

export class TipLine implements Component {
	private readonly tip: string;

	constructor(tip: string) {
		this.tip = tip;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const text = theme.fg("dim", this.tip);
		const padding = " ".repeat(Math.max(1, width - visibleWidth(text) - 1));
		return [`${padding}${text}`];
	}
}

/**
 * The launch tip: visible only while the chat shows no conversation. The caller's predicate decides
 * what counts; interactive mode passes `hasChatTranscript`, so prompts, model replies, `!` bash
 * rows and built-in command output all hide it, while startup notices and the `/new` confirmation
 * do not. Typing does not hide it. It returns after `/new`, because the transcript is cleared.
 */
export class SessionTip implements Component {
	private readonly tip = new TipLine(pickLaunchTip());
	private readonly hasTranscript: () => boolean;

	constructor(hasTranscript: () => boolean) {
		this.hasTranscript = hasTranscript;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return this.hasTranscript() ? [] : this.tip.render(width);
	}
}
