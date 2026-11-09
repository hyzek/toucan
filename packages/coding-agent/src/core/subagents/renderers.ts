/**
 * Presentation for the subagent tool: a call line naming the action and agent,
 * and a result that renders the tool's status and answer text.
 */

import { Text } from "@hyzek/toucan-tui";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import { getTextOutput, str, toolRowCallLine } from "../tools/render-utils.ts";
import type { SubagentToolDetails } from "./subagent-tool.ts";

const COLLAPSED_RESULT_LINES = 10;

function formatSubagentCall(
	args: { action?: string; agent?: string; agent_id?: string; description?: string } | undefined,
	theme: Theme,
): string {
	const action = str(args?.action) ?? "spawn";
	let text = `${theme.fg("toolTitle", theme.bold("Subagent"))} ${theme.fg("toolTitle", action)}`;
	const subject = str(args?.agent) || str(args?.agent_id) || "";
	if (subject) text += theme.fg("toolOutput", ` ${subject}`);
	const summary = str(args?.description) ?? "";
	if (summary) text += theme.fg("toolOutput", ` · ${summary}`);
	return text;
}

function formatSubagentResult(
	result: { content: Array<{ type: string; text?: string }>; details?: SubagentToolDetails },
	options: ToolRenderResultOptions,
	theme: Theme,
	showImages: boolean,
): string {
	const output = getTextOutput(result, showImages).trim();
	if (!output) return "";
	const lines = output.split("\n");
	const maxLines = options.expanded ? lines.length : COLLAPSED_RESULT_LINES;
	const displayLines = lines.slice(0, maxLines);
	const remaining = lines.length - maxLines;
	let text = `\n${displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
	if (remaining > 0) {
		text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
	}
	return text;
}

export const subagentRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(toolRowCallLine(formatSubagentCall(args as any, theme), context, theme));
		return text;
	},
	renderResult(result, options, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatSubagentResult(result as any, options, theme, context.showImages));
		return text;
	},
};
