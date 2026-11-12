/**
 * Design sketch: the user message row in the transcript and the composer band.
 *
 * From the repo root: npm run build
 * From packages/coding-agent: node test/ui-demos/03-message-surface.ts
 *
 * Keys: t theme, q quit.
 */

import { type Component, Editor, Markdown, type TUI, visibleWidth } from "@hyzek/toucan-tui";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { CustomEditor, inputBandOptions } from "../../src/modes/interactive/components/custom-editor.ts";
import { WorkingStatusIndicator } from "../../src/modes/interactive/components/status-indicator.ts";
import { UserMessageComponent } from "../../src/modes/interactive/components/user-message.ts";
import { getEditorTheme, getMarkdownTheme, theme } from "../../src/modes/interactive/theme/theme.ts";
import { type Demo, runDemo } from "./demo-kit.ts";

const PROMPT = "› ";
const MESSAGE = "Summarize the auth flow in src/server/auth.ts and list the missing tests.";

class PrefixedMessage implements Component {
	private readonly child: Component;
	private readonly prefix: string;

	constructor(child: Component, prefix: string) {
		this.child = child;
		this.prefix = prefix;
	}

	invalidate(): void {
		this.child.invalidate?.();
	}

	render(width: number): string[] {
		const prefixWidth = visibleWidth(this.prefix);
		const lines = this.child.render(Math.max(1, width - prefixWidth));
		return lines.map((line, index) => `${index === 0 ? this.prefix : " ".repeat(prefixWidth)}${line}`);
	}
}

class MessageDemo implements Demo {
	readonly title = "Message input surface";
	readonly help = "transcript user message variants and composer band variants";

	private readonly currentUser: UserMessageComponent;
	private readonly flushUser: Markdown;
	private readonly prefixedUser: Markdown;
	private readonly plainUser: Markdown;
	private readonly currentComposer: Editor;
	private readonly oneRowComposer: Editor;
	private readonly statusComposer: CustomEditor;
	private readonly statusIndicator: WorkingStatusIndicator;

	constructor(tui: TUI) {
		this.currentUser = new UserMessageComponent(MESSAGE);
		this.flushUser = new Markdown(MESSAGE, 1, 0, getMarkdownTheme(), {
			color: (text) => theme.fg("userMessageText", text),
			bgColor: (text) => theme.bg("userMessageBg", text),
		});
		this.prefixedUser = new Markdown(MESSAGE, 0, 0, getMarkdownTheme(), {
			color: (text) => theme.fg("userMessageText", text),
			bgColor: (text) => theme.bg("userMessageBg", text),
		});
		this.plainUser = new Markdown(MESSAGE, 0, 0, getMarkdownTheme());

		this.currentComposer = new Editor(tui, getEditorTheme(), inputBandOptions());
		this.oneRowComposer = new Editor(tui, getEditorTheme(), { ...inputBandOptions(), minLines: 0 });
		this.statusComposer = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create(), {
			...inputBandOptions(),
			minLines: 0,
			embedWorkingStatus: true,
		});
		this.statusIndicator = new WorkingStatusIndicator(tui, "Working");
		this.statusIndicator.setLine({ label: "Working", status: "312 tokens · 2s" });
		this.statusComposer.setWorkingStatusIndicator(this.statusIndicator);
	}

	render(width: number): string[] {
		const promptPrefix = theme.bg("userMessageBg", theme.fg("userMessageText", PROMPT));
		const plainPrefix = theme.fg("userMessageText", PROMPT);
		const lines: string[] = [];

		lines.push(theme.fg("dim", "  transcript user message"));
		lines.push(theme.fg("muted", "  shipped: padded background + indent + arrow"));
		lines.push(...this.currentUser.render(width));
		lines.push(theme.fg("muted", "  alternative: flush, one row per line"));
		lines.push(...this.flushUser.render(width));
		lines.push(theme.fg("muted", "  alternative: flush + prompt"));
		lines.push(...new PrefixedMessage(this.prefixedUser, promptPrefix).render(width));
		lines.push(theme.fg("muted", "  alternative: no background + prompt"));
		lines.push(...new PrefixedMessage(this.plainUser, plainPrefix).render(width));
		lines.push("");

		lines.push(theme.fg("dim", "  composer band"));
		lines.push(theme.fg("muted", "  current: three rows"));
		lines.push(...this.currentComposer.render(width));
		lines.push(theme.fg("muted", "  one row at rest"));
		lines.push(...this.oneRowComposer.render(width));
		lines.push(theme.fg("muted", "  one row + activity row"));
		lines.push(...this.statusComposer.render(width));
		return lines;
	}

	dispose(): void {
		this.statusIndicator.dispose();
	}
}

runDemo((tui) => new MessageDemo(tui));
