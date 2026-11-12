/**
 * Presentation for the grep tool.
 *
 * The call is `Grep "pattern" in path`; the result is one line saying how many matches were found,
 * and expanding shows them. This mirrors the reference CC-UI row: a collapsed search reports its
 * count instead of dumping a page of matches into the transcript.
 */

import { Container, Text } from "@hyzek/toucan-tui";
import { ToolBranchBlock } from "../../../modes/interactive/components/tool-branch.ts";
import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../../extensions/types.ts";
import type { GrepToolDetails } from "../grep.ts";
import {
	getTextOutput,
	invalidArgText,
	shortenPath,
	str,
	stripTrailingNotice,
	summarizeText,
	toolRowCallLine,
} from "../render-utils.ts";
import { DEFAULT_MAX_BYTES, formatSize } from "../truncate.ts";

/** Expanded lists stop here, as in the reference renderer. */
const EXPANDED_PREVIEW_MATCHES = 8;

function formatGrepCall(
	args: { pattern: string; path?: string; glob?: string; limit?: number } | undefined,
	theme: Theme,
	cwd: string,
): string {
	const pattern = str(args?.pattern);
	const rawPath = str(args?.path);
	const path = rawPath !== null ? shortenPath(rawPath || ".", cwd) : null;
	const invalidArg = invalidArgText(theme);
	const shown = pattern === null ? invalidArg : theme.fg("accent", `"${summarizeText(pattern, 40)}"`);
	return `${theme.fg("toolTitle", theme.bold("Grep"))} ${shown}${theme.fg("toolOutput", ` in ${path === null ? invalidArg : path}`)}`;
}

function truncationText(details: GrepToolDetails | undefined): string | undefined {
	const warnings: string[] = [];
	if (details?.matchLimitReached) warnings.push(`${details.matchLimitReached} matches limit`);
	if (details?.truncation?.truncated)
		warnings.push(`${formatSize(details.truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
	if (details?.linesTruncated) warnings.push("some lines truncated");
	return warnings.length > 0 ? warnings.join(", ") : undefined;
}

function formatGrepResult(
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: GrepToolDetails;
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
		block.addChild(new Text(theme.fg("muted", "Searching\u2026"), 0, 0));
		return block;
	}

	let output = getTextOutput(result, showImages).trim();
	if (truncationText(result.details)) output = stripTrailingNotice(output);
	const matches =
		output && output !== "No matches found" ? output.split("\n").filter((line) => line.trim() !== "") : [];
	if (matches.length === 0) {
		block.addChild(new Text(theme.fg("muted", "no matches"), 0, 0));
		return block;
	}

	const truncated = truncationText(result.details);
	const hint = ` (${context.keyHint("app.tools.expand", options.expanded ? "to collapse" : "to expand")})`;
	block.addChild(
		new Text(
			`${theme.fg("muted", `${matches.length} matches`)}${truncated ? theme.fg("warning", " (truncated)") : ""}${theme.fg("muted", hint)}`,
			0,
			0,
		),
	);
	if (options.expanded) {
		const shown = matches.slice(0, EXPANDED_PREVIEW_MATCHES);
		const lines = shown.map((line) => theme.fg("dim", line));
		const remaining = matches.length - shown.length;
		if (remaining > 0) lines.push(theme.fg("muted", `\u2026 ${remaining} more matches`));
		block.addChild(new Text(lines.join("\n"), 0, 0));
	}
	return block;
}

export const grepRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(toolRowCallLine(formatGrepCall(args as any, theme, context.cwd), context, theme));
		return text;
	},
	renderResult(result, options, theme, context) {
		const component = (context.lastComponent as Container | undefined) ?? new Container();
		component.clear();
		component.addChild(formatGrepResult(result as any, options, theme, context, context.showImages));
		return component;
	},
};
