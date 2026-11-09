/**
 * Running one subagent: builds an isolated child AgentSession from an agent
 * definition (own system prompt, tools, model) and starts its task. The handle
 * keeps the live child session reachable for steering and stopping until the
 * run finishes.
 */

import type { ThinkingLevel } from "@hyzek/toucan-agent-core";
import type { Api, AssistantMessage, Model } from "@hyzek/toucan-ai";
import { getAgentDir } from "../../config.ts";
import type { AgentSession } from "../agent-session.ts";
import type { ModelRuntime } from "../model-runtime.ts";
import { DefaultResourceLoader } from "../resource-loader.ts";
import { createAgentSession } from "../sdk.ts";
import { SessionManager } from "../session-manager.ts";
import type { SettingsManager } from "../settings-manager.ts";
import type { AgentDefinition } from "./agent-registry.ts";
import { ASSIGNABLE_TOOL_NAMES } from "./agent-registry.ts";

/** The session-bound services a subagent spawn needs, read at call time. */
export interface SubagentRuntime {
	cwd: string;
	modelRuntime: ModelRuntime;
	settingsManager: SettingsManager;
	sessionManager: SessionManager;
	model: Model<Api> | undefined;
	thinkingLevel: ThinkingLevel;
}

export interface SubagentRunUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export type SubagentRunStatus = "completed" | "stopped" | "error";

export interface SubagentRunResult {
	status: SubagentRunStatus;
	/** The agent's final assistant text, or its partial output when it did not finish. */
	text: string;
	sessionId: string;
	sessionFile?: string;
	turns: number;
	usage: SubagentRunUsage;
	/** `provider/modelId` the run used. */
	model: string;
}

/** A started subagent run: the live child session plus its eventual result. */
export interface SubagentHandle {
	session: AgentSession;
	sessionManager: SessionManager;
	done: Promise<SubagentRunResult>;
	/** Request aborting the run. */
	abort(): void;
}

/** Wrap-up warning at `maxTurns`, hard abort `GRACE_TURNS` later. */
const GRACE_TURNS = 5;
const WRAP_UP_MESSAGE = "Wrap up immediately — finish the current step and provide your final answer now.";

/**
 * Create a child session for `definition` and start `task` without waiting. The child
 * gets no extensions and never the `subagent` tool itself. When `signal` aborts, the
 * child aborts with it. The child session is disposed when the run ends.
 *
 * `maxTurns` gets a graceful shutdown: a wrap-up steer at the limit and an abort
 * after `GRACE_TURNS` more assistant turns. `resumeSessionFile` continues a finished
 * child's saved session instead of starting a new one.
 */
