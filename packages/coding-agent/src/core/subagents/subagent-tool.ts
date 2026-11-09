/**
 * The built-in `subagent` tool: spawn an agent task in an isolated child
 * session (background by default), and send, stop, or inspect running and
 * finished subagents.
 */

import { type Static, Type } from "typebox";
import { getAgentDir } from "../../config.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import {
	type AgentDefinition,
	ASSIGNABLE_TOOL_NAMES,
	discoverAgentDefinitions,
	resolveAgentDefinition,
} from "./agent-registry.ts";
import { resolveModelPin } from "./model-selection.ts";
import { subagentRenderers } from "./renderers.ts";
import type { SubagentManager, SubagentRecord } from "./subagent-manager.ts";

const subagentSchema = Type.Object({
	action: Type.Optional(
		Type.Union([Type.Literal("spawn"), Type.Literal("send"), Type.Literal("stop"), Type.Literal("status")], {
			description: '"spawn" (default), "send" (steer a running agent), "stop", or "status".',
		}),
	),
	agent: Type.Optional(
		Type.String({ description: "spawn: agent type to run, e.g. general-purpose, explore, plan, or a custom name" }),
	),
	task: Type.Optional(
		Type.String({
			description:
				"spawn: the task for the agent. It runs in its own session and cannot see this conversation, so make the task self-contained.",
		}),
	),
	description: Type.Optional(Type.String({ description: "spawn: short 3-5 word summary of the task, for display" })),
	background: Type.Optional(
		Type.Boolean({
			description:
				"spawn: run without blocking the call (default true; you are notified when it finishes). Pass false to wait and get the answer inline.",
		}),
	),
	agent_id: Type.Optional(Type.String({ description: "send/stop/status: the id returned by a spawn" })),
	max_turns: Type.Optional(
		Type.Integer({
			minimum: 1,
			description:
				"spawn: turn cap for this call. The agent nears the cap, it is told to wrap up; the run aborts after a grace period.",
		}),
	),
	resume: Type.Optional(
		Type.String({
			description:
				"spawn: id of a finished subagent; continue its conversation with this task instead of starting fresh",
		}),
	),
	message: Type.Optional(
		Type.String({
			description: "send: message injected into the running agent after its current tool, redirecting it",
		}),
	),
	wait: Type.Optional(
		Type.Boolean({ description: "status: wait for the agent to finish before returning its full result" }),
	),
});

export type SubagentToolInput = Static<typeof subagentSchema>;

export interface SubagentToolDetails {
	action: "spawn" | "send" | "stop" | "status";
	records: SubagentRecord[];
}

export interface SubagentToolOptions {
	/** The session's subagent manager, created on first use. */
	manager: () => SubagentManager;
}

/** Create the `subagent` tool definition for a session. Only sessions that pass manager options get the tool. */
export function createSubagentToolDefinition(
	cwd: string,
	options: SubagentToolOptions,
): ToolDefinition<typeof subagentSchema, SubagentToolDetails | undefined> {
	const description = buildToolDescription(cwd, options.manager());

	return {
		name: "subagent",
		label: "subagent",
		description,
		promptSnippet: "Delegate a self-contained task to a subagent session",
		promptGuidelines: [
			"Subagents cannot see this conversation: pass a task that carries all context the agent needs.",
			"Use the explore agent for broad codebase searches instead of running many greps and reads yourself.",
			"Background subagents report their results as follow-up messages; do not poll them in a loop.",
		],
		parameters: subagentSchema,
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const manager = options.manager();
			const action = params.action ?? "spawn";
			switch (action) {
				case "spawn": {
					if (!params.task) throw new Error('action "spawn" requires task.');
					let definition: AgentDefinition;
					let resumeSessionFile: string | undefined;
					let resumeOf: string | undefined;
					if (params.resume) {
						const source = manager.get(params.resume);
						if (!source) throw unknownIdError(params.resume, manager);
						if (source.status === "queued" || source.status === "running") {
							throw new Error(
								`Subagent ${params.resume} is still ${source.status}; resume needs a finished agent.`,
							);
						}
						if (!source.sessionFile) {
							throw new Error(`Subagent ${params.resume} has no saved session to resume.`);
						}
						// The definition is re-resolved, so a continuation runs under the type's current frontmatter.
						definition = resolveDefinition(cwd, source.agent, manager);
						resumeSessionFile = source.sessionFile;
						resumeOf = source.id;
					} else {
						if (!params.agent) throw new Error('action "spawn" requires agent (or resume with an agent_id).');
						definition = resolveDefinition(cwd, params.agent, manager);
					}
					const model = resolveSpawnModel(definition, manager);
					const background = params.background ?? true;
					const record = manager.spawn({
						definition,
						task: params.task,
						description: params.description,
						background,
						model,
						thinkingLevel: definition.thinking ?? manager.runtime().thinkingLevel,
						// Background runs outlive the tool call; only a blocking call aborts its child on Esc.
						signal: background ? undefined : signal,
						maxTurns: params.max_turns,
						resumeSessionFile,
						resumeOf,
					});
					if (background) {
						const opened = resumeOf
							? `Resumed ${resumeOf} as ${record.id}`
							: `Spawned ${definition.name} as ${record.id}`;
						return {
							content: [
								{
									type: "text" as const,
									text:
										`${opened} (background). ` +
										`Its result arrives as a follow-up message when it finishes. ` +
										`Check it with subagent action "status" and agent_id "${record.id}"; "send" steers it, "stop" stops it.`,
								},
							],
							details: { action, records: [record] },
						};
					}
					const settled = await manager.waitFor(record.id);
					return spawnResult(action, settled);
				}
				case "send": {
					if (!params.agent_id || !params.message) {
						throw new Error('action "send" requires agent_id and message.');
					}
					await manager.steer(params.agent_id, params.message);
					return {
						content: [
							{
								type: "text" as const,
								text: `Message queued for ${params.agent_id}; it redirects the agent after its current tool call.`,
							},
						],
						details: { action, records: [manager.get(params.agent_id) as SubagentRecord] },
					};
				}
				case "stop": {
					if (!params.agent_id) throw new Error('action "stop" requires agent_id.');
					manager.stop(params.agent_id);
					return {
						content: [{ type: "text" as const, text: `Stop requested for ${params.agent_id}.` }],
						details: { action, records: [manager.get(params.agent_id) as SubagentRecord] },
					};
				}
				case "status": {
					if (params.agent_id) {
						if (!manager.get(params.agent_id)) throw unknownIdError(params.agent_id, manager);
						const record = params.wait ? await manager.waitFor(params.agent_id) : manager.get(params.agent_id);
						if (!record) throw new Error(`Subagent ${params.agent_id} is no longer tracked.`);
						return {
							content: [
								{
									type: "text" as const,
									text: `${formatRecordLine(record)}\n\n${record.result ?? "(no result yet)"}`,
								},
							],
							details: { action, records: [record] },
						};
					}
					const records = manager.list();
					const text =
						records.length === 0
							? "No subagents have been spawned in this session."
							: records.map(formatRecordLine).join("\n");
					return { content: [{ type: "text" as const, text }], details: { action, records } };
				}
				default:
					throw new Error(`Unknown subagent action "${String(action)}".`);
			}
		},
		...subagentRenderers,
	};
}

