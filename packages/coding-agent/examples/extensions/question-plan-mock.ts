/**
 * Question-plan mock provider - exercises the question tool, the plan mode prompt, and the
 * handoff tool offline.
 *
 * Registers provider `planmock` with the model `plan-question`. Every prompt replays one flow:
 * the model calls the `question` tool (one single-select and one multi-select question), then
 * after the form submits it answers with a `Plan:` list and immediately calls `handoff`
 * ("Hand off to build mode and start implementing?" - Yes / Keep planning). After the handoff
 * choice it reports what the model actually saw in its system prompt (whether a `<plan_mode>`
 * section is present and which tools are active), so you can verify plan mode's prompt
 * injection directly in the transcript: toggle /plan, re-run, and read the check line.
 * No files are written; fully offline.
 *
 * Usage (from the repo root):
 *   ./toucan-test.sh -e ./packages/coding-agent/examples/extensions/question-plan-mock.ts --model planmock/plan-question --api-key mock
 *   # then type any prompt, answer the form, and pick in the handoff menu
 */

import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
	getSystemMessageText,
	type TranscriptContext,
} from "@hyzek/toucan-ai";
import type { ExtensionAPI } from "@hyzek/toucan-coding-agent";

const mockQuestions: {
	question: string;
	header: string;
	options: { label: string; description?: string }[];
	multiple?: boolean;
}[] = [
	{
		question: "Which storage backend should the plan assume?",
		header: "Storage",
		options: [
			{ label: "SQLite", description: "embedded, single file" },
			{ label: "Redis", description: "external server" },
		],
	},
	{
		question: "Which interfaces should the plan cover?",
		header: "Interfaces",
		options: [{ label: "CLI" }, { label: "Web UI" }, { label: "SDK" }],
		multiple: true,
	},
];

/** What the model was actually told: plan mode section presence + listed tools in the prompt. */
function promptCheck(context: TranscriptContext): string {
	const systemText = context.messages
		.filter((message) => message.role === "system")
		.map((message) => getSystemMessageText(message))
		.join("\n");
	return (
		`plan_mode section in prompt: ${systemText.includes("<plan_mode>") ? "yes" : "no"}; ` +
		`question listed: ${systemText.includes("- question:") ? "yes" : "no"}; ` +
		`handoff listed: ${systemText.includes("- handoff:") ? "yes" : "no"}`
	);
}

export default function questionPlanMock(toucan: ExtensionAPI) {
	const core = createFauxCore({ api: "planmock-api", tokensPerSecond: 400 });

	toucan.registerProvider("planmock", {
		baseUrl: "http://localhost:0",
		apiKey: "mock-key",
		api: "planmock-api",
		models: [
			{
				id: "plan-question",
				name: "Plan Question Mock",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 16384,
			},
		],
		streamSimple: (model, context, options) => {
			const answered = context.messages.some(
				(message) => message.role === "toolResult" && message.toolName === "question",
			);
			const handoffResult = context.messages.findLast(
				(message) => message.role === "toolResult" && message.toolName === "handoff",
			);
			if (!answered) {
				core.setResponses([
					fauxAssistantMessage([fauxToolCall("question", { questions: mockQuestions })], {
						stopReason: "toolUse",
					}),
				]);
			} else if (!handoffResult) {
				core.setResponses([
					fauxAssistantMessage(
						[
							{
								type: "text",
								text: "Answers recorded. Here is the plan.\n\nPlan:\n1. Read core/tools/index.ts and plan-mode.ts to see the current wiring\n2. Toggle /plan and re-run this mock to compare the prompt check\n3. Pick an option in the handoff menu below\n\n",
							},
							fauxToolCall("handoff", {
								prompt: "Hand off to build mode and start implementing?",
								summary: "3 steps ready. Step 1: read the tool registry wiring.",
								options: [
									{
										label: "Yes — start implementing",
										description: "turns plan mode off",
										startImplementation: true,
									},
									{ label: "Keep planning", description: "stay read-only" },
								],
							}),
						],
						{ stopReason: "toolUse" },
					),
				]);
			} else {
				const choice =
					handoffResult?.role === "toolResult"
						? handoffResult.content.map((block) => (block.type === "text" ? block.text : "")).join(" ")
						: "";
				core.setResponses([
					fauxAssistantMessage(
						`Mock done. ${choice}\nPrompt check (what the model saw): ${promptCheck(context)}.`,
					),
				]);
			}
			return core.streamSimple(model, context, options);
		},
	});
}
