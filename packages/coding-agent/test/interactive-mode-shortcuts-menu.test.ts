import { Container, type KeyId } from "@hyzek/toucan-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionShortcut } from "../src/core/extensions/types.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { getMarkdownTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type ShortcutsMenuContext = {
	chatContainer: Container;
	keybindings: { getEffectiveConfig: () => Record<string, never> };
	session: { extensionRunner: { getShortcuts: (config: Record<string, never>) => Map<string, ExtensionShortcut> } };
	ui: { requestRender: () => void };
	getEditorKeyDisplay: (action: string) => string;
	getAppKeyDisplay: (action: string) => string;
	getMarkdownThemeWithSettings: () => ReturnType<typeof getMarkdownTheme>;
};

const prototype = InteractiveMode.prototype as unknown as {
	handleHotkeysCommand(this: ShortcutsMenuContext): void;
};

function shortcut(key: KeyId, extensionPath: string, description: string): ExtensionShortcut {
	return { shortcut: key, description, extensionPath, handler: () => {} };
}

function createContext(shortcuts: Map<string, ExtensionShortcut>): ShortcutsMenuContext {
	return {
		chatContainer: new Container(),
		keybindings: { getEffectiveConfig: () => ({}) },
		session: { extensionRunner: { getShortcuts: () => shortcuts } },
		ui: { requestRender: vi.fn() },
		getEditorKeyDisplay: () => "key",
		getAppKeyDisplay: () => "key",
		getMarkdownThemeWithSettings: () => getMarkdownTheme(),
	};
}

describe("InteractiveMode /shortcuts grouping", () => {
	beforeEach(() => {
		initTheme("dark");
	});

	it("lists built-in extension shortcuts under Other and third-party ones under Extensions", () => {
		const context = createContext(
			new Map<string, ExtensionShortcut>([
				["ctrl+shift+w", shortcut("ctrl+shift+w", "builtin:toucan-web", "Toggle web search activity")],
				["ctrl+t", shortcut("ctrl+t", "/tmp/third-party.ts", "Third-party action")],
			]),
		);

		prototype.handleHotkeysCommand.call(context);

		const text = stripAnsi(context.chatContainer.render(200).join("\n"));
		const other = text.indexOf("Other");
		const builtinRow = text.indexOf("Ctrl+Shift+W");
		const extensions = text.indexOf("Extensions");
		const thirdPartyRow = text.indexOf("Ctrl+T");

		expect(other).toBeGreaterThanOrEqual(0);
		expect(builtinRow).toBeGreaterThan(other);
		expect(text).toContain("Toggle web search activity");
		expect(extensions).toBeGreaterThan(builtinRow);
		expect(thirdPartyRow).toBeGreaterThan(extensions);
		expect(text).toContain("Third-party action");
	});

	it("omits the Extensions section when only built-in shortcuts are registered", () => {
		const context = createContext(
			new Map<string, ExtensionShortcut>([
				["ctrl+shift+w", shortcut("ctrl+shift+w", "builtin:toucan-web", "Toggle web search activity")],
			]),
		);

		prototype.handleHotkeysCommand.call(context);

		const text = stripAnsi(context.chatContainer.render(200).join("\n"));
		expect(text).toContain("Ctrl+Shift+W");
		expect(text).not.toContain("Extensions");
	});
});
