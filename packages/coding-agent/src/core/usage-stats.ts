/**
 * Token usage aggregated across stored sessions.
 *
 * `/stats` asks what this machine and this project have spent. The answers live in the session
 * JSONL files: every assistant message and every usage entry (cache warmups and the like) carries
 * its provider, model and cost, and each entry has a timestamp that places it on a calendar day.
 * A file that cannot be read or a line that cannot be parsed is skipped rather than failing the
 * whole report, mirroring how session discovery treats corrupt sessions.
 */

import { readFile } from "node:fs/promises";
import type { Usage } from "@hyzek/toucan-ai";

export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface ModelUsage extends UsageTotals {
	/** `provider/model` as recorded on the entry. */
	model: string;
}

export interface DayUsage {
	/** Local calendar day, `YYYY-MM-DD`. */
	day: string;
	tokens: number;
	cost: number;
}

export interface UsageReport {
	/** Session files that took part in the aggregation. */
	sessions: number;
	totals: UsageTotals;
	/** One entry per requested day, oldest first; days without usage are zero. */
	byDay: DayUsage[];
	/** Models with recorded usage, most expensive first. */
	byModel: ModelUsage[];
}

/** A local calendar-day key for a date. */
export function dayKey(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/** The last `count` local calendar days ending today, oldest first. */
export function recentDayKeys(count: number, now = new Date()): string[] {
	const days: string[] = [];
	for (let back = count - 1; back >= 0; back--) {
		const date = new Date(now);
		date.setDate(date.getDate() - back);
		days.push(dayKey(date));
	}
	return days;
}

/** Total tokens across the four usage buckets. */
export function totalTokens(totals: UsageTotals): number {
	return totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
}

/**
 * Aggregate the usage recorded in the given session files into totals, per-day and per-model sums.
 * `days` fixes which calendar days the report tracks; entries outside them count toward totals only.
 */
export async function collectUsageReport(sessionFiles: string[], days: readonly string[]): Promise<UsageReport> {
	const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	const dayTotals = new Map<string, DayUsage>(days.map((day) => [day, { day, tokens: 0, cost: 0 }]));
	const modelTotals = new Map<string, UsageTotals>();

	for (const file of sessionFiles) {
		let content: string;
		try {
			content = await readFile(file, "utf8");
		} catch {
			continue;
		}
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			let entry: unknown;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			takeEntry(entry, totals, dayTotals, modelTotals);
		}
	}

	const byModel = [...modelTotals.entries()]
		.map(([model, sums]) => ({ model, ...sums }))
		.sort((a, b) => b.cost - a.cost || totalTokens(b) - totalTokens(a));

	return {
		sessions: sessionFiles.length,
		totals,
		byDay: days.map((day) => dayTotals.get(day) ?? { day, tokens: 0, cost: 0 }),
		byModel,
	};
}

interface UsageBearingMessage {
	type: "message";
	timestamp?: string;
	message?: {
		role?: string;
		usage?: Usage;
		provider?: string;
		model?: string;
		responseModel?: string;
	};
}

interface UsageBearingEntry {
	type: "usage";
	timestamp?: string;
	provider?: string;
	model?: string;
	usage?: Usage;
}

interface UsageCarryingEntry {
	type: "compaction" | "branch_summary";
	timestamp?: string;
	usage?: Usage;
}

/** Add one parsed session entry to the running sums, if it carries usage at all. */
function takeEntry(
	entry: unknown,
	totals: UsageTotals,
	dayTotals: Map<string, DayUsage>,
	modelTotals: Map<string, UsageTotals>,
): void {
	if (typeof entry !== "object" || entry === null || typeof (entry as { type?: unknown }).type !== "string") return;
	const kind = (entry as { type: string }).type;
	if (kind === "message") {
		const record = entry as UsageBearingMessage;
		const message = record.message;
		if (!message?.usage) return;
		if (message.role === "assistant") {
			addUsage(totals, message.usage, record.timestamp, dayTotals);
			if (message.provider && message.model) {
				addModelUsage(modelTotals, `${message.provider}/${message.responseModel ?? message.model}`, message.usage);
			}
			return;
		}
		if (message.role === "toolResult") {
			addUsage(totals, message.usage, record.timestamp, dayTotals);
			addModelUsage(modelTotals, "Tools/summaries", message.usage);
		}
		return;
	}
	if (kind === "usage") {
		const record = entry as UsageBearingEntry;
		if (!record.usage) return;
		addUsage(totals, record.usage, record.timestamp, dayTotals);
		if (record.provider && record.model) {
			addModelUsage(modelTotals, `${record.provider}/${record.model}`, record.usage);
		}
		return;
	}
	if (kind === "compaction" || kind === "branch_summary") {
		const record = entry as UsageCarryingEntry;
		if (!record.usage) return;
		addUsage(totals, record.usage, record.timestamp, dayTotals);
		addModelUsage(modelTotals, "Tools/summaries", record.usage);
	}
}

function addUsage(
	totals: UsageTotals,
	usage: Usage,
	timestamp: string | undefined,
	dayTotals: Map<string, DayUsage>,
): void {
	addTotals(totals, usage);
	if (!timestamp) return;
	const day = dayTotals.get(dayKey(new Date(timestamp)));
	if (!day) return;
	day.tokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	day.cost += usage.cost?.total ?? 0;
}

function addModelUsage(modelTotals: Map<string, UsageTotals>, model: string, usage: Usage): void {
	let sums = modelTotals.get(model);
	if (!sums) {
		sums = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
		modelTotals.set(model, sums);
	}
	addTotals(sums, usage);
}

function addTotals(totals: UsageTotals, usage: Usage): void {
	totals.input += usage.input ?? 0;
	totals.output += usage.output ?? 0;
	totals.cacheRead += usage.cacheRead ?? 0;
	totals.cacheWrite += usage.cacheWrite ?? 0;
	totals.cost += usage.cost?.total ?? 0;
}
