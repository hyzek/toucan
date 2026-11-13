import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverAgentDefinitions } from "../src/core/subagents/agent-registry.ts";

describe("subagent registry restrictions", () => {
	it("preserves an empty tool list and removes a disabled built-in", () => {
		const dir = mkdtempSync(join(tmpdir(), "toucan-agent-registry-"));
		try {
			mkdirSync(join(dir, "agents"));
			writeFileSync(join(dir, "agents", "general-purpose.md"), "---\nenabled: false\n---\n");
			writeFileSync(join(dir, "agents", "restricted.md"), "---\ntools: []\n---\nRead only");
			writeFileSync(join(dir, "agents", "invalid.md"), "---\ntools: 42\n---\nInvalid");
			const result = discoverAgentDefinitions({ cwd: dir, agentDir: dir, projectTrusted: false });
			expect(result.definitions.some((agent) => agent.name === "general-purpose")).toBe(false);
			expect(result.definitions.find((agent) => agent.name === "restricted")?.tools).toEqual([]);
			expect(result.definitions.some((agent) => agent.name === "invalid")).toBe(false);
			expect(result.diagnostics.some((diagnostic) => diagnostic.includes("invalid.md"))).toBe(true);
			expect(result.definitions.find((agent) => agent.name === "plan")?.tools).not.toContain("bash");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
