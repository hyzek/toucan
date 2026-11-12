/**
 * Design reference: the shipped compaction and branch result rows.
 *
 * From the repo root: npm run build
 * From packages/coding-agent: node test/ui-demos/02-session-summaries.ts
 *
 * Keys: e expand/collapse, t theme, q quit.
 */

import { BranchSummaryMessageComponent } from "../../src/modes/interactive/components/branch-summary-message.ts";
import { CompactionSummaryMessageComponent } from "../../src/modes/interactive/components/compaction-summary-message.ts";
import { getMarkdownTheme, theme } from "../../src/modes/interactive/theme/theme.ts";
import { type Demo, runDemo } from "./demo-kit.ts";

const SUMMARY = `## Goal

Make the session surface quieter and easier to scan.

## Decisions

- Keep the input band separate from transcript content.
- Treat compaction and branch summaries as the same visual family.
- Preserve click and \`ctrl+o\` expansion.

## Files

- \`src/modes/interactive/components/compaction-summary-message.ts\`
- \`src/modes/interactive/components/branch-summary-message.ts\`
`;

const TOKENS_BEFORE = 48_200;

class SummaryDemo implements Demo {
	readonly title = "Compaction and branch results";
	readonly help = "shipped inline result rows · e expand/collapse";

	private expanded = false;
	private readonly compaction = new CompactionSummaryMessageComponent(
		{ role: "compactionSummary", summary: SUMMARY, tokensBefore: TOKENS_BEFORE, timestamp: Date.now() },
		getMarkdownTheme(),
		1,
	);
	private readonly branch = new BranchSummaryMessageComponent(
		{ role: "branchSummary", summary: SUMMARY, fromId: "entry-1", timestamp: Date.now() },
		getMarkdownTheme(),
		1,
	);

	handleInput(data: string): boolean {
		if (data !== "e") return false;
		this.expanded = !this.expanded;
		this.compaction.setExpanded(this.expanded);
		this.branch.setExpanded(this.expanded);
		return true;
	}

	render(width: number): string[] {
		return [
			theme.fg("muted", "  compaction"),
			...this.compaction.render(width),
			"",
			theme.fg("muted", "  branch"),
			...this.branch.render(width),
		];
	}

	dispose(): void {}
}

runDemo(() => new SummaryDemo());
