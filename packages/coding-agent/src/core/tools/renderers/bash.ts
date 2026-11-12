/**
 * Presentation for the shell tools, ported from pi-claude-code-ui.
 *
 * The call is a compact `Bash <command headline>` row with the duration on the right. The command
 * itself appears under the row when expanded; otherwise the headline is enough. The result sits
 * under the same guide: `Done (N lines)` or `Exit N`, then the first lines; the tail streams while
 * the command runs. A shell command that edits one file becomes an `Edit (sed) path` row with the
 * same change block the edit tool uses.
 */

import { Container, Text } from "@hyzek/toucan-tui";
import { COLLAPSED_DIFF_ROWS, type DiffComponent } from "../../../modes/interactive/components/diff.ts";
import { ToolBranchBlock } from "../../../modes/interactive/components/tool-branch.ts";
import { ToolCallLine } from "../../../modes/interactive/components/tool-call-line.ts";
import { VisualLinePreview } from "../../../modes/interactive/components/visual-truncate.ts";
import { theme } from "../../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../../extensions/types.ts";
import type { BashToolDetails } from "../bash.ts";
import { detectShellFileEdit } from "../bash-edit.ts";
import {
	getTextOutput,
	invalidArgText,
	renderToolPath,
	SHELL_EMPTY_OUTPUT,
	startToolTimer,
	str,
	toolDurationText,
	toolRowCallLine,
} from "../render-utils.ts";
import { buildBashCommandPresentation } from "./bash-command.ts";
import { createChangeBlock } from "./change-block.ts";

/** Collapsed result rows; the expanded row shows all of them. */
const BASH_PREVIEW_LINES = 10;
/** While output streams, show the newest rows so progress stays visible. */
const BASH_LIVE_PREVIEW_LINES = 5;
export const BASH_UPDATE_THROTTLE_MS = 100;

/** The result component, kept between renders so the diff keeps its syntax cache. */
type BashResultComponent = Container & { diffView?: DiffComponent };

function formatShellCall(args: { command?: string; timeout?: number } | undefined, label: string, cwd: string): string {
	const command = str(args?.command);
	const timeout = args?.timeout as number | undefined;
	const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
	const edit = command ? detectShellFileEdit(command) : undefined;
	if (edit) {
		return (
			theme.fg("toolTitle", theme.bold(`Edit (${edit.tool})`)) +
			` ${renderToolPath(edit.path, theme, cwd)}` +
			timeoutSuffix
		);
	}
	const commandDisplay =
		command === null
			? invalidArgText(theme)
			: command
				? theme.fg("accent", buildBashCommandPresentation(command).headline)
				: theme.fg("toolOutput", "...");
	return `${theme.fg("toolTitle", theme.bold(label))} ${commandDisplay}${timeoutSuffix}`;
}

/** The command source under an expanded row; the guide continues into the result below. */
function renderCommandBlock(command: string): ToolBranchBlock | undefined {
	const presentation = buildBashCommandPresentation(command);
	if (presentation.sourceLines.length === 0) return undefined;
	const block = new ToolBranchBlock({ openEnded: true });
	block.addChild(new Text(presentation.sourceLines.map((line) => theme.fg("accent", line || " ")).join("\n"), 0, 0));
	return block;
}

/** `Exit 7` when the shell said so, `Failed` for any other error. The status line is not output. */
function takeExitStatus(output: string, isError: boolean): { output: string; status: string | undefined } {
	if (!isError) return { output, status: undefined };
	const match = output.match(/(?:^|\n)Command exited with code (\d+)\s*$/);
	if (!match) return { output, status: "Failed" };
	return { output: output.slice(0, match.index).trimEnd(), status: `Exit ${match[1]}` };
}

function statusLine(
	result: { details?: BashToolDetails },
	options: ToolRenderResultOptions,
	context: { isError: boolean; keyHint: (key: "app.tools.expand", description: string) => string },
	lineCount: number,
	failure: string | undefined,
): string {
	const expandHint = context.keyHint("app.tools.expand", options.expanded ? "to collapse" : "to expand");
	const hint = theme.fg("muted", ` (${expandHint})`);
	if (options.isPartial)
		return `${theme.fg("muted", `Running\u2026 (${lineCount} line${lineCount === 1 ? "" : "s"})`)}${hint}`;
	if (context.isError) {
		const status = theme.fg("error", failure ?? "Failed");
		return `${status}${hint}`;
	}
	const truncated = result.details?.truncation?.truncated ? theme.fg("warning", " [truncated]") : "";
	const fullOutput = result.details?.fullOutputPath
		? theme.fg("muted", ` \u00b7 full output: ${result.details.fullOutputPath}`)
		: "";
	return `${theme.fg("muted", `Done (${lineCount} line${lineCount === 1 ? "" : "s"})`)}${truncated}${fullOutput}${hint}`;
}

