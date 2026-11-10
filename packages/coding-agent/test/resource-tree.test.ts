import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Skill } from "../src/core/skills.ts";
import { formatContextTree, formatSkillsTree } from "../src/modes/interactive/resource-tree.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

initTheme("dark");

const home = homedir();

function skill(
	name: string,
	filePath: string,
	baseDir: string,
	source: string,
	scope: "user" | "project" | "temporary",
): Skill {
	return {
		name,
		description: `${name} description`,
		filePath,
		baseDir,
		sourceInfo: { path: filePath, source, scope, origin: "top-level", baseDir },
		disableModelInvocation: false,
	};
}

function plain(value: string): string {
	return stripAnsi(value).replaceAll("\\", "/");
}

describe("resource tree reports", () => {
	it("groups skills by origin and source directory", () => {
		const cwd = join(home, "work", "app");
		const userBase = join(home, ".toucan", "agent");
		const packageBase = join(cwd, "node_modules", "@acme", "tools");
		const skills = [
			skill("pdf", join(userBase, "skills", "pdf", "SKILL.md"), userBase, "auto", "user"),
			skill("report", join(cwd, ".toucan", "skills", "report", "SKILL.md"), cwd, "auto", "project"),
			skill("pkg", join(packageBase, "skills", "pkg", "SKILL.md"), packageBase, "npm:@acme/tools", "project"),
		];

		expect(plain(formatSkillsTree(skills))).toBe(
			[
				"Skills (3)",
				"",
				"user",
				"└─ ~/.toucan/agent",
				"   └─ pdf  skills/pdf/SKILL.md",
				"",
				"project",
				"└─ ~/work/app",
				"   └─ report  .toucan/skills/report/SKILL.md",
				"",
				"npm:@acme/tools (project)",
				"└─ ~/work/app/node_modules/@acme/tools",
				"   └─ pkg  skills/pkg/SKILL.md",
			].join("\n"),
		);
	});

	it("groups context files by user and project origin", () => {
		const cwd = join(home, "work", "app");
		const files = [
			{ path: join(home, ".toucan", "agent", "AGENTS.md"), content: "global" },
			{ path: join(home, "work", "AGENTS.md"), content: "parent" },
			{ path: join(cwd, "AGENTS.md"), content: "project" },
		];

		expect(plain(formatContextTree(files, cwd))).toBe(
			[
				"Context files (3)",
				"",
				"user",
				"└─ ~/.toucan/agent",
				"   └─ AGENTS.md",
				"",
				"project",
				"├─ ~/work",
				"│  └─ AGENTS.md",
				"└─ ~/work/app",
				"   └─ AGENTS.md",
			].join("\n"),
		);
	});

	it("reports empty lists", () => {
		expect(plain(formatSkillsTree([]))).toBe("Skills (0)\n\nNo skills loaded.");
		expect(plain(formatContextTree([], home))).toBe("Context files (0)\n\nNo context files loaded.");
	});
});
