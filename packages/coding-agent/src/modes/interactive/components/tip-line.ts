/** The line above the input: the startup tip, or a jump-to-latest link while the fullscreen transcript is scrolled up. */

import {
	type Component,
	type ScrollView,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	visibleWidth,
} from "@hyzek/toucan-tui";
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

/** Shown in the tip slot while the fullscreen transcript is scrolled away from its end. Clicking it resumes following. */
const JUMP_LABEL = "Jump to latest ↓";

export function pickLaunchTip(): string {
	return TIPS[Math.floor(Math.random() * TIPS.length)]!;
}

/** Right-aligns one styled line, leaving one blank column at the right edge. */
function rightAligned(text: string, width: number): string {
	const padding = " ".repeat(Math.max(1, width - visibleWidth(text) - 1));
	return `${padding}${text}`;
}

export class TipLine implements Component {
	private readonly tip: string;

	constructor(tip: string) {
		this.tip = tip;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return [rightAligned(theme.fg("dim", this.tip), width)];
	}
}

/**
 * The slot above the input. The launch tip is visible only while the chat shows no conversation:
 * the caller's predicate decides what counts; interactive mode passes `hasChatTranscript`, so
 * prompts, model replies, `!` bash rows and built-in command output all hide it, while startup
 * notices and the `/new` confirmation do not. Typing does not hide it. It returns after `/new`,
 * because the transcript is cleared. Once a transcript exists, the slot instead shows a
 * right-aligned jump-to-latest line while the fullscreen transcript is scrolled away from its
 * end; clicking that line resumes end-following.
 */
export class SessionTip implements Component {
	private readonly tip = new TipLine(pickLaunchTip());
	private readonly hasTranscript: () => boolean;
	private readonly getTranscript: () => ScrollView | undefined;

	constructor(hasTranscript: () => boolean, getTranscript: () => ScrollView | undefined = () => undefined) {
		this.hasTranscript = hasTranscript;
		this.getTranscript = getTranscript;
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (!this.hasTranscript()) return this.tip.render(width);
		return this.jumpVisible() ? [rightAligned(theme.fg("dim", JUMP_LABEL), width)] : [];
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const transcript = this.getTranscript();
		if (!transcript || event.type !== "click" || !this.jumpVisible()) return undefined;
		// Only the label itself jumps; the padding beside it belongs to the rest of the row.
		const labelStart = Math.max(0, event.width - visibleWidth(JUMP_LABEL) - 1);
		if (event.y !== 0 || event.x < labelStart || event.x > event.width - 2) return undefined;
		transcript.scrollToEnd();
		return { handled: true };
	}

	private jumpVisible(): boolean {
		return this.getTranscript()?.isFollowingEnd === false;
	}
}
