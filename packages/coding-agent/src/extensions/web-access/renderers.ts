/**
 * Toucan-style rows for the tools pi-web-access registers.
 *
 * The package ships Pi renderers that paint a block-character progress bar while a request runs.
 * Toucan rows are marker-led and use the same guide as the built-in tools; a request in flight says
 * `Searching…` or `Fetching…` and never draws a bar. The call line carries the duration.
 *
 * The detail shapes below belong to the external package, so they are read structurally and only the
 * fields these rows display are named.
 */

import { Container, Text } from "@hyzek/toucan-tui";
import type { ToolDefinition, ToolRenderContext, ToolRenderResultOptions } from "../../core/extensions/types.ts";
import {
	getTextOutput,
	startToolTimer,
	summarizeText,
	toolDurationText,
	toolRowCallLine,
} from "../../core/tools/render-utils.ts";
import { ToolBranchBlock } from "../../modes/interactive/components/tool-branch.ts";
import { ToolCallLine } from "../../modes/interactive/components/tool-call-line.ts";
import { VisualLinePreview } from "../../modes/interactive/components/visual-truncate.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";

export type WebToolKind = "search" | "fetch" | "content" | "source-check" | "enable";

interface WebArgs {
	query?: string;
	queries?: string[];
	url?: string;
	urls?: string[];
	responseId?: string;
	queryIndex?: number;
	urlIndex?: number;
	offset?: number;
	findText?: string | string[];
	claim?: string;
	mode?: string;
	prompt?: string;
	timestamp?: string;
	frames?: number;
	model?: string;
	answerModel?: string;
	auth?: string | boolean;
	numResults?: number;
	includeContent?: boolean;
	fetchContent?: boolean;
	provider?: string;
}

interface WebDetails {
	error?: string;
	phase?: string;
	currentQuery?: string;
	totalResults?: number;
	successfulQueries?: number;
	queryCount?: number;
	curated?: boolean;
	fetchUrls?: string[];
	urlCount?: number;
	successful?: number;
	title?: string;
	totalChars?: number;
	imageCount?: number;
	hasImage?: boolean;
	truncated?: boolean;
	responseId?: string;
	matchCount?: number;
	returnedMatches?: number;
	query?: string;
	resultCount?: number;
	offset?: number;
	returnedChars?: number;
	contentLength?: number;
	nextOffset?: number;
	sourceCount?: number;
	passageCount?: number;
	searchCount?: number;
	unavailable?: string[];
}

const WEB_PREVIEW_LINES = 5;

