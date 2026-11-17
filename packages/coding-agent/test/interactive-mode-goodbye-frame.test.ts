import { Container, TuiMainScreen } from "@hyzek/toucan-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type GoodbyeFrameContext = {
	clearStatusIndicator: () => void;
	pendingMessagesContainer: Container;
	statusContainer: Container;
	widgetContainerAbove: Container;
	tipContainer: Container;
	shortcutsPanel: { setOpen: (open: boolean) => void };
	editorContainer: Container;
	widgetContainerBelow: Container;
	footerContainer: Container;
	hintsContainer: Container;
	documentContainer: Container;
	outputPad: number;
	ui: { renderNow: () => void };
};

const prototype = InteractiveMode.prototype as unknown as {
	renderGoodbyeFrame(this: GoodbyeFrameContext): void;
};

function textComponent(label: string): Container {
	const container = new Container();
	container.addChild({ render: () => [label], invalidate: () => {} });
	return container;
}

function createContext(): GoodbyeFrameContext {
	return {
		clearStatusIndicator: vi.fn(),
		pendingMessagesContainer: textComponent("queued message"),
		statusContainer: textComponent("Qwen 3.8 Flash (IQ3_XXS Q8E) · max"),
		widgetContainerAbove: textComponent("extension widget"),
		tipContainer: textComponent("Tip: /model switches models"),
		shortcutsPanel: { setOpen: vi.fn() },
		editorContainer: textComponent("> give toucan a task"),
		widgetContainerBelow: textComponent("extension widget below"),
		footerContainer: textComponent("~/repo main"),
		hintsContainer: textComponent("? for shortcuts"),
		documentContainer: textComponent("transcript line"),
		outputPad: 1,
		ui: { renderNow: vi.fn() },
	};
}

describe("InteractiveMode.renderGoodbyeFrame", () => {
	beforeAll(() => initTheme("dark"));

	test("clears the live input area and ends the document with a bye line", () => {
		const context = createContext();

		prototype.renderGoodbyeFrame.call(context);

		expect(context.clearStatusIndicator).toHaveBeenCalled();
		expect(context.shortcutsPanel.setOpen).toHaveBeenCalledWith(false);
		for (const container of [
			context.pendingMessagesContainer,
			context.statusContainer,
			context.widgetContainerAbove,
			context.tipContainer,
			context.editorContainer,
			context.widgetContainerBelow,
			context.footerContainer,
			context.hintsContainer,
		]) {
			expect(container.children).toHaveLength(0);
		}

		const document = stripAnsi(context.documentContainer.children.flatMap((child) => child.render(80)).join("\n"));
		expect(document).toContain("transcript line");
		expect(document).toContain("Bye!");
		expect(document).not.toContain("give toucan a task");
		expect(document).not.toContain("for shortcuts");
	});

	test("repaints so the goodbye frame reaches the terminal before stop", () => {
		const context = createContext();

		prototype.renderGoodbyeFrame.call(context);

		expect(context.ui.renderNow).toHaveBeenCalledOnce();
	});

	test("the terminal no longer shows the input area after the goodbye frame", async () => {
		const context = createContext();
		const terminal = new VirtualTerminal(80, 12);
		const tui = new TuiMainScreen(terminal);
		for (const container of [
			context.documentContainer,
			context.statusContainer,
			context.tipContainer,
			context.editorContainer,
			context.footerContainer,
			context.hintsContainer,
		]) {
			tui.addChild(container);
		}
		context.ui = { renderNow: () => tui.renderNow() };
		tui.renderNow();
		await terminal.waitForRender();

		prototype.renderGoodbyeFrame.call(context);
		await terminal.waitForRender();

		const viewport = (await terminal.flushAndGetViewport())
			.map((line) => line.trimEnd())
			.filter((line) => line.length > 0);
		const text = viewport.join("\n");
		expect(text).toContain("transcript line");
		expect(text).toContain("Bye!");
		expect(text).not.toContain("give toucan a task");
		expect(text).not.toContain("Qwen 3.8 Flash");
		expect(text).not.toContain("Tip:");
		expect(text).not.toContain("for shortcuts");
		expect(text).not.toContain("~/repo");
	});
});
