/** Nerd Font file and directory glyphs, adapted from pi-claude-code-ui's list. */

import type { Theme } from "../theme/theme.ts";

const DEFAULT_FILE = "\uf15b";
const DIRECTORY = "\ue5ff";

const EXTENSION_ICON: Record<string, string> = {
	ts: "\ue628",
	tsx: "\ue7ba",
	js: "\ue74e",
	jsx: "\ue7ba",
	py: "\ue73c",
	rs: "\ue7a8",
	go: "\ue724",
	java: "\ue738",
	rb: "\ue739",
	swift: "\ue755",
	c: "\ue61e",
	cpp: "\ue61d",
	html: "\ue736",
	css: "\ue749",
	scss: "\ue749",
	vue: "\ue6a0",
	svelte: "\ue697",
	json: "\ue60b",
	yaml: "\ue6a8",
	yml: "\ue6a8",
	toml: "\ue6b2",
	md: "\ue73e",
	sh: "\ue795",
	bash: "\ue795",
	zsh: "\ue795",
	lua: "\ue620",
	php: "\ue73d",
	sql: "\ue706",
	xml: "\ue619",
	graphql: "\ue662",
	dockerfile: "\ue7b0",
	lock: "\uf023",
	png: "\uf1c5",
	jpg: "\uf1c5",
	svg: "\uf1c5",
	gif: "\uf1c5",
};

const NAME_ICON: Record<string, string> = {
	"package.json": "\ue71e",
	"tsconfig.json": "\ue628",
	".gitignore": "\ue702",
	dockerfile: "\ue7b0",
	makefile: "\ue615",
	"readme.md": "\ue73e",
	license: "\ue60a",
};

export function fileIcon(path: string, theme: Theme): string {
	const base = path.split("/").pop()?.toLowerCase() ?? "";
	const icon = NAME_ICON[base] ?? (base.includes(".") ? EXTENSION_ICON[base.split(".").pop() ?? ""] : undefined);
	return `${theme.fg("muted", icon ?? DEFAULT_FILE)} `;
}

export function directoryIcon(theme: Theme): string {
	return `${theme.fg("accent", DIRECTORY)} `;
}
