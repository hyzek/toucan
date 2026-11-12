# Question tool (`question`)

Built-in ask-the-user tool: the model calls `question` with one or more
questions, the user answers all of them in one form, and the tool submits
everything at once (opencode-style). Plan mode highlights it.

Decisions (confirmed): tabbed form layout; built-in and active by default;
per-question multi-select supported; the form is not a bordered panel — it
extends the input band upward, painted with the same `editorBg` background.

## Tool contract — `src/core/tools/question.ts`

```
{ questions: [ { question: string, header: string,
                 options: [{ label, description? }], multiple?: boolean } ] }
```

- 1..N questions per call; "Type your own answer." auto-appended per question.
- `execute` awaits `ctx.ui.custom(...)`; built-in tools receive the full
  `ExtensionToolContext` (with `ui`) via `wrapRegisteredTools`, so the agent
  blocks until the user submits. `executionMode: "sequential"`.
- Result: `Answers:` block with `- <header>: <answer>` per question (multi
  answers joined `; `). Esc => returns a dismissed notice so the model
  continues gracefully.
- Non-TUI runs (print/json/rpc, subagents): error result, "only available in
  interactive runs".
- `promptSnippet` + `promptGuidelines` (ask to resolve ambiguity; batch all
  questions into one call).

## Layout (inline dialog replacing the editor slot)

Every row painted `theme.bg("editorBg", line)`, full width, indented to the
`INPUT_PROMPT` caret column; grows upward from the bottom, min 3 rows (editor
`minLines`), capped at ~half the terminal; long option lists scroll with a
`(i/n)` counter (SelectList visible-range pattern).

```
■ Which layout?  □ Storage  □ Migration                 ✓ Submit
  Which storage should the cache use?
  ❯ ☐ 1. SQLite        single file, zero ops
    ☒ 2. Redis         needs a running server
    ☐ 3. In-memory     no persistence across restarts
    ☐ 4. Type your own answer.
  ↑↓ move · space toggle · enter next · tab switch · ctrl+enter submit · esc cancel
```

- Single question => no tab row; answering submits immediately.
- Tabs: `■` answered / `□` open, `✓ Submit` at the end; Submit disabled until
  all answered, hint names the first unanswered header.
- Selected single answer marked `✓`; multi-select rows carry `☐/☒`.
- Typing an answer swaps the option row for an inline `Input` on the same
  editorBg; Enter commits + advances, Esc returns to the list.
- Key labels in the hint row come from the keybinding manager (stay true
  after rebinds).

## Keybindings — `core/keybindings.ts` (`APP_KEYBINDINGS`)

- Reuse `tui.select.up/down/confirm/cancel` for list nav.
- New ids: `app.question.tabForward` (`tab`,`right`), `app.question.tabBackward`
  (`shift+tab`,`left`), `app.question.toggle` (`space`),
  `app.question.submitAll` (`ctrl+enter`).
- Safe to use tab/shift+tab inside the form: the form replaces the editor, so
  `tui.input.tab` / `app.planMode.toggle` (bound on the editor) are not live.

## Plan mode integration — `core/plan-mode.ts`

- `PLAN_MODE_ENSURED_TOOLS` += `"question"`.
- `PLAN_MODE_PROMPT` gains, before the `Plan:` block:
  "When requirements are ambiguous, use the question tool to ask the user
  before finalizing: batch all clarifying questions into one call, and prefer
  asking over assumptions for anything that changes the plan's shape."

## Registration + defaults

- `core/tools/index.ts`: `question` added to `ToolName`, `allToolNames`,
  `ToolsOptions`, `createToolDefinition`/`createTool`,
  `createAllToolDefinitions`/`createAllTools`.
- Active by default: `agent-session.ts` default active list +
  `settings-manager.ts` `DEFAULT_TOOL_NAMES`; opt out via `-question` in
  `defaultTools` or `--exclude-tools`.
- Kept OUT of subagent default allowlists (`core/subagents/default-agents.ts`):
  a subagent must not block on a human.
- Transcript rows: `core/tools/renderers/question.ts` + `renderers/index.ts`
  (`Ask N questions`, answers when expanded, dim dismissed row).

## Tests

- `test/question-tool.test.ts`: schema validation; execute through harness
  mock `ctx.ui.custom` (single, multi-select, typed answer, dismissed,
  non-TUI error); plan mode ensures `question` active.
- `test/question-form.test.ts` (llama-ui pattern: capture component from
  `ui.custom`, drive `handleInput`, parse `render(width)`): tab cycling,
  answered markers, multi-toggle gating, free-text flow, Esc dismiss, and
  every rendered row carries the `editorBg` background (band-continuity
  regression guard).

## Docs/changelog

- `docs/keybindings.md` table rows; `docs/settings.md` built-in tool list;
  `docs/cli.md` if it lists default tools; CHANGELOG Unreleased -> Added.
- Optional: `test/ui-demos/` entry to inspect the layout visually.

## Reference implementations in-repo

- `examples/extensions/questionnaire.ts` — tab form state machine, tab glyphs.
- `examples/extensions/question.ts` — minimal ui.custom + Input fallback.
- `src/modes/interactive/components/custom-editor.ts:22-31` — input band
  style (`editorBg` line background, `INPUT_PROMPT`, minLines 3).
- `src/modes/interactive/components/config-selector.ts` — checkbox list
  and search-passthrough keyboard patterns.
- `test/llama-ui.test.ts` — driving ui.custom components headlessly.
