// The info bar: one line under the input showing the blocks the user picked (model, thinking,
// directory, usage, ...), the mode badges, and any statuses extensions set below it.

import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { type Component, truncateToWidth, visibleWidth } from "@hyzek/toucan-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import { areExperimentalFeaturesEnabled } from "../../../core/experimental.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import type { FooterItemId } from "../../../core/footer-items.ts";
import { FOOTER_ITEMS_DEFAULT } from "../../../core/footer-items.ts";
import type { FooterStats } from "../../../core/footer-stats.ts";
import { createUsageTotals } from "../../../core/usage-totals.ts";
import { theme } from "../theme/theme.ts";
import { INPUT_PROMPT } from "./custom-editor.ts";
import { type FooterRenderContext, renderFooterBlocks } from "./footer-blocks.ts";

const SEPARATOR = " \u00b7 ";
const NO_USAGE = createUsageTotals();

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

export interface FooterComponentOptions {
	/** Block order, read per render so `/footer` takes effect without rebuilding the component. */
	items?: () => readonly FooterItemId[];
	/** Session usage numbers. Omitted, the usage blocks have nothing to show. */
	stats?: FooterStats;
}

/**
 * The info bar. Blocks come from `footer.items`; `plan` and the experimental marker are mode
 * badges rather than blocks: they report a state the user is in, so they appear on their own
 * terms and never take a slot in the configured order.
 */
export class FooterComponent implements Component {
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;
	private options: FooterComponentOptions;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider, options: FooterComponentOptions = {}) {
		this.session = session;
		this.footerData = footerData;
		this.options = options;
	}

	setSession(session: AgentSession): void {
		this.session = session;
		this.options.stats?.setSession(session);
	}

	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider, usage refreshes on session events.
	}

	/** Git branch caching and the extension statuses live in the provider, which owns their cleanup. */
	dispose(): void {}

	render(width: number): string[] {
		const items = this.options.items?.() ?? FOOTER_ITEMS_DEFAULT;
		const segments = renderFooterBlocks(items, this.renderContext());
		if (areExperimentalFeaturesEnabled()) {
			segments.push(theme.fg("dim", theme.bold(theme.fg("warning", "xp"))));
		}

		// Indent to the caret column of the input band above (the prompt cell width).
		const indent = " ".repeat(visibleWidth(INPUT_PROMPT));
		// When the bar does not fit, the rightmost block goes first: the order is the user's, so
		// what they put last is what they chose to lose. Only the block still standing truncates.
		while (segments.length > 1 && visibleWidth(`${indent}${segments.join(SEPARATOR)}`) > width) {
			segments.pop();
		}
		// Dim per segment, not the whole line: a block's own color closes with a foreground
		// reset, and one line-wide dim before it would leave everything after that block in the
		// terminal default color.
		const dimSeparator = theme.fg("dim", SEPARATOR);
		let bar = `${indent}${segments.map((segment) => theme.fg("dim", segment)).join(dimSeparator)}`;

		// Plan mode badge, right-aligned on the same bar. Dropped when the width is tight.
		if (this.session.planMode) {
			const badge = theme.fg("planMode", "\u25c7 Plan mode");
			const gap = width - visibleWidth(bar) - visibleWidth(badge);
			if (gap >= 2) bar += " ".repeat(gap) + badge;
		}
		if (visibleWidth(bar) > width) {
			bar = truncateToWidth(bar, width, theme.fg("dim", "..."));
		}

		const lines: string[] = [bar];

		// Add extension statuses on a single line, sorted by key alphabetically
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}

	private renderContext(): FooterRenderContext {
		const state = this.session.state;
		const snapshot = this.options.stats?.read();
		return {
			model: state.model,
			thinkingLevel: state.thinkingLevel,
			routedModel: this.session.routedModel,
			sessionName: this.session.sessionManager.getSessionName() ?? "",
			directory: formatCwdForFooter(this.session.sessionManager.getCwd(), homedir()),
			gitBranch: this.footerData.getGitBranch(),
			usage: snapshot?.totals ?? NO_USAGE,
			contextTokens: snapshot?.contextTokens,
			contextPercent: snapshot?.contextPercent,
			cacheHitPercent: snapshot?.cacheHitPercent,
		};
	}
}
