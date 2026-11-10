/**
 * Built-in web access: loads the `pi-web-access` extension with Toucan's module aliases and
 * points its `web-search.json` at the Toucan agent directory instead of Pi's.
 */

import { createRequire } from "node:module";
import { getAgentDir } from "../../config.ts";
import { loadExternalExtensionFactory } from "../../core/extensions/loader.ts";
import type { ExtensionFactory } from "../../core/extensions/types.ts";

const require = createRequire(import.meta.url);

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
		await factory(toucan);
	} finally {
		if (previousPiAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
		}
	}
};

export default webAccessExtension;