function rebuildBashResultRenderComponent(
	component: BashResultComponent,
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: BashToolDetails;
	},
	options: ToolRenderResultOptions,
	command: string | null,
	showImages: boolean,
	context: { isError: boolean; keyHint: (key: "app.tools.expand", description: string) => string },
	expandHint: string,
): void {
	component.clear();

	let output = getTextOutput(result, showImages).trim();
	const fileEdit = result.details?.fileEdit;
	// A command that edited a file prints nothing to say so; the diff below is its result.
	if (fileEdit && output === SHELL_EMPTY_OUTPUT) {
		output = "";
	}
	const exit = takeExitStatus(output, context.isError);
	output = exit.output;
	// The row is labelled an edit because the command can only write one file. If that file came out
	// unchanged there is no diff, and `(no output)` would read as a result that went missing.
	const noChange =
		!fileEdit &&
		!options.isPartial &&
		!context.isError &&
		output === SHELL_EMPTY_OUTPUT &&
		command !== null &&
		detectShellFileEdit(command) !== undefined;
	if (noChange || output === SHELL_EMPTY_OUTPUT) {
		output = "";
	}
	const truncation = result.details?.truncation;
	const fullOutputPath = result.details?.fullOutputPath;
	if (!options.isPartial && truncation?.truncated && fullOutputPath && output.endsWith("]")) {
		const footerStart = output.lastIndexOf("\n\n[");
		if (footerStart !== -1 && output.slice(footerStart).includes(fullOutputPath)) {
			output = output.slice(0, footerStart).trimEnd();
		}
	}

	const outputLines = output ? output.split("\n") : [];
	if (output) {
		const styledOutput = outputLines.map((line) => theme.fg("toolOutput", line)).join("\n");
		const block = new ToolBranchBlock();
		block.addChild(new Text(statusLine(result, options, context, outputLines.length, exit.status), 0, 0));
		if (options.expanded) {
			block.addChild(new Text(styledOutput, 0, 0));
		} else {
			block.addChild(
				new VisualLinePreview({
					text: styledOutput,
					maxVisualLines: options.isPartial ? BASH_LIVE_PREVIEW_LINES : BASH_PREVIEW_LINES,
					keep: options.isPartial ? "end" : "start",
					formatHint: (hidden) =>
						theme.fg("muted", options.isPartial ? `... (${hidden} earlier lines)` : `... (${hidden} more lines)`),
				}),
			);
		}
		component.addChild(block);
	} else if (!fileEdit) {
		const block = new ToolBranchBlock();
		block.addChild(
			new Text(
				noChange ? theme.fg("muted", "no change") : statusLine(result, options, context, 0, exit.status),
				0,
				0,
			),
		);
		component.addChild(block);
	}

	if (fileEdit) {
		component.addChild(
			createChangeBlock(
				component,
				{
					diff: fileEdit.diff,
					path: fileEdit.path,
					edits: 1,
					view: { expanded: options.expanded, maxRows: COLLAPSED_DIFF_ROWS, expandHint },
				},
				theme,
			),
		);
	}
}

/** Shell renderers are shared by bash and powershell, which differ only in the label they display. */
export function createShellRenderers(label: string): Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> {
	return {
		renderCall(args, _theme, context) {
			startToolTimer(context);
			const command = str((args as { command?: string } | undefined)?.command);
			const duration = toolDurationText(context, context.isPartial);
			const header = formatShellCall(args as { command?: string; timeout?: number } | undefined, label, context.cwd);
			const component = new Container();
			component.addChild(
				new ToolCallLine(
					toolRowCallLine(header, context, theme),
					duration ? theme.fg("muted", `\u00b7 ${duration}`) : "",
				),
			);
			if (context.expanded && command) {
				const commandBlock = renderCommandBlock(command);
				if (commandBlock) component.addChild(commandBlock);
			}
			return component;
		},
		renderResult(result, options, _theme, context) {
			startToolTimer(context);
			const component = (context.lastComponent as BashResultComponent | undefined) ?? new Container();
			rebuildBashResultRenderComponent(
				component,
				result,
				options,
				str((context.args as { command?: string } | undefined)?.command),
				context.showImages,
				{ isError: context.isError, keyHint: context.keyHint },
				`(${context.keyHint("app.tools.expand", "to expand")})`,
			);
			component.invalidate();
			return component;
		},
	};
}
