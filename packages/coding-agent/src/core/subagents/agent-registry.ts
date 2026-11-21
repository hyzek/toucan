/**
 * Subagent type registry: built-in agent types plus markdown definitions
 * discovered from the user agent directory and the project `.toucan/agents` directory.
 */

import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ThinkingLevel } from "@hyzek/toucan-agent-core";
import { CONFIG_DIR_NAME } from "../../config.ts";
import { parseFrontmatter } from "../../utils/frontmatter.ts";
import { BUILTIN_AGENT_DEFINITIONS } from "./default-agents.ts";

export type AgentSource = "builtin" | "user" | "project";

export interface AgentDefinition {
	/** The agent type: what `subagent({ agent })` addresses. */
	name: string;
	description: string;
	/** Built-in tool names this agent may call. Undefined means all assignable built-in tools. */
	tools?: string[];
	/** `provider/modelId` or a fuzzy model name. Undefined means inherit the parent model. */
	model?: string;
	thinking?: ThinkingLevel;
	/** Agentic turns before the wrap-up warning; 0/undefined means unlimited. */
	maxTurns?: number;
	/**
	 * `replace`: the body is the whole system prompt (no AGENTS.md inheritance).
	 * `append`: the body is appended to the default prompt, with context files loaded as usual.
	 */
	promptMode: "replace" | "append";
	systemPrompt: string;
	source: AgentSource;
	filePath?: string;
}

export interface AgentDiscoveryResult {
	definitions: AgentDefinition[];
	/** Problems found while reading agent files; each names the file. */
	diagnostics: string[];
}

/** Built-in tools an agent definition may name in `tools:`. `subagent` is excluded: nesting is not built in yet. */
export const ASSIGNABLE_TOOL_NAMES: readonly string[] = [
	"read",
	"bash",
	"powershell",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
];

const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Frontmatter of an agent markdown file. Values are `unknown` because `parseFrontmatter` runs a
 * real YAML parser, so any scalar or collection can appear here. A type alias rather than an
 * interface: `parseFrontmatter` constrains its parameter to `Record<string, unknown>`, and only an
 * alias picks up the implicit index signature that satisfies it.
 */
type AgentFrontmatter = {
	name?: unknown;
	description?: unknown;
	tools?: unknown;
	model?: unknown;
	thinking?: unknown;
	prompt_mode?: unknown;
	max_turns?: unknown;
	enabled?: unknown;
};

/** Resolve an agent type case-insensitively; undefined when nothing matches. */
export function resolveAgentDefinition(name: string, definitions: AgentDefinition[]): AgentDefinition | undefined {
	const wanted = name.trim().toLowerCase();
	return definitions.find((definition) => definition.name.toLowerCase() === wanted);
}

/** Discover all agent definitions: built-ins, then user, then project; a later source overrides an earlier same-named one. */
export function discoverAgentDefinitions(options: {
	cwd: string;
	agentDir: string;
	projectTrusted: boolean;
}): AgentDiscoveryResult {
	const diagnostics: string[] = [];
	const byName = new Map<string, AgentDefinition>();
	for (const definition of BUILTIN_AGENT_DEFINITIONS) {
		byName.set(definition.name.toLowerCase(), definition);
	}

	const userDir = join(options.agentDir, "agents");
	for (const definition of loadAgentsFromDir(userDir, "user", diagnostics)) {
		if ("disabled" in definition) byName.delete(definition.name.toLowerCase());
		else byName.set(definition.name.toLowerCase(), definition);
	}

	if (options.projectTrusted) {
		const projectDir = findNearestProjectAgentsDir(options.cwd);
		if (projectDir) {
			for (const definition of loadAgentsFromDir(projectDir, "project", diagnostics)) {
				if ("disabled" in definition) byName.delete(definition.name.toLowerCase());
				else byName.set(definition.name.toLowerCase(), definition);
			}
		}
	}

	return { definitions: [...byName.values()], diagnostics };
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = join(currentDir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;
		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

function isDirectory(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function loadAgentsFromDir(
	dir: string,
	source: Exclude<AgentSource, "builtin">,
	diagnostics: string[],
): (AgentDefinition | { name: string; disabled: true })[] {
	const agents: (AgentDefinition | { name: string; disabled: true })[] = [];
	if (!existsSync(dir)) return agents;

	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		diagnostics.push(`${dir}: cannot read directory (${error instanceof Error ? error.message : error})`);
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = join(dir, entry.name);
		let definition: AgentDefinition | { name: string; disabled: true };
		try {
			definition = parseAgentFile(readFileSync(filePath, "utf-8"), filePath, source);
		} catch (error) {
			diagnostics.push(`${filePath}: skipped (${error instanceof Error ? error.message : error})`);
			continue;
		}
		if (definition) agents.push(definition);
	}
	return agents;
}

/** Parse one agent markdown file, including disabled entries that remove an earlier definition. */
function parseAgentFile(
	content: string,
	filePath: string,
	source: Exclude<AgentSource, "builtin">,
): AgentDefinition | { name: string; disabled: true } {
	const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);

	const fallbackName = basename(filePath, ".md");
	const name =
		typeof frontmatter.name === "string" && frontmatter.name.trim() ? frontmatter.name.trim() : fallbackName;
	if (name.includes("/") || name.includes(":")) {
		throw new Error(`invalid agent name "${name}"`);
	}
	if (frontmatter.enabled === false) return { name, disabled: true };

	const description =
		typeof frontmatter.description === "string" && frontmatter.description.trim()
			? frontmatter.description.trim()
			: (firstBodyLine(body) ?? `Custom agent ${name}`);

	const tools = parseToolList(frontmatter.tools);

	let thinking: ThinkingLevel | undefined;
	if (typeof frontmatter.thinking === "string") {
		const level = frontmatter.thinking.trim() as ThinkingLevel;
		if (THINKING_LEVELS.includes(level)) {
			thinking = level;
		}
	}

	let maxTurns: number | undefined;
	if (
		typeof frontmatter.max_turns === "number" &&
		Number.isInteger(frontmatter.max_turns) &&
		frontmatter.max_turns > 0
	) {
		maxTurns = frontmatter.max_turns;
	}

	return {
		name,
		description,
		tools,
		model: typeof frontmatter.model === "string" && frontmatter.model.trim() ? frontmatter.model.trim() : undefined,
		thinking,
		maxTurns,
		promptMode:
			typeof frontmatter.prompt_mode === "string" && frontmatter.prompt_mode.trim() === "append"
				? "append"
				: "replace",
		systemPrompt: body.trim(),
		source,
		filePath,
	};
}

/**
 * Normalize a frontmatter `tools` value to a list of tool names. Both spellings are valid YAML:
 *
 *     tools: read, bash        # string
 *     tools: [read, bash]      # array
 *
 * An omitted field inherits the built-in tool set. An explicit empty list grants no tools;
 * malformed fields reject this definition so they cannot grant more access by accident.
 */
function parseToolList(value: unknown): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) && typeof value !== "string")
		throw new Error("tools must be a list or comma-separated string");
	const raw = Array.isArray(value) ? value : value.split(",");
	if (raw.some((item) => typeof item !== "string")) throw new Error("tools must contain only strings");
	const tools = raw
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
	return tools;
}

function firstBodyLine(body: string): string | undefined {
	for (const line of body.split("\n")) {
		const trimmed = line.trim();
		if (trimmed) return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
	}
	return undefined;
}
