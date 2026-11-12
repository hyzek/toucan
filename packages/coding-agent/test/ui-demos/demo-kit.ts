/**
 * Shared shell for the chat UI design sketches in this directory.
 *
 * The demos are not tests. They render real TUI components against a real terminal
 * so a design can be judged before its product component exists. Run them with
 * `npm run build` once, then `node test/ui-demos/<demo>.ts` from packages/coding-agent.
 */

import {
	type Component,
	ProcessTerminal,
	setKeybindings,
	type TUI,
	TuiMainScreen,
	truncateToWidth,
} from "@hyzek/toucan-tui";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { initTheme, theme } from "../../src/modes/interactive/theme/theme.ts";

export interface Demo {
	title: string;
	help: string;
	render(width: number): string[];
	handleInput?(data: string): boolean;
	dispose?(): void;
}

export type DemoFactory = (tui: TUI) => Demo;

class DemoRoot implements Component {
	private readonly tui: TUI;
	private readonly demo: Demo;
	private disposed = false;

	constructor(tui: TUI, demo: Demo) {
		this.tui = tui;
		this.demo = demo;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		if (data === "q" || data === "\x03") {
			this.dispose();
			this.tui.stop();
			process.exit(0);
		}
		if (data === "t") {
			initTheme(theme.name === "dark" ? "light" : "dark");
			this.tui.invalidate();
			this.tui.requestRender();
			return;
		}
		if (this.demo.handleInput?.(data)) {
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		const title = theme.bold(theme.fg("accent", this.demo.title));
		const help = theme.fg("muted", this.demo.help);
		const controls = theme.fg("dim", "t theme · q quit");
		return [title, help, controls, "", ...this.demo.render(width), "", controls].map((line) =>
			truncateToWidth(line, width, theme.fg("dim", "...")),
		);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.demo.dispose?.();
	}
}

export function runDemo(create: DemoFactory): void {
	initTheme("dark");
	setKeybindings(KeybindingsManager.create());
	const terminal = new ProcessTerminal();
	const tui = new TuiMainScreen(terminal);
	const demo = create(tui);
	const root = new DemoRoot(tui, demo);

	tui.addChild(root);
	tui.setFocus(root);
	tui.start();

	const stop = (): void => {
		root.dispose();
		tui.stop();
		process.exit(0);
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
}
