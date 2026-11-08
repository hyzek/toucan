import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { type Component, truncateToWidth, visibleWidth } from "@hyzek/toucan-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import { areExperimentalFeaturesEnabled } from "../../../core/experimental.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { theme } from "../theme/theme.ts";
import { INPUT_PROMPT } from "./custom-editor.ts";

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

/**
 * Format token counts compactly for status output.
 */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
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

/**
 * Footer bar showing model and thinking level, session name, and the working directory.
 * Extension statuses come from the provider.
 */
export class FooterComponent implements Component {
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider) {
		this.session = session;
		this.footerData = footerData;
	}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	render(width: number): string[] {
		const state = this.session.state;

		// The session name is an optional part of the bar.
		const sessionName = this.session.sessionManager.getSessionName();
		const directory = formatCwdForFooter(this.session.sessionManager.getCwd(), homedir());

		// One bar like the reference design: model and thinking level lead the bar, indented by
		// one cell to line up under the input caret, then the session name, and the directory.
		const modelName = state.model?.id || "no-model";
		let left = modelName;
		if (state.model?.reasoning) {
			const thinkingLevel = state.thinkingLevel || "off";
			left = thinkingLevel === "off" ? `${modelName} · thinking off` : `${modelName} · ${thinkingLevel}`;
		}
		// A virtual model routes each request; show where the latest response went.
		const routed = this.session.routedModel;
		if (routed) {
			const level = routed.thinkingLevel ? ` · ${routed.thinkingLevel}` : "";
			left += ` → ${routed.model.id}${level}`;
		}
		if (sessionName) {
			left = `${left} · ${sessionName}`;
		}
		// Indent to the caret column of the input band above (the prompt cell width).
		const indent = " ".repeat(visibleWidth(INPUT_PROMPT));
		let bar = `${indent}${left}  ·  ${theme.fg("success", directory)}`;
		if (areExperimentalFeaturesEnabled()) {
			bar += `  ·  ${theme.bold(theme.fg("warning", "xp"))}`;
		}
		if (visibleWidth(bar) > width) {
			bar = truncateToWidth(bar, width, theme.fg("dim", "..."));
		}

		const lines: string[] = [theme.fg("dim", bar)];

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
}
