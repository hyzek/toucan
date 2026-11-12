import type { MarkdownTheme } from "@hyzek/toucan-tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import type { BranchSummaryMessage } from "../../../core/messages.ts";
import { getMarkdownTheme } from "../theme/theme.ts";
import { SessionSummaryMessageComponent } from "./session-summary-message.ts";

/** A branch summary as one inline row, expandable to the summary Markdown. */
export class BranchSummaryMessageComponent extends SessionSummaryMessageComponent {
	constructor(
		message: BranchSummaryMessage,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		messageId?: string,
		timestamp?: string,
	) {
		super({
			label: "[branch]",
			detail: "summary",
			summary: message.summary,
			markdownTheme,
			outputPad,
			markdownTransformers,
			messageId,
			timestamp,
		});
	}
}
