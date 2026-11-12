/**
 * Presentation for the read tool.
 *
 * Renderers live apart from the implementation so a process that only displays tool output does not
 * load the execution path or its typebox parameter schema. `read.ts` spreads these into its
 * definition, so the tool's public shape is unchanged.
 *
 * Under the row, a guide holds a block that says what was loaded (`185 lines loaded`, muted): expanded,
 * the file's content follows under the same guide, syntax-coloured from its language; collapsed, the
 * block is that one line plus the key that expands it. A failed read shows the error line instead.
 */

import { basename, dirname, isAbsolute, relative, resolve as resolvePath, sep } from "node:path";
import type { ImageContent, TextContent } from "@hyzek/toucan-ai";
import { Container, Text } from "@hyzek/toucan-tui";
import { getReadmePath } from "../../../config.ts";
import { keyText } from "../../../modes/interactive/components/keybinding-hints.ts";
import { ToolBranchBlock } from "../../../modes/interactive/components/tool-branch.ts";
import { getLanguageFromPath, highlightCode, type Theme } from "../../../modes/interactive/theme/theme.ts";
import { formatPathRelativeToCwdOrAbsolute } from "../../../utils/paths.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../../extensions/types.ts";
import { resolveToCwd } from "../path-utils.ts";
import type { ReadToolDetails } from "../read.ts";
import {
	formatReadLineRange,
	getTextOutput,
	renderToolPath,
	replaceTabs,
	str,
	toolRowCallLine,
} from "../render-utils.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "../truncate.ts";

