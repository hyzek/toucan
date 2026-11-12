import { pathToFileURL } from "node:url";
import type { ImageContent, TextContent } from "@hyzek/toucan-ai";
import { getCapabilities, getImageDimensions, hyperlink, imageFallback } from "@hyzek/toucan-tui";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../utils/ansi.ts";
import { resolvePath, shortenHomePath } from "../../utils/paths.ts";
import { sanitizeBinaryOutput } from "../../utils/shell.ts";
import type { ToolRenderContext } from "../extensions/types.ts";
import type { DiffStats } from "./diff-lines.ts";

/** Paths under the session cwd display relative to it; other paths are shortened at the home directory. */
export function shortenPath(path: unknown, cwd = ""): string {
	if (typeof path !== "string") return "";
	const root = cwd.replace(/\/+$/, "");
	if (root && (path === root || path.startsWith(`${root}/`))) return path.slice(root.length + 1) || ".";
	return shortenHomePath(path);
}

export function linkPath(styledText: string, rawPath: string, cwd: string): string {
	if (!getCapabilities().hyperlinks) return styledText;
	const absolutePath = resolvePath(rawPath, cwd);
	return hyperlink(styledText, pathToFileURL(absolutePath).href);
}

export function str(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (value == null) return "";
	return null;
}

function parseLineNumber(value: unknown): number | undefined {
	if (typeof value === "string" && value.trim() !== "") value = Number(value);
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Format finite numbers or numeric strings as a read line range, omitting malformed ranges. */
export function formatReadLineRange(offset: unknown, limit: unknown): string {
	// Strict schemas represent omitted optional arguments as null.
	if (offset == null && limit == null) return "";
	const start = offset == null ? 1 : parseLineNumber(offset);
	if (start === undefined) return "";
	if (limit == null) return `:${start}`;
	const count = parseLineNumber(limit);
	if (count === undefined) return "";
	const end = start + count - 1;
	return `:${start}${end ? `-${end}` : ""}`;
}

export function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

export function normalizeDisplayText(text: string): string {
	return text.replace(/\r/g, "");
}

/** The line a shell tool shows when the command printed nothing. Renderers hide it when a diff follows. */
export const SHELL_EMPTY_OUTPUT = "(no output)";

export function getTextOutput(
	result: { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> } | undefined,
	showImages: boolean,
): string {
	if (!result) return "";

	const textBlocks = result.content.filter((c) => c.type === "text");
	const imageBlocks = result.content.filter((c) => c.type === "image");

	let output = textBlocks.map((c) => sanitizeBinaryOutput(stripAnsi(c.text || "")).replace(/\r/g, "")).join("\n");

	const caps = getCapabilities();
	if (imageBlocks.length > 0 && (!caps.images || !showImages)) {
		const imageIndicators = imageBlocks
			.map((img) => {
				const mimeType = img.mimeType ?? "image/unknown";
				const dims =
					img.data && img.mimeType ? (getImageDimensions(img.data, img.mimeType) ?? undefined) : undefined;
				return imageFallback(mimeType, dims);
			})
			.join("\n");
		output = output ? `${output}\n${imageIndicators}` : imageIndicators;
	}

	return output;
}

export type ToolRenderResultLike<TDetails> = {
	content: (TextContent | ImageContent)[];
	details: TDetails;
};

const COLLAPSED_ARGS_CHARS = 100;

/** Drops the `[notice]` block a search/list tool appends when the detail it carries is shown separately. */
export function stripTrailingNotice(output: string): string {
	const index = output.lastIndexOf("\n\n[");
	if (index === -1) return output;
	return output.slice(index).trimEnd().endsWith("]") ? output.slice(0, index) : output;
}

/** A single-line, length-capped form of a value such as a search pattern. */
export function summarizeText(text: string, max = 40): string {
	const oneLine = text.replace(/\n/g, " ").trim();
	if (oneLine.length <= max) return oneLine;
	return `${oneLine.slice(0, Math.max(0, max - 3))}...`;
}

/**
 * Generic tool call header: the title followed by the arguments. Collapsed, they are `key=value`
 * pairs on the title line, cut to {@link COLLAPSED_ARGS_CHARS}. Expanded, each is a `key: value`
 * line below the title, with strings shown raw and continuation lines indented.
 */
export function formatToolCallWithArgs(title: string, args: unknown, theme: Theme, expanded: boolean): string {
	const header = theme.fg("toolTitle", theme.bold(title));
	if (args == null) return header;
	const entries =
		typeof args === "object" && !Array.isArray(args)
			? Object.entries(args)
			: ([["args", args]] as [string, unknown][]);
	if (entries.length === 0) return header;
	if (expanded) {
		const lines = entries.map(([key, value]) => {
			const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
			return `  ${key}: ${replaceTabs(text).replace(/\r/g, "").split("\n").join("\n    ")}`;
		});
		return `${header}\n${theme.fg("muted", lines.join("\n"))}`;
	}
	const pairs = entries.map(([key, value]) => `${key}=${JSON.stringify(value) ?? String(value)}`).join(" ");
	const preview = pairs.length > COLLAPSED_ARGS_CHARS ? `${pairs.slice(0, COLLAPSED_ARGS_CHARS - 3)}...` : pairs;
	return `${header} ${theme.fg("muted", preview)}`;
}

/** Duration as `4.2s` below a minute, then `1m 30s` and `2h 3m 4s`. */
export function formatToolDuration(ms: number): string {
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;

	const totalSeconds = Math.floor(seconds);
	const minutes = Math.floor(totalSeconds / 60);
	const remainder = totalSeconds % 60;
	if (minutes < 60) return `${minutes}m ${remainder}s`;

	return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

/** Renderer state of {@link startToolTimer} and {@link toolTimerText}, kept in `ToolRenderContext.state`. */
interface ToolTimerState {
	startedAt?: number;
	endedAt?: number;
	interval?: ReturnType<typeof setInterval>;
}

/** Start the row's clock once execution starts. Call from `renderCall`. */
export function startToolTimer(context: ToolRenderContext<ToolTimerState>): void {
	const state = context.state;
	if (context.executionStarted && state.startedAt === undefined) {
		state.startedAt = Date.now();
		state.endedAt = undefined;
	}
}

/**
 * The row's elapsed time, as `4.2s`, redrawn every second while the result is partial and frozen once
 * it is final. Undefined when the row has no start time and no recorded duration. A final result's
 * recorded duration wins: it is monotonic and survives reloads.
 */
export function toolDurationText(context: ToolRenderContext<ToolTimerState>, isPartial: boolean): string | undefined {
	const state = context.state;
	if (state.startedAt !== undefined && isPartial && !state.interval) {
		state.interval = setInterval(() => context.invalidate(), 1000);
	}
	if (!isPartial || context.isError) {
		state.endedAt ??= Date.now();
		if (state.interval) {
			clearInterval(state.interval);
			state.interval = undefined;
		}
	}
	if (!isPartial && context.durationMs !== undefined) return formatToolDuration(context.durationMs);
	if (state.startedAt === undefined) return undefined;
	return formatToolDuration((state.endedAt ?? Date.now()) - state.startedAt);
}

/** The row's timing line: `Elapsed 4.2s` while partial, `Took 4.2s` once final. */
export function toolTimerText(context: ToolRenderContext<ToolTimerState>, isPartial: boolean): string | undefined {
	const duration = toolDurationText(context, isPartial);
	if (duration === undefined) return undefined;
	return `${isPartial ? "Elapsed" : "Took"} ${duration}`;
}

export function invalidArgText(theme: Theme): string {
	return theme.fg("error", "[invalid arg]");
}

/**
 * What a change did, as `+5 -4` in the diff's colours, or `no change` when it moved nothing.
 */
export function diffCountsText(added: number, removed: number, theme: Theme): string {
	const parts: string[] = [];
	if (added > 0) parts.push(theme.fg("toolDiffAdded", `+${added}`));
	if (removed > 0) parts.push(theme.fg("toolDiffRemoved", `-${removed}`));
	return parts.length > 0 ? parts.join(" ") : theme.fg("muted", "no change");
}

/** Where a change starts, as `at line 6`; empty when the diff carries no line number. */
export function diffLineText(line: number, theme: Theme): string {
	return line > 0 ? ` ${theme.fg("muted", `at line ${line}`)}` : "";
}

/**
 * How a change is divided, as `· 2 hunks (11 diff lines)`; empty for the single hunk a reader can count
 * on one screen.
 */
export function diffHunkText(stats: DiffStats, theme: Theme): string {
	if (stats.hunks.length <= 1) return "";
	return ` ${theme.fg("muted", `· ${stats.hunks.length} hunks (${stats.lines} diff lines)`)}`;
}

/** State a tool row shows in its leading marker. */
export type ToolRowStatus = "pending" | "done" | "failed";
/**
 * The glyph that leads a tool row.
 *
 * `•` (U+2022). Measured at 14px in Menlo, SF Mono and JetBrains Mono it draws a 4-6px spot
 * (12-32 ink pixels) against the 9px of `●` (U+25CF, 59-63). Nothing sits between them: `∙`, `·`
 * and `◦` are smaller, `◉` and `⬤` are at `●` or missing, and the one medium option, the ring
 * `○` (U+25CB), is absent from Monaco and `⊙` from SF Mono. The bullet is the only marker every
 * mono font on macOS has, so it wins on staying visible rather than on weight.
 */
export const TOOL_ROW_MARKER = "\u2022";

/** The inputs a row renderer needs to draw the call line: state and whether the marker shows. */
export interface ToolRowContext {
	isPartial: boolean;
	isError: boolean;
	/** Defaults to shown; a collapsed tool group turns it off for its members. */
	rowMarkerShown?: boolean;
}

/** The row's state, from the render context: no final result yet, done, or failed. */
export function getToolRowStatus(context: ToolRowContext): ToolRowStatus {
	if (context.isError) return "failed";
	return context.isPartial ? "pending" : "done";
}

/**
 * A tool row's call line: the state marker, then the header the renderer built.
 *
 * Tool rows have no background, so the marker carries the state: dim while the call streams or runs,
 * green once a final result lands, red when it fails. A row inside a collapsed tool group sets
 * `rowMarkerShown: false`: the group leads with one marker instead of one per member.
 */
export function toolRowCallLine(header: string, context: ToolRowContext, theme: Theme): string {
	if (context.rowMarkerShown === false) return header;
	const status = getToolRowStatus(context);
	const token = status === "failed" ? "error" : status === "done" ? "success" : "dim";
	return `${theme.fg(token, TOOL_ROW_MARKER)} ${header}`;
}

export function renderToolPath(
	rawPath: string | null,
	theme: Theme,
	cwd: string,
	options?: { emptyFallback?: string },
): string {
	if (rawPath === null) return invalidArgText(theme);
	const value = rawPath || options?.emptyFallback;
	if (!value) return theme.fg("toolOutput", "...");
	return linkPath(theme.fg("accent", shortenPath(value, cwd)), value, cwd);
}
