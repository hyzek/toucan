/**
 * Mock subagents provider - replays a scripted subagent run to exercise the
 * built-in `subagent` tool and the agent command center without any API calls.
 *
 * Registers provider `mock` with the model `mock-agents`. Every prompt replays
 * the same scenario:
 *
 *   1. The main agent spawns two background subagents (explore + general-purpose).
 *   2. Each subagent streams its own script: a bash tool call, then an answer.
 *   3. Their completions arrive as a follow-up message; the main agent then
 *      resumes the finished explore agent with `resume`, asks it one follow-up
 *      question inline (`background: false`), and summarizes everything.
 *
 * Requests are routed by the subagent system prompt, so parent and child turns
 * stay on separate scripts no matter what order they stream in.
 *
 * Usage:
 *   node packages/coding-agent/dist/bundle/cli.js -e ./packages/coding-agent/examples/extensions/mock-subagents.ts
 *   # subagents are off by default; set "subagents": { "enabled": true } in
 *   # .toucan/settings.json (project) or <agent-dir>/settings.json (user) first
 *   # then select mock/mock-agents via /model and type any prompt
 *   # press Left at the empty prompt (or /agents) to watch the command center
 */

import {
	type AssistantMessage,
	createFauxCore,
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
	type TranscriptContext,
} from "@hyzek/toucan-ai";
import type { ExtensionAPI } from "@hyzek/toucan-coding-agent";

const TASK_EXPLORE = "Find every file that handles authentication and summarize how sessions are validated.";
const TASK_PACKAGES = "Summarize how this repository is organized: which packages exist and what each one does.";

/** Find the id a background spawn reported, from the parent's tool results. */
function spawnedId(context: TranscriptContext, agentName: string): string | undefined {
	for (const message of context.messages) {
		if (message.role !== "toolResult") continue;
		const text = message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("");
		const match = new RegExp(`Spawned ${agentName} as (agent-[a-z0-9]+)`).exec(text);
		if (match) return match[1];
	}
	return undefined;
}

/** Responses for the main (spawning) session, consumed one per model request. */
function mainScript(turn: number, context: TranscriptContext): AssistantMessage {
	switch (turn) {
		case 0:
			return fauxAssistantMessage(
				[
					fauxText("I'll delegate this: one agent maps the auth code, another maps the package layout.\n"),
					fauxToolCall(
						"subagent",
						{ action: "spawn", agent: "explore", task: TASK_EXPLORE, description: "Map auth handling" },
						{ id: "agents-spawn-explore" },
					),
					fauxToolCall(
						"subagent",
						{ action: "spawn", agent: "general-purpose", task: TASK_PACKAGES, description: "Map package layout" },
						{ id: "agents-spawn-packages" },
					),
				],
				{ stopReason: "toolUse" },
			);
		case 1:
			return fauxAssistantMessage(
				[
					fauxText("The explore agent finished first. I want one more detail from it, so I resume its session.\n"),
					fauxToolCall(
						"subagent",
						{
							action: "spawn",
							agent: "explore",
							task: "One more thing: which single file is the best entry point for the auth flow, and why?",
							description: "Auth entry point",
							background: false,
							resume: spawnedId(context, "explore"),
						},
						{ id: "agents-resume-explore" },
					),
				],
				{ stopReason: "toolUse" },
			);
		default:
			return fauxAssistantMessage([
				fauxText(
					"## Subagent run complete\n\n" +
						"Both agents reported. Authentication lives in `packages/agent/src/auth.ts`, checked before every " +
						"provider request; session keys are in `packages/tui/src/keys.ts`.\n\n" +
						"The repo is a monorepo: `agent` holds the agent loop, `ai` the providers, `tui` the terminal UI, " +
						"and `coding-agent` the CLI.\n\n" +
						"Press **Left** at an empty prompt to open the agent command center and read either agent's full " +
						"transcript.\n",
				),
			]);
	}
}

/** Script for the explore subagent; turn 0 is the task, turn 1 the resume question. */
function exploreScript(turn: number): AssistantMessage {
	if (turn === 0) {
		// explore is read-only: it may call ls, not bash.
		return fauxAssistantMessage([fauxToolCall("ls", { path: "." }, { id: "explore-ls" })], {
			stopReason: "toolUse",
		});
	}
	return fauxAssistantMessage([
		fauxText(
			"## Subagent run complete\n\n" +
				"**explore** mapped authentication: sessions are validated by a token check in `packages/agent/src/auth.ts`, " +
				"called before every provider request. Session keys live in `packages/tui/src/keys.ts`.\n\n" +
				"**general-purpose** mapped the layout: this is a monorepo, with `agent` holding the agent loop, `ai` the " +
				"providers, and `coding-agent` the CLI and terminal UI wiring.\n\n" +
				"The single entry point for the auth flow is `packages/agent/src/auth.ts`: every request path — first turn, " +
				"follow-up, and compaction — calls into it before touching the network.",
		),
	]);
}

/** Script for the general-purpose subagent. */
function packagesScript(): AssistantMessage {
	return fauxAssistantMessage([fauxToolCall("bash", { command: "cat package.json" }, { id: "packages-cat" })]);
}

function packagesAnswer(): AssistantMessage {
	return fauxAssistantMessage([
		fauxText(
			"This is a monorepo: `agent` (core loop), `agent-core`, `ai` (providers), `tui` (terminal UI), " +
				"`coding-agent` (the CLI), plus `orchestrator` and `tui-collab`.",
		),
	]);
}

function childSystemText(context: TranscriptContext): string {
	const first = context.messages[0];
	if (first?.role !== "system") return "";
	const message = first as { content?: unknown; sections?: Record<string, unknown> };
	const parts: string[] = [];
	if (typeof message.content === "string") parts.push(message.content);
	for (const section of Object.values(message.sections ?? {})) {
		if (typeof section === "string") parts.push(section);
	}
	return parts.join("\n");
}

function isExploreSystem(context: TranscriptContext): boolean {
	return childSystemText(context).includes("read-only codebase exploration agent");
}

function isPackagesSystem(context: TranscriptContext): boolean {
	return childSystemText(context).includes("subagent handling one delegated task");
}

export default function (toucan: ExtensionAPI) {
	const core = createFauxCore({ api: "mock-api", tokensPerSecond: 40 });
	const turns = new Map<string, number>();

	toucan.registerProvider("mock", {
		baseUrl: "http://localhost:0",
		apiKey: "mock-key",
		api: "mock-api",
		models: [
			{
				id: "mock-agents",
				name: "Mock Agents",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 16384,
			},
		],
		streamSimple: (model, context, options) => {
			let response: AssistantMessage;
			if (isExploreSystem(context)) {
				const turn = turns.get("explore") ?? 0;
				turns.set("explore", turn + 1);
				response = exploreScript(turn);
			} else if (isPackagesSystem(context)) {
				const turn = turns.get("packages") ?? 0;
				turns.set("packages", turn + 1);
				response = turn === 0 ? packagesScript() : packagesAnswer();
			} else {
				const turn = turns.get("main") ?? 0;
				turns.set("main", turn + 1);
				response = mainScript(turn, context);
			}
			core.setResponses([response]);
			return core.streamSimple(model, context, options);
		},
	});
}
