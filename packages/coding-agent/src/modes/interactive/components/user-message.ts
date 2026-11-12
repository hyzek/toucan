import { Container, Markdown, type MarkdownTheme, truncateToWidth, visibleWidth } from "@hyzek/toucan-tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const PROMPT = "› ";

/**
 * A user prompt as a padded background band with the composer's prompt arrow.
 *
 * The Markdown owns the background and the vertical padding. This component renders it
 * two columns narrower and prefixes the first text row with the indent and arrow, so the
 * band stays full width while the first line reads like the input that produced it.
 */
export class UserMessageComponent extends Container {
	private text: string;
	private markdownTheme: MarkdownTheme;
	private outputPad: number;
	private markdownTransformers: readonly MarkdownTransformer[];
	private messageId?: string;
	private timestamp?: string;
	private markdown: Markdown;

	constructor(
		text: string,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		messageId?: string,
		timestamp?: string,
	) {
		super();
		this.text = text;
		this.markdownTheme = markdownTheme;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;
		this.messageId = messageId;
		this.timestamp = timestamp;
		this.markdown = this.createMarkdown();
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		this.markdown = this.createMarkdown();
	}

	override invalidate(): void {
		this.markdown.invalidate();
	}

	override render(width: number): string[] {
		const prefixWidth = Math.min(width, Math.max(0, this.outputPad) + visibleWidth(PROMPT));
		const indentWidth = Math.min(Math.max(0, this.outputPad), Math.max(0, prefixWidth - visibleWidth(PROMPT)));
		const indent = " ".repeat(indentWidth);
		const childWidth = Math.max(1, width - prefixWidth);
		const childLines = this.markdown.render(childWidth);
		if (childLines.length === 0) return [];

		const textRow = childLines.length > 1 ? 1 : 0;
		const lines = childLines.map((line, index) => {
			const prefix =
				index === textRow
					? theme.bg("userMessageBg", truncateToWidth(`${indent}${theme.fg("accent", PROMPT)}`, prefixWidth, ""))
					: theme.bg("userMessageBg", " ".repeat(prefixWidth));
			return prefix + line;
		});

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	private createMarkdown(): Markdown {
		return new Markdown(
			this.text,
			0,
			1,
			this.markdownTheme,
			{
				color: (content: string) => theme.fg("userMessageText", content),
				bgColor: (content: string) => theme.bg("userMessageBg", content),
			},
			{
				preserveOrderedListMarkers: true,
				preserveBackslashEscapes: true,
				transform: createMarkdownTransform(
					"user",
					() => false,
					this.markdownTransformers,
					this.messageId,
					this.timestamp,
				),
			},
		);
	}
}
