// Esc-to-interrupt is a double press: the first Esc arms an orange
// `esc again to interrupt` hint in the footer row, a second Esc inside the
// window runs the abort, and the timeout disarms the hint again.

import { setKeybindings } from "@hyzek/toucan-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { HotkeyHints } from "../src/modes/interactive/components/hotkey-hints.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const CONFIRM_MS = 2000;

interface ConfirmationHost {
	activeStatusIndicator: unknown;
	interruptConfirmTimer: ReturnType<typeof setTimeout> | undefined;
	interruptHintOwned: boolean;
	footerHints: HotkeyHints;
	ui: { requestRender(): void };
	renderInterruptHint(): string;
	requestInterrupt(action: () => void): void;
	clearInterruptConfirmation(): void;
}

/** The confirmation methods of InteractiveMode with just the state they touch. */
function createHost(options: { statusIndicator?: unknown; hasInput?: boolean } = {}): ConfirmationHost {
	const host = Object.create(InteractiveMode.prototype) as ConfirmationHost;
	host.activeStatusIndicator = options.statusIndicator;
	host.interruptConfirmTimer = undefined;
	host.interruptHintOwned = false;
	host.footerHints = new HotkeyHints(() => options.hasInput ?? false);
	host.ui = { requestRender: () => {} };
	return host;
}

function hintRow(host: ConfirmationHost): string {
	return host.footerHints.render(200).map((line) => stripAnsi(line).trimEnd())[0] ?? "";
}

describe("InteractiveMode interrupt confirmation", () => {
	beforeAll(() => {
		initTheme("dark");
		setKeybindings(new KeybindingsManager());
	});

	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	test("the first press arms the confirmation without running the action", () => {
		const host = createHost({ statusIndicator: { kind: "working" } });
		const action = vi.fn();

		host.requestInterrupt(action);

		expect(action).not.toHaveBeenCalled();
		expect(hintRow(host)).toBe("  esc again to interrupt");
		expect(host.renderInterruptHint()).toContain(theme.fg("warning", "esc again to interrupt"));
	});

	test("a second press inside the window runs the action and disarms", () => {
		const host = createHost({ statusIndicator: { kind: "working" } });
		const action = vi.fn();

		host.requestInterrupt(action);
		host.requestInterrupt(action);

		expect(action).toHaveBeenCalledExactlyOnceWith();
		expect(host.interruptConfirmTimer).toBeUndefined();
		expect(hintRow(host)).toBe("  esc to interrupt");
	});

	test("the timeout disarms, and the next single press arms again instead of aborting", () => {
		const host = createHost({ statusIndicator: { kind: "working" } });
		const action = vi.fn();

		host.requestInterrupt(action);
		vi.advanceTimersByTime(CONFIRM_MS);
		expect(hintRow(host)).toBe("  esc to interrupt");

		host.requestInterrupt(action);
		expect(action).not.toHaveBeenCalled();
		expect(hintRow(host)).toBe("  esc again to interrupt");
	});

	test("the armed hint stays visible while the prompt has input", () => {
		const host = createHost({ statusIndicator: { kind: "working" }, hasInput: true });
		host.requestInterrupt(() => {});
		expect(hintRow(host)).toBe("  esc again to interrupt");

		host.clearInterruptConfirmation();
		expect(hintRow(host)).toBe("");
	});

	test("without a status indicator the confirmation owns the hint and removes it again", () => {
		const host = createHost();
		host.requestInterrupt(() => {});
		expect(host.interruptHintOwned).toBe(true);
		expect(hintRow(host)).toBe("  esc again to interrupt");

		host.clearInterruptConfirmation();
		expect(hintRow(host)).toBe("");
		expect(host.footerHints.render(200)).toEqual([""]);
	});

	test("clearing the confirmation twice is a no-op", () => {
		const host = createHost({ statusIndicator: { kind: "working" } });
		host.clearInterruptConfirmation();
		host.clearInterruptConfirmation();
		expect(hintRow(host)).toBe("");
	});
});
