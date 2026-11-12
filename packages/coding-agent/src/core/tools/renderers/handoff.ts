/**
 * Presentation for the handoff tool.
 *
 * The call row shows the decision asked; the result shows the option the user picked.
 * A dismissed menu shows a warning row.
 */

import { Text } from "@hyzek/toucan-tui";
import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../../extensions/types.ts";
import type { HandoffToolDetails } from "../handoff.ts";
import { getTextOutput, toolRowCallLine } from "../render-utils.ts";

function formatHandoffCall(args: { prompt?: string } | undefined, theme: Theme): string {
	const prompt = args?.prompt?.trim() || "Handoff decision";
	const short = prompt.length > 60 ? `${prompt.slice(0, 59)}…` : prompt;
	return `${theme.fg("toolTitle", theme.bold("Handoff"))} ${theme.fg("muted", short)}`;
}

export const handoffRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(toolRowCallLine(formatHandoffCall(args as { prompt?: string }, theme), context, theme));
		return text;
	},

	renderResult(result, _options, theme, context) {
		if (context.isError) {
			return new Text(theme.fg("error", getTextOutput(result, false).trim() || "Failed"), 0, 0);
		}
		const details = result.details as HandoffToolDetails | undefined;
		if (!details) return new Text(getTextOutput(result, false).trim(), 0, 0);
		if (details.dismissed) {
			return new Text(theme.fg("warning", "Handoff dismissed, no choice"), 0, 0);
		}
		const exited = details.planModeExited ? theme.fg("success", "  ·  plan mode off") : "";
		return new Text(`${theme.fg("success", "→ ")}${theme.fg("accent", details.choice?.label ?? "?")}${exited}`, 0, 0);
	},
};
