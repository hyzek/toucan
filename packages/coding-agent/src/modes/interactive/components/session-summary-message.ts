/**
 * Shared inline result row for compaction and branch summaries.
 *
 * The row is one header line with a click/ctrl+o expansion hint. Expanded content is
 * the summary Markdown, indented under the header with no full-width panel behind it.
 */

import { Box, Container, Markdown, type MarkdownTheme, MouseRegion, Spacer, Text } from "@hyzek/toucan-tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import { theme } from "../theme/theme.ts";
import { keyText } from "./keybinding-hints.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";

export interface SessionSummaryMessageOptions {
	label: string;
	detail: string;
	summary: string;
	markdownTheme: MarkdownTheme;
	outputPad: number;
	markdownTransformers: readonly MarkdownTransformer[];
	messageId?: string;
	timestamp?: string;
}

export class SessionSummaryMessageComponent extends Box {
	private expanded = false;
	private readonly options: SessionSummaryMessageOptions;

	constructor(options: SessionSummaryMessageOptions) {
		super(options.outputPad, 0);
		this.options = options;
		this.updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	setOutputPad(outputPad: number): void {
		this.setPaddingX(outputPad);
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	private updateDisplay(): void {
		this.clear();
		const content = new Container();
		const hint =
			theme.fg("dim", keyText("app.tools.expand")) +
			theme.fg("muted", this.expanded ? " to collapse" : " to expand");
		const header =
			`${theme.fg("customMessageLabel", `\x1b[1m${this.options.label}\x1b[22m`)} ` +
			`${theme.fg("customMessageText", this.options.detail)}` +
			`${theme.fg("dim", "  ·  ")}${hint}`;
		content.addChild(new Text(header, 0, 0));

		if (this.expanded) {
			content.addChild(new Spacer(1));
			content.addChild(
				new Markdown(
					this.options.summary,
					2,
					0,
					this.options.markdownTheme,
					{ color: (text: string) => theme.fg("customMessageText", text) },
					{
						transform: createMarkdownTransform(
							"summary",
							() => false,
							this.options.markdownTransformers,
							this.options.messageId,
							this.options.timestamp,
						),
					},
				),
			);
		}

		this.addChild(
			new MouseRegion(content, (event) => {
				if (event.type !== "click" || event.button !== "left") return undefined;
				this.setExpanded(!this.expanded);
				return { handled: true };
			}),
		);
	}
}
