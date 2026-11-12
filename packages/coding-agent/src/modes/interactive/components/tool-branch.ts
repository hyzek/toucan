/**
 * The guide that hangs a tool row's output block under its label.
 *
 * The rows a tool prints below its call line belong to that call, so they join it with a rule: the first
 * row starts the rule with `├`, the rows between continue it with `│`, and the last closes it with `└`.
 * The glyph sits two columns right of the row's marker, under the first letter of the label, so the block
 * reads as part of the call rather than as a paragraph after it. Blank rows between parts of the block
 * carry no glyph: the rule is meant to stop where the text does.
 */

import { type Component, truncateToWidth } from "@hyzek/toucan-tui";
import { stripAnsi } from "../../../utils/ansi.ts";
import { theme } from "../theme/theme.ts";

/** Blank columns between the row's content and the guide glyph. */
const INDENT = 2;
const OPEN = "\u251c";
const RUN = "\u2502";
const CLOSE = "\u2514";

export interface ToolBranchBlockOptions {
	/**
	 * Leave the guide open at the bottom: the last row keeps `│` instead of closing with `└`. A call
	 * that shows its command under the header uses this so the result below can continue the guide.
	 */
	openEnded?: boolean;
}

export class ToolBranchBlock implements Component {
	private children: Component[] = [];
	private readonly openEnded: boolean;

	constructor(options: ToolBranchBlockOptions = {}) {
		this.openEnded = options.openEnded === true;
	}

	addChild(child: Component): void {
		this.children.push(child);
	}

	clear(): void {
		this.children.length = 0;
	}

	invalidate(): void {
		for (const child of this.children) child.invalidate();
	}

	render(width: number): string[] {
		const inner = Math.max(0, width - (INDENT + 2));
		const rows = this.children.flatMap((child) => child.render(inner));
		const filled = rows.map((row) => stripAnsi(row).trim() !== "");
		const first = filled.indexOf(true);
		const last = filled.lastIndexOf(true);
		return rows.map((row, index) => {
			if (!filled[index] || index < first || index > last) return truncateToWidth(row, width);
			const glyph = index === last && !this.openEnded ? CLOSE : index === first ? OPEN : RUN;
			return `${" ".repeat(INDENT)}${theme.fg("borderMuted", glyph)} ${truncateToWidth(row, inner)}`;
		});
	}
}
