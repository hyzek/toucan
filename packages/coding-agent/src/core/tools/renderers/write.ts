/**
 * Presentation for the write tool.
 *
 * Renderers live apart from the implementation so a process that only displays tool output does not
 * load the execution path or its typebox parameter schema. `write.ts` spreads these into its
 * definition, so the tool's public shape is unchanged.
 *
 * The row names the file, and a block under it says what the write did: the diff against the file's
 * previous content (all added lines for a new file), `✓ no changes` when the write left the file as
 * it was, or `Written` when the file cannot be diffed. While the call is still running, the row
 * previews the content instead, so the write can be watched as it arrives. A file that did not exist
 * is labelled `Create` before the result arrives.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Container, Text } from "@hyzek/toucan-tui";
import { COLLAPSED_DIFF_ROWS, type DiffComponent } from "../../../modes/interactive/components/diff.ts";
import { keyHint } from "../../../modes/interactive/components/keybinding-hints.ts";
import { ToolBranchBlock } from "../../../modes/interactive/components/tool-branch.ts";
import {
	CodeHighlighter,
	getLanguageFromPath,
	highlightCode,
	type Theme,
} from "../../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../../extensions/types.ts";
import { normalizeDisplayText, renderToolPath, replaceTabs, str, toolRowCallLine } from "../render-utils.ts";
import type { WriteToolDetails } from "../write.ts";
import { createChangeBlock } from "./change-block.ts";

type WriteHighlightCache = {
	rawPath: string | null;
	lang: string;
	rawContent: string;
	normalizedLines: string[];
	highlightedLines: string[];
};
class WriteCallRenderComponent extends Text {
	// Whether the file did not exist before the write; the header says Create instead of Write.
	created?: boolean;
	// Line by line highlighting of a call whose content is still streaming.
	cache?: WriteHighlightCache;
	// A streamed call highlights its first lines on every delta, which stop changing once the file is longer, and a
	// complete call highlights the whole file on every update and expand toggle. Either way the row reuses the last
	// highlighting; it also holds the only copy of a complete call's displayed source.
	readonly highlighter = new CodeHighlighter();

	constructor() {
		super("", 0, 0);
	}
}
/** The result component, kept between renders so the diff keeps its syntax cache. */
type WriteResultComponent = Container & { diffView?: DiffComponent };
const WRITE_PARTIAL_FULL_HIGHLIGHT_LINES = 50;
function highlightSingleLine(line: string, lang: string): string {
	const highlighted = highlightCode(line, lang);
	return highlighted[0] ?? "";
}
function refreshWriteHighlightPrefix(cache: WriteHighlightCache, highlighter: CodeHighlighter): void {
	const prefixCount = Math.min(WRITE_PARTIAL_FULL_HIGHLIGHT_LINES, cache.normalizedLines.length);
	if (prefixCount === 0) return;
	const prefixSource = cache.normalizedLines.slice(0, prefixCount).join("\n");
	const prefixHighlighted = highlighter.highlight(prefixSource, cache.lang);
	for (let i = 0; i < prefixCount; i++) {
		cache.highlightedLines[i] =
			prefixHighlighted[i] ?? highlightSingleLine(cache.normalizedLines[i] ?? "", cache.lang);
	}
}
function rebuildWriteHighlightCacheFull(rawPath: string | null, fileContent: string): WriteHighlightCache | undefined {
	const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
	if (!lang) return undefined;
	const displayContent = normalizeDisplayText(fileContent);
	const normalized = replaceTabs(displayContent);
	return {
		rawPath,
		lang,
		rawContent: fileContent,
		normalizedLines: normalized.split("\n"),
		highlightedLines: highlightCode(normalized, lang),
	};
}
function updateWriteHighlightCacheIncremental(
	cache: WriteHighlightCache | undefined,
	rawPath: string | null,
	fileContent: string,
	highlighter: CodeHighlighter,
): WriteHighlightCache | undefined {
	const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
	if (!lang) return undefined;
	if (!cache) return rebuildWriteHighlightCacheFull(rawPath, fileContent);
	if (cache.lang !== lang || cache.rawPath !== rawPath || !fileContent.startsWith(cache.rawContent)) {
		return rebuildWriteHighlightCacheFull(rawPath, fileContent);
	}
	if (fileContent.length === cache.rawContent.length) return cache;

	const deltaRaw = fileContent.slice(cache.rawContent.length);
	const deltaDisplay = normalizeDisplayText(deltaRaw);
	const deltaNormalized = replaceTabs(deltaDisplay);
	cache.rawContent = fileContent;
	if (cache.normalizedLines.length === 0) {
		cache.normalizedLines.push("");
		cache.highlightedLines.push("");
	}

	const segments = deltaNormalized.split("\n");
	const lastIndex = cache.normalizedLines.length - 1;
	cache.normalizedLines[lastIndex] += segments[0];
	cache.highlightedLines[lastIndex] = highlightSingleLine(cache.normalizedLines[lastIndex], cache.lang);
	for (let i = 1; i < segments.length; i++) {
		cache.normalizedLines.push(segments[i]);
		cache.highlightedLines.push(highlightSingleLine(segments[i], cache.lang));
	}
	refreshWriteHighlightPrefix(cache, highlighter);
	return cache;
}
function trimTrailingEmptyLines(lines: readonly string[]): string[] {
	let end = lines.length;
	while (end > 0 && lines[end - 1] === "") {
		end--;
	}
	return lines.slice(0, end);
}
function formatWriteHeader(
	args: { path?: string; file_path?: string } | undefined,
	theme: Theme,
	cwd: string,
	created: boolean | undefined,
): string {
	const pathDisplay = renderToolPath(str(args?.file_path ?? args?.path), theme, cwd);
	return `${theme.fg("toolTitle", theme.bold(created ? "Create" : "Write"))} ${pathDisplay}`;
}
function formatWriteCall(
	args: { path?: string; file_path?: string; content?: string } | undefined,
	options: ToolRenderResultOptions,
	theme: Theme,
	cache: WriteHighlightCache | undefined,
	highlighter: CodeHighlighter,
	cwd: string,
	created: boolean | undefined,
): string {
	const rawPath = str(args?.file_path ?? args?.path);
	const fileContent = str(args?.content);
	let text = formatWriteHeader(args, theme, cwd, created);

	if (fileContent === null) {
		text += `\n\n${theme.fg("error", "[invalid content arg - expected string]")}`;
	} else if (fileContent) {
		const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
		const renderedLines = lang
			? (cache?.highlightedLines ?? highlighter.highlight(replaceTabs(normalizeDisplayText(fileContent)), lang))
			: normalizeDisplayText(fileContent).split("\n");
		const lines = trimTrailingEmptyLines(renderedLines);
		const totalLines = lines.length;
		const maxLines = options.expanded ? lines.length : 10;
		const displayLines = lines.slice(0, maxLines);
		const remaining = lines.length - maxLines;
		text += `\n\n${displayLines.map((line) => (lang ? line : theme.fg("toolOutput", replaceTabs(line)))).join("\n")}`;
		if (remaining > 0) {
			text += `${theme.fg("muted", `\n... (${remaining} more lines, ${totalLines} total,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
		}
	}

	return text;
}

export const writeRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, theme, context) {
		const renderArgs = args as { path?: string; file_path?: string; content?: string } | undefined;
		const rawPath = str(renderArgs?.file_path ?? renderArgs?.path);
		const fileContent = str(renderArgs?.content);
		const component =
			(context.lastComponent as WriteCallRenderComponent | undefined) ?? new WriteCallRenderComponent();
		(context.state as { callComponent?: WriteCallRenderComponent }).callComponent = component;
		// Decide Create vs Write before the result arrives, as the reference row does; the result's
		// recorded `created` flag corrects this on replay or if the filesystem changed underneath.
		if (component.created === undefined && rawPath && (context.argsComplete || fileContent)) {
			component.created = !existsSync(resolve(context.cwd, rawPath));
		}
		component.cache =
			fileContent !== null && context.isPartial && !context.argsComplete
				? updateWriteHighlightCacheIncremental(component.cache, rawPath, fileContent, component.highlighter)
				: undefined;
		// The content preview belongs to a running call, so the write can be watched as it arrives.
		// Once a final result lands, the change is told by the block under the row, from the tool's
		// recorded diff; a replayed call shows that block straight away.
		component.setText(
			toolRowCallLine(
				context.isPartial
					? formatWriteCall(
							renderArgs,
							{ expanded: context.expanded, isPartial: context.isPartial },
							theme,
							component.cache,
							component.highlighter,
							context.cwd,
							component.created,
						)
					: formatWriteHeader(renderArgs, theme, context.cwd, component.created),
				context,
				theme,
			),
		);
		return component;
	},
	renderResult(result, options, theme, context) {
		const component: WriteResultComponent =
			(context.lastComponent as WriteResultComponent | undefined) ?? new Container();
		component.clear();

		if (context.isError) {
			const output = result.content
				.filter((c) => c.type === "text")
				.map((c) => c.text || "")
				.join("\n");
			const block = new ToolBranchBlock();
			block.addChild(new Text(theme.fg("error", output || "Failed"), 0, 0));
			component.addChild(block);
			return component;
		}

		if (options.isPartial) return component;
		const details = result.details as WriteToolDetails | undefined;
		const callComponent = context.state.callComponent as WriteCallRenderComponent | undefined;
		if (callComponent && details?.created !== undefined && callComponent.created !== details.created) {
			callComponent.created = details.created;
			queueMicrotask(() => context.invalidate());
		}
		if (details?.diff) {
			component.addChild(
				createChangeBlock(
					component,
					{
						diff: details.diff,
						path: details.path,
						edits: 1,
						view: {
							expanded: options.expanded,
							maxRows: COLLAPSED_DIFF_ROWS,
							expandHint: `(${context.keyHint("app.tools.expand", "to expand")})`,
						},
					},
					theme,
				),
			);
		} else if (details?.unchanged) {
			const block = new ToolBranchBlock();
			block.addChild(new Text(theme.fg("muted", "\u2713 no changes"), 0, 0));
			component.addChild(block);
		} else {
			const block = new ToolBranchBlock();
			block.addChild(new Text(theme.fg("success", "Written"), 0, 0));
			component.addChild(block);
		}
		return component;
	},
};
