# CC-UI plan: porting pi-claude-code-ui pieces into core

Source: `pi-claude-code-ui` (npm, v1.0.109), repo `FammasMaz/pi-cc-tools`, MIT.
It is a pi extension. We port only the rendering behavior into fixed core code
(no extension, no commands, no settings). Hardcoded decisions replace its config:

- `toolBackground: "transparent"` — no rules, no panel backgrounds on tool rows.
- `groupToolCalls: true` — consecutive calls fold into one sentence.
- `thinkingMode: "live"` — thinking streams, then collapses to `Thought for Xs`.

Out of scope (deliberate): input-box restyle (our solid band stays), terminal
palette theme switching (`/cc-theme`), bash intent labels (`/cc-tools intent`),
subagents, LaTeX, RTK badges, `Ctrl+Shift+O` detail mode.

Reference checkout for implementation (never commit it):
`npm pack pi-claude-code-ui` into /tmp/opencode and read the sources.

Build & run for manual checks:

```
npm run build
node packages/coding-agent/dist/bundle/cli.js
```

Each phase: implement, targeted tests only, `npm run check`, then the manual
check below. Check off `[ ]` items by hand after verifying in the real TUI.

## Phase 1 — Hide the tip when the session has messages

Goal: the `Tip: ...` line above the input box shows only while the session is
message-free; any user/assistant message (or a resumed session) hides it.

Files: `interactive-mode.ts` (tipContainer), `components/tip-line.ts`,
`test/launch-layout.test.ts`.

Manual check:
- [ ] Fresh empty session: tip visible above the input band.
- [ ] Launch in a repo with an existing session (resume): no tip.
- [ ] Send one message in a fresh session: tip gone immediately.
- [ ] `/new`: tip back.

## Phase 2 — Spinner (working indicator)

Goal: replace the current working/compaction status text:

- While the model thinks (no tool running): a playful gerund chosen randomly,
  rotating every few seconds (`Thinking…` is never reused twice in a row):
  e.g. Transfiguring, Reticulating, Ballooning, Caramelizing, …
- While a tool runs: the line names it (`Running npm test…`, `Reading stats.py…`,
  `Searching for TODO…`) — driven by the running tool call, not a guess.
- Status tail on the same line: streamed token count for the request (output +
  reasoning + tool args, counting up smoothly) and elapsed time:
  `Transfiguring… 1.2k tokens · 4s`.
- Colors: verb `accent`, status text `muted`. No verb-color config.

Files: `status-indicator.ts`, `components/status-indicator.ts` (renderInBorder),
the request/stream event plumbing in `interactive-mode.ts` that feeds it.

Manual check:
- [ ] Send a prompt with a reasoning model: verb rotates while thinking,
  token count rises during streaming, seconds tick.
- [ ] Start a tool (e.g. ask it to run `sleep 5`): line switches to the named
  command with time counting.
- [ ] Working status still renders correctly on the input band's top row
  (3-row box unchanged, no `─` rules appear).
- [ ] Retry/compaction states still show (kind transitions).

## Phase 3 — Tool rows, transparent style

Goal: tool calls render as compact one-line rows instead of the current
background panels:

- Each call: `● Tool Label` (dot colored by state: dim pending, green done,
  red failed) with the key argument (`Read src/app.ts`, `Bash npm test`).
- Consecutive finished calls fold into one sentence: `Read 2 files, ran 1
  shell command`; while running: `Reading 2 files, running 1 shell command… · 3s`,
  plus a `· 1 failed` suffix when any failed.
- Expanded state (click in fullscreen, or ctrl+o): each call in the group with
  its output preview (hardcoded: collapsed preview 8 lines, bash collapsed 10).
- No backgrounds, no top/bottom rules on tool rows. Error dot + error text keep
  theme `error` color. `toolPendingBg/toolSuccessBg/toolErrorBg` tokens stay in
  the schema (third-party themes) but the default chat rendering stops using them.

Files: `components/tool-*.ts` (read/bash/edit/diff/mcp renderers),
`chat-viewport.ts`/click hit-testing for expand, tests.

### Phase 3 decisions (settled)

- Marker glyph: `•` (U+2022). Measured at 14px in Menlo, SF Mono and JetBrains Mono: the bullet
  draws a 4-6px spot (12-32 ink pixels), `●` (U+25CF) a 9px one (59-63). Nothing sits between them
  in these fonts — `∙`, `·` and `◦` are smaller, `◉` and `⬤` are at `●` or missing, and the only
  medium option, the ring `○` (U+25CB), is absent from Monaco (and `⊙` from SF Mono). The bullet
  is the one marker every mono font on macOS has, so it wins on being reliably visible rather than
  on weight. It lives in one constant, `TOOL_ROW_MARKER`, if a future design wants a heavier mark.
  State stays in color only: `dim` pending, `success` done, `error` failed.
