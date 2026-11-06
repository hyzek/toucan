/**
 * Bash Spawn Hook Example
 *
 * Adjusts command, cwd, and env before execution.
 *
 * Usage:
 *   toucan -e ./bash-spawn-hook.ts
 */

import type { ExtensionAPI } from "@hyzek/toucan-coding-agent";
import { createBashTool } from "@hyzek/toucan-coding-agent";

export default function (toucan: ExtensionAPI) {
	const cwd = process.cwd();

	const bashTool = createBashTool(cwd, {
		spawnHook: ({ command, cwd, env }) => ({
			command: `source ~/.profile\n${command}`,
			cwd,
			env: { ...env, TOUCAN_SPAWN_HOOK: "1" },
		}),
	});

	toucan.registerTool({
		...bashTool,
		execute: async (id, params, signal, onUpdate, _ctx) => {
			return bashTool.execute(id, params, signal, onUpdate);
		},
	});
}
