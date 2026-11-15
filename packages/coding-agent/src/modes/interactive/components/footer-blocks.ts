// The info bar's blocks as text: what each one prints, and which states hide it. Which blocks
// exist and what they are called lives in `src/core/footer-items.ts`; `components/footer.ts`
// assembles the returned segments into one line.

import type { ThinkingLevel } from "@hyzek/toucan-agent-core";
import type { Api, Model } from "@hyzek/toucan-ai";
import type { FooterItemId } from "../../../core/footer-items.ts";
import type { UsageTotals } from "../../../core/usage-totals.ts";
import { theme } from "../theme/theme.ts";

/** Everything the blocks may show, gathered once per render by `FooterComponent`. */
export interface FooterRenderContext {
	model: Model<Api> | undefined;
	thinkingLevel: ThinkingLevel | undefined;
	/** Physical model the latest request was routed to, when the session model is virtual. */
	routedModel: { model: Model<Api>; thinkingLevel?: ThinkingLevel } | undefined;
	sessionName: string;
	directory: string;
	/** Git branch, `detached` for a detached HEAD, null outside a repository. */
	gitBranch: string | null;
	usage: UsageTotals;
	contextTokens: number | undefined;
	contextPercent: number | undefined;
	cacheHitPercent: number | undefined;
}

/** The model's own name: the catalog display name, falling back to the API id. */
function modelDisplayName(model: Model<Api> | undefined): string {
	return model?.name || model?.id || "no-model";
}

/**
 * The bar's token sizes: a capital unit and a decimal only where it carries information, so
 * `7700` is `7.7K`, `103000` is `103K`, `134800` is `134.8K`. Rounding a running count to `135K`
 * leaves it unchanged for several turns of slow growth, which reads as a bar that stopped moving.
 */
function formatBarTokens(count: number): string {
	if (count < 1000) return count.toString();
	const millions = count >= 1000000;
	const text = (millions ? count / 1000000 : count / 1000).toFixed(1);
	return `${text.endsWith(".0") ? text.slice(0, -2) : text}${millions ? "M" : "K"}`;
}

function formatCost(cost: number): string {
	return cost >= 100 ? `$${Math.round(cost)}` : `$${cost.toFixed(2)}`;
}

/**
 * Context pressure thresholds: the block turns yellow as the window fills up and red when the
 * next request is likely to need a compaction.
 */
const CONTEXT_WARN_PERCENT = 70;
const CONTEXT_DANGER_PERCENT = 85;

/** Bar text for each block; undefined hides the block until it applies. */
const RENDERERS: Record<FooterItemId, (context: FooterRenderContext) => string | undefined> = {
	model: (context) => {
		const name = modelDisplayName(context.model);
		const routed = context.routedModel;
		if (!routed) return name;
		const level = routed.thinkingLevel ? ` · ${routed.thinkingLevel}` : "";
		return `${name} \u2192 ${modelDisplayName(routed.model)}${level}`;
	},
	"model-id": (context) => context.model?.id,
	thinking: (context) => {
		if (!context.model?.reasoning) return undefined;
		const level = context.thinkingLevel ?? "off";
		return level === "off" ? "thinking off" : level;
	},
	session: (context) => context.sessionName || undefined,
	directory: (context) => context.directory,
	branch: (context) => context.gitBranch || undefined,
	context: (context) => {
		// A zero or missing estimate means the projection has not run yet, and "0 (0%)" is not news.
		if (!context.contextTokens || context.contextPercent === undefined) return undefined;
		const text = `${formatBarTokens(context.contextTokens)} (${context.contextPercent}%)`;
		if (context.contextPercent >= CONTEXT_DANGER_PERCENT) return theme.fg("error", text);
		if (context.contextPercent >= CONTEXT_WARN_PERCENT) return theme.fg("warning", text);
		return text;
	},
	tokens: (context) => {
		const parts: string[] = [];
		const sent = context.usage.input + context.usage.cacheRead + context.usage.cacheWrite;
		if (sent > 0) parts.push(`\u2191${formatBarTokens(sent)}`);
		if (context.usage.output > 0) parts.push(`\u2193${formatBarTokens(context.usage.output)}`);
		return parts.length > 0 ? parts.join(" ") : undefined;
	},
	cache: (context) => (context.cacheHitPercent === undefined ? undefined : `${context.cacheHitPercent}%`),
	cost: (context) => (context.usage.cost > 0 ? formatCost(context.usage.cost) : undefined),
};

/**
 * Styled text for the requested blocks in the requested order. Blocks that do not apply right
 * now — no session name, outside a repository, nothing billed yet — contribute nothing, so the
 * bar never shows a dash or an empty separator.
 */
export function renderFooterBlocks(items: readonly FooterItemId[], context: FooterRenderContext): string[] {
	const segments: string[] = [];
	for (const id of items) {
		const text = RENDERERS[id](context);
		if (text) segments.push(text);
	}
	return segments;
}
