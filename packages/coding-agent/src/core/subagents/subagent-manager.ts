/**
 * The subagent manager: one per parent session. Tracks every subagent run,
 * queues background spawns behind a concurrency limit, lets the model steer or
 * stop running children, and delivers background completions to the parent as
 * follow-up messages at its next boundary.
 */

import type { ThinkingLevel } from "@hyzek/toucan-agent-core";
import type { Api, Model } from "@hyzek/toucan-ai";
import type { AgentSession } from "../agent-session.ts";
import type { AgentDefinition } from "./agent-registry.ts";
import type { SubagentHandle, SubagentRunResult, SubagentRunStatus, SubagentRunUsage } from "./subagent-runner.ts";
import { type SubagentRuntime, startSubagentSession } from "./subagent-runner.ts";

export type SubagentRecordStatus = "queued" | "running" | SubagentRunStatus;

export interface SubagentRecord {
	id: string;
	/** The agent type name. */
	agent: string;
	description?: string;
	background: boolean;
	status: SubagentRecordStatus;
	/** The task the agent was given (shown by the command center). */
	task: string;
	sessionId?: string;
	sessionFile?: string;
	/** `provider/modelId` the run used, once started. */
	model?: string;
	turns: number;
	usage: SubagentRunUsage;
	/** The final answer, or the error text, once settled. */
	result?: string;
	startedAt: number;
	finishedAt?: number;
	/** Agent id whose session this run resumed, when it did. */
	resumedFrom?: string;
}

export interface SpawnRequest {
	definition: AgentDefinition;
	task: string;
	description?: string;
	background: boolean;
	model: Model<Api>;
	thinkingLevel: ThinkingLevel;
	/** Foreground runs pass the tool call's signal so Esc stops the child. Background runs take none. */
	signal?: AbortSignal;
	/** Turn budget for this run; the definition's own limit wins when set. */
	maxTurns?: number;
	/** Session file of a finished child to continue instead of starting fresh. */
	resumeSessionFile?: string;
	/** Agent id this run resumes from, for display. */
	resumeOf?: string;
}

export interface SubagentManagerDeps {
	/** Parent session services, read at call time. */
	runtime: () => SubagentRuntime;
	/** Concurrency limit for background runs, read per start decision. */
	maxConcurrent: () => number;
	/** Deliver a completion note to the parent: queued as follow-up while it runs, a new turn when idle. */
	notifyParent: (text: string) => Promise<void>;
}

const EMPTY_USAGE: SubagentRunUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

/** How long completions wait for siblings before the batch is delivered to the parent. */
const NOTIFICATION_BATCH_MS = 300;

/** Result text beyond this length is truncated in the parent's completion note; `status` returns the full text. */
const NOTIFICATION_RESULT_CHARS = 2000;