- Expand: click plus `ctrl+o`. No new keybinding — `ctrl+o` already toggles every
  tool row, which is the keyboard path (this answers the open question above).
- Group boundary: any visible non-tool transcript row (assistant text/thinking, user
  message) ends a run; blank spacers and empty assistant framing do not.
- A group forms at two or more consecutive calls. A lone call stays its own row, so
  a single `bash` or `edit` never hides its output behind a one-call sentence.
- Collapsed group: the sentence row, plus the call currently running under it.
  Member rows drop their own marker while the group is collapsed, so exactly one
  dot leads the group.

Built with: `core/tools/group-summary.ts` (the sentence model), `modes/interactive/components/tool-group.ts`
(the group row), `ToolExecutionComponent.setRowMarkerShown`/`getGroupedState`, and `addToolRow` in
`interactive-mode.ts`. The plan's earlier `components/tool-*.ts` file list still describes the
renderer files, which only changed to draw the marker and drop the panel background.

Manual check:
- [ ] Ask: "read package.json and run ls" — one grouped sentence after both
  finish; during run the live sentence + in-progress call below it.
- [ ] Click the row (fullscreen): expands with output; click again collapses.
- [ ] ctrl+o keyboard expand works.
- [ ] Failing bash: red dot, `· 1 failed` on the group.
- [ ] Long bash output collapses at 10 lines.
- [ ] No panel backgrounds/rule lines around any tool row.

## Phase 4 — Thinking rendering

Goal: reasoning display:

- Live: thinking streams inline (current behavior).
- On finish: collapses to one row `Thought for 3s` (dim).
- Click / ctrl+o on that row: re-expand the full thinking.
- Only rendering changes; the thinking stays in session/context.

Files: thinking message component, expand plumbing from phase 3.

Manual check:
- [ ] Reasoning model prompt: thinking streams, then folds to `Thought for Xs`.
- [ ] Click expands it again.
- [ ] `Thinking level off`: no row at all.

### Phase 4 decisions (settled)

- Nothing in the codebase stores when a thinking block started or ended: `ThinkingContent` is text
  plus a signature, and no provider reports reasoning time. So the duration is measured while
  rendering. `AssistantMessageComponent` records, per thinking run, the first update that carried the
  run and the first update that shows it is over, and caches the pair so redraws (theme change,
  click, ctrl+t) keep the same number.
- A run counts as live only while it is the last content block of a still-streaming message. Once an
  answer or a tool call follows it, or the message ends, it collapses. No new setting:
  `hideThinkingBlock: false` (default) means "expanded while the model reasons, collapsed after",
  `true` means "collapsed from the start, `Thinking...` instead of the text".
- Resumed sessions show `Thought` with no duration. The only timestamps a resumed message offers are
  its request start (`AssistantMessage.timestamp`) and the moment its session entry was written, and
  that span also covers the answer and the streamed call arguments: measured on a live session and
  then resumed, the real 3s of reasoning read as 12s. Printing that is worse than printing nothing,
  so the fallback was dropped; storing the real span means a session-format change, which this phase
  excludes.
- Adjacent thinking blocks are one run, so they collapse to one row. A run whose blocks are all empty
  (redacted reasoning carries only a signature) renders nothing, as before.
- A blank `hiddenThinkingLabel` stays the way to render no thinking row at all, for finished runs as
  well as live ones.
- Expand routes: click the row (existing per-run override). The plan's `ctrl+o` is not wired to
  thinking: `app.tools.expand` is the tool-row toggle and ctrl+t (`app.thinking.toggle`) already
  expands every thinking run, which is what the row needs. Status text and `docs/settings.md` now say
  collapsed/expanded instead of hidden/visible.

## Phase 5 — Diffs (edit/write)

Goal: edit/write calls render as syntax-highlighted diffs with word-level
marks; unified layout, side-by-side when both sides fit (wide terminals).
Pending edit shows the diff before the result. Collapses at 24 lines (ctrl+o
expands). Port/strip the plugin's diff renderer rather than write fresh.

Also port: bash commands that only edit files (`sed -i`, `perl -pi`,
`cat > f <<EOF`, `tee`, `echo > f`) render as `Edit (sed) file` with the real
diff; anything ambiguous (pipes, variables) stays a plain bash row.

