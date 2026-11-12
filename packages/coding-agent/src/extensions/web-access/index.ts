/**
 * Built-in web access: loads the `pi-web-access` extension with Toucan's module aliases and
 * points its `web-search.json` at the Toucan agent directory instead of Pi's.
 */

import { createRequire } from "node:module";
import type { Static, TSchema } from "typebox";
import { getAgentDir } from "../../config.ts";
import { loadExternalExtensionFactory } from "../../core/extensions/loader.ts";
import type { ExtensionAPI, ExtensionFactory, ToolDefinition } from "../../core/extensions/types.ts";
import { webAccessRenderersFor } from "./renderers.ts";

const require = createRequire(import.meta.url);

/** Web UI entry points in pi-web-access: the curator browser and its shortcut. */
const WEB_UI_COMMANDS = new Set(["websearch", "curator"]);
const WEB_UI_SHORTCUT = "ctrl+shift+s";

/**
 * Keep every web tool while hiding the curator browser UI: no curator commands, no curator
 * shortcut, and no `summary-review` workflow from the search tool.
 */
function withoutWebUi<TParams extends TSchema, TDetails, TState>(
	definition: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> {
	if (definition.label !== "Web Search") return definition;
	return {
		...definition,
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

function hideWebUi(toucan: ExtensionAPI): ExtensionAPI {
	const registerCommand: ExtensionAPI["registerCommand"] = (name, options) => {
		if (!WEB_UI_COMMANDS.has(name)) toucan.registerCommand(name, options);
	};
	const registerShortcut: ExtensionAPI["registerShortcut"] = (key, options) => {
		if (key !== WEB_UI_SHORTCUT) toucan.registerShortcut(key, options);
	};
	const registerTool: ExtensionAPI["registerTool"] = (definition) => {
		const kept = withoutWebUi(definition);
		// Replace the package's Pi renderers, including its block-character progress bar, as each
		// tool is registered so the row uses Toucan's marker and guide language.
		const renderers = webAccessRenderersFor(kept);
		toucan.registerTool(renderers ? { ...kept, ...renderers } : kept);
	};
	return new Proxy(toucan, {
		get(target, property, receiver) {
			if (property === "registerCommand") return registerCommand;
			if (property === "registerShortcut") return registerShortcut;
			if (property === "registerTool") return registerTool;
			const value = Reflect.get(target, property, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/** Register web search, page fetching, source checks, and stored-content retrieval. */
const webAccessExtension: ExtensionFactory = async (toucan) => {
	const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
	// pi-web-access resolves web-search.json from PI_CODING_AGENT_DIR first, then ~/.pi.
	process.env.PI_CODING_AGENT_DIR ??= getAgentDir();

	try {
		const entry = require.resolve("pi-web-access/dist/index.js");
		const factory = await loadExternalExtensionFactory(entry);
		if (!factory) {
			throw new Error(`pi-web-access has no default extension factory: ${entry}`);
		}
		await factory(hideWebUi(toucan));
	} finally {
		if (previousPiAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
		}
	}
};

export default webAccessExtension;
