// Question tool renderer: the chat rows an answered form leaves behind.

import { TuiMainScreen } from "@hyzek/toucan-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import type { ToolRenderContext, ToolRenderResultOptions } from "../src/core/extensions/types.ts";
import { createQuestionToolDefinition } from "../src/core/tools/question.ts";
import { questionRenderers } from "../src/core/tools/renderers/question.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const answer = {
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
} as const;

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

	it("emits unpadded lines; the tool row's box owns the indent", () => {
		const lines = renderAnswerLines(1);
		expect(lines.length).toBeGreaterThan(1); // the answer must wrap to exercise this
		for (const line of lines) expect(line.startsWith(" ")).toBe(false);
	});
});

describe("question answer rows in the tool execution shell", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("keeps wrapped answer lines at the tool row indent, never at column 0", () => {
		const ui = new TuiMainScreen(new VirtualTerminal(100, 24));
		const definition = { ...createQuestionToolDefinition(), ...questionRenderers };
		const component = new ToolExecutionComponent(
			"question",
			"q1",
			{ questions: [{ question: "Which direction?", header: "Angle", options: [{ label: "a" }] }] },
			{ outputPad: 1 },
			definition as never,
			ui,
			"/",
		);
		component.updateResult({
			content: [{ type: "text", text: "ok" }],
			isError: false,
			details: { questions: [], answers: [{ ...answer, answers: [...answer.answers] }], dismissed: false },
		} as never);

		const lines = component
			.render(100)
			.map((line) => stripAnsi(line).replace(/\s+$/, ""))
			.filter((line) => /\S/.test(line));
		const answerLines = lines.filter((line) => /Compiler is unhinged|self-contradicting/.test(line));
		expect(answerLines.length).toBeGreaterThan(1); // the answer wrapped
		for (const line of answerLines) expect(line.startsWith(" ")).toBe(true);
	});
});
