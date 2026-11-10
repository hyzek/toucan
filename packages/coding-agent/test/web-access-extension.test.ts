import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "../src/core/extensions/index.ts";
import webAccessExtension from "../src/extensions/web-access/index.ts";

const temporaryDirs: string[] = [];

afterEach(() => {
	vi.unstubAllEnvs();
	for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createApi(): {
	api: ExtensionAPI;
	tools: Map<string, { name: string }>;
	commands: string[];
	shortcuts: string[];
	handlers: Map<string, Array<(event: unknown, ctx: ExtensionContext) => Promise<void> | void>>;
	activeTools: string[];
} {
	const tools = new Map<string, { name: string }>();
	const commands: string[] = [];
	const shortcuts: string[] = [];
	const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => Promise<void> | void>>();
	const activeTools: string[] = [];
	const api = {
		registerTool(definition: { name: string }) {
			tools.set(definition.name, definition);
		},
		registerCommand(name: string) {
			commands.push(name);
		},
		registerShortcut(key: string) {
			shortcuts.push(key);
		},
		on(event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
		getAllTools: () => [...tools.values()],
		getActiveTools: () => [...activeTools],
		setActiveTools(names: string[]) {
			activeTools.splice(0, activeTools.length, ...names);
		},
		appendEntry() {},
		sendMessage() {},
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	} as unknown as ExtensionAPI;
	return { api, tools, commands, shortcuts, handlers, activeTools };
}

describe("built-in web access", () => {
	it("loads pi-web-access through Toucan's module aliases", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "toucan-web-access-"));
		temporaryDirs.push(agentDir);
		vi.stubEnv("TOUCAN_CODING_AGENT_DIR", agentDir);
		vi.stubEnv("PI_CODING_AGENT_DIR", undefined);
		const { api, tools, commands, shortcuts, handlers, activeTools } = createApi();

		await webAccessExtension(api);

		expect([...tools.keys()]).toEqual(
			expect.arrayContaining(["web_search", "fetch_content", "get_search_content", "source_check"]),
		);
		expect(commands).toEqual(expect.arrayContaining(["websearch", "curator"]));
		expect(shortcuts).toEqual(expect.arrayContaining(["ctrl+shift+s", "ctrl+shift+w"]));

		const sessionStart = handlers.get("session_start") ?? [];
		expect(sessionStart.length).toBeGreaterThan(0);
		const ctx = {
			hasUI: false,
			ui: {},
			model: undefined,
			sessionManager: { getBranch: () => [] },
		} as unknown as ExtensionContext;
		for (const handler of sessionStart) {
			await handler({ type: "session_start" }, ctx);
		}
		expect(activeTools).toEqual(
			expect.arrayContaining(["web_search", "fetch_content", "get_search_content", "source_check"]),
		);
	});
});