function resolveDefinition(cwd: string, agent: string, manager: SubagentManager) {
	const { definitions } = discoverAgentDefinitions({
		cwd,
		agentDir: getAgentDir(),
		projectTrusted: manager.runtime().settingsManager.isProjectTrusted(),
	});
	const definition = resolveAgentDefinition(agent, definitions);
	if (!definition) {
		const available = [...definitions]
			.map((candidate) => candidate.name)
			.sort((a, b) => a.localeCompare(b))
			.join(", ");
		throw new Error(`Unknown subagent type "${agent}". Available types: ${available}`);
	}
	const unknownTools = definition.tools?.filter((name) => !ASSIGNABLE_TOOL_NAMES.includes(name)) ?? [];
	if (unknownTools.length > 0) {
		throw new Error(
			`Agent "${definition.name}" names unknown tools: ${unknownTools.join(", ")}. ` +
				`Assignable tools: ${ASSIGNABLE_TOOL_NAMES.join(", ")}.`,
		);
	}
	return definition;
}

function resolveSpawnModel(definition: AgentDefinition, manager: SubagentManager) {
	const runtime = manager.runtime();
	let model = runtime.model;
	if (definition.model) {
		const pinned = resolveModelPin(definition.model, runtime.modelRuntime);
		if (!pinned) {
			throw new Error(
				`Agent "${definition.name}" pins model "${definition.model}" but it does not resolve to any configured model.`,
			);
		}
		model = pinned;
	}
	if (!model) {
		throw new Error("No model available to run the subagent.");
	}
	return model;
}

function spawnResult(action: SubagentToolDetails["action"], record: SubagentRecord) {
	const isError = record.status === "error" || record.status === "stopped";
	return {
		content: [{ type: "text" as const, text: `${formatRecordLine(record)}\n\n${record.result ?? ""}`.trim() }],
		details: { action, records: [record] },
		isError: isError || undefined,
	};
}

function formatRecordLine(record: SubagentRecord): string {
	const stats = `${record.turns} turns, ${formatTokens(record.usage.input + record.usage.output + record.usage.cacheWrite)} tokens`;
	const parts = [`${record.status}: ${record.agent} (${record.id}`, stats];
	if (record.resumedFrom) parts.push(`resumed from ${record.resumedFrom}`);
	if (record.model) parts.push(record.model);
	if (record.description) parts.push(`"${record.description}"`);
	return `${parts.join("; ")})`;
}

function unknownIdError(id: string, manager: SubagentManager): Error {
	const known = manager
		.list()
		.map((record) => record.id)
		.join(", ");
	return new Error(`Unknown subagent id "${id}". Known ids: ${known || "none"}.`);
}

function formatTokens(count: number): string {
	return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

function buildToolDescription(cwd: string, manager: SubagentManager): string {
	const { definitions } = discoverAgentDefinitions({
		cwd,
		agentDir: getAgentDir(),
		projectTrusted: manager.runtime().settingsManager.isProjectTrusted(),
	});
	const agentLines = [...definitions]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((definition) => {
			const tools = definition.tools ? definition.tools.join(", ") : "*";
			return `- ${definition.name}: ${definition.description} (Tools: ${tools})`;
		});
	return [
		"Run subagents: isolated agent sessions that complete tasks autonomously. " +
			'action "spawn" starts one (background by default: the call returns its id and the result arrives as a follow-up message; ' +
			"pass background=false to block and get the answer inline; pass resume to continue a finished agent's conversation). " +
			'action "status" lists agents or returns one agent\'s full result (wait=true blocks until it finishes). ' +
			'action "send" injects a redirecting message into a running agent. action "stop" aborts one. ' +
			"A subagent has its own system prompt and tools, and does not see this conversation, so spawn tasks must be self-contained.",
		`Available agent types:\n${agentLines.join("\n")}`,
		"Custom agent types are markdown files in .toucan/agents/ (project) or <agent dir>/agents/ (user).",
	].join("\n\n");
}