export async function startSubagentSession(request: {
	runtime: SubagentRuntime;
	definition: AgentDefinition;
	task: string;
	model: Model<Api>;
	thinkingLevel: ThinkingLevel;
	signal?: AbortSignal;
	maxTurns?: number;
	resumeSessionFile?: string;
}): Promise<SubagentHandle> {
	const { runtime, definition, task, model, thinkingLevel, signal, maxTurns, resumeSessionFile } = request;
	const agentDir = getAgentDir();
	const replaceMode = definition.promptMode === "replace";

	// `replace`: the definition body is the whole prompt and project context files stay out.
	// `append`: the default prompt (context files included) is kept and the body is appended.
	const resourceLoader = new DefaultResourceLoader({
		cwd: runtime.cwd,
		agentDir,
		settingsManager: runtime.settingsManager,
		noExtensions: true,
		noSkills: replaceMode,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: replaceMode,
		systemPrompt: replaceMode && definition.systemPrompt ? definition.systemPrompt : undefined,
		appendSystemPrompt: !replaceMode && definition.systemPrompt ? [definition.systemPrompt] : undefined,
	});
	await resourceLoader.reload();

	// Persisted parents give the child its own session file, linked to the parent so it
	// nests under it in /resume. In-memory parents keep children in memory. A resume
	// continues the finished child's own file.
	const parentSessionManager = runtime.sessionManager;
	const sessionManager = resumeSessionFile
		? SessionManager.open(resumeSessionFile)
		: parentSessionManager.isPersisted()
			? SessionManager.create(runtime.cwd, parentSessionManager.getSessionDir(), {
					parentSession: parentSessionManager.getSessionFile(),
				})
			: SessionManager.inMemory(runtime.cwd);

	const { session } = await createAgentSession({
		cwd: runtime.cwd,
		agentDir,
		modelRuntime: runtime.modelRuntime,
		settingsManager: runtime.settingsManager,
		sessionManager,
		resourceLoader,
		model,
		thinkingLevel,
		tools: definition.tools ? [...definition.tools] : [...ASSIGNABLE_TOOL_NAMES],
	});

	let abortRequested = false;
	const handleAbort = () => {
		abortRequested = true;
		session.abort();
	};
	if (signal) {
		if (signal.aborted) handleAbort();
		else signal.addEventListener("abort", handleAbort);
	}

	// Graceful turn limit: count this run's assistant turns (a resume starts fresh),
	// warn at the limit, abort after the grace period.
	let turnAbort = false;
	if (maxTurns !== undefined && maxTurns > 0) {
		let assistantTurns = 0;
		let warned = false;
		session.subscribe((event) => {
			if (event.type !== "message_end" || event.message.role !== "assistant") return;
			assistantTurns++;
			if (!warned && assistantTurns >= maxTurns) {
				warned = true;
				void session.steer(WRAP_UP_MESSAGE, undefined, { source: "extension" }).catch(() => {});
			} else if (warned && assistantTurns >= maxTurns + GRACE_TURNS) {
				turnAbort = true;
				void session.abort();
			}
		});
	}

	let runError: unknown;
	const done = session
		.prompt(task, { expandPromptTemplates: false })
		.catch((error) => {
			runError = error;
		})
		.finally(() => {
			signal?.removeEventListener("abort", handleAbort);
		})
		.then(async () => {
			try {
				return await collectResult({ session, sessionManager, model, abortRequested, turnAbort, runError });
			} finally {
				session.dispose();
			}
		});

	return {
		session,
		sessionManager,
		done,
		abort: handleAbort,
	};
}

function collectResult(input: {
	session: AgentSession;
	sessionManager: SessionManager;
	model: Model<Api>;
	abortRequested: boolean;
	turnAbort: boolean;
	runError: unknown;
}): SubagentRunResult {
	const { session, sessionManager, model, abortRequested, turnAbort, runError } = input;
	const usage: SubagentRunUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	let turns = 0;
	let lastAssistant: AssistantMessage | undefined;
	for (const message of session.messages) {
		if (message.role !== "assistant") continue;
		turns++;
		lastAssistant = message;
		usage.input += message.usage.input;
		usage.output += message.usage.output;
		usage.cacheRead += message.usage.cacheRead;
		usage.cacheWrite += message.usage.cacheWrite;
		usage.cost += message.usage.cost.total;
	}

	const text = assistantText(lastAssistant);
	const run = {
		sessionId: sessionManager.getSessionId(),
		sessionFile: sessionManager.getSessionFile(),
		turns,
		usage,
		model: `${model.provider}/${model.id}`,
	};
	if (abortRequested || turnAbort) {
		const note = turnAbort ? "(stopped: turn limit exceeded)" : "(stopped before finishing)";
		return {
			...run,
			status: "stopped",
			text: text ? `${text}\n\n${note}` : note,
		};
	}
	if (runError) {
		return {
			...run,
			status: "error",
			text: `Subagent failed: ${runError instanceof Error ? runError.message : String(runError)}`,
		};
	}
	if (lastAssistant?.stopReason === "error") {
		return {
			...run,
			status: "error",
			text: `Subagent failed: ${lastAssistant.errorMessage || text || "unknown error"}`,
		};
	}
	return { ...run, status: "completed", text: text || "(the subagent finished without a text answer)" };
}

function assistantText(message: AssistantMessage | undefined): string {
	if (!message) return "";
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}
