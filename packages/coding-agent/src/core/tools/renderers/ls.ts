/**
 * Presentation for the ls tool.
 *
 * The call is `Ls path`; the result is one line saying how many entries the directory holds, and
 * expanding lists them. A collapsed listing reports its count instead of dumping every entry.
 */

import { Container, Text } from "@hyzek/toucan-tui";
import { directoryIcon, fileIcon } from "../../../modes/interactive/components/file-icon.ts";
import { ToolBranchBlock } from "../../../modes/interactive/components/tool-branch.ts";
import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../../extensions/types.ts";
import type { LsToolDetails } from "../ls.ts";
import { getTextOutput, renderToolPath, str, stripTrailingNotice, toolRowCallLine } from "../render-utils.ts";
import { DEFAULT_MAX_BYTES, formatSize } from "../truncate.ts";

/** Expanded lists stop here, as in the reference renderer. */
const EXPANDED_PREVIEW_ENTRIES = 8;

function formatLsCall(args: { path?: string; limit?: number } | undefined, theme: Theme, cwd: string): string {
	const limit = args?.limit;
	const pathDisplay = renderToolPath(str(args?.path), theme, cwd, { emptyFallback: "." });
	let text = `${theme.fg("toolTitle", theme.bold("Ls"))} ${pathDisplay}`;
	if (limit !== undefined) text += theme.fg("toolOutput", ` (limit ${limit})`);
	return text;
}

function truncationText(details: LsToolDetails | undefined): string | undefined {
	const warnings: string[] = [];
	if (details?.entryLimitReached) warnings.push(`${details.entryLimitReached} entries limit`);
	if (details?.truncation?.truncated)
		warnings.push(`${formatSize(details.truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
	return warnings.length > 0 ? warnings.join(", ") : undefined;
}

function formatLsResult(
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: LsToolDetails;
	},
	options: ToolRenderResultOptions,
	theme: Theme,
	context: { isError: boolean; keyHint: (key: "app.tools.expand", description: string) => string },
	showImages: boolean,
): ToolBranchBlock {
	const block = new ToolBranchBlock();
	if (context.isError) {
		const message = getTextOutput(result, showImages).trim();
		block.addChild(new Text(theme.fg("error", message || "Failed"), 0, 0));
		return block;
	}
	if (options.isPartial) {
		block.addChild(new Text(theme.fg("muted", "Listing\u2026"), 0, 0));
		return block;
	}

	let output = getTextOutput(result, showImages).trim();
	if (truncationText(result.details)) output = stripTrailingNotice(output);
	const entries =
		output && output !== "(empty directory)" ? output.split("\n").filter((line) => line.trim() !== "") : [];
	if (entries.length === 0) {
		block.addChild(new Text(theme.fg("muted", "empty directory"), 0, 0));
		return block;
	}

	const truncated = truncationText(result.details);
	const hint = ` (${context.keyHint("app.tools.expand", options.expanded ? "to collapse" : "to expand")})`;
	block.addChild(
		new Text(
			`${theme.fg("muted", `${entries.length} entries`)}${truncated ? theme.fg("warning", " (truncated)") : ""}${theme.fg("muted", hint)}`,
			0,
			0,
		),
	);
	if (options.expanded) {
		const shown = entries.slice(0, EXPANDED_PREVIEW_ENTRIES);
		const lines = shown.map((entry) =>
			entry.endsWith("/")
				? `${directoryIcon(theme)}${theme.fg("accent", theme.bold(entry))}`
				: `${fileIcon(entry, theme)}${theme.fg("dim", entry)}`,
		);
		const remaining = entries.length - shown.length;
		if (remaining > 0) lines.push(theme.fg("muted", `\u2026 ${remaining} more entries`));
		block.addChild(new Text(lines.join("\n"), 0, 0));
	}
	return block;
}

export const lsRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(toolRowCallLine(formatLsCall(args as any, theme, context.cwd), context, theme));
		return text;
	},
	renderResult(result, options, theme, context) {
		const component = (context.lastComponent as Container | undefined) ?? new Container();
		component.clear();
		component.addChild(formatLsResult(result as any, options, theme, context, context.showImages));
		return component;
	},
};
