import type { TUI } from "@hyzek/toucan-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { KEYBINDINGS, KeybindingsManager } from "../src/core/keybindings.ts";
import type { QuestionToolQuestion } from "../src/core/tools/question.ts";
import { QuestionForm, type QuestionFormResult } from "../src/modes/interactive/components/question-form.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const DOWN = "\x1b[B";
const ENTER = "\r";
const TAB = "\t";
const SHIFT_TAB = "\x1b[Z";
const SPACE = " ";
const ESC = "\x1b";

const storageQuestion: QuestionToolQuestion = {
	question: "Which storage should the cache use?",
	header: "Storage",
	options: [
		{ label: "SQLite", description: "single file, zero ops" },
		{ label: "Redis", description: "needs a running server" },
	],
};

const extrasQuestion: QuestionToolQuestion = {
	question: "Which extras do you want?",
	header: "Extras",
	options: [{ label: "CLI" }, { label: "Web UI" }],
	multiple: true,
};

function makeForm(questions: QuestionToolQuestion[]): {
	form: QuestionForm;
	result(): QuestionFormResult | undefined;
} {
	let result: QuestionFormResult | undefined;
	const tui = { requestRender: () => {} } as unknown as TUI;
	const keybindings = new KeybindingsManager();
	const form = new QuestionForm(tui, keybindings, questions, (r) => {
		result = r;
	});
	return { form, result: () => result };
}

function text(form: QuestionForm, width = 100): string {
	return form.render(width).map(stripAnsi).join("\n");
}

describe("QuestionForm keybinding defaults", () => {
	it("binds tab and space to form actions", () => {
		expect(KEYBINDINGS["app.question.tabForward"].defaultKeys).toEqual(["tab", "right"]);
		expect(KEYBINDINGS["app.question.tabBackward"].defaultKeys).toEqual(["shift+tab", "left"]);
		expect(KEYBINDINGS["app.question.toggle"].defaultKeys).toBe("space");
	});
});

describe("QuestionForm single question", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("renders padded band rows with the question, numbered options, and the free-text row", () => {
		const { form } = makeForm([storageQuestion]);
		const lines = form.render(100).map(stripAnsi);
		expect(lines[0]!.trim()).toBe(""); // top band padding
		expect(lines[lines.length - 1]!.trim()).toBe(""); // bottom band padding
		const body = lines.join("\n");
		expect(body).toContain("Which storage should the cache use?");
		expect(body).toContain("1. SQLite");
		expect(body).toContain("single file, zero ops");
		expect(body).toContain("Type your own answer.");
		expect(body).not.toContain("Submit");
	});

	it("paints every row with the editor background (input-band continuity)", () => {
		const { form } = makeForm([storageQuestion, extrasQuestion]);
		for (const line of form.render(100)) {
			expect(line).toMatch(/\x1b\[48;/);
		}
	});

	it("answering an option submits the single question immediately, with title and subtitle", () => {
		const { form, result } = makeForm([storageQuestion]);
		form.handleInput(DOWN);
		form.handleInput(ENTER);
		expect(result()).toEqual({
			answers: [
				{
					header: "Storage",
					question: storageQuestion.question,
					answers: [{ title: "Redis", subtitle: "needs a running server" }],
					typed: false,
				},
			],
			dismissed: false,
		});
	});

	it("typing a custom answer submits it marked as written", () => {
		const { form, result } = makeForm([storageQuestion]);
		form.handleInput(DOWN);
		form.handleInput(DOWN); // onto "Type your own answer."
		form.handleInput(ENTER);
		expect(text(form)).toContain("Your answer:");
		form.handleInput("tabs");
		form.handleInput(ENTER);
		expect(result()?.answers[0]?.answers).toEqual([{ title: "tabs" }]);
		expect(result()?.answers[0]?.typed).toBe(true);
	});

	it("escape dismisses without answers", () => {
		const { form, result } = makeForm([storageQuestion]);
		form.handleInput(ESC);
		expect(result()).toEqual({ answers: [], dismissed: true });
	});
});

describe("QuestionForm tabs and Submit question", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("paints the tab row background continuously across chips, gaps, and tail", () => {
		const { form } = makeForm([storageQuestion, extrasQuestion]);
		const tabRow = form.render(100)[1]!;
		// theme.bg ends every run with \x1b[49m; after each reset the next run (gap, chip, or
		// tail padding) must open a background again, so no stretch of the row is unpainted.
		const segments = tabRow.split("\x1b[49m");
		expect(segments.length).toBeGreaterThanOrEqual(7); // indent, 3 chips, 2 gaps, tail
		for (const segment of segments.slice(0, -1)) {
			expect(segment.startsWith("\x1b[48;")).toBe(true);
		}
	});

	it("auto-advances to the Submit tab once all questions are answered", () => {
		const { form } = makeForm([storageQuestion, extrasQuestion]);
		form.handleInput(ENTER); // Storage: SQLite
		form.handleInput(SPACE); // Extras: CLI
		form.handleInput(DOWN);
		form.handleInput(SPACE); // Extras: Web UI
		form.handleInput(TAB); // explicit Submit visit
		const body = text(form);
		expect(body).toContain("Submit these answers?");
		expect(body).toContain("Storage: SQLite — single file, zero ops");
		expect(body).toContain("Extras: CLI; Web UI");
		expect(body).toContain("1. Yes — submit 2 answers");
		expect(body).toContain("2. No — go back and edit");
	});

	it("Yes submits all answers; No jumps back to the first unanswered question", () => {
		const { form, result } = makeForm([storageQuestion, extrasQuestion]);
		form.handleInput(ENTER); // Storage: SQLite -> advances to Extras
		form.handleInput(SPACE); // Extras: CLI
		form.handleInput(TAB); // Submit tab
		form.handleInput(ENTER); // Yes
		const answers = result()?.answers ?? [];
		expect(answers.map((a) => a.header)).toEqual(["Storage", "Extras"]);
		expect(answers[1]?.answers).toEqual([{ title: "CLI" }]);

		const back = makeForm([storageQuestion, extrasQuestion]);
		back.form.handleInput(ENTER); // Storage answered
		back.form.handleInput(TAB); // Submit while Extras open
		expect(text(back.form)).toContain("Extras: open");
		back.form.handleInput(DOWN); // onto "No"
		back.form.handleInput(ENTER);
		expect(back.result()).toBeUndefined();
		expect(text(back.form)).toContain("Which extras do you want?");
	});

	it("Yes on an incomplete form jumps to the first unanswered question", () => {
		const { form, result } = makeForm([storageQuestion, extrasQuestion]);
		form.handleInput(TAB); // to Extras
		form.handleInput(TAB); // to Submit
		form.handleInput(ENTER); // Yes with nothing answered
		expect(result()).toBeUndefined();
		expect(text(form)).toContain("Which storage should the cache use?");
	});

	it("single-question multi-select gets a Submit question instead of auto-submit", () => {
		const { form, result } = makeForm([extrasQuestion]);
		form.handleInput(SPACE); // toggle CLI, stays on the question
		expect(result()).toBeUndefined();
		form.handleInput(TAB); // Submit tab
		form.handleInput(ENTER); // Yes
		expect(result()?.answers).toEqual([
			{ header: "Extras", question: extrasQuestion.question, answers: [{ title: "CLI" }], typed: false },
		]);
	});

	it("multi-select: space toggles, enter advances to the Submit tab without toggling", () => {
		const { form, result } = makeForm([extrasQuestion]);
		form.handleInput(SPACE); // toggle CLI on
		form.handleInput(ENTER); // enter must NOT toggle CLI off; it advances
		expect(text(form)).toContain("Submit these answers?");
		expect(text(form)).toContain("Extras: CLI"); // still selected
		form.handleInput(SHIFT_TAB); // back to the question: nothing was toggled off
		expect(text(form)).toContain("☒ 1. CLI");
		form.handleInput(TAB); // Submit tab
		form.handleInput(ENTER); // Yes
		expect(result()?.answers[0]?.answers).toEqual([{ title: "CLI" }]);
	});

	it("multi-select: enter on the free-text row starts typing", () => {
		const { form, result } = makeForm([extrasQuestion]);
		form.handleInput(DOWN);
		form.handleInput(DOWN); // onto "Type your own answer."
		form.handleInput(ENTER);
		expect(text(form)).toContain("Your answer:");
		form.handleInput("custom");
		form.handleInput(ENTER);
		form.handleInput(ENTER); // Yes on the Submit tab
		expect(result()?.answers[0]?.answers).toEqual([{ title: "custom" }]);
		expect(result()?.answers[0]?.typed).toBe(true);
	});

	it("shift+tab and left go to the previous tab", () => {
		const { form } = makeForm([storageQuestion, extrasQuestion]);
		form.handleInput(SHIFT_TAB); // wrap to Submit tab
		expect(text(form)).toContain("Storage: open");
		form.handleInput(SHIFT_TAB);
		expect(text(form)).toContain("Which extras do you want?");
	});
});