function strings(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/** The search's queries, including the JSON-array form the package accepts in `query`. */
function queryList(args: WebArgs): string[] {
	const listed = strings(args.queries);
	if (listed.length > 0) return listed;
	const query = typeof args.query === "string" ? args.query.trim() : "";
	if (!query) return [];
	if (query.startsWith("[") && query.endsWith("]")) {
		try {
			const parsed: unknown = JSON.parse(query);
			const fromJson = strings(parsed);
			if (fromJson.length > 0) return fromJson;
		} catch {
			// Not JSON; keep it as one literal query.
		}
	}
	return [query];
}

function urlList(args: WebArgs): string[] {
	const listed = strings(args.urls);
	if (listed.length > 0) return listed;
	const url = typeof args.url === "string" ? args.url.trim() : "";
	return url ? [url] : [];
}

function title(theme: Theme, label: string): string {
	return theme.fg("toolTitle", theme.bold(label));
}

function invalid(theme: Theme): string {
	return theme.fg("error", "[invalid arg]");
}

/** The call line and the optional details shown under it while expanded. */
function callParts(kind: WebToolKind, args: WebArgs, theme: Theme): { main: string; details: string[] } {
	switch (kind) {
		case "search": {
			const queries = queryList(args);
			if (queries.length === 0) return { main: `${title(theme, "Web Search")} ${invalid(theme)}`, details: [] };
			const main =
				queries.length === 1
					? `${title(theme, "Web Search")} ${theme.fg("accent", `"${summarizeText(queries[0], 60)}"`)}`
					: `${title(theme, "Web Search")} ${theme.fg("accent", `${queries.length} queries`)}`;
			const details: string[] = [];
			if (queries.length > 1) {
				details.push(...queries.slice(0, 5).map((query) => theme.fg("accent", `"${query}"`)));
				if (queries.length > 5) details.push(theme.fg("muted", `... and ${queries.length - 5} more`));
			}
			if (args.provider) details.push(theme.fg("muted", `provider: ${args.provider}`));
			if (args.numResults !== undefined) details.push(theme.fg("muted", `results: ${args.numResults}`));
			if (args.includeContent) details.push(theme.fg("muted", "include content"));
			return { main, details };
		}
		case "fetch": {
			const urls = urlList(args);
			if (urls.length === 0) return { main: `${title(theme, "Fetch")} ${invalid(theme)}`, details: [] };
			const main =
				urls.length === 1
					? `${title(theme, "Fetch")} ${theme.fg("accent", urls[0])}`
					: `${title(theme, "Fetch")} ${theme.fg("accent", `${urls.length} URLs`)}`;
			const details = urls.slice(0, 5).map((url) => theme.fg("accent", url));
			if (urls.length > 5) details.push(theme.fg("muted", `... and ${urls.length - 5} more`));
			if (args.mode && args.mode !== "readable") details.push(theme.fg("muted", `mode: ${args.mode}`));
			if (args.prompt) details.push(theme.fg("muted", `prompt: "${summarizeText(args.prompt, 120)}"`));
			if (args.timestamp) details.push(theme.fg("muted", `timestamp: ${args.timestamp}`));
			if (args.frames !== undefined) details.push(theme.fg("muted", `frames: ${args.frames}`));
			if (args.model) details.push(theme.fg("muted", `model: ${args.model}`));
			if (args.answerModel) details.push(theme.fg("muted", `answer model: ${args.answerModel}`));
			if (args.auth !== undefined)
				details.push(theme.fg("muted", `auth: ${args.auth === true ? "true" : args.auth}`));
			return { main, details };
		}
		case "content": {
			const target =
				args.query !== undefined
					? `"${summarizeText(args.query, 50)}"`
					: args.queryIndex !== undefined
						? `query ${args.queryIndex}`
						: args.url !== undefined
							? summarizeText(args.url, 60)
							: args.urlIndex !== undefined
								? `URL ${args.urlIndex}`
								: args.responseId
									? args.responseId.slice(0, 8)
									: "";
			const details: string[] = [];
			if (args.responseId) details.push(theme.fg("muted", `response: ${args.responseId}`));
			if (args.offset !== undefined) details.push(theme.fg("muted", `offset: ${args.offset}`));
			if (args.findText !== undefined) {
				const find = strings(Array.isArray(args.findText) ? args.findText : [args.findText]).length;
				details.push(theme.fg("muted", `find: ${find} ${find === 1 ? "phrase" : "phrases"}`));
			}
			return { main: `${title(theme, "Get Content")} ${theme.fg("accent", target || "...")}`, details };
		}
		case "source-check": {
			const claim = typeof args.claim === "string" ? args.claim.trim() : "";
			const main = claim
				? `${title(theme, "Source Check")} ${theme.fg("accent", `"${summarizeText(claim, 60)}"`)}`
				: `${title(theme, "Source Check")} ${invalid(theme)}`;
			const details: string[] = [];
			const queries = strings(args.queries);
			if (queries.length > 0) details.push(...queries.slice(0, 5).map((query) => theme.fg("muted", query)));
			if (args.numResults !== undefined) details.push(theme.fg("muted", `results: ${args.numResults}`));
			if (args.fetchContent) details.push(theme.fg("muted", "fetch top pages"));
			if (args.provider) details.push(theme.fg("muted", `provider: ${args.provider}`));
			return { main, details };
		}
		case "enable":
			return { main: title(theme, "Web Access"), details: [] };
	}
}

function phaseLabel(details: WebDetails): string {
	switch (details.phase) {
		case "search":
		case "searching":
			return "Searching\u2026";
		case "fetch":
		case "fetching":
			return "Fetching\u2026";
		case "curating":
			return "Waiting for the curator\u2026";
		case "waiting-for-approval":
			return "Waiting for summary approval\u2026";
		case "generating-summary":
			return "Generating summary\u2026";
		case "curator-fallback":
			return "Curator unavailable";
		default:
			return "Working\u2026";
	}
}

/** The status line under the call, without any progress bar. */
function statusText(
	kind: WebToolKind,
	details: WebDetails,
	options: ToolRenderResultOptions,
	theme: Theme,
	context: ToolRenderContext,
): string {
	const hint = theme.fg(
		"muted",
		` (${context.keyHint("app.tools.expand", options.expanded ? "to collapse" : "to expand")})`,
	);
	if (options.isPartial) return theme.fg("muted", phaseLabel(details));
	if (details.error) return `${theme.fg("error", "Failed")}${hint}`;

	switch (kind) {
		case "search": {
			const queries = details.queryCount !== undefined && details.queryCount > 1;
			const count = queries ? `${details.successfulQueries ?? 0}/${details.queryCount} queries, ` : "";
			let line = theme.fg("success", `${count}${details.totalResults ?? 0} sources`);
			if (details.curated)
				line += theme.fg("muted", ` (curated${details.queryCount ? `, ${details.queryCount} queries` : ""})`);
			if (details.fetchUrls?.length) line += theme.fg("muted", ` (fetching ${details.fetchUrls.length} URLs)`);
			return `${line}${hint}`;
		}
		case "fetch": {
			if (details.urlCount === 1) {
				const images = details.imageCount ?? (details.hasImage ? 1 : 0);
				const imageBadge =
					images > 1
						? theme.fg("accent", ` [${images} images]`)
						: images === 1
							? theme.fg("accent", " [image]")
							: "";
				let line =
					theme.fg("success", details.title || "Untitled") +
					theme.fg("muted", ` (${details.totalChars ?? 0} chars)`) +
					imageBadge;
				if (details.truncated) line += theme.fg("warning", " [truncated]");
				return `${line}${hint}`;
			}
			const color = (details.successful ?? 0) > 0 ? "success" : "error";
			return `${theme.fg(color, `${details.successful ?? 0}/${details.urlCount ?? 0} URLs`)}${hint}`;
		}
		case "content": {
			let line: string;
			if (details.matchCount !== undefined) {
				line =
					theme.fg("success", details.title || details.query || "Content") +
					theme.fg("muted", ` (${details.matchCount} matches, ${details.returnedMatches ?? 0} shown)`);
			} else if (details.query) {
				line =
					theme.fg("success", `"${details.query}"`) + theme.fg("muted", ` (${details.resultCount ?? 0} results)`);
			} else {
				const start = details.offset ?? 0;
				const returned = details.returnedChars ?? details.contentLength ?? 0;
				const end = start + returned;
				const range = details.nextOffset !== undefined || start > 0 ? `, showing ${start}-${end}` : "";
				line =
					theme.fg("success", details.title || "Content") +
					theme.fg("muted", ` (${details.contentLength ?? 0} chars${range})`);
			}
			return `${line}${hint}`;
		}
		case "source-check": {
			const parts: string[] = [];
			if (details.sourceCount !== undefined) parts.push(`${details.sourceCount} sources`);
			if (details.passageCount !== undefined) parts.push(`${details.passageCount} passages`);
			if (details.searchCount !== undefined && details.searchCount > 1)
				parts.push(`${details.searchCount} searches`);
			return `${theme.fg("success", parts.join(" \u00b7 ") || "Checked")}${hint}`;
		}
		case "enable": {
			const unavailable = details.unavailable ?? [];
			if (unavailable.length > 0) return `${theme.fg("error", `Unavailable: ${unavailable.join(", ")}`)}${hint}`;
			return `${theme.fg("success", "Enabled")}${hint}`;
		}
	}
}

function firstLine(text: string): string {
	const newline = text.indexOf("\n");
	return newline === -1 ? text : text.slice(0, newline);
}

function renderWebCall(kind: WebToolKind): NonNullable<ToolDefinition<any, any>["renderCall"]> {
	return (args, theme, context) => {
		startToolTimer(context);
		const { main, details } = callParts(kind, args as WebArgs, theme);
		const duration = toolDurationText(context, context.isPartial);
		const component = new Container();
		component.addChild(
			new ToolCallLine(
				toolRowCallLine(main, context, theme),
				duration ? theme.fg("muted", `\u00b7 ${duration}`) : "",
			),
		);
		if (context.expanded && details.length > 0) {
			const block = new ToolBranchBlock({ openEnded: true });
			block.addChild(new Text(details.join("\n"), 0, 0));
			component.addChild(block);
		}
		return component;
	};
}

function renderWebResult(kind: WebToolKind): NonNullable<ToolDefinition<any, any>["renderResult"]> {
	return (result, options, theme, context) => {
		const details = (result.details ?? {}) as WebDetails;
		const text = getTextOutput(
			result as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> },
			context.showImages,
		).trim();
		const block = new ToolBranchBlock();
		block.addChild(new Text(statusText(kind, details, options, theme, context), 0, 0));
		if (options.isPartial) return block;
		if (details.error) {
			if (text) block.addChild(new Text(theme.fg("error", options.expanded ? text : firstLine(text)), 0, 0));
			return block;
		}
		if (text) {
			if (options.expanded) {
				block.addChild(
					new Text(
						text
							.split("\n")
							.map((line) => theme.fg("toolOutput", line))
							.join("\n"),
						0,
						0,
					),
				);
			} else {
				block.addChild(
					new VisualLinePreview({
						text: text
							.split("\n")
							.map((line) => theme.fg("toolOutput", line))
							.join("\n"),
						maxVisualLines: WEB_PREVIEW_LINES,
						keep: "start",
						formatHint: (hidden) => theme.fg("muted", `... (${hidden} more lines)`),
					}),
				);
			}
		}
		return block;
	};
}

