// Question tool renderer: the chat rows an answered form leaves behind.

import { beforeAll, describe, expect, it } from "vitest";
import type { ToolRenderContext, ToolRenderResultOptions } from "../src/core/extensions/types.ts";
import type { QuestionToolAnswer } from "../src/core/tools/question.ts";
import { questionRenderers } from "../src/core/tools/renderers/question.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const answer: QuestionToolAnswer = {
	header: "Angle",
	question: "Which direction should I take the energy?",
	answers: [
		{
			title: "Compiler is unhinged, not coherent",
			subtitle:
				"Keep the technical essay but strip its logic: tsc's rulings become arbitrary, self-contradicting, unexplained. It bans things it cannot name.",
		},
	],
	typed: false,
};

function context(outputPad: number): ToolRenderContext {
	return {
		isPartial: false,
		isError: false,
		expanded: false,
		outputPad,
		rowMarkerShown: true,
		lastComponent: undefined,
		state: {},
	} as unknown as ToolRenderContext;
}

const options: ToolRenderResultOptions = { expanded: false, isPartial: false };

function renderAnswerLines(outputPad: number, width = 80): string[] {
	const component = questionRenderers.renderResult!(
		{ content: [], details: { questions: [], answers: [answer] } },
		options,
		theme,
		context(outputPad),
	);
	return component
		.render(width)
		.map(stripAnsi)
		.filter((line) => /\S/.test(line));
}

describe("questionRenderers.renderResult", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("indents every line of a wrapped answer by the tool row padding", () => {
		const lines = renderAnswerLines(1);
		expect(lines.length).toBeGreaterThan(1); // the answer must wrap to exercise this
		for (const line of lines) expect(line.startsWith(" ")).toBe(true);
	});

	it("honours zero output padding by starting every line at the left edge", () => {
		for (const line of renderAnswerLines(0)) expect(line.startsWith(" ")).toBe(false);
	});
});
