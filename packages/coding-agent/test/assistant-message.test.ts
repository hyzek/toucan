import type { AssistantMessage } from "@hyzek/toucan-ai";
import type { TuiMouseEvent } from "@hyzek/toucan-tui";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import * as syntaxHighlight from "../src/utils/syntax-highlight.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/** Fixed request start, so thought durations do not depend on the clock. */
const START = 1_800_000_000_000;

function createAssistantMessage(
	content: AssistantMessage["content"],
	overrides: Partial<Pick<AssistantMessage, "stopReason" | "timestamp">> = {},
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: overrides.stopReason ?? "stop",
		timestamp: overrides.timestamp ?? Date.now(),
	};
}

/** Left-clicks the first rendered line containing `text`. */
function clickLine(component: AssistantMessageComponent, width: number, text: string): boolean {
	const lines = component.render(width);
	const y = lines.findIndex((line) => stripAnsi(line).includes(text));
	if (y < 0) throw new Error(`no rendered line contains ${text}`);
	const event: TuiMouseEvent = {
		type: "click",
		button: "left",
		x: 1,
		y,
		screenX: 1,
		screenY: y,
		width,
		height: lines.length,
		shift: false,
		alt: false,
		ctrl: false,
		clickCount: 1,
	};
	return component.handleMouse(event)?.handled === true;
}

