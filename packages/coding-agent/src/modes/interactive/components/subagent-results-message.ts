/**
 * A batched background-subagent completion, shown as tool-style rows instead
 * of a user bubble. The notification arrives as a user message wrapped in
 * `<subagent-results>` tags; this component recognizes the wrapper and draws
 * one row per finished agent: a state bullet, a bold title with the agent
 * type, and the answer as markdown under a `└─` guide, collapsed to a few
 * lines like a read row until ctrl+o expands it.
 */

import { Container, HStack, Markdown, Spacer, Text } from "@hyzek/toucan-tui";
import { TOOL_ROW_MARKER } from "../../../core/tools/render-utils.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { ChatNotice } from "./chat-notice.ts";
import { keyHint } from "./keybinding-hints.ts";

export const SUBAGENT_RESULTS_OPEN = "<subagent-results>";
export const SUBAGENT_RESULTS_CLOSE = "</subagent-results>";

/** The row indent that puts the guide under the title's "Subagent". */
const INDENT = "  ";

/** Body lines a collapsed row shows before the fold notice. */
const COLLAPSED_RESULT_LINES = 3;

/** Whether this user message is a batched subagent completion. */
export function isSubagentResultsMessage(text: string): boolean {
	const trimmed = text.trim();
	return trimmed.startsWith(SUBAGENT_RESULTS_OPEN) && trimmed.endsWith(SUBAGENT_RESULTS_CLOSE);
}

/** One finished agent inside the notification; `parseSubagentResults` extracts these. */
interface SubagentResultBlock {
	status: string;
	agent: string;
	id: string;
	stats: string;
	summary: string;
	result: string;
}

/** The machine-formatted lines the manager writes per agent. */
const HEADER_RE = /^(completed|stopped|error): (\S+) \((\S+); (.+)\)$/;
const SUMMARY_RE = /^\d+ background subagent.*$/;

/** Split the notification body into one block per agent. Lines before the first header become the summary. */
export function parseSubagentResults(text: string): SubagentResultBlock[] {
	const body = text.trim().slice(SUBAGENT_RESULTS_OPEN.length, -SUBAGENT_RESULTS_CLOSE.length).trim();
	const blocks: SubagentResultBlock[] = [];
	let current: SubagentResultBlock | undefined;
	const fallback: string[] = [];
	for (const line of body.split("\n")) {
		const header = HEADER_RE.exec(line.trim());
		if (header) {
			current = { status: header[1], agent: header[2], id: header[3], stats: header[4], summary: "", result: "" };
			blocks.push(current);
			continue;
		}
		if (SUMMARY_RE.test(line.trim())) continue;
		if (current) current.result += `${current.result ? "\n" : ""}${line}`;
		else fallback.push(line);
	}
	const summary = fallback.join("\n").trim();
	if (blocks.length > 0) blocks[0].summary = summary;
	return blocks.map((block) => ({ ...block, result: block.result.trim() }));
}

function statusToken(status: string): "success" | "error" | "muted" {
	if (status === "completed") return "success";
	if (status === "error") return "error";
	return "muted";
}

/**
 * One agent's row: `• Subagent explore · completed · 2 turns, 1.1k tokens`,
 * with the answer as markdown beside an indented `└─` guide. Collapsed, the
 * answer folds to a few lines and the fold notice names the expand key, like
 * a read row. The model name is left out of the stats: the row stays short,
 * and the model lives in the command center.
 */
class SubagentResultRow extends Container {
	constructor(block: SubagentResultBlock, expanded: boolean) {
		super();
		const token = statusToken(block.status);
		const stats = block.stats
			.split(", ")
			.filter((part) => !part.includes("/"))
			.join(", ");
		const title =
			theme.fg(token, TOOL_ROW_MARKER) +
			` ${theme.fg("toolTitle", theme.bold("Subagent"))} ${theme.fg("toolTitle", block.agent)}` +
			theme.fg(token, ` · ${block.status}`) +
			theme.fg("muted", ` · ${stats}`);
		this.addChild(new Text(title, 0, 0));

		const body = [block.summary, block.result].filter((part) => part).join("\n\n");
		if (!body) return;

		const lines = body.split("\n");
		const shown = expanded ? lines.length : Math.min(lines.length, COLLAPSED_RESULT_LINES);

		// The guide sits under the row's title ("Subagent"), not at the left edge.
		// It is layout, not source text: the markdown body parses untouched, and the
		// HStack keeps every wrapped and continuation line aligned under the first
		// line's text instead of drifting with hand-built indentation.
		// Both entries need an explicit basis: a Text child's intrinsic width is the
		// full row, and a basis-0 column without a minSize cannot grow.
		// Style by foreground only: no panel background, so the notice reads as a
		// tool tail rather than a user bubble. Headings are demoted to plain text:
		// a tail shows an answer, not a titled document, like an edit call's rows.
		const guide = new HStack([], { gap: 1 });
		guide.addChild(new Text(`${INDENT}${theme.fg("muted", "└─")}`, 0, 0), { basis: 4, minSize: 4, shrink: 0 });
		const bodyText = new Markdown(
			lines.slice(0, shown).join("\n"),
			0,
			0,
			getMarkdownTheme(),
			{ color: (text) => theme.fg("text", text) },
			{ transform: (source) => source.replace(/^#{1,6}[ \t]+/gm, "") },
		);
		guide.addChild(bodyText, { basis: 0, grow: 1, minSize: 8 });
		this.addChild(guide);

		const remaining = lines.length - shown;
		if (remaining > 0) {
			// Aligned with the body column: guide column (4) + gap (1).
			this.addChild(
				new Text(
					`${INDENT}   ${theme.fg("muted", `... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`,
					0,
					0,
				),
			);
		}
	}
}

/** The whole batch: one tool-style row per finished agent, no banner line. */
export class SubagentResultsNoticeComponent extends ChatNotice {
	private expanded = false;
	private text: string;
	private blocks: SubagentResultBlock[];

	constructor(text: string) {
		super();
		this.text = text;
		this.blocks = parseSubagentResults(text);
		this.rebuild();
	}

	/** Expand or collapse every agent's answer tail (ctrl+o path). */
	setExpanded(expanded: boolean): void {
		if (this.expanded === expanded) return;
		this.expanded = expanded;
		this.rebuild();
	}

	override invalidate(): void {
		super.invalidate();
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		if (this.blocks.length === 0) {
			// Body we cannot parse: show it raw rather than lose it.
			this.addChild(
				new Text(
					`${theme.fg("success", TOOL_ROW_MARKER)} ${theme.fg("toolTitle", theme.bold("Subagent results"))}`,
					0,
					0,
				),
			);
			this.addChild(new Text(theme.fg("text", this.text), 0, 0));
			return;
		}
		for (const [index, block] of this.blocks.entries()) {
			if (index > 0) this.addChild(new Spacer(1));
			this.addChild(new SubagentResultRow(block, this.expanded));
		}
	}
}
