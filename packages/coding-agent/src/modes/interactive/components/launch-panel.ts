/** The launch screen: app name and version, a welcome line, and model and directory rows. */

import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@hyzek/toucan-tui";
import { APP_NAME } from "../../../config.ts";
import { theme } from "../theme/theme.ts";

export interface LaunchPanelContent {
	version: string;
	welcome: () => string;
	model: () => string;
	directory: () => string;
	/** Extra help shown when expanded (ctrl+o). */
	expandedHelp?: () => string;
	/** Clicking the app name plays the logo easter egg; the arguments are the wordmark cell's screen position. */
	onNameClick?: (column: number, row: number) => void;
}

const LABEL_COLUMN = 12;

export class LaunchPanel implements Component {
	private readonly content: LaunchPanelContent;
	private expanded = false;
	private cached: { width: number; lines: string[] } | undefined;

	constructor(content: LaunchPanelContent) {
		this.content = content;
	}

	setExpanded(expanded: boolean): void {
		if (this.expanded === expanded) return;
		this.expanded = expanded;
		this.invalidate();
	}

	invalidate(): void {
		this.cached = undefined;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const onNameClick = this.content.onNameClick;
		if (!onNameClick || event.type !== "click" || event.y !== 0) return undefined;
		const nameStart = 1;
		const nameEnd = nameStart + APP_NAME.length;
		if (event.x < nameStart || event.x > nameEnd) return undefined;
		onNameClick(event.screenX - event.x + nameStart, event.screenY - event.y);
		return { handled: true };
	}

	render(width: number): string[] {
		const cached = this.cached;
		if (cached && cached.width === width) return cached.lines;

		const name = theme.fg("accent", APP_NAME);
		const version = theme.fg("dim", this.content.version);
		const label = (text: string) => theme.fg("muted", text.padEnd(LABEL_COLUMN));

		const lines = [
			` ${name} ${version}`,
			"",
			` ${theme.bold(this.content.welcome())}`,
			"",
			` ${label("model:")}${this.content.model()}`,
			` ${label("directory:")}${this.content.directory()}`,
		];
		if (this.expanded && this.content.expandedHelp) {
			lines.push(
				"",
				...this.content
					.expandedHelp()
					.split("\n")
					.map((line) => ` ${line}`),
			);
		}

		this.cached = { width, lines };
		return lines;
	}
}
