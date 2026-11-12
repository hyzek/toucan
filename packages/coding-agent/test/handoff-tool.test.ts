import type { TUI } from "@hyzek/toucan-tui";
import { describe, expect, it } from "vitest";
import type { ExtensionToolContext } from "../src/core/extensions/types.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { createHandoffToolDefinition, type HandoffToolDetails } from "../src/core/tools/handoff.ts";
import { HandoffMenu } from "../src/modes/interactive/components/handoff-menu.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const ENTER = "\r";
const DOWN = "\x1b[B";
const ESC = "\x1b";

const options = [
	{ label: "Yes — start implementing", description: "turns plan mode off", startImplementation: true },
	{ label: "Keep planning", description: "stay read-only" },
];

function fakeCtx(custom: (factory: unknown) => Promise<unknown>, mode = "tui", hasUI = true): ExtensionToolContext {
	return { mode, hasUI, ui: { custom } } as unknown as ExtensionToolContext;
}

describe("handoff tool execute", () => {
	it("asks in non-interactive runs instead of blocking", async () => {
		const definition = createHandoffToolDefinition();
		const result = await definition.execute(
			"call-1",
			{ prompt: "Start?", options },
			undefined,
			undefined,
			fakeCtx(async () => ({ choiceIndex: 0, dismissed: false }), "print", false),
		);
		const text = result.content[0];
		expect(text?.type === "text" && text.text).toContain("interactive");
	});

	it("returns the chosen option and exits plan mode for startImplementation choices", async () => {
		let exited = false;
		const definition = createHandoffToolDefinition({
			isPlanMode: () => true,
			exitPlanMode: () => {
				exited = true;
			},
		});
		const result = await definition.execute(
			"call-1",
			{ prompt: "Hand off to build mode?", summary: "Next step: write the registry", options },
			undefined,
			undefined,
			fakeCtx(async () => ({ choiceIndex: 0, dismissed: false })),
		);
		const text = result.content[0];
		expect(text?.type === "text" && text.text).toContain("User chose: Yes — start implementing");
		expect((result.details as HandoffToolDetails).planModeExited).toBe(true);
		expect(exited).toBe(true);
	});

	it("does not exit plan mode for other choices", async () => {
		let exited = false;
		const definition = createHandoffToolDefinition({
			isPlanMode: () => true,
			exitPlanMode: () => {
				exited = true;
			},
		});
		const result = await definition.execute(
			"call-1",
			{ prompt: "Hand off?", options },
			undefined,
			undefined,
			fakeCtx(async () => ({ choiceIndex: 1, dismissed: false })),
		);
		expect((result.details as HandoffToolDetails).choice?.label).toBe("Keep planning");
		expect((result.details as HandoffToolDetails).planModeExited).toBe(false);
		expect(exited).toBe(false);
	});

	it("dismissal tells the model not to implement", async () => {
		const definition = createHandoffToolDefinition();
		const result = await definition.execute(
			"call-1",
			{ prompt: "Hand off?", options },
			undefined,
			undefined,
			fakeCtx(async () => ({ choiceIndex: 0, dismissed: true })),
		);
		const text = result.content[0];
		expect(text?.type === "text" && text.text).toContain("do not start implementing");
	});
});

describe("HandoffMenu component", () => {
	initTheme("dark");

	function makeMenu(optionsArg = options) {
		let result: { choiceIndex: number; dismissed: boolean } | undefined;
		const tui = { requestRender: () => {} } as unknown as TUI;
		const menu = new HandoffMenu(
			tui,
			new KeybindingsManager(),
			"Hand off to build mode and start implementing?",
			"Plan is ready: 3 steps.",
			optionsArg,
			(r) => {
				result = r;
			},
		);
		return { menu, result: () => result };
	}

	it("renders prompt, summary, and options with band background and no hint row", () => {
		const { menu } = makeMenu();
		const lines = menu.render(100);
		const body = lines.map(stripAnsi).join("\n");
		expect(body).toContain("Hand off to build mode and start implementing?");
		expect(body).toContain("Plan is ready: 3 steps.");
		expect(body).toContain("1. Yes — start implementing");
		expect(body).toContain("turns plan mode off");
		expect(body).toContain("2. Keep planning");
		expect(body).not.toContain("move");
		for (const line of lines) {
			expect(line).toMatch(/\x1b\[48;/);
		}
	});

	it("down moves the cursor and enter confirms the choice", () => {
		const { menu, result } = makeMenu();
		menu.handleInput(DOWN);
		menu.handleInput(ENTER);
		expect(result()).toEqual({ choiceIndex: 1, dismissed: false });
	});

	it("escape dismisses", () => {
		const { menu, result } = makeMenu();
		menu.handleInput(ESC);
		expect(result()).toEqual({ choiceIndex: 0, dismissed: true });
	});
});
