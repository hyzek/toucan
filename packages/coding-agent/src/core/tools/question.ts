/**
 * question tool: asks the user one or more questions with selectable options and
 * blocks the agent until every question is answered and the form is submitted once.
 * In the TUI the form extends the input band (`QuestionForm`); other runs get an
 * error result so the model asks in its reply instead.
 */

import type { AgentTool } from "@hyzek/toucan-agent-core";
import { type Static, Type } from "typebox";
import { QuestionForm, type QuestionFormResult } from "../../modes/interactive/components/question-form.ts";
import type { ExtensionToolContext, ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export interface QuestionToolOption {
	label: string;
	description?: string;
}

export interface QuestionToolQuestion {
	question: string;
	header: string;
	options: QuestionToolOption[];
	multiple?: boolean;
}

/** One chosen answer: the option's title plus its subtitle (description) when it had one. */
export interface QuestionToolAnswerValue {
	title: string;
	subtitle?: string;
}

export interface QuestionToolAnswer {
	header: string;
	question: string;
	answers: QuestionToolAnswerValue[];
	/** True when the answer came from the free-text row rather than an option. */
	typed: boolean;
}

export interface QuestionToolDetails {
	questions: QuestionToolQuestion[];
	answers?: QuestionToolAnswer[];
	dismissed?: boolean;
}

const QuestionOptionSchema = Type.Object({
	label: Type.String({ description: "Short option label shown to the user" }),
	description: Type.Optional(Type.String({ description: "One-line detail shown beside the label" })),
});

const QuestionSchema = Type.Object({
	question: Type.String({ description: "The full question text shown to the user" }),
	header: Type.String({ description: "Short tab label, e.g. 'Storage' (keep under 12 characters)" }),
	options: Type.Array(QuestionOptionSchema, {
		description: "Choices shown to the user; the user can always type their own answer",
	}),
	multiple: Type.Optional(Type.Boolean({ description: "Let the user pick more than one option" })),
});

export const QuestionToolParameters = Type.Object({
	questions: Type.Array(QuestionSchema, {
		minItems: 1,
		description: "Questions to ask at once; the user answers all of them in one form and submits together",
	}),
});

type QuestionToolParams = Static<typeof QuestionToolParameters>;

/** Fill in defaults for questions coming from the model. */
function normalizeQuestions(questions: QuestionToolParams["questions"]): QuestionToolQuestion[] {
	return questions.map((q, i) => ({
		question: q.question,
		header: q.header?.trim() || `Q${i + 1}`,
		options: q.options.map((option) => ({
			label: option.label,
			...(option.description ? { description: option.description } : {}),
		})),
		...(q.multiple !== undefined ? { multiple: q.multiple } : {}),
	}));
}

function formatAnswerValue(value: QuestionToolAnswerValue): string {
	return value.subtitle ? `${value.title} (${value.subtitle})` : value.title;
}

export function formatQuestionAnswers(answers: QuestionToolAnswer[]): string {
	return answers
		.map(
			(answer) =>
				`- ${answer.header}: ${answer.typed ? "(wrote) " : ""}${answer.answers.map(formatAnswerValue).join("; ")}`,
		)
		.join("\n");
}

/** Create the built-in `question` tool definition. */
export function createQuestionToolDefinition(): ToolDefinition<typeof QuestionToolParameters, QuestionToolDetails> {
	return {
		name: "question",
		label: "Question",
		description:
			"Ask the user one or more questions in a single form and wait for the answers. Use it to resolve ambiguity before acting: preferences, scope, trade-offs, missing details. Give concrete options per question; the user can always type their own answer. Batch all questions into one call instead of asking one per turn.",
		promptSnippet: "ask the user questions with options; one form, all answers submitted together",
		promptGuidelines: [
			"Never assume what the user meant: when unsure about scope, preferences, or approach, ask with the question tool",
			"Batch all clarifying questions into one question call",
		],
		parameters: QuestionToolParameters,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			const questions = normalizeQuestions(params.questions);
			if (!ctx?.hasUI || ctx.mode !== "tui") {
				return {
					content: [
						{
							type: "text",
							text: "The question tool needs an interactive run. Ask the questions in your reply text instead.",
						},
					],
					details: { questions, dismissed: true },
				};
			}
			if (questions.length === 0) {
				return {
					content: [{ type: "text", text: "No questions provided." }],
					details: { questions, dismissed: true },
				};
			}

			const result = await ctx.ui.custom<QuestionFormResult>(
				(tui, _theme, keybindings, done) => new QuestionForm(tui, keybindings, questions, done),
				{ blocked: { kind: "question", message: "Waiting for your answers" } },
			);

			if (result.dismissed) {
				return {
					content: [
						{
							type: "text",
							text: "The user closed the questions without answering. Do not ask again; proceed with your best judgment and state your assumptions.",
						},
					],
					details: { questions, dismissed: true },
				};
			}

			return {
				content: [{ type: "text", text: `User answered:\n${formatQuestionAnswers(result.answers)}` }],
				details: { questions, answers: result.answers },
			};
		},
	};
}

/** Create the built-in `question` tool. */
export function createQuestionTool(): AgentTool<any, QuestionToolDetails> {
	return wrapToolDefinition(createQuestionToolDefinition());
}
