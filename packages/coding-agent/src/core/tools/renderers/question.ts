/**
 * Presentation for the question tool.
 *
 * The call is one row saying how many questions were asked; the result lists one answer line per
 * question. A dismissed form shows a single warning row.
 */

import { Container, Text } from "@hyzek/toucan-tui";
import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../../extensions/types.ts";
import type { QuestionToolAnswer, QuestionToolDetails, QuestionToolQuestion } from "../question.ts";
import { getTextOutput, toolRowCallLine } from "../render-utils.ts";

function formatQuestionCall(args: { questions?: QuestionToolQuestion[] } | undefined, theme: Theme): string {
	const questions = args?.questions ?? [];
	const count = questions.length;
	let text = `${theme.fg("toolTitle", theme.bold("Asked"))} ${theme.fg("muted", `${count} question${count === 1 ? "" : "s"}`)}`;
	const headers = questions.map((q) => q.header).filter((header) => header);
	if (headers.length > 0) text += theme.fg("dim", ` (${headers.join(", ")})`);
	return text;
}

function answerValueText(answer: QuestionToolAnswer, theme: Theme): string {
	// Title only: the option's subtitle (description) would make answer rows wrap
	// around the screen; it stays in the tool result text the model sees.
	return answer.answers.map((value) => theme.fg("text", value.title)).join("; ");
}

function answerLine(answer: QuestionToolAnswer, theme: Theme): string {
	const typed = answer.typed ? theme.fg("muted", "(wrote) ") : "";
	return `${theme.fg("success", "✓ ")}${theme.fg("accent", `${answer.header}: `)}${typed}${answerValueText(answer, theme)}`;
}

export const questionRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(
			toolRowCallLine(formatQuestionCall(args as { questions?: QuestionToolQuestion[] }, theme), context, theme),
		);
		return text;
	},

	renderResult(result, _options, theme, context) {
		const container = (context.lastComponent as Container | undefined) ?? new Container();
		container.clear();
		// Answer rows sit one cell right of the tool row's box padding so they start under
		// the call line's header text; the dot marker's ink hangs right of its cell, and
		// padding alone made these rows look shifted left of the marker.
		if (context.isError) {
			container.addChild(new Text(theme.fg("error", getTextOutput(result, false).trim() || "Failed"), 1, 0));
			return container;
		}
		const details = result.details as QuestionToolDetails | undefined;
		if (details?.dismissed) {
			container.addChild(new Text(theme.fg("warning", "Questions dismissed, no answers"), 1, 0));
			return container;
		}
		if (context.isPartial || !details?.answers) {
			container.addChild(new Text(theme.fg("muted", "Waiting for answers\u2026"), 1, 0));
			return container;
		}
		container.addChild(new Text(details.answers.map((answer) => answerLine(answer, theme)).join("\n"), 1, 0));
		return container;
	},
};