describe("AssistantMessageComponent", () => {
	afterEach(() => vi.restoreAllMocks());

	test("reuses its Markdown across streaming and its end, and renders like a new component after a theme change", () => {
		initTheme("dark");
		const highlight = vi.spyOn(syntaxHighlight, "highlight");
		const streaming: boolean[] = [];
		const code = "```ts\nconst a = 1;\n```";
		const content = (text: string): AssistantMessage["content"] => [
			{ type: "thinking", thinking: "Thinking with **bold** text" },
			{ type: "text", text },
		];
		const component = new AssistantMessageComponent(undefined, false, undefined, "Thinking...", 1, [
			(markdown, { isStreaming }) => {
				streaming.push(isStreaming);
				return markdown;
			},
		]);
		component.updateContent(createAssistantMessage(content(code)), true);
		component.render(80);
		const message = createAssistantMessage(content(`${code}\n\nThe end.`));
		component.updateContent(message, false);
		component.render(80);
		expect(highlight).toHaveBeenCalledTimes(1);
		expect(streaming.at(-1)).toBe(false);

		initTheme("light");
		component.invalidate();
		expect(component.render(80)).toEqual(new AssistantMessageComponent(message).render(80));
		initTheme("dark");
	});

	test("adds OSC 133 zone markers to assistant messages without tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(createAssistantMessage([{ type: "text", text: "hello" }]));
		const lines = component.render(40);

		expect(lines).not.toHaveLength(0);
		expect(lines[0]).toContain(OSC133_ZONE_START);
		expect(lines[lines.length - 1].startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)).toBe(true);
	});

	test("does not add OSC 133 zone markers when assistant message contains tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "text", text: "calling tool" },
				{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "file.txt" } },
			]),
		);
		const rendered = component.render(60).join("\n");

		expect(rendered.includes(OSC133_ZONE_START)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_END)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_FINAL)).toBe(false);
	});

	test("renders length stops with neutral truncation wording", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "thinking", thinking: "private reasoning" }], { stopReason: "length" }),
			true,
		);
		const rendered = component.render(80).join("\n");

		expect(rendered).toContain("Thought");
		expect(rendered).toContain("Response was truncated before completion.");
	});

	test("coalesces adjacent thinking blocks into one thought row", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "thinking", thinking: "first thought" },
				{ type: "thinking", thinking: "" },
				{ type: "thinking", thinking: "second thought" },
				{ type: "text", text: "answer" },
			]),
			true,
		);
		const rendered = stripAnsi(component.render(80).join("\n"));

		expect(rendered).toContain("Thought");
		expect(rendered.match(/Thought/g)).toHaveLength(1);
		expect(rendered).toContain("answer");
	});

	test("renders nothing for hidden thinking with an empty label", () => {
		initTheme("dark");

		const thinkingOnly = new AssistantMessageComponent(
			createAssistantMessage(
				[
					{ type: "thinking", thinking: "reasoning" },
					{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "file.txt" } },
				],
				{ stopReason: "toolUse" },
			),
			true,
			undefined,
			"",
		);
		expect(thinkingOnly.render(80)).toEqual([]);

		const withText = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "thinking", thinking: "reasoning" },
				{ type: "text", text: "answer" },
			]),
			true,
			undefined,
			"",
		);
		expect(withText.render(80).map((line) => stripAnsi(line).trim())).toEqual(["", "answer"]);
	});

	test("keeps the thought row and its spacing for collapsed thinking", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "thinking", thinking: "reasoning" },
				{ type: "text", text: "answer" },
			]),
			true,
		);
		expect(component.render(80).map((line) => stripAnsi(line).trim())).toEqual(["", "Thought", "", "answer"]);
	});

	test("expands a collapsed thinking run when clicked", () => {
		initTheme("dark");
		const component = new AssistantMessageComponent();
		component.updateContent(
			createAssistantMessage([
				{ type: "thinking", thinking: "first reasoning" },
				{ type: "text", text: "answer" },
				{ type: "thinking", thinking: "second reasoning" },
			]),
			true,
		);
		const width = 80;

		const collapsed = stripAnsi(component.render(width).join("\n"));
		expect(collapsed).toContain("Thought");
		expect(collapsed).toContain("second reasoning");
		expect(clickLine(component, width, "Thought")).toBe(true);

		const expanded = stripAnsi(component.render(width).join("\n"));
		expect(expanded).toContain("first reasoning");
		expect(expanded).toContain("second reasoning");
	});

	test("collapses a live thinking run when clicked", () => {
		initTheme("dark");
		const component = new AssistantMessageComponent();
		component.updateContent(createAssistantMessage([{ type: "thinking", thinking: "first reasoning" }]), true);
		const width = 80;

		expect(stripAnsi(component.render(width).join("\n"))).toContain("first reasoning");
		expect(clickLine(component, width, "first reasoning")).toBe(true);

		const collapsed = stripAnsi(component.render(width).join("\n"));
		expect(collapsed).not.toContain("first reasoning");
		expect(collapsed).toContain("Thinking...");
	});

	test("streams thinking while it runs and times it once the answer follows", () => {
		initTheme("dark");
		const now = vi.spyOn(Date, "now").mockReturnValue(START);
		const component = new AssistantMessageComponent();
		const thinking: AssistantMessage["content"] = [{ type: "thinking", thinking: "step by step" }];

		component.updateContent(createAssistantMessage(thinking, { timestamp: START }), true);
		const live = stripAnsi(component.render(80).join("\n"));
		expect(live).toContain("step by step");
		expect(live).not.toContain("Thought");

		now.mockReturnValue(START + 2000);
		component.updateContent(
			createAssistantMessage([...thinking, { type: "text", text: "answer" }], { timestamp: START }),
			false,
		);
		const finished = stripAnsi(component.render(80).join("\n"));
		expect(finished).not.toContain("step by step");
		expect(finished).toContain("Thought for 2s");
	});

	test("renders no thought row for a reply without thinking", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(createAssistantMessage([{ type: "text", text: "hello" }]));
		expect(stripAnsi(component.render(80).join("\n"))).not.toContain("Thought");
	});

	test("uses configured output padding for text and thinking", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(undefined, false, undefined, "Thinking...", 1);
		component.updateContent(
			createAssistantMessage([
				{ type: "text", text: "hello" },
				{ type: "thinking", thinking: "reasoning" },
			]),
			true,
		);
		const lines = component.render(80).map((line) => stripAnsi(line));

		expect(lines.some((line) => line.includes(" hello"))).toBe(true);
		expect(lines.some((line) => line.includes(" reasoning"))).toBe(true);

		component.setOutputPad(0);
		const updatedLines = component.render(80).map((line) => stripAnsi(line));
		expect(updatedLines.some((line) => line.startsWith("hello"))).toBe(true);
		expect(updatedLines.some((line) => line.startsWith("reasoning"))).toBe(true);
	});

	test("chains Markdown transformers in registration order", () => {
		initTheme("dark");
		const calls: string[] = [];
		const message = createAssistantMessage([{ type: "text", text: "The result is $x^2$." }]);
		const component = new AssistantMessageComponent(message, false, undefined, "Thinking...", 1, [
			(markdown, context) => {
				calls.push("formula");
				expect(context).toEqual({ messageType: "assistant", isStreaming: false, availableWidth: 78 });
				return markdown.replace("$x^2$", "x²");
			},
			(markdown) => {
				calls.push("suffix");
				return `${markdown} Done.`;
			},
		]);

		expect(stripAnsi(component.render(80).join("\n"))).toContain("The result is x². Done.");
		expect(calls).toEqual(["formula", "suffix"]);
	});

	test("identifies partial assistant Markdown as streaming", () => {
		initTheme("dark");
		const streamingStates: boolean[] = [];
		const message = createAssistantMessage([{ type: "text", text: "partial" }]);
		const component = new AssistantMessageComponent(undefined, false, undefined, "Thinking...", 1, [
			(markdown, context) => {
				streamingStates.push(context.isStreaming);
				return context.isStreaming ? markdown : `${markdown} transformed`;
			},
		]);

		component.updateContent(message, true);
		expect(stripAnsi(component.render(80).join("\n"))).not.toContain("transformed");

		component.updateContent(message, false);
		expect(stripAnsi(component.render(80).join("\n"))).toContain("partial transformed");
		expect(streamingStates).toEqual([true, false]);
	});

	test("reapplies Markdown transformers when available width changes", () => {
		initTheme("dark");
		const availableWidths: number[] = [];
		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "text", text: "answer" }]),
			false,
			undefined,
			"Thinking...",
			1,
			[
				(markdown, context) => {
					availableWidths.push(context.availableWidth);
					return `${markdown} (${context.availableWidth})`;
				},
			],
		);

		expect(stripAnsi(component.render(80).join("\n"))).toContain("answer (78)");
		component.render(80);
		expect(stripAnsi(component.render(60).join("\n"))).toContain("answer (58)");
		expect(availableWidths).toEqual([78, 58]);
	});

	test("continues the Markdown transformer chain when a transformer throws", () => {
		initTheme("dark");
		const calls: string[] = [];
		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "text", text: "still visible" }]),
			false,
			undefined,
			"Thinking...",
			1,
			[
				(markdown) => {
					calls.push("first");
					return markdown.replace("still", "remains");
				},
				() => {
					calls.push("throw");
					throw new Error("broken transformer");
				},
				(markdown) => {
					calls.push("last");
					return `${markdown} after error`;
				},
			],
		);

		expect(stripAnsi(component.render(80).join("\n"))).toContain("remains visible after error");
		expect(calls).toEqual(["first", "throw", "last"]);
	});

	test("transforms text and thinking Markdown without mutating the original message", () => {
		initTheme("dark");
		const message = createAssistantMessage([
			{ type: "text", text: "answer" },
			{ type: "thinking", thinking: "reasoning" },
		]);
		const component = new AssistantMessageComponent(undefined, false, undefined, "Thinking...", 1, [
			(markdown, { messageType }) => {
				return `${messageType}:${markdown}`;
			},
		]);
		component.updateContent(message, true);

		const rendered = stripAnsi(component.render(80).join("\n"));
		expect(rendered).toContain("assistant:answer");
		expect(rendered).toContain("assistant-thinking:reasoning");
		expect(message.content).toEqual([
			{ type: "text", text: "answer" },
			{ type: "thinking", thinking: "reasoning" },
		]);
	});

	test("uses configured output padding for user messages", () => {
		initTheme("dark");

		const paddedComponent = new UserMessageComponent("hello", undefined, 1);
		const paddedLines = paddedComponent.render(40).map((line) => stripAnsi(line));
		expect(paddedLines.some((line) => line.startsWith(" hello"))).toBe(true);

		const unpaddedComponent = new UserMessageComponent("hello", undefined, 0);
		const unpaddedLines = unpaddedComponent.render(40).map((line) => stripAnsi(line));
		expect(unpaddedLines.some((line) => line.startsWith("hello"))).toBe(true);
	});
});
