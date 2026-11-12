import type { MarkdownTheme } from "@hyzek/toucan-tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import type { CompactionSummaryMessage } from "../../../core/messages.ts";
import { getMarkdownTheme } from "../theme/theme.ts";
import { SessionSummaryMessageComponent } from "./session-summary-message.ts";

/** A compaction result as one inline row, expandable to the summary Markdown. */
export class CompactionSummaryMessageComponent extends SessionSummaryMessageComponent {
	constructor(
		message: CompactionSummaryMessage,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		messageId?: string,
		timestamp?: string,
	) {
		super({
			label: "[compaction]",
			detail: `${message.tokensBefore.toLocaleString()} tokens`,
			summary: message.summary,
			markdownTheme,
			outputPad,
			markdownTransformers,
			messageId,
			timestamp,
		});
	}
}
