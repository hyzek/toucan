import type { AssistantMessage } from "@hyzek/toucan-ai";
import { type Component, Container, Markdown, type MarkdownTheme, MouseRegion, Spacer, Text } from "@hyzek/toucan-tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import { formatElapsedSeconds } from "../../../utils/duration.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * A Markdown block of the last update. The next update reuses it at the same position for the same kind of content, so
 * a streamed answer keeps the blocks it already rendered, also once the stream ends.
 */
interface MarkdownSlot {
	kind: "text" | "thinking";
	markdown: Markdown;
}

/**
 * The row a finished thinking run collapses to: `Thought for 3s`, or the bare `Thought` when the run
 * came from a resumed session and nothing was timed. A blank hidden label is the configured way to
 * show no thinking row, so it collapses to no row here as well.
 */
function thoughtLabel(hiddenLabel: string, durationMs: number | undefined): string {
	if (!hiddenLabel.trim()) return "";
	if (durationMs === undefined) return "Thought";
	return `Thought for ${formatThoughtDuration(durationMs)}`;
}

/**
 * Whole seconds, except under a second, where `0s` would read as a broken timer. The running tool
 * group keeps its `0s` tail because that number counts up.
 */
function formatThoughtDuration(durationMs: number): string {
	if (durationMs < 1000) return `${(durationMs / 1000).toFixed(1)}s`;
	return formatElapsedSeconds(durationMs);
}

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private outputPad: number;
	private markdownTransformers: readonly MarkdownTransformer[];
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;
	private isStreaming = false;
	private messageId?: string;
	private timestamp?: string;
	private thinkingVisibilityOverrides = new Map<number, boolean>();
	/** When each thinking run was first seen streaming, and when it stopped: the wall time of `Thought for 3s`. */
	private thinkingRunStarts = new Map<number, number>();
	private thinkingRunEnds = new Map<number, number>();
	private markdownSlots: MarkdownSlot[] = [];

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel = "Thinking...",
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		messageId?: string,
		timestamp?: string,
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;
		this.messageId = messageId;
		this.timestamp = timestamp;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	/**
	 * The wall time of a thinking run, or `undefined` when it cannot be known.
	 *
	 * Only a run the transcript watched stream can be timed: the first update carrying it starts the
	 * clock, the first update that shows it is over stops it. A resumed session has no deltas, and
	 * the session stores no reasoning timings, so its rows get no duration; the request span that
	 * the entry timestamps do give covers the answer and the call arguments as well, which is a
	 * number too wrong to print. Storing the span would be a session format change.
	 */
	private thinkingRunDuration(runIndex: number, running: boolean): number | undefined {
		if (running) {
			this.thinkingRunStarts.set(runIndex, this.thinkingRunStarts.get(runIndex) ?? Date.now());
			return undefined;
		}
		const startedAt = this.thinkingRunStarts.get(runIndex);
		if (startedAt === undefined) {
			return undefined;
		}
		const endedAt = this.thinkingRunEnds.get(runIndex) ?? Date.now();
		this.thinkingRunEnds.set(runIndex, endedAt);
		return endedAt - startedAt;
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		this.thinkingVisibilityOverrides.clear();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		// Markdown takes its padding at construction.
		this.markdownSlots = [];
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	/**
	 * Whether this message row shows anything. A reply that is only tool calls builds no visible
	 * children, so it sits between tool rows without breaking up the run they group into.
	 */
	hasVisibleContent(): boolean {
		return this.contentContainer.children.length > 0;
	}

	updateContent(message: AssistantMessage, isStreaming = this.isStreaming): void {
		this.lastMessage = message;
		this.isStreaming = isStreaming;

		// Clear content container
		this.contentContainer.clear();
		const previousSlots = this.markdownSlots;
		this.markdownSlots = [];
		const markdownBlock = (kind: MarkdownSlot["kind"], text: string, create: () => Markdown): Markdown => {
			const slot = previousSlots[this.markdownSlots.length];
			const markdown = slot?.kind === kind ? slot.markdown : create();
			markdown.setText(text);
			this.markdownSlots.push({ kind, markdown });
			return markdown;
		};

		// Spacers are added lazily, right before the next visible content block. This puts a blank
		// line before the first visible block and after each visible thinking run that is followed
		// by more visible content, while hidden thinking runs without a label contribute nothing.
		let needsSpacer = true;
		const addVisibleChild = (child: Component) => {
			if (needsSpacer) {
				this.contentContainer.addChild(new Spacer(1));
				needsSpacer = false;
			}
			this.contentContainer.addChild(child);
		};

		// Render content in order
		let thinkingRunIndex = 0;
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				const text = content.text.trim();
				addVisibleChild(
					markdownBlock(
						"text",
						text,
						() =>
							new Markdown(text, this.outputPad, 0, this.markdownTheme, undefined, {
								transform: createMarkdownTransform(
									"assistant",
									() => this.isStreaming,
									this.markdownTransformers,
									this.messageId,
									this.timestamp,
								),
							}),
					),
				);
			} else if (content.type === "thinking") {
				const thinkingBlocks: string[] = [];
				for (; i < message.content.length; i++) {
					const thinkingContent = message.content[i];
					if (thinkingContent.type !== "thinking") {
						break;
					}
					const thinking = thinkingContent.thinking.trim();
					if (thinking) {
						thinkingBlocks.push(thinking);
					}
				}
				// `i` is the index after the run: the run is live only when nothing follows it.
				const thinkingRunEndsAt = i;
				i--;

				if (thinkingBlocks.length === 0) {
					continue;
				}

				const runIndex = thinkingRunIndex++;
				// A thinking run is live only while it is the last thing in a message that keeps streaming.
				// Once an answer or a tool call follows it, or the message ends, it collapses.
				const running = isStreaming && thinkingRunEndsAt === message.content.length;
				const durationMs = this.thinkingRunDuration(runIndex, running);
				const label = running ? this.hiddenThinkingLabel : thoughtLabel(this.hiddenThinkingLabel, durationMs);
				const hidden = this.thinkingVisibilityOverrides.get(runIndex) ?? (this.hideThinkingBlock || !running);
				// A hidden run with an empty label renders nothing, including no spacing.
				if (hidden && !label.trim()) {
					continue;
				}
				const thinking = thinkingBlocks.join("\n\n");
				const thinkingComponent = hidden
					? new Text(theme.italic(theme.fg("thinkingText", label)), this.outputPad, 0)
					: markdownBlock(
							"thinking",
							thinking,
							() =>
								new Markdown(
									thinking,
									this.outputPad,
									0,
									this.markdownTheme,
									{
										color: (text: string) => theme.fg("thinkingText", text),
										italic: true,
									},
									{
										transform: createMarkdownTransform(
											"assistant-thinking",
											() => this.isStreaming,
											this.markdownTransformers,
											this.messageId,
											this.timestamp,
										),
									},
								),
						);
				addVisibleChild(
					new MouseRegion(thinkingComponent, (event) => {
						if (event.type !== "click" || event.button !== "left") return undefined;
						this.thinkingVisibilityOverrides.set(runIndex, !hidden);
						if (this.lastMessage) this.updateContent(this.lastMessage);
						return { handled: true };
					}),
				);
				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				needsSpacer = true;
			}
		}

		// Check if incomplete/failed - show after partial content.
		// For aborted/error tool calls, tool execution components show the error.
		// Length stops can happen before a tool call is complete, so surface them here too.
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
		if (message.stopReason === "length") {
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(
				new Text(theme.fg("error", "Response was truncated before completion."), this.outputPad, 0),
			);
		} else if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), this.outputPad, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), this.outputPad, 0));
			}
		}
	}
}