const RENDERER_BY_KIND: Record<WebToolKind, Pick<ToolDefinition<any, any>, "renderCall" | "renderResult">> = {
	search: { renderCall: renderWebCall("search"), renderResult: renderWebResult("search") },
	fetch: { renderCall: renderWebCall("fetch"), renderResult: renderWebResult("fetch") },
	content: { renderCall: renderWebCall("content"), renderResult: renderWebResult("content") },
	"source-check": { renderCall: renderWebCall("source-check"), renderResult: renderWebResult("source-check") },
	enable: { renderCall: renderWebCall("enable"), renderResult: renderWebResult("enable") },
};

const KIND_BY_LABEL: Record<string, WebToolKind> = {
	"Web Search": "search",
	"Fetch Content": "fetch",
	"Get Search Content": "content",
	"Source Check": "source-check",
	"Enable Web Access": "enable",
};

const KIND_BY_NAME: Record<string, WebToolKind> = {
	web_search: "search",
	fetch_content: "fetch",
	get_search_content: "content",
	source_check: "source-check",
	web_enable: "enable",
};

/** The Toucan renderers for a tool registered by pi-web-access, matched by label or default name. */
export function webAccessRenderersFor(
	definition: ToolDefinition<any, any>,
): Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> | undefined {
	const kind = KIND_BY_LABEL[definition.label] ?? KIND_BY_NAME[definition.name];
	return kind ? RENDERER_BY_KIND[kind] : undefined;
}
