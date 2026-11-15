import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type UhmContext = {
	uhmHandoffArmed: boolean;
	uhmEscapeHandler?: () => void;
	defaultEditor: { onEscape?: () => void };
	editor: { setText: (text: string) => void; addToHistory?: (text: string) => void };
	session: {
		isStreaming: boolean;
		isCompacting: boolean;
		model: { id: string } | undefined;
		modelRuntime: {
			streamSimple: (
				model: unknown,
				context: { systemPrompt?: string; messages: Array<{ role: string; content: string }> },
				options: { maxTokens: number },
			) => { result: () => Promise<{ content: Array<{ type: string; text: string }>; stopReason: string }> };
		};
		prompt: (text: string) => Promise<void>;
	};
	handleClearCommand: () => Promise<boolean>;
	showStatus: (message: string) => void;
	showError: (message: string) => void;
	ui: { requestRender: () => void };
	armUhmHandoff: (prompt: string) => void;
	clearUhmArmed: () => void;
	disarmUhmHandoff: () => void;
};

type InteractiveModePrototype = {
	handleUhmCommand(this: UhmContext, dump: string): Promise<void>;
	armUhmHandoff(this: UhmContext, prompt: string): void;
	disarmUhmHandoff(this: UhmContext): void;
	submitUhmHandoff(this: UhmContext, text: string): Promise<void>;
	clearUhmArmed(this: UhmContext): void;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

function createContext(overrides: Partial<UhmContext> = {}): UhmContext {
	const context: UhmContext = {
		uhmHandoffArmed: false,
		defaultEditor: { onEscape: () => {} },
		editor: { setText: vi.fn(), addToHistory: vi.fn() },
		session: {
			isStreaming: false,
			isCompacting: false,
			model: { id: "test-model" },
			modelRuntime: {
				streamSimple: vi.fn(() => ({
					result: async () => ({
						content: [{ type: "text", text: "Build a game with 2 guns." }],
						stopReason: "stop",
					}),
				})),
			},
			prompt: vi.fn(async () => {}),
		},
		handleClearCommand: vi.fn(async () => true),
		showStatus: vi.fn(),
		showError: vi.fn(),
		ui: { requestRender: vi.fn() },
		armUhmHandoff: () => {},
		clearUhmArmed: () => {},
		disarmUhmHandoff: () => {},
		...overrides,
	};
	context.armUhmHandoff = (prompt) => interactiveModePrototype.armUhmHandoff.call(context, prompt);
	context.clearUhmArmed = () => interactiveModePrototype.clearUhmArmed.call(context);
	context.disarmUhmHandoff = () => interactiveModePrototype.disarmUhmHandoff.call(context);
	return context;
}

describe("InteractiveMode /uhm reformulation", () => {
	it("shows usage when the dump is empty", async () => {
		const context = createContext();

		await interactiveModePrototype.handleUhmCommand.call(context, "");

		expect(context.showStatus).toHaveBeenCalledWith("Usage: /uhm <fuzzy idea dump>");
		expect(context.session.modelRuntime.streamSimple).not.toHaveBeenCalled();
	});

	it("refuses when no model is configured", async () => {
		const context = createContext({ session: { ...createContext().session, model: undefined } });

		await interactiveModePrototype.handleUhmCommand.call(context, "build a game and add a gun");

		expect(context.showError).toHaveBeenCalledWith("No model configured. Run /login first.");
		expect(context.session.modelRuntime.streamSimple).not.toHaveBeenCalled();
	});

	it("refuses while the agent is working", async () => {
		const context = createContext({
			session: { ...createContext().session, isStreaming: true },
		});

		await interactiveModePrototype.handleUhmCommand.call(context, "build a game");

		expect(context.showStatus).toHaveBeenCalledWith(
			"/uhm needs the agent idle — wait for the current turn to finish",
		);
		expect(context.session.modelRuntime.streamSimple).not.toHaveBeenCalled();
	});

	it("rephrases with the session model and arms the handoff with the result", async () => {
		const context = createContext();

		await interactiveModePrototype.handleUhmCommand.call(
			context,
			"build a game and add a gun and uhm maybe 2 guns actually",
		);

		expect(context.session.modelRuntime.streamSimple).toHaveBeenCalledWith(
			{ id: "test-model" },
			expect.objectContaining({
				messages: [
					expect.objectContaining({
						role: "user",
						content: "build a game and add a gun and uhm maybe 2 guns actually",
					}),
				],
			}),
			{ maxTokens: 200 },
		);
		expect(context.editor.setText).toHaveBeenCalledWith("Build a game with 2 guns.");
		expect(context.uhmHandoffArmed).toBe(true);
		expect(context.showStatus).toHaveBeenCalledWith("Enter starts a fresh session with this prompt · Esc discards");
		expect(context.showError).not.toHaveBeenCalled();
	});

	it("sends a reformulate-only system prompt", async () => {
		const context = createContext();

		await interactiveModePrototype.handleUhmCommand.call(context, "make a thing");

		const systemPrompt = vi.mocked(context.session.modelRuntime.streamSimple).mock.calls[0][1].systemPrompt;
		expect(systemPrompt).toContain("Never add scope");
		expect(systemPrompt).toContain("Never ask questions");
		expect(systemPrompt).toContain("Reply with only the reformulated prompt");
	});

	it("errors when the model returns no text", async () => {
		const context = createContext({
			session: {
				...createContext().session,
				modelRuntime: {
					streamSimple: vi.fn(() => ({
						result: async () => ({ content: [], stopReason: "stop" }),
					})),
				},
			},
		});

		await interactiveModePrototype.handleUhmCommand.call(context, "build a game");

		expect(context.showError).toHaveBeenCalledWith("The model did not return a reformulation. Try /uhm again.");
		expect(context.uhmHandoffArmed).toBe(false);
	});
});

describe("InteractiveMode /uhm discard", () => {
	it("Esc disarms, clears the editor, and restores the previous escape handler", () => {
		const previousEscape = () => {};
		const context = createContext({ defaultEditor: { onEscape: previousEscape } });
		context.armUhmHandoff("Build a game with 2 guns.");
		const armedEscape = context.defaultEditor.onEscape!;

		armedEscape();

		expect(context.uhmHandoffArmed).toBe(false);
		expect(context.defaultEditor.onEscape).toBe(previousEscape);
		expect(context.editor.setText).toHaveBeenLastCalledWith("");
		expect(context.showStatus).toHaveBeenCalledWith("Handoff discarded");
	});
});

describe("InteractiveMode /uhm handoff", () => {
	it("submits the edited text into a fresh session", async () => {
		const context = createContext();
		context.armUhmHandoff("Build a game with 2 guns.");

		await interactiveModePrototype.submitUhmHandoff.call(context, "Build a top-down game with 2 guns.");

		expect(context.handleClearCommand).toHaveBeenCalled();
		expect(context.session.prompt).toHaveBeenCalledWith("Build a top-down game with 2 guns.");
		expect(context.uhmHandoffArmed).toBe(false);
		expect(context.editor.addToHistory).toHaveBeenCalledWith("Build a top-down game with 2 guns.");
	});

	it("restores the editor when the new session was cancelled", async () => {
		const context = createContext({ handleClearCommand: async () => false });
		context.armUhmHandoff("Build a game with 2 guns.");

		await interactiveModePrototype.submitUhmHandoff.call(context, "Build a game with 2 guns.");

		expect(context.session.prompt).not.toHaveBeenCalled();
		expect(context.editor.setText).toHaveBeenLastCalledWith("Build a game with 2 guns.");
		expect(context.showStatus).toHaveBeenCalledWith("Handoff cancelled — prompt restored to the editor");
	});
});