Manual check:
- [ ] Ask it to edit a file: colored unified diff with +/- markers and
  word-level highlights inside changed lines.
- [ ] Wide terminal (>=160 cols): side-by-side view.
- [ ] `echo hi > t.txt` via bash renders as a Create/edit row with a diff;
  `ls | grep x` stays a normal bash row.
- [ ] Diff taller than 24 lines collapses; ctrl+o shows all.

### Phase 5 decisions (settled)

- The plugin's diff renderer is not ported. It paints state with backgrounds (line background red or
  green, a stronger background on changed words, a `▌` border), which Phase 3 removed from toucan's
  tool rows. Rebuilt on toucan's own pieces instead: `diff` (npm) for the change computation,
  `CodeHighlighter`/highlight.js for syntax, `sliceByColumn`/`truncateToWidth` from toucan-tui for
  column work. The plugin's useful ideas are kept: highlight each side as one block rather than line
  by line (so a change inside a multi-line string still colours correctly), gate word marks by
  similarity, and cap highlighting by size.
- `core/tools/diff-lines.ts` holds the model: the display-diff string back into
  `{kind, oldNumber, newNumber, text}`, word ranges for a -/+ pair, and the pairing rule.
  `EditToolDetails.diff` stays the string it is today: the HTML export template parses it in the
  browser, so changing its shape is a wire-format change this phase does not need.
- Row colouring, since backgrounds are out: the gutter (sign + number) is red/green/dim; a changed
  line keeps its syntax colours and only the words that differ take the state colour (stripped, then
  recoloured, because the syntax codes inside the slice would otherwise win); context lines stay dim
  with no syntax colour, so the changes are what stands out.
- Layout: `DiffComponent` is a component rather than a string builder because the layout depends on
  the width it renders into. Two columns at >= 150 columns and only when both sides' longest line
  fits the half width; otherwise one column. Rows are cut to the terminal width rather than wrapped,
  which keeps one row per diff line.
- Fold budget 24 rows, notice `N more lines (ctrl+o to expand)`; `expanded` comes from the tool row's
  own state, so ctrl+o and clicking the group row both reveal the rest.
- Word marks change for extensions: `renderDiff` now colours the changed words instead of
  inverting them. Public behaviour change to note in the changelog.
- Shell commands that edit one file (`core/tools/bash-edit.ts`): the bash tool recognises
  `sed -i <script> <file>`, `perl -pi -e <script> <file>`, `echo|printf|cat … > <file>` and
  `tee [-a] <file>` fed by a heredoc, and stores the before/after diff of that file in
  `BashToolDetails.fileEdit`. The row then reads `edit (sed) src/app.ts` with the diff under it, and the
  command's `(no output)` line is dropped. The diff is computed by the tool rather than by the renderer,
  so resumed sessions and the HTML export show it too, which a renderer-side snapshot cannot.
- Detection refuses anything it cannot pin to one file: a pipe, `&&`, `;`, a second file operand, a glob
  or `$` path, a backtick or `$()` anywhere in the command (substitution can change anything), an
  unterminated quote, `sed -i.bak` (leaves a backup, so the command is not only an edit), `perl -pi`
  without `-e` (that runs a program), and `tee` without a heredoc (it would wait on stdin). A wrong diff
  under an `edit` label is worse than no diff.
- The snapshot is skipped when custom `BashOperations` are configured (the command may run on another
  machine), for files over 256 KiB, and for binary content. A failing command still gets its diff: the
  shell sets up a redirect before the command runs, so `cat missing.txt > f` really did empty `f`.

## Phase 6 — Cleanup & regression

- `npm run check`, `npm run build`.
- coding-agent suite + tui `editor.test.ts` (targeted files per repo rule).
- Regenerate `test/snapshots/launch-layout.txt` if footer/band moved.
- Changelog entries under `## [Unreleased]` (`### Changed` / `### Added`).
- Manual check:
  - [ ] Full session (prompt → thinking → tools → edits → reply) looks like a
    coherent transcript, no leftover old panel rendering paths.
  - [ ] Light theme spot check (tool dots, diff colors readable).

## Open questions (answer before starting the phase)

- Phase 2: exact verb list — copy the plugin's gerunds or write our own?
- Phase 3: keep any click-free fallback (expand-all keybinding already ctrl+o)?
- Phase 5: vendor the plugin's diff renderer (MIT, code size) or re-implement
  on our existing shiki/syntax-highlight infra?
