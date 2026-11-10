import type { AssistantMessage } from "@hyzek/toucan-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	streamedCharCount,
	WorkingStatusEngine,
	type WorkingStatusLine,
} from "../src/modes/interactive/components/working-status.ts";

/** Only `content` matters to the engine; the rest of the message shape is irrelevant here. */
function assistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return { role: "assistant", content } as unknown as AssistantMessage;
}

function createEngine() {
	const lines: WorkingStatusLine[] = [];
	const engine = new WorkingStatusEngine({ onLine: (line) => lines.push(line) });
	return { engine, lines };
}

describe("WorkingStatusEngine", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("says Working while tool calls stream and run", () => {
		vi.useFakeTimers();
		const { engine, lines } = createEngine();
		engine.begin();
		expect(lines.at(-1)!.label).toBe("Working");

		engine.noteStreamedMessage(assistantMessage([{ type: "toolCall", id: "1", name: "bash", arguments: {} }]));
		expect(lines.at(-1)!.label).toBe("Working");

		engine.noteStreamedMessage(assistantMessage([{ type: "text", text: "done" }]));
		expect(lines.at(-1)!.label).toBe("Working");

		engine.end();
	});

	it("says Thinking while a thinking block is the newest content", () => {
		vi.useFakeTimers();
		const { engine, lines } = createEngine();
		engine.begin();

		engine.noteStreamedMessage(assistantMessage([{ type: "thinking", thinking: "hmm" }]));
		expect(lines.at(-1)!.label).toBe("Thinking");

		// A tool call after the thinking block ends the thinking phase.
		engine.noteStreamedMessage(
			assistantMessage([
				{ type: "thinking", thinking: "hmm" },
				{ type: "toolCall", id: "1", name: "bash", arguments: {} },
			]),
		);
		expect(lines.at(-1)!.label).toBe("Working");

		engine.end();
	});

	it("returns to Working when a tool starts executing", () => {
		vi.useFakeTimers();
		const { engine, lines } = createEngine();
		engine.begin();
		engine.noteStreamedMessage(assistantMessage([{ type: "thinking", thinking: "hmm" }]));
		expect(lines.at(-1)!.label).toBe("Thinking");

		engine.noteToolRunning();
		expect(lines.at(-1)!.label).toBe("Working");

		engine.end();
	});

	it("counts streamed tokens up and reports elapsed time", () => {
		vi.useFakeTimers();
		const { engine, lines } = createEngine();
		engine.begin();

		engine.noteStreamedMessage(assistantMessage([{ type: "text", text: "x".repeat(400) }])); // ~100 tokens
		vi.advanceTimersByTime(1_000);

		const line = lines.at(-1)!;
		expect(line.label).toBe("Working");
		expect(line.status).toBe("100 tokens · 1s");
		const counts = lines
			.map((entry) => /(\d+) tokens/.exec(entry.status)?.[1])
			.filter((value): value is string => value !== undefined)
			.map(Number);
		expect(counts).toEqual([...counts].sort((a, b) => a - b));

		engine.end();
	});

	it("keeps every token digit, grouped with dots", () => {
		vi.useFakeTimers({ now: 0 });
		const { engine } = createEngine();
		engine.begin();
		engine.settleMessage(1_000);
		vi.setSystemTime(5_000);
		expect(engine.line().status).toBe("1.000 tokens · 5s");

		engine.settleMessage(499_000);
		vi.setSystemTime(10_000);
		expect(engine.line().status).toBe("500.000 tokens · 10s");

		engine.end();
	});

	it("abbreviates the runtime timer to minutes and hours", () => {
		vi.useFakeTimers({ now: 0 });
		const { engine } = createEngine();
		engine.begin();

		vi.setSystemTime(60_000);
		expect(engine.line().status).toBe("1m");
		vi.setSystemTime(65_000);
		expect(engine.line().status).toBe("1m 5s");
		vi.setSystemTime(1_000_000);
		expect(engine.line().status).toBe("16m 40s");
		vi.setSystemTime(3_670_000);
		expect(engine.line().status).toBe("1h 1m 10s");

		engine.end();
	});

	it("swaps the streamed estimate for the provider's count without losing the total", () => {
		vi.useFakeTimers();
		const { engine, lines } = createEngine();
		engine.begin();

		engine.noteStreamedMessage(assistantMessage([{ type: "text", text: "x".repeat(400) }]));
		engine.settleMessage(80);
		engine.noteStreamedMessage(assistantMessage([{ type: "text", text: "x".repeat(400) }]));
		vi.advanceTimersByTime(1_000);

		// 80 settled + 100 estimated for the message now streaming.
		expect(lines.at(-1)!.status).toBe("180 tokens · 1s");

		engine.end();
	});

	it("stays quiet while an extension owns the working text", () => {
		vi.useFakeTimers();
		const { engine, lines } = createEngine();
		engine.begin();

		engine.setFrozen(true);
		const frozenAt = lines.length;
		engine.noteToolRunning();
		vi.advanceTimersByTime(3_000);
		expect(lines).toHaveLength(frozenAt);

		engine.setFrozen(false);
		vi.advanceTimersByTime(250);
		expect(lines.length).toBeGreaterThan(frozenAt);

		engine.end();
	});

	it("stops ticking when the turn ends", () => {
		vi.useFakeTimers();
		const { engine, lines } = createEngine();
		engine.begin();
		engine.end();

		const last = lines.length;
		vi.advanceTimersByTime(30_000);
		expect(lines).toHaveLength(last);

		engine.begin();
		engine.noteStreamedMessage(assistantMessage([{ type: "text", text: "again" }]));
		expect(lines.length).toBeGreaterThan(last);
		engine.dispose();
		vi.advanceTimersByTime(30_000);
		expect(lines).toHaveLength(lines.length);
	});

	it("keeps one clock while steering does not restart the turn", () => {
		vi.useFakeTimers();
		const { engine, lines } = createEngine();
		engine.begin();
		engine.noteStreamedMessage(assistantMessage([{ type: "text", text: "x".repeat(400) }]));
		vi.advanceTimersByTime(2_000);
		expect(lines.at(-1)!.status).toBe("100 tokens · 2s");

		engine.begin();
		vi.advanceTimersByTime(1_000);
		expect(lines.at(-1)!.status).toBe("100 tokens · 3s");

		engine.end();
	});
});

describe("streamedCharCount", () => {
	it("counts text, thinking, and tool-call arguments", () => {
		expect(
			streamedCharCount(
				assistantMessage([
					{ type: "text", text: "hello" },
					{ type: "thinking", thinking: "why" },
					{ type: "toolCall", id: "1", name: "bash", arguments: { command: "ls" } },
				]),
			),
		).toBe("hello".length + "why".length + '{"command":"ls"}'.length);
	});
});