/** Tracks and runs the subagents of one parent session. */
export class SubagentManager {
	private records = new Map<string, SubagentRecord>();
	private spawnRequests = new Map<string, SpawnRequest>();
	private handles = new Map<string, SubagentHandle>();
	private completions = new Map<
		string,
		{ promise: Promise<SubagentRecord>; settle: (record: SubagentRecord) => void }
	>();
	private running = 0;
	private nextId = 1;
	private pendingNotes: SubagentRecord[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | undefined;
	private listeners = new Set<() => void>();
	/** Parent agent-turn counters; kept so notes lost to a turn boundary can be re-offered. */
	/** Notes handed to the parent, awaiting the user message that delivers them. */
	private ackedNotes: { record: SubagentRecord; text: string }[] = [];
	private deps: SubagentManagerDeps;

	constructor(deps: SubagentManagerDeps) {
		this.deps = deps;
	}

	/** Parent session services. */
	runtime(): SubagentRuntime {
		return this.deps.runtime();
	}

	/**
	 * Subscribe to record changes (spawn, start, settle, stop). Listeners read fresh
	 * state via `list`/`get`; the callback carries no payload. Returns the unsubscribe.
	 */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** The live child session of a running agent, for UIs that read its transcript. */
	liveSession(id: string): AgentSession | undefined {
		return this.handles.get(id)?.session;
	}

	/** All records, oldest spawn first. */
	list(): SubagentRecord[] {
		return [...this.records.values()];
	}

	/** The record for one agent id. */
	get(id: string): SubagentRecord | undefined {
		return this.records.get(id);
	}

	/** Resolves with the settled record when the agent finishes. */
	async waitFor(id: string): Promise<SubagentRecord> {
		const completion = this.completions.get(id);
		if (completion) return completion.promise;
		const record = this.records.get(id);
		if (!record) throw new Error(`Unknown subagent id "${id}".`);
		return record;
	}

	/**
	 * Start an agent run without waiting for it. Background spawns queue behind the
	 * concurrency limit; foreground spawns always start at once.
	 */
	spawn(request: SpawnRequest): SubagentRecord {
		const id = `agent-${(this.nextId++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
		const record: SubagentRecord = {
			id,
			agent: request.definition.name,
			description: request.description,
			task: request.task,
			background: request.background,
			status: "queued",
			turns: 0,
			usage: { ...EMPTY_USAGE },
			startedAt: Date.now(),
			resumedFrom: request.resumeOf,
		};
		this.records.set(id, record);
		this.spawnRequests.set(id, request);
		let settle!: (record: SubagentRecord) => void;
		const promise = new Promise<SubagentRecord>((resolve) => {
			settle = resolve;
		});
		this.completions.set(id, { promise, settle });
		void this.start(record);
		this.emitChange();
		return record;
	}

	/** Steer a running agent by injecting a user message into its conversation. */
	async steer(id: string, message: string): Promise<void> {
		const record = this.records.get(id);
		if (!record) throw new Error(`Unknown subagent id "${id}".`);
		if (record.status !== "running") {
			throw new Error(`Subagent ${id} is ${record.status}; only running agents can be steered.`);
		}
		const handle = this.handles.get(id);
		if (!handle) throw new Error(`Subagent ${id} has no live session to steer.`);
		await handle.session.steer(message, undefined, { source: "extension" });
	}

	/** Request that a running or queued agent stop. */
	stop(id: string): void {
		const record = this.records.get(id);
		if (!record) throw new Error(`Unknown subagent id "${id}".`);
		if (record.status === "queued") {
			record.status = "stopped";
			record.finishedAt = Date.now();
			this.settleCompletion(record);
			if (record.background) this.noteCompletion(record);
			this.emitChange();
			return;
		}
		if (record.status === "running") {
			this.handles.get(id)?.abort();
			return;
		}
		throw new Error(`Subagent ${id} is already ${record.status}.`);
	}

	/** Stop every running child and drop pending notifications. Called when the parent session dies. */
	stopAll(): void {
		if (this.flushTimer !== undefined) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		this.pendingNotes = [];
		for (const [id, record] of this.records) {
			if (record.status === "running") this.handles.get(id)?.abort();
			else if (record.status === "queued") this.stop(id);
		}
	}

	private async start(record: SubagentRecord): Promise<void> {
		if (record.status !== "queued") return;
		if (record.background && this.running >= Math.max(1, this.deps.maxConcurrent())) return;

		const request = this.spawnRequests.get(record.id);
		if (!request) return;

		this.running++;
		record.status = "running";
		record.model = `${request.model.provider}/${request.model.id}`;
		this.emitChange();
		let result: SubagentRunResult | undefined;
		let failure: string | undefined;
		try {
			const handle = await startSubagentSession({
				runtime: this.deps.runtime(),
				definition: request.definition,
				task: request.task,
				model: request.model,
				thinkingLevel: request.thinkingLevel,
				signal: request.signal,
				maxTurns: request.definition.maxTurns ?? request.maxTurns,
				resumeSessionFile: request.resumeSessionFile,
			});
			this.handles.set(record.id, handle);
			result = await handle.done;
			this.handles.delete(record.id);
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			this.running--;
		}

		record.finishedAt = Date.now();
		record.turns = result?.turns ?? 0;
		record.usage = result?.usage ?? record.usage;
		record.sessionId = result?.sessionId;
		record.sessionFile = result?.sessionFile;
		if (failure) {
			record.status = "error";
			record.result = failure;
		} else if (result) {
			record.status = result.status;
			record.result = result.text;
		} else {
			record.status = "error";
			record.result = "Subagent failed: no result";
		}
		this.spawnRequests.delete(record.id);
		this.settleCompletion(record);
		if (record.background) this.noteCompletion(record);
		this.emitChange();
		this.drainQueue();
	}

	private drainQueue(): void {
		for (const record of this.records.values()) {
			if (record.status === "queued" && this.spawnRequests.has(record.id)) {
				void this.start(record);
			}
		}
	}

	private emitChange(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				// A UI listener must not break the run that settled.
			}
		}
	}

	private settleCompletion(record: SubagentRecord): void {
		const completion = this.completions.get(record.id);
		if (completion) {
			completion.settle(record);
			this.completions.delete(record.id);
		}
	}

	private noteCompletion(record: SubagentRecord): void {
		this.pendingNotes.push(record);
		if (this.flushTimer !== undefined) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined;
			void this.flushNotes();
		}, NOTIFICATION_BATCH_MS);
	}

	private async flushNotes(): Promise<void> {
		const notes = this.pendingNotes;
		this.pendingNotes = [];
		if (notes.length === 0) return;
		// Record the turn the note is offered into: if that turn ends without the
		// parent having read it, the same batch is offered again next boundary.
		const text = formatCompletionNotes(notes);
		try {
			await this.deps.notifyParent(text);
			// Acked: in the queue or the transcript, awaiting delivery (a user
			// message start) before the next turn boundary.
			this.ackedNotes.push(...notes.map((record) => ({ record, text })));
		} catch {
			// The parent session is gone (replaced or disposed mid-flush); re-queue the batch.
			this.pendingNotes.unshift(...notes);
		}
	}

	/**
	 * Observe parent session events. A queued completion note is consumed when its
	 * message is delivered (a user message start carrying the note text); if a turn
	 * ends while acked notes were never delivered, the batch is re-offered so the
	 * parent cannot lose completions to an abandoned turn.
	 */
	noteParentActivity(event: { type: string; message?: { role?: string; content?: unknown } }): void {
		if (event.type === "message_start" && event.message?.role === "user") {
			const text = userText(event.message.content);
			if (!text) return;
			for (let i = this.ackedNotes.length - 1; i >= 0; i--) {
				const ack = this.ackedNotes[i];
				if (ack && (text === ack.text || text.includes(ack.text))) this.ackedNotes.splice(i, 1);
			}
			return;
		}
		if (event.type !== "agent_end") return;
		if (this.ackedNotes.length > 0) {
			// The turn ended before these notes were delivered; offer them again.
			this.pendingNotes.unshift(...this.ackedNotes.map((ack) => ack.record));
			this.ackedNotes = [];
		}
		if (this.pendingNotes.length > 0 && this.flushTimer === undefined) void this.flushNotes();
	}
}

function formatCompletionNotes(notes: SubagentRecord[]): string {
	const lines = [
		"<subagent-results>",
		`${notes.length} background subagent${notes.length === 1 ? "" : "s"} finished. Summarize what matters for the current work.`,
	];
	for (const note of notes) {
		const stats = `${note.turns} turns, ${formatTokens(totalTokens(note.usage))} tokens, ${note.model ?? "unknown model"}`;
		lines.push("", `${note.status}: ${note.agent} (${note.id}; ${stats})`);
		const result = note.result ?? "(no result)";
		if (result.length > NOTIFICATION_RESULT_CHARS) {
			lines.push(
				result.slice(0, NOTIFICATION_RESULT_CHARS),
				`... (use subagent action "status" with agent_id "${note.id}" for the full answer)`,
			);
		} else {
			lines.push(result);
		}
	}
	lines.push("</subagent-results>");
	return lines.join("\n");
}

/** Plain text of a user message's content, for note-delivery matching. */
function userText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) =>
				part && typeof part === "object" && "type" in part && (part as { type: string }).type === "text"
					? String((part as { text?: string }).text ?? "")
					: "",
			)
			.join("\n");
	}
	return "";
}

function totalTokens(usage: SubagentRunUsage): number {
	return usage.input + usage.output + usage.cacheWrite;
}

function formatTokens(count: number): string {
	return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}
