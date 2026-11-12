/**
 * Toucan Web: web search, page fetching, source checks, GitHub and PDF handling, video analysis,
 * and stored-content retrieval.
 *
 * The implementation is the `pi-web-access` package, loaded with Toucan's module aliases. This
 * wrapper points its config at the Toucan agent directory and removes the package's own UI and
 * branding: the curator browser, its shortcut, and its update notice do not reach Toucan.
 */

import { createRequire } from "node:module";
import type { Static, TSchema } from "typebox";
import { getAgentDir } from "../../config.ts";
import { loadExternalExtensionFactory } from "../../core/extensions/loader.ts";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory, ToolDefinition } from "../../core/extensions/types.ts";
import { toucanWebRenderersFor } from "./renderers.ts";

const require = createRequire(import.meta.url);

const UPSTREAM_PACKAGE = "pi-web-access";
const UPSTREAM_UPDATE_NOTICE = `${UPSTREAM_PACKAGE} updated from `;

/** Curator browser entry points in the upstream package. */
const CURATOR_COMMANDS = new Set(["websearch", "curator"]);
const CURATOR_SHORTCUT = "ctrl+shift+s";

/**
 * Keep every web tool while hiding the curator browser UI and upstream branding: no curator
 * commands, no curator shortcut, no `summary-review` workflow, and no upstream package name in the
 * tool's label or description.
 */
function toucanWebTool<TParams extends TSchema, TDetails, TState>(
	definition: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> {
	const branded = {
		...definition,
		label: definition.name === "web_enable" ? "Enable Toucan Web" : definition.label,
		description: definition.description.replaceAll(UPSTREAM_PACKAGE, "Toucan Web"),
	};
	if (branded.label !== "Web Search") return branded;
	return {
		...branded,
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			definition.execute(
				toolCallId,
				{ ...(params as Record<string, unknown>), workflow: "none" } as unknown as Static<TParams>,
				signal,
				onUpdate,
				ctx,
			),
	};
}

/** The context without the upstream package's own dependency-update notice. */
function withoutUpstreamNotice(ctx: ExtensionContext): ExtensionContext {
	const ui = new Proxy(ctx.ui, {
		get(target, property, receiver) {
			if (property !== "notify") return Reflect.get(target, property, receiver);
			return (message: string, type?: "info" | "warning" | "error") => {
				if (message.startsWith(UPSTREAM_UPDATE_NOTICE)) return;
				target.notify(message, type);
			};
		},
	});
	return new Proxy(ctx, {
		get(target, property, receiver) {
			if (property === "ui") return ui;
			return Reflect.get(target, property, receiver);
		},
	});
}

function withoutUpstreamUi(toucan: ExtensionAPI): ExtensionAPI {
	const registerCommand: ExtensionAPI["registerCommand"] = (name, options) => {
		if (!CURATOR_COMMANDS.has(name)) toucan.registerCommand(name, options);
	};
	const registerShortcut: ExtensionAPI["registerShortcut"] = (key, options) => {
		if (key !== CURATOR_SHORTCUT) toucan.registerShortcut(key, options);
	};
	const registerTool: ExtensionAPI["registerTool"] = (definition) => {
		const tool = toucanWebTool(definition);
		// Replace the upstream renderers, including their block-character progress bar, as each tool
		// is registered so the row uses Toucan's marker and guide language.
		const renderers = toucanWebRenderersFor(tool);
		toucan.registerTool(renderers ? { ...tool, ...renderers } : tool);
	};
	// The upstream package selects handlers by string, which the overloads cannot express.
	const subscribe = toucan.on as (
		event: string,
		handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void,
	) => () => void;
	const on = ((event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void) =>
		event === "session_start"
			? subscribe("session_start", (sessionEvent, ctx) => handler(sessionEvent, withoutUpstreamNotice(ctx)))
			: subscribe(event, handler)) as ExtensionAPI["on"];
	return new Proxy(toucan, {
		get(target, property, receiver) {
			if (property === "on") return on;
			if (property === "registerCommand") return registerCommand;
			if (property === "registerShortcut") return registerShortcut;
			if (property === "registerTool") return registerTool;
			const value = Reflect.get(target, property, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/** Register Toucan Web's search, fetch, source-check, stored-content, and enable tools. */
const toucanWebExtension: ExtensionFactory = async (toucan) => {
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	// The upstream package resolves web-search.json from PI_CODING_AGENT_DIR first.
	process.env.PI_CODING_AGENT_DIR ??= getAgentDir();

	try {
		const entry = require.resolve(`${UPSTREAM_PACKAGE}/dist/index.js`);
		const factory = await loadExternalExtensionFactory(entry);
		if (!factory) {
			throw new Error(`Toucan Web has no extension factory: ${entry}`);
		}
		await factory(withoutUpstreamUi(toucan));
	} finally {
		if (previousAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
	}
};

export default toucanWebExtension;
