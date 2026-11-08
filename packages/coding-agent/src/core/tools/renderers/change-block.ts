/**
 * The block a change prints under its tool row.
 *
 * One line says what the change did (`2 edits +5 -4`, or `+1 -0 at line 8` when a single change has a
 * known position), then the diff itself, then a line counting its parts when it has more than one
 * (`2 edits +5 -4 · 2 hunks (11 diff lines)`). A guide on the left joins the block to the call it belongs
 * to, and each hunk of the diff is named (`Edit 1/2 at line 6`). The edit tool and a shell command that
 * rewrote a file both use it, so the two read the same way.
 */

import { Spacer, Text } from "@hyzek/toucan-tui";
import { DiffComponent, type DiffViewOptions } from "../../../modes/interactive/components/diff.ts";
import { ToolBranchBlock } from "../../../modes/interactive/components/tool-branch.ts";
import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import { diffStats, parseDisplayDiff } from "../diff-lines.ts";
import { diffCountsText, diffHunkText, diffLineText } from "../render-utils.ts";

/** Keeps the view between rebuilds so a diff keeps the syntax colours it already worked out. */
export interface ChangeBlockState {
	diffView?: DiffComponent;
}

export interface ChangeBlock {
	/** The change, in the display form `generateDiffString` writes. */
	diff: string;
	/** The file the change applies to; picks the language for syntax colouring. */
	path?: string;
	/** How many separate edits the tool made, when it knows. More than one names the hunks after them. */
	edits?: number;
	/** Folding, and the key that expands the diff. */
	view: Omit<DiffViewOptions, "filePath" | "hunkLabel">;
}

/**
 * Builds the block for a change: summary line, diff with its hunks named, count line when there is more
 * than one hunk.
 */
export function createChangeBlock(state: ChangeBlockState, change: ChangeBlock, theme: Theme): ToolBranchBlock {
	const stats = diffStats(parseDisplayDiff(change.diff));
	const counts = diffCountsText(stats.added, stats.removed, theme);
	const edits = change.edits ?? 0;
	const plural = edits > 1 ? `${edits} edits ` : "";
	const parts = stats.hunks.length > 1;
	const summary =
		parts || edits > 1 ? `${plural}${counts}` : `${counts}${diffLineText(stats.hunks[0]?.line ?? 0, theme)}`;

	const options: DiffViewOptions = {
		...change.view,
		filePath: change.path,
		// A combined diff's hunks are not the edits that made them: one edit can touch two places, so the
		// rows are named after operations only when there is more than one.
		hunkLabel: parts
			? (hunk, index, total) => `${edits > 1 ? "Edit" : "Hunk"} ${index + 1}/${total} at line ${hunk.line}`
			: undefined,
	};

	const block = new ToolBranchBlock();
	block.addChild(new Text(summary, 0, 0));
	block.addChild(new Spacer(1));
	block.addChild(diffView(state, change.diff, options));
	if (parts) {
		block.addChild(new Spacer(1));
		block.addChild(new Text(`${plural}${counts}${diffHunkText(stats, theme)}`, 0, 0));
	}
	return block;
}

function diffView(state: ChangeBlockState, diff: string, options: DiffViewOptions): DiffComponent {
	if (state.diffView) {
		state.diffView.setDiff(diff);
	} else {
		state.diffView = new DiffComponent(diff, options);
	}
	state.diffView.setOptions(options);
	return state.diffView;
}
