/**
 * Presentation for the find tool.
 *
 * The call is `Find "pattern" in path`; the result is one line saying how many files matched, and
 * expanding lists them. A collapsed search reports its count instead of dumping every path.
 */

import { Container, Text } from "@hyzek/toucan-tui";
import { directoryIcon, fileIcon } from "../../../modes/interactive/components/file-icon.ts";
import { ToolBranchBlock } from "../../../modes/interactive/components/tool-branch.ts";
import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../../extensions/types.ts";
import type { FindToolDetails } from "../find.ts";
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

const NO_FILES = "No files found matching pattern";
/** Expanded lists stop here, as in the reference renderer. */
const EXPANDED_PREVIEW_FILES = 8;

function formatFindCall(
	args: { pattern: string; path?: string; limit?: number } | undefined,
	theme: Theme,
	cwd: string,
): string {
	const pattern = str(args?.pattern);
	const rawPath = str(args?.path);
	const path = rawPath !== null ? shortenPath(rawPath || ".", cwd) : null;
	const invalidArg = invalidArgText(theme);
	const shown = pattern === null ? invalidArg : theme.fg("accent", `"${summarizeText(pattern, 40)}"`);
	return `${theme.fg("toolTitle", theme.bold("Find"))} ${shown}${theme.fg("toolOutput", ` in ${path === null ? invalidArg : path}`)}`;
}

function truncationText(details: FindToolDetails | undefined): string | undefined {
	const warnings: string[] = [];
	if (details?.resultLimitReached) warnings.push(`${details.resultLimitReached} results limit`);
	if (details?.truncation?.truncated)
		warnings.push(`${formatSize(details.truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
	return warnings.length > 0 ? warnings.join(", ") : undefined;
}

function formatFindResult(
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: FindToolDetails;
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
		block.addChild(new Text(theme.fg("muted", "Finding\u2026"), 0, 0));
		return block;
	}

	let output = getTextOutput(result, showImages).trim();
	if (truncationText(result.details)) output = stripTrailingNotice(output);
	const files = output && output !== NO_FILES ? output.split("\n").filter((line) => line.trim() !== "") : [];
	if (files.length === 0) {
		block.addChild(new Text(theme.fg("muted", "no files found"), 0, 0));
		return block;
	}

	const truncated = truncationText(result.details);
	const hint = ` (${context.keyHint("app.tools.expand", options.expanded ? "to collapse" : "to expand")})`;
	block.addChild(
		new Text(
			`${theme.fg("muted", `${files.length} files`)}${truncated ? theme.fg("warning", " (truncated)") : ""}${theme.fg("muted", hint)}`,
			0,
			0,
		),
	);
	if (options.expanded) {
		const shown = files.slice(0, EXPANDED_PREVIEW_FILES);
		const lines = shown.map((line) => {
			const icon = line.endsWith("/") ? directoryIcon(theme) : fileIcon(line, theme);
			return `${icon}${theme.fg("dim", line)}`;
		});
		const remaining = files.length - shown.length;
		if (remaining > 0) lines.push(theme.fg("muted", `\u2026 ${remaining} more files`));
		block.addChild(new Text(lines.join("\n"), 0, 0));
	}
	return block;
}

export const findRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(toolRowCallLine(formatFindCall(args as any, theme, context.cwd), context, theme));
		return text;
	},
	renderResult(result, options, theme, context) {
		const component = (context.lastComponent as Container | undefined) ?? new Container();
		component.clear();
		component.addChild(formatFindResult(result as any, options, theme, context, context.showImages));
		return component;
	},
};
