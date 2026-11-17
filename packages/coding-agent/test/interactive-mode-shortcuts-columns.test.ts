import type { KeyId } from "@hyzek/toucan-tui";
import { beforeEach, describe, expect, it } from "vitest";
import type { ExtensionShortcut } from "../src/core/extensions/types.ts";
import type { ShortcutColumn } from "../src/modes/interactive/components/shortcuts-panel.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

type ShortcutsColumnsContext = {
	keybindings: { getEffectiveConfig: () => Record<string, never> };
	session: { extensionRunner: { getShortcuts: (config: Record<string, never>) => Map<string, ExtensionShortcut> } };
};

const prototype = InteractiveMode.prototype as unknown as {
	buildShortcutColumns(this: ShortcutsColumnsContext): ShortcutColumn[];
};

function shortcut(key: KeyId, extensionPath: string, description: string): ExtensionShortcut {
	return { shortcut: key, description, extensionPath, handler: () => {} };
}

function createContext(shortcuts: Map<string, ExtensionShortcut>): ShortcutsColumnsContext {
	return {
		keybindings: { getEffectiveConfig: () => ({}) },
		session: { extensionRunner: { getShortcuts: () => shortcuts } },
	};
}

function columnOf(columns: ShortcutColumn[], title: string): ShortcutColumn | undefined {
	return columns.find((column) => column.title === title);
}

describe("InteractiveMode shortcut popup columns", () => {
	beforeEach(() => {
		initTheme("dark");
	});

	it("lists built-in extension shortcuts under Session and third-party ones under Extensions", () => {
		const context = createContext(
			new Map<string, ExtensionShortcut>([
				["ctrl+shift+w", shortcut("ctrl+shift+w", "builtin:toucan-web", "Toggle web search activity")],
				["ctrl+t", shortcut("ctrl+t", "/tmp/third-party.ts", "Third-party action")],
			]),
		);

		const columns = prototype.buildShortcutColumns.call(context);

		expect(columnOf(columns, "Session")?.rows).toContainEqual({
			key: "Ctrl+Shift+W",
			description: "Toggle web search activity",
		});
		expect(columnOf(columns, "Extensions")?.rows).toContainEqual({
			key: "Ctrl+T",
			description: "Third-party action",
		});
	});

	it("omits the Extensions column when only built-in shortcuts are registered", () => {
		const context = createContext(
			new Map<string, ExtensionShortcut>([
				["ctrl+shift+w", shortcut("ctrl+shift+w", "builtin:toucan-web", "Toggle web search activity")],
			]),
		);

		const columns = prototype.buildShortcutColumns.call(context);

		expect(columnOf(columns, "Session")?.rows).toContainEqual({
			key: "Ctrl+Shift+W",
			description: "Toggle web search activity",
		});
		expect(columnOf(columns, "Extensions")).toBeUndefined();
	});
});
