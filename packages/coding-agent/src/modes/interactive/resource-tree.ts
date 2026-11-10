/**
 * Chat reports for `/skills` and `/context`: the loaded skills and AGENTS.md context files,
 * grouped by the origin they load from and drawn as a tree.
 */

import { basename, dirname, isAbsolute, relative, sep } from "node:path";
import type { Skill } from "../../core/skills.ts";
import type { SourceInfo } from "../../core/source-info.ts";
import { isPathWithin, shortenHomePath } from "../../utils/paths.ts";
import { theme } from "./theme/theme.ts";

interface TreeEntry {
	label: string;
	children?: TreeEntry[];
}

interface TreeGroup {
	label: string;
	itemsByDir: Map<string, TreeEntry[]>;
}

interface ContextFile {
	path: string;
}

/** List every loaded skill under the source directory it was discovered from. */
export function formatSkillsTree(skills: readonly Skill[]): string {
	const groups: TreeGroup[] = [];
	for (const skill of skills) {
		const baseDir = skill.sourceInfo.baseDir ?? dirname(skill.filePath);
		addToGroup(groups, sourceLabel(skill.sourceInfo), baseDir, skillEntry(skill));
	}
	return renderReport("Skills", skills.length, groups, "No skills loaded.");
}

/** List every loaded context file grouped by user or project origin and its directory. */
export function formatContextTree(files: readonly ContextFile[], cwd: string): string {
	const groups: TreeGroup[] = [];
	for (const file of files) {
		const label = isPathWithin(dirname(file.path), cwd) ? "project" : "user";
		addToGroup(groups, label, dirname(file.path), { label: theme.fg("text", basename(file.path)) });
	}
	return renderReport("Context files", files.length, groups, "No context files loaded.");
}

/** Draw a forest of groups with blank lines between top-level groups. */
function renderReport(title: string, count: number, groups: readonly TreeGroup[], emptyText: string): string {
	const heading = `${theme.bold(theme.fg("accent", title))} ${theme.fg("dim", `(${count})`)}`;
	if (groups.length === 0) {
		return `${heading}\n\n${theme.fg("muted", emptyText)}`;
	}

	const lines: string[] = [heading, ""];
	groups.forEach((group, index) => {
		if (index > 0) lines.push("");
		lines.push(theme.bold(group.label));
		const directories: TreeEntry[] = [];
		for (const [dir, entries] of group.itemsByDir) {
			directories.push({ label: theme.fg("muted", shortenHomePath(dir)), children: entries });
		}
		lines.push(...renderTree(directories));
	});
	return lines.join("\n");
}

function renderTree(entries: readonly TreeEntry[], prefix = ""): string[] {
	return entries.flatMap((entry, index) => {
		const last = index === entries.length - 1;
		const branch = theme.fg("dim", `${prefix}${last ? "└─" : "├─"} `);
		const lines = [`${branch}${entry.label}`];
		if (entry.children && entry.children.length > 0) {
			lines.push(...renderTree(entry.children, `${prefix}${last ? "   " : "│  "}`));
		}
		return lines;
	});
}

function addToGroup(groups: TreeGroup[], label: string, dir: string, item: TreeEntry): void {
	let group = groups.find((candidate) => candidate.label === label);
	if (!group) {
		group = { label, itemsByDir: new Map() };
		groups.push(group);
	}
	const items = group.itemsByDir.get(dir);
	if (items) {
		items.push(item);
	} else {
		group.itemsByDir.set(dir, [item]);
	}
}

function sourceLabel(sourceInfo: SourceInfo): string {
	const source = sourceInfo.source.trim();
	if (source.startsWith("npm:") || source.startsWith("git:")) {
		return `${source} (${sourceInfo.scope})`;
	}
	switch (sourceInfo.scope) {
		case "user":
			return "user";
		case "project":
			return "project";
		case "temporary":
			return "path (temporary)";
	}
}

function skillEntry(skill: Skill): TreeEntry {
	const relativePath = relativePathForDisplay(skill.sourceInfo.baseDir, skill.filePath);
	const label = theme.fg("text", skill.name);
	return { label: relativePath ? `${label}  ${theme.fg("dim", relativePath)}` : label };
}

/** Path relative to the source directory, or undefined when that adds nothing for the reader. */
function relativePathForDisplay(baseDir: string | undefined, filePath: string): string | undefined {
	if (!baseDir) return shortenHomePath(filePath);
	const relativePath = relative(baseDir, filePath);
	if (
		!relativePath ||
		relativePath === "SKILL.md" ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		return undefined;
	}
	return relativePath.split(sep).join("/");
}
