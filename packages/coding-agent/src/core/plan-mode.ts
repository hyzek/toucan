/**
 * Plan mode: read-only research and planning mode.
 * Policy lives here: which tools plan mode changes, which bash commands it allows,
 * and the system prompt section it adds.
 */

/** Built-in tools that plan mode always deactivates (they can change state, directly or via subagents). */
export const PLAN_MODE_REMOVED_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "powershell", "subagent"]);

/** Read-only built-in tools plan mode activates when they are registered. */
export const PLAN_MODE_ENSURED_TOOLS: readonly string[] = ["read", "grep", "find", "ls", "bash", "question", "handoff"];

/** Destructive commands blocked in plan mode (matches anywhere in the command line). */
const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

/** Read-only commands allowed in plan mode (anchored at the command start). */
const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*curl\s/i,
	/^\s*wget\s+-O\s*-/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*eza\b/,
];

/**
 * Whether a bash command is read-only enough for plan mode: it must match an allowed
 * pattern and no destructive pattern. Ported from the plan-mode extension example.
 */
export function isReadOnlyBashCommand(command: string): boolean {
	const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
	const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
	return !isDestructive && isSafe;
}

/** The `plan_mode` system prompt section added while plan mode is active. */
export const PLAN_MODE_PROMPT = `You are in plan mode: a read-only research and planning mode. Investigate and plan; do not act.

- Leave everything unchanged. Nothing may be created, modified, deleted, moved, installed, committed, pushed, sent, or configured. The edit, write, powershell and subagent tools are disabled.
- Bash is limited to read-only commands (status, log, diff, show, listing, searching). Commands that change state are blocked and will fail.
- MCP and extension tools are still available, for research only. Never call a tool that acts on anything: skip tools whose name or description implies create/update/delete/send/post/merge actions, and use only read/search/list tools.
- NEVER ASSUME. If you are unsure about anything the user wants or how they want it — scope, names, preferences, trade-offs, whether your approach matches their intent — stop and ask with the question tool. Asking costs one call; guessing wrong costs a rewrite. Batch every open question into one question call.
- Research with the least effort that answers the question: fewest files read, fewest commands run. Do not re-verify facts you already have.
- Do not output code, patches, or config blocks. Describe changes as plan steps.

When you are done, answer with a plan under a "Plan:" header:

Plan:
1. <step: what to change, in which files, and how it is verified>
2. ...

Keep steps to one line where possible. State assumptions and open questions before the plan. Order steps so each can be executed on its own.

When the plan is finished, do not start implementing and do not just ask in plain text: call the handoff tool. Prompt like "Hand off to build mode and start implementing?", with options such as "Yes — start implementing" (startImplementation: true) and "Keep planning". The user's choice comes back to you, and picking a startImplementation option turns plan mode off; then implement the plan.`;