interface CompactReadClassification {
	kind: "docs" | "resource" | "skill";
	label: string;
}
const COMPACT_RESOURCE_FILE_NAMES = new Set(["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]);
type ReadRenderArgs = { path?: string; file_path?: string; offset?: unknown; limit?: unknown };
/** The compact rows (skills, docs, resources) keep the short line range. */
function styledReadLineRange(args: ReadRenderArgs | undefined, theme: Theme): string {
	const range = formatReadLineRange(args?.offset, args?.limit);
	return range ? theme.fg("warning", range) : "";
}
/** The read range as the reference row writes it: `(offset=10, limit=20)`. */
function readArgsText(args: ReadRenderArgs | undefined, theme: Theme): string {
	const parts: string[] = [];
	if (args?.offset != null) parts.push(`offset=${String(args.offset)}`);
	if (args?.limit != null) parts.push(`limit=${String(args.limit)}`);
	return parts.length > 0 ? ` ${theme.fg("muted", `(${parts.join(", ")})`)}` : "";
}
function formatReadCall(args: ReadRenderArgs | undefined, theme: Theme, cwd: string): string {
	const pathDisplay = renderToolPath(str(args?.file_path ?? args?.path), theme, cwd);
	return `${theme.fg("toolTitle", theme.bold("Read"))} ${pathDisplay}${readArgsText(args, theme)}`;
}
function trimTrailingEmptyLines(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && lines[end - 1] === "") {
		end--;
	}
	return lines.slice(0, end);
}
function toPosixPath(filePath: string): string {
	return filePath.split(sep).join("/");
}
function getToucanDocsClassification(absolutePath: string): CompactReadClassification | undefined {
	const packageRoot = dirname(getReadmePath());
	const relativePath = relative(resolvePath(packageRoot), resolvePath(absolutePath));
	if (
		relativePath === "" ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		return undefined;
	}

	const label = toPosixPath(relativePath);
	if (label === "README.md" || label.startsWith("docs/") || label.startsWith("examples/")) {
		return { kind: "docs", label };
	}
	return undefined;
}
function getCompactReadClassification(
	args: ReadRenderArgs | undefined,
	cwd: string,
): CompactReadClassification | undefined {
	const rawPath = str(args?.file_path ?? args?.path);
	if (!rawPath) return undefined;

	const absolutePath = resolveToCwd(rawPath, cwd);
	const fileName = basename(absolutePath);
	if (fileName === "SKILL.md") {
		return { kind: "skill", label: basename(dirname(absolutePath)) || fileName };
	}

	const docsClassification = getToucanDocsClassification(absolutePath);
	if (docsClassification) return docsClassification;

	if (COMPACT_RESOURCE_FILE_NAMES.has(fileName)) {
		return { kind: "resource", label: formatPathRelativeToCwdOrAbsolute(absolutePath, cwd) };
	}

	return undefined;
}
function formatCompactReadCall(
	classification: CompactReadClassification,
	args: ReadRenderArgs | undefined,
	theme: Theme,
): string {
	if (classification.kind === "skill") {
		return (
			theme.fg("customMessageLabel", `\x1b[1m[skill]\x1b[22m `) + theme.fg("customMessageText", classification.label)
		);
	}

	return (
		theme.fg("toolTitle", theme.bold(`Read ${classification.kind}`)) +
		" " +
		theme.fg("accent", classification.label) +
		styledReadLineRange(args, theme) +
		theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`)
	);
}
function formatReadResult(
	args: ReadRenderArgs | undefined,
	result: { content: (TextContent | ImageContent)[]; details?: ReadToolDetails },
	options: ToolRenderResultOptions,
	theme: Theme,
	showImages: boolean,
	_cwd: string,
	isError: boolean,
	expandHint: string,
): string {
	if (isError) {
		const message = getTextOutput(result, showImages).trim().split("\n");
		return theme.fg("error", options.expanded ? message.join("\n") : (message[0] ?? "Error"));
	}

	const rawPath = str(args?.file_path ?? args?.path);
	const output = getTextOutput(result, showImages);
	const lines = trimTrailingEmptyLines(output.split("\n"));
	const truncation = result.details?.truncation;
	let text = theme.fg("muted", `${lines.length} lines loaded`);
	if (truncation?.truncated) {
		text += ` ${theme.fg("warning", "(truncated)")}`;
	}
	if (!options.expanded) {
		return `${text} ${theme.fg("muted", `(${expandHint})`)}`;
	}

	const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
	const renderedLines = lang
		? trimTrailingEmptyLines(highlightCode(replaceTabs(output), lang))
		: lines.map((line) => theme.fg("toolOutput", replaceTabs(line)));
	text += `\n${renderedLines.join("\n")}`;

	if (truncation?.truncated) {
		if (truncation.firstLineExceedsLimit) {
			text += `\n${theme.fg("warning", `[First line exceeds ${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`)}`;
		} else if (truncation.truncatedBy === "lines") {
			text += `\n${theme.fg("warning", `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.maxLines ?? DEFAULT_MAX_LINES} line limit)]`)}`;
		} else {
			text += `\n${theme.fg("warning", `[Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`)}`;
		}
	}
	return text;
}

export const readRenderers: Pick<ToolDefinition<any, ReadToolDetails | undefined>, "renderCall" | "renderResult"> = {
	renderCall(rawArgs, theme, context) {
		const args = rawArgs as ReadRenderArgs | undefined;
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		const classification = !context.expanded ? getCompactReadClassification(args, context.cwd) : undefined;
		const header = classification
			? formatCompactReadCall(classification, args, theme)
			: formatReadCall(args, theme, context.cwd);
		text.setText(toolRowCallLine(header, context, theme));
		return text;
	},
	renderResult(result, options, theme, context) {
		const container = (context.lastComponent as Container | undefined) ?? new Container();
		container.clear();
		const block = new ToolBranchBlock();
		block.addChild(
			new Text(
				formatReadResult(
					context.args as ReadRenderArgs | undefined,
					result,
					options,
					theme,
					context.showImages,
					context.cwd,
					context.isError,
					context.keyHint("app.tools.expand", "to expand"),
				),
				0,
				0,
			),
		);
		container.addChild(block);
		return container;
	},
};
