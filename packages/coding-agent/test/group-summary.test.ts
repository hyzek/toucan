import { describe, expect, it } from "vitest";
import { summarizeToolGroup } from "../src/core/tools/group-summary.ts";

describe("summarizeToolGroup", () => {
	it("summarizes an empty group as nothing", () => {
		expect(summarizeToolGroup([])).toEqual({ sentence: "", running: false, failed: 0 });
	});

	it("counts one finished call with its noun", () => {
		expect(summarizeToolGroup([{ name: "read", status: "done" }]).sentence).toBe("Read 1 file");
	});

	it("joins families in first-call order", () => {
		const sentence = summarizeToolGroup([
			{ name: "bash", status: "done" },
			{ name: "read", status: "done" },
			{ name: "read", status: "done" },
		]).sentence;
		expect(sentence).toBe("Ran 1 shell command, read 2 files");
	});

	it("uses the running verbs while any call is pending", () => {
		const summary = summarizeToolGroup([
			{ name: "read", status: "done" },
			{ name: "read", status: "done" },
			{ name: "bash", status: "pending" },
		]);
		expect(summary.sentence).toBe("Reading 2 files, running 1 shell command");
		expect(summary.running).toBe(true);
	});

	it("counts find with grep as searches and powershell with bash as shell commands", () => {
		expect(
			summarizeToolGroup([
				{ name: "grep", status: "done" },
				{ name: "find", status: "done" },
			]).sentence,
		).toBe("Searched 2 patterns");
		expect(
			summarizeToolGroup([
				{ name: "bash", status: "done" },
				{ name: "powershell", status: "done" },
			]).sentence,
		).toBe("Ran 2 shell commands");
	});

	it("separates edit and write from read even though all three count files", () => {
		expect(
			summarizeToolGroup([
				{ name: "edit", status: "done" },
				{ name: "write", status: "done" },
				{ name: "read", status: "done" },
			]).sentence,
		).toBe("Edited 1 file, wrote 1 file, read 1 file");
	});

	it("names tools that have no family, and repeats them with a count", () => {
		expect(summarizeToolGroup([{ name: "web_search", status: "done" }]).sentence).toBe("Called web_search");
		expect(
			summarizeToolGroup([
				{ name: "web_search", status: "done" },
				{ name: "web_search", status: "done" },
				{ name: "ctx_reduce", status: "done" },
			]).sentence,
		).toBe("Called web_search ×2, ctx_reduce");
		expect(summarizeToolGroup([{ name: "web_search", status: "pending" }]).sentence).toBe("Calling web_search");
	});

	it("counts failed calls without changing the sentence", () => {
		const summary = summarizeToolGroup([
			{ name: "bash", status: "failed" },
			{ name: "bash", status: "done" },
			{ name: "read", status: "failed" },
		]);
		expect(summary.sentence).toBe("Ran 2 shell commands, read 1 file");
		expect(summary.failed).toBe(2);
		expect(summary.running).toBe(false);
	});
});
