// The info bar's vocabulary: the blocks that exist, what the `/footer` menu calls them, and the
// order a fresh install shows. Their text lives in
// `src/modes/interactive/components/footer-blocks.ts`; the bar itself is `components/footer.ts`.

/** A block the info bar can show, as it appears in `settings.json` and in the `/footer` menu. */
export type FooterItemId =
	| "model"
	| "model-id"
	| "thinking"
	| "session"
	| "directory"
	| "branch"
	| "context"
	| "tokens"
	| "cache"
	| "cost";

/** Every block, in the order the `/footer` menu lists them. */
export const FOOTER_ITEM_IDS: readonly FooterItemId[] = [
	"model",
	"model-id",
	"thinking",
	"session",
	"directory",
	"branch",
	"context",
	"tokens",
	"cache",
	"cost",
];

/**
 * What an install shows with no `footer.items` set: which model is answering at which effort, in
 * which directory. Everything else the bar can show is opted into.
 */
export const FOOTER_ITEMS_DEFAULT: readonly FooterItemId[] = ["model", "thinking", "directory"];

export interface FooterItemText {
	/** Name in the menu. */
	label: string;
	/** What the block shows, in the menu's description column. */
	description: string;
}

export const FOOTER_ITEM_TEXT: Record<FooterItemId, FooterItemText> = {
	model: { label: "Model", description: "Model display name, and where a routed request went" },
	"model-id": { label: "Model id", description: "Model id as the API names it" },
	thinking: { label: "Thinking", description: "Reasoning level" },
	session: { label: "Session name", description: "Set with /name" },
	directory: { label: "Directory", description: "Working directory, abbreviated under the home" },
	branch: { label: "Git branch", description: "Current branch; hidden outside a repository" },
	context: {
		label: "Context",
		description: "Tokens in context, and the share of the window they fill",
	},
	tokens: {
		label: "Tokens",
		description: "Sent (prompt plus cache reads and writes) and received, this session",
	},
	cache: { label: "Cache hit rate", description: "Prompt tokens served from cache, this session" },
	cost: { label: "Cost", description: "What this session has cost, as billed" },
};

/**
 * True for an id this build knows. `settings.json` is not validated on load, so a hand-edited
 * file can name a block that does not exist or one this build dropped; those are ignored.
 */
export function isFooterItemId(value: unknown): value is FooterItemId {
	return typeof value === "string" && (FOOTER_ITEM_IDS as readonly string[]).includes(value);
}

/**
 * Block order to render for a configured list: valid ids as given, unknown ones dropped.
 * An empty or fully-invalid list falls back to the default, because a bar with nothing in it
 * reads as a bug, and the menu always leaves at least one way to reach `/footer` again.
 */
export function resolveFooterItems(value: unknown): readonly FooterItemId[] {
	if (!Array.isArray(value)) return FOOTER_ITEMS_DEFAULT;
	const items = value.filter(isFooterItemId);
	return items.length > 0 ? items : FOOTER_ITEMS_DEFAULT;
}

/** Compact summary for the `/settings` row: the first two labels, then how many more. */
export function footerItemsSummary(items: readonly FooterItemId[]): string {
	const labels = items.map((id) => FOOTER_ITEM_TEXT[id].label);
	const head = labels.slice(0, 2).join(", ");
	return labels.length > 2 ? `${head} +${labels.length - 2}` : head;
}
