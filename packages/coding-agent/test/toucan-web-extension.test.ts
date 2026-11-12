import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "../src/core/extensions/index.ts";
import type { ToolRenderContext } from "../src/core/extensions/types.ts";
import toucanWebExtension from "../src/extensions/toucan-web/index.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const temporaryDirs: string[] = [];

afterEach(() => {
	vi.unstubAllEnvs();
	for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createApi(): {
	api: ExtensionAPI;
	tools: Map<string, ToolDefinition>;
	commands: string[];
	shortcuts: string[];
	handlers: Map<string, Array<(event: unknown, ctx: ExtensionContext) => Promise<void> | void>>;
	activeTools: string[];
} {
	const tools = new Map<string, ToolDefinition>();
	const commands: string[] = [];
	const shortcuts: string[] = [];
	const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => Promise<void> | void>>();
	const activeTools: string[] = [];
	const api = {
		registerTool(definition: ToolDefinition) {
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

function renderContext(overrides: Partial<ToolRenderContext> = {}): ToolRenderContext {
	return {
		args: {},
		state: {},
		lastComponent: undefined,
		invalidate: () => {},
		toolCallId: "web-tool-call",
		cwd: process.cwd(),
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
		durationMs: undefined,
		outputPad: 0,
		rowMarkerShown: true,
		keyText: () => "ctrl+o",
		keyHint: (_keybinding, description) => `ctrl+o ${description}`,
		...overrides,
	};
}

function render(
	definition: ToolDefinition,
	kind: "call" | "result",
	args: unknown,
	result?: unknown,
	options = { expanded: false, isPartial: false },
): string {
	const context = renderContext({ args });
	const component =
		kind === "call"
			? definition.renderCall!(args as never, theme, context)
			: definition.renderResult!(result as never, options, theme, context);
	return stripAnsi(component.render(100).join("\n"));
}

describe("built-in Toucan Web", () => {
	it("loads the upstream web package through Toucan's module aliases", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "toucan-web-"));
		temporaryDirs.push(agentDir);
		vi.stubEnv("TOUCAN_CODING_AGENT_DIR", agentDir);
		vi.stubEnv("PI_CODING_AGENT_DIR", undefined);
		const { api, tools, commands, shortcuts, handlers, activeTools } = createApi();

		await toucanWebExtension(api);

		expect([...tools.keys()]).toEqual(
			expect.arrayContaining(["web_search", "fetch_content", "get_search_content", "source_check"]),
		);
		expect(commands).toEqual(expect.arrayContaining(["search", "google-account"]));
		expect(commands).not.toContain("websearch");
		expect(commands).not.toContain("curator");
		expect(shortcuts).not.toContain("ctrl+shift+s");

		const enable = tools.get("web_enable");
		expect(enable?.label).toBe("Enable Toucan Web");
		expect(enable?.description).toContain("Toucan Web tools");
		expect(enable?.description).not.toContain("pi-web-access");

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

	it("replaces the upstream renderers with Toucan rows and no progress bar", async () => {
		initTheme("dark");
		const agentDir = mkdtempSync(join(tmpdir(), "toucan-web-"));
		temporaryDirs.push(agentDir);
		vi.stubEnv("TOUCAN_CODING_AGENT_DIR", agentDir);
		vi.stubEnv("PI_CODING_AGENT_DIR", undefined);
		const { api, tools } = createApi();

		await toucanWebExtension(api);

		for (const name of ["web_search", "fetch_content", "get_search_content", "source_check"]) {
			expect(tools.get(name)?.renderCall).toBeDefined();
			expect(tools.get(name)?.renderResult).toBeDefined();
		}

		const enable = tools.get("web_enable");
		expect(enable).toBeDefined();
		expect(render(enable!, "call", {})).toContain("• Toucan Web");

		const fetch = tools.get("fetch_content");
		expect(fetch).toBeDefined();
		expect(render(fetch!, "call", { url: "https://example.com" })).toContain("• Fetch https://example.com");
		expect(render(fetch!, "call", { urls: ["https://example.com/a", "https://example.com/b"] })).toContain(
			"• Fetch 2 URLs",
		);

		const sourceCheck = tools.get("source_check");
		expect(render(sourceCheck!, "call", { claim: "Saturn has rings" })).toContain(
			'• Source Check "Saturn has rings"',
		);
		const getContent = tools.get("get_search_content");
		expect(render(getContent!, "call", { responseId: "abc12345", query: "rings" })).toContain(
			'• Get Content "rings"',
		);

		const partial = render(
			fetch!,
			"result",
			{},
			{ content: [{ type: "text", text: "" }], details: { phase: "fetch", progress: 0.5 } },
			{ expanded: false, isPartial: true },
		);
		expect(partial).toContain("Fetching");
		expect(partial).not.toMatch(/[█░]/);

		const search = tools.get("web_search");
		expect(search).toBeDefined();
		const searching = render(
			search!,
			"result",
			{},
			{ content: [{ type: "text", text: "" }], details: { phase: "searching", progress: 0.75 } },
			{ expanded: false, isPartial: true },
		);
		expect(searching).toContain("Searching");
		expect(searching).not.toMatch(/[█░]/);

		const final = render(
			fetch!,
			"result",
			{},
			{
				content: [{ type: "text", text: "Example page content" }],
				details: { urlCount: 1, title: "Example", totalChars: 123 },
			},
		);
		expect(final).toContain("Example");
		expect(final).toContain("123 chars");
		expect(final).toContain("Example page content");
	});
});
