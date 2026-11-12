/** A one-line tool call header with an optional right-aligned trailing value such as a duration. */

import { type Component, truncateToWidth, visibleWidth } from "@hyzek/toucan-tui";

/** At least this many spaces separate the summary from the trailing value. */
const MIN_GAP = 2;

export class ToolCallLine implements Component {
	private left: string;
	private right: string;

	constructor(left = "", right = "") {
		this.left = left;
		this.right = right;
	}

	setText(left: string, right = ""): void {
		this.left = left;
		this.right = right;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const line = this.renderLine(width);
		return [line + " ".repeat(Math.max(0, width - visibleWidth(line)))];
	}

	private renderLine(width: number): string {
		const left = firstLine(this.left);
		const right = firstLine(this.right);
		if (!right) return truncateToWidth(left, width);
		const rightWidth = visibleWidth(right);
		if (rightWidth >= width) return truncateToWidth(right, width);
		const leftText = truncateToWidth(left, Math.max(1, width - rightWidth - MIN_GAP));
		return `${leftText}${" ".repeat(Math.max(MIN_GAP, width - visibleWidth(leftText) - rightWidth))}${right}`;
	}
}

function firstLine(text: string): string {
	const newline = text.indexOf("\n");
	return newline === -1 ? text : text.slice(0, newline);
}
