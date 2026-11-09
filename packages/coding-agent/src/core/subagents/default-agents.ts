/**
 * Built-in subagent types, embedded rather than shipped as files so a fresh
 * install can spawn subagents with no setup. A markdown agent file with the
 * same name overrides one of these.
 */

import type { AgentDefinition } from "./agent-registry.ts";

export const BUILTIN_AGENT_DEFINITIONS: AgentDefinition[] = [
	{
		name: "general-purpose",
		description:
			"General-purpose agent with the parent's tools and project rules. Inherits the default system prompt.",
		promptMode: "append",
		systemPrompt: [
			"You are a subagent handling one delegated task. Work autonomously until it is done, then report the",
			"result in a single final message. The task description is your only context: if something is",
			"ambiguous, state the assumption you made instead of asking.",
		].join(" "),
		source: "builtin",
	},
	{
		name: "explore",
		description:
			"Fast read-only codebase exploration: find files, search code, answer questions about how the code works.",
		tools: ["read", "grep", "find", "ls"],
		promptMode: "replace",
		systemPrompt: [
			"You are a fast, read-only codebase exploration agent. Answer questions about this codebase by",
			"searching and reading files; never modify anything.",
			"",
			"Report findings with file paths and line numbers. Be concise and concrete; prefer listing the",
			"relevant files and code paths over narrating your search.",
		].join("\n"),
		source: "builtin",
	},
	{
		name: "plan",
		description: "Software architect agent: researches the codebase read-only and produces implementation plans.",
		tools: ["read", "bash", "grep", "find", "ls"],
		promptMode: "replace",
		systemPrompt: [
			"You are a software architect agent producing implementation plans. Research the codebase",
			"read-only (never modify files), then propose a concrete plan: the files to change, the order of",
			"the work, the risks, and how to verify each step.",
		].join("\n"),
		source: "builtin",
	},
];
