/**
 * handoff tool: asks the user to choose what happens next — typically whether to leave plan
 * mode and start implementing a finished plan. The model supplies the prompt and the options;
 * an option marked `startImplementation` turns plan mode off when the user picks it.
 * The menu extends the input band like the question form, without a hint row.
 */

import type { AgentTool } from "@hyzek/toucan-agent-core";
import { Type } from "typebox";
import { HandoffMenu, type HandoffMenuResult } from "../../modes/interactive/components/handoff-menu.ts";
import type { ExtensionToolContext, ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export interface HandoffToolOption {
	label: string;
	description?: string;
	/** Picking this option exits plan mode (the "start implementing" choice). */
	startImplementation?: boolean;
}

export interface HandoffToolDetails {
	prompt: string;
	options: HandoffToolOption[];
	choice?: HandoffToolOption;
	dismissed?: boolean;
	planModeExited?: boolean;
}

export interface HandoffToolOptions {
	/** Current plan-mode state and the switch, wired by AgentSession. */
	isPlanMode?: () => boolean;
	exitPlanMode?: () => void;
}

const HandoffOptionSchema = Type.Object({
	label: Type.String({ description: "Option the user can pick, e.g. 'Yes — start implementing'" }),
	description: Type.Optional(Type.String({ description: "One-line detail shown beside the label" })),
	startImplementation: Type.Optional(
		Type.Boolean({ description: "Picking this exits plan mode and starts implementing" }),
	),
});

export const HandoffToolParameters = Type.Object({
	prompt: Type.String({
		description: "The question shown at the top, e.g. 'Hand off to build mode and start implementing?'",
	}),
	summary: Type.Optional(
		Type.String({ description: "Optional recap shown above the options, e.g. the plan's next step" }),
	),
	options: Type.Array(HandoffOptionSchema, { minItems: 1, description: "Choices the user can pick" }),
});

/** Create the built-in `handoff` tool definition. */
export function createHandoffToolDefinition(
	options?: HandoffToolOptions,
): ToolDefinition<typeof HandoffToolParameters, HandoffToolDetails> {
	return {
		name: "handoff",
		label: "Handoff",
		description:
			"Ask the user to choose what happens next, as a menu they pick one answer from. Use it when a plan is finished and you need a decision before acting, for example whether to hand off to build mode and start implementing. Offer clear options; mark the option that should begin implementation with startImplementation.",
		promptSnippet: "ask the user to choose the next step as a menu (e.g. start implementing a finished plan)",
		promptGuidelines: ["Use handoff at decision points; put every real choice in options, never assume the answer"],
		parameters: HandoffToolParameters,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			const handoffOptions: HandoffToolOption[] = params.options.map((option) => ({
				label: option.label,
				...(option.description ? { description: option.description } : {}),
				...(option.startImplementation !== undefined ? { startImplementation: option.startImplementation } : {}),
			}));
			if (!ctx?.hasUI || ctx.mode !== "tui") {
				return {
					content: [
						{
							type: "text",
							text: "The handoff tool needs an interactive run. Ask the question in your reply text instead.",
						},
					],
					details: { prompt: params.prompt, options: handoffOptions, dismissed: true },
				};
			}

			const result = await ctx.ui.custom<HandoffMenuResult>(
				(tui, _theme, keybindings, done) =>
					new HandoffMenu(tui, keybindings, params.prompt, params.summary, handoffOptions, done),
				{ blocked: { kind: "question", message: "Waiting for your choice" } },
			);

			if (result.dismissed) {
				return {
					content: [
						{
							type: "text",
							text: "The user closed the handoff menu without choosing. Keep the current plan; do not start implementing.",
						},
					],
					details: { prompt: params.prompt, options: handoffOptions, dismissed: true },
				};
			}

			const choice = handoffOptions[result.choiceIndex]!;
			let planModeExited = false;
			if (choice.startImplementation && options?.isPlanMode?.()) {
				options?.exitPlanMode?.();
				planModeExited = true;
			}
			const followup = planModeExited
				? " Plan mode is off; you may now implement the plan."
				: choice.startImplementation
					? " You may now implement."
					: "";
			return {
				content: [{ type: "text", text: `User chose: ${choice.label}.${followup}` }],
				details: { prompt: params.prompt, options: handoffOptions, choice, planModeExited },
			};
		},
	};
}

/** Create the built-in `handoff` tool without session plan-mode wiring. */
export function createHandoffTool(): AgentTool<any, HandoffToolDetails> {
	return wrapToolDefinition(createHandoffToolDefinition());
}
