/**
 * Mock provider - replays a scripted coding session to simulate a real user run.
 *
 * Registers provider `mock` with the model `mock-coder`. Every prompt replays the same run: a thinking
 * block, streaming markdown, and calls to the default active tools only (read, bash, edit, write), so
 * nothing in the script errors with "tool not found". Two messages queue two calls in a row, which the
 * transcript folds into one sentence, and one bash call rewrites a file, which renders as an edit row
 * with a diff. Ends with a markdown summary. Fully offline; built on toucan-ai's faux provider for
 * token-by-token streaming.
 *
 * Usage:
 *   node packages/coding-agent/dist/bundle/cli.js -e ./packages/coding-agent/examples/extensions/mock-provider.ts
 *   # then select mock/mock-coder via /model and type any prompt
 *
 * Run it from a directory containing a package.json and a git history so the calls succeed; write and
 * edit only touch files under /tmp.
 */

import {
	type AssistantMessage,
	createFauxCore,
	fauxAssistantMessage,
	fauxText,
	fauxThinking,
	fauxToolCall,
} from "@hyzek/toucan-ai";
import type { ExtensionAPI } from "@hyzek/toucan-coding-agent";

const NOTES_FILE = "/tmp/opencode/mock-run.md";
const STATUS_FILE = "/tmp/opencode/mock-run-status.txt";

const NOTES_CONTENT = `# Mock run notes

Scratch file written by the mock provider.

## Notes

- first pass
`;

function scriptedResponses(): AssistantMessage[] {
	return [
		fauxAssistantMessage(
			[
				fauxThinking(
					"The user wants a quick change. I should start by reading the project manifest, then scan the tree " +
						"before touching anything.",
				),
				fauxText("I'll run through this **top to bottom**: inspect, change, verify. Starting with the manifest.\n"),
				fauxToolCall("read", { path: "package.json" }, { id: "mock-read-1" }),
			],
			{ stopReason: "toolUse" },
		),
		// Two calls in a row with no text between them: the transcript folds them into one sentence.
		fauxAssistantMessage(
			[
				fauxText("That's an **npm workspaces** root. Let me list the tree and find the version.\n"),
				fauxToolCall("bash", { command: "ls -1" }, { id: "mock-ls-1" }),
				fauxToolCall("bash", { command: "grep -n version package.json | head -5" }, { id: "mock-grep-1" }),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage(
			[
				fauxText("Now the readme files at the root, and a longer command to watch while it runs.\n"),
				fauxToolCall("bash", { command: "ls -1 *.md" }, { id: "mock-find-1" }),
				fauxToolCall("bash", { command: "sleep 2 && git log --oneline -3" }, { id: "mock-git-1" }),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage(
			[
				fauxText("I'll jot down what I found in a scratch file before editing anything.\n"),
				fauxToolCall("write", { path: NOTES_FILE, content: NOTES_CONTENT }, { id: "mock-write-1" }),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage(
			[
				fauxText("Let me append a second pass to the notes with a targeted edit.\n"),
				fauxToolCall(
					"edit",
					{
						path: NOTES_FILE,
						edits: [{ oldText: "- first pass", newText: "- first pass\n- second pass: verified the tool chain" }],
					},
					{ id: "mock-edit-1" },
				),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage(
			[
				fauxText("Finally, verify the notes on disk, then record the result:\n"),
				fauxToolCall("bash", { command: `wc -l ${NOTES_FILE}` }, { id: "mock-bash-1" }),
				fauxToolCall("bash", { command: `printf 'verified\\n' > ${STATUS_FILE}` }, { id: "mock-bash-2" }),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage([
			fauxText(
				"## Run complete\n\n" +
					"Here is what happened, in **markdown** so you can see how the UI renders it:\n\n" +
					"1. Read `package.json`, then listed the tree and searched the manifest in one run\n" +
					"2. Wrote and edited `" +
					NOTES_FILE +
					"`\n" +
					"3. Verified with a shell command, and rewrote a file with `printf`, which shows as an edit with a diff\n\n" +
					"| Tool | Result |\n| --- | --- |\n| read | manifest inspected |\n| edit | notes updated |\n\n" +
					"> This message was produced by the mock provider; no API calls were made.\n\n" +
					'```json\n{ "status": "ok", "tools": 8 }\n```\n',
			),
		]),
	];
}

export default function (toucan: ExtensionAPI) {
	const core = createFauxCore({ api: "mock-api", tokensPerSecond: 60 });
	const responses = scriptedResponses();
	let index = 0;

	toucan.registerProvider("mock", {
		baseUrl: "http://localhost:0",
		apiKey: "mock-key",
		api: "mock-api",
		models: [
			{
				id: "mock-coder",
				name: "Mock Coder",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 16384,
			},
		],
		streamSimple: (model, context, options) => {
			const last = context.messages[context.messages.length - 1];
			if (last?.role === "user") index = 0;
			core.setResponses([responses[index++] ?? fauxAssistantMessage("Mock run already replayed. Type anything.")]);
			return core.streamSimple(model, context, options);
		},
	});
}
