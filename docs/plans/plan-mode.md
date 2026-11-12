# Plan mode

Built-in toggleable read-only planning mode for the interactive TUI.

## Behavior

`shift+tab` or `/plan` toggles plan mode on/off for the current session. When on:

- Mutating built-ins (`edit`, `write`, `powershell`, `subagent` — subagent because it grants
  indirect write access) are deactivated; `read`, `grep`, `find`, `ls` are ensured active;
  `bash` stays but is restricted to a read-only command allowlist; MCP and other tools stay active.
- The system prompt gains a `plan_mode` section instructing:
  - Read-only research only: do not use any tool that changes state.
  - Built-in `edit`/`write`/`powershell`/`subagent` are unavailable; `bash` is limited to
    read-only commands.
  - MCP and other extension tools may be used only for reading/research; do not call MCP tools
    that create, modify, delete, send, or otherwise act on anything (no `*_create`/`*_update`/
    `*_delete`/post-style actions, and nothing whose description implies a side effect).
    This stays prompt-level only: MCP tools cannot be reliably classified for removal
    (annotations are optional), so the hard `tool_call` guard applies to `bash` only.
  - Be concise; end with a numbered plan under a `Plan:` header instead of executing.
- The footer model bar gets a right-aligned purple `◇ Plan mode` segment.
- State is persisted as a custom session entry, so resume restores the mode and the tool set.
  Toggling mid-turn takes effect next turn (standard `setActiveToolsByName` semantics).

Decisions:

- Toggle key `shift+tab` (matches the Codex convention); `app.thinking.cycle` moves to `alt+t`.
  Users with custom `keybindings.json` are unaffected.
- Bash kept with a read-only allowlist (best for research: git history, test output).
- MCP tools stay active; write-MCP restraint is instruction-level.

## Changes by file

### `packages/coding-agent/src/core/keybindings.ts`

- Add `"app.planMode.toggle": { defaultKeys: "shift+tab", description: "Toggle plan mode" }`.
- Rebind `"app.thinking.cycle"` default from `shift+tab` to `alt+t`.

### `packages/coding-agent/src/core/extensions/runner.ts`

- Add `app.planMode.toggle` to `RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS`
  (lines 98-117), like `app.thinking.cycle`.

### New `packages/coding-agent/src/core/tools/read-only-bash.ts`

- `isReadOnlyBashCommand(command)` — ported from `examples/extensions/plan-mode/utils.ts`
  `isSafeCommand` allowlist (git log/diff/status, ls, cat, rg, etc.).
  The example extension stays untouched.

### `packages/coding-agent/src/core/agent-session.ts`

- `state.planMode: boolean`; `enablePlanMode()` / `disablePlanMode()` / `togglePlanMode()`:
  - Enable: snapshot `getActiveToolNames()`, compute plan set (snapshot minus mutating built-ins,
    plus read/grep/find/ls/bash if registered), apply via `setActiveToolsByName` — which already
    rebuilds the system prompt.
  - Disable: restore snapshot.
- `_rebuildSystemPrompt()` (~line 1790): when `planMode`, add a `plan_mode` section (via
  `BuildSystemPromptOptions.sections`, already supported and diffed per request by
  `diffSystemPromptSections`).
- `_beforeToolCall()` (line 718): built-in guard before the extension runner — if `planMode` and
  `toolCall.name === "bash"` and `!isReadOnlyBashCommand(cmd)`, return `{ block: true, reason }`.
- Persist: append `{ type: "custom", customType: "plan-mode", data: { enabled,
  toolsBeforePlanMode } }` on toggle; restore on session start/resume.

### `packages/coding-agent/src/core/slash-commands.ts`

- Add `/plan` to `BUILTIN_SLASH_COMMANDS` ("Toggle plan mode"); handler wired in interactive
  mode's command dispatch.

### `packages/coding-agent/src/modes/interactive/interactive-mode.ts`

- `setupKeyHandlers()` (~line 2948):
  `this.defaultEditor.onAction("app.planMode.toggle", () => this.togglePlanMode())`.
- `togglePlanMode()`: calls the session method, `requestRender`, brief notify.
- Hotkey hints row: add `⟨shift+tab⟩ plan mode` entry (uses `keyText` so it follows rebinds).
- Expanded help (`ctrl+o`, ~line 1091) and the shortcuts overlay table (~lines 6957/7002):
  add the new binding; thinking-cycle rows pick up the new key automatically via
  `keyHint`/`getAppKeyDisplay`.

### `packages/coding-agent/src/modes/interactive/components/footer.ts`

- In `render(width)`: if `session.state.planMode`, compute a right-aligned segment and pad with
  spaces between left bar and it (small local `spread()`; precedent:
  `apps/p2/src/tui/components/chrome.ts:114`). Drop the segment first when width is too small.
- Color: add a `planMode` token to `theme-tokens.ts` (next to `bashMode`) mapping to the existing
  `violet` in `dark.json`, `light.json`, `system-theme.ts`. Using `accent` would follow users'
  accent customizations away from purple; a dedicated token guarantees purple and stays themeable.

### Tests (`packages/coding-agent/test/plan-mode.test.ts` + footer render test)

- Toggle swaps tool set correctly (mutating tools gone, MCP kept) and restores prior set,
  including the `--tools`/`--exclude-tools` interplay.
- `plan_mode` system-prompt section appears/disappears (section diff only touches that section).
- Bash allowlist: `git log` passes, `rm` blocked with reason.
- Footer: `◇ Plan mode` is right-aligned at the given width and uses the `planMode` color token.
- Keybinding defaults: shift+tab -> `app.planMode.toggle`, alt+t -> `app.thinking.cycle`;
  extension conflict reservation.
- Resume restores plan mode and re-applies tools.
- Existing `test/plan-mode-extension.test.ts` (example) unaffected.

### Docs/changelog

- `packages/coding-agent/CHANGELOG.md` under `[Unreleased] -> Added`: built-in plan mode;
  under `Changed`: thinking-cycle default key moved to alt+t.
- `packages/coding-agent/README.md` line 19 currently says plan mode is only an example —
  update; check `docs/keybindings.md` for the binding table.

## Not included (can add later)

- The example's plan-execution flow (`[DONE:n]` tracking, "Execute the plan?" prompt).
  This plan is toggle + read-only + indicator only.
- RPC/print-mode surface beyond the `AgentSession` API.
- Editor border tint for plan mode (like bash mode) — one line in `updateEditorBorderColor()`
  if wanted.

## Notes from exploration

- The sketch target is the coding-agent interactive mode: the model row is the footer bar
  (`components/footer.ts:89-137`), currently one left-aligned line; no right-aligned segment
  exists there yet.
- A full example plan mode exists at `packages/coding-agent/examples/extensions/plan-mode/`
  and proves every needed hook works; it does not satisfy the indicator requirement
  (right-aligned on the model row vs. a second footer line), hence built-in.
- `createReadOnlyTools()` exists in `core/tools/index.ts:228` (read/grep/find/ls).
- No per-tool permission prompt system; enforcement is tool-registry swapping plus
  `tool_call` blocking.
