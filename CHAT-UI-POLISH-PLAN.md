# Chat UI polish plan

Status: Stages 1-5 are implemented. The design references under
`packages/coding-agent/test/ui-demos/` now render the shipped components.

Scope: auto-compaction and branch-summary activity, compaction and branch result rows,
message input surface, model/effort persistence, menu hints, and the interrupt hint in
the hotkey bar.

Non-goals: no change to compaction thresholds, summary prompts, branch behavior, tool-row
styling, or the existing theme token set unless a demo proves a new token is necessary.

## Ground rules

- Stages 0-5 ship as separate changes, each with its own tests and manual check.
- The new visual work is demo-first. Do not implement the product component until its
  demo variant is approved.
- The straightforward behavior work (model persistence, menu hints, interrupt hint) needs
  no design demo and can be implemented directly after this plan is accepted.
- Every user-visible change gets one `packages/coding-agent/CHANGELOG.md` entry under
  `## [Unreleased]`; a TUI editor change also gets a `packages/tui/CHANGELOG.md` entry.
- Run `npm run check` after each code stage. Run targeted tests, not the full suite.

## Current state

### Activity indicators

- `working` / `thinking` use the fading dot and swept label in
  `src/modes/interactive/components/status-indicator.ts` and `working-status.ts`.
- `CompactionStatusIndicator` and `BranchSummaryStatusIndicator` still use the base
  `Loader` braille spinner. Their labels include `(esc to cancel)` inline.
- `RetryStatusIndicator` also includes `(esc to cancel)` inline.
- All four kinds already share the same display slot: the editor's top border when
  embedded, otherwise the status container.
- The `/tree` summarization path adds a stray `Spacer(1)` to the chat before showing the
  branch-summary indicator.

### Compaction and branch results

- `components/compaction-summary-message.ts` and `components/branch-summary-message.ts`
  are near-identical full-width `Box` surfaces with `customMessageBg`, vertical padding,
  a `[compaction]` / `[branch]` label, a blank line, and a collapsed line.
- A collapsed result is roughly five rows: outer spacer, top padded row, label, blank,
  collapsed text, bottom padded row. The expanded state adds the full summary Markdown
  inside the same full-width surface.
- Both expand on click and through `ctrl+o`.

### Message input surface

Two different surfaces are possible readings of "message input":

- The transcript user message (`components/user-message.ts`) uses Markdown with
  `padY = 1` and a full-width `userMessageBg`, so a one-line prompt occupies three rows.
- The composer (`components/custom-editor.ts`, `inputBandOptions`) is a three-row solid
  `editorBg` band (`minLines: 3`), with the text row vertically centered.

The wording "in the chat, the message input, like when you send a message to the model"
points at the transcript user message. Stage 0 nevertheless demos both so one review
settles it.

### Model and effort persistence

- The model selector treats `Enter` as session-only and `Ctrl+S` as "set as default".
- The effort selector does the same.
- `/model <exact>`, `/effort <level>`, and the cycle keybindings also use
  `persist: false` in the interactive call sites.
- Both selectors render a bottom hint row with `Enter to select · Ctrl+S to set as
  default · Esc to cancel`.
- `app.thinking.save` exists only for the effort selector. `app.models.save` is also used
  by the scoped-model selector to persist the model scope, so that binding stays.

### Hotkey hint row

- `components/hotkey-hints.ts` renders a dynamic row under the model footer.
- `shortcuts` registers first; `applySubagentHint()` uses `addFront("agents")`, so the row
  is currently `← for agents · ? for shortcuts`.
- There is no `esc to interrupt` item. The hint is inline in the working/compaction/
  branch/retry labels instead.
- `footerHint()` already renders the key in `text` (bright white) and the effect in `dim`
  (darker), which matches the requested styling.

## Stage 0 - design demo scripts

Create a small demo harness and three scripts. They are not tests: the filename must not
end in `.test.ts`, and the app must never import them.

Location: `packages/coding-agent/test/ui-demos/`.

Shared harness in `test/ui-demos/demo-kit.ts`:

- `ProcessTerminal` + `TuiMainScreen`, real theme initialization, `q` to quit.
- Header with the demo name, what it shows, and the live keys.
- Dark/light theme toggle.
- Width marker so wide layouts can be judged at 80 and 120 columns.
- A fake session/footer factory matching `launch-layout.test.ts`.

Demos import built workspace packages, so the run command is:

```bash
npm run build
node packages/coding-agent/test/ui-demos/01-activity-and-hints.ts
```

Prototype-only components live inside the demo file. Once a variant ships, the demo is
updated to instantiate the real component, so it remains a reference rather than dead code.

### `01-activity-and-hints.ts`

Shows the complete bottom stack: status row, input band, footer bar, hint row.

States, switched with keys `1`-`6`:

1. idle
2. working (with token/elapsed tail)
3. thinking
4. auto-compacting
5. manual compacting
6. summarizing branch

Also toggles: subagents on/off, editor empty/non-empty, and compact/branch retry.

Settles:

- whether compaction/branch labels sweep like `Working` / `Thinking`
- wording: `Auto-compacting`, `Compacting context`, `Context overflow, compacting`,
  `Summarizing branch`
- whether they keep an elapsed tail (`· 4s`) or label only
- that the interrupt hint is first, then agents, then shortcuts
- whether the hint row stays hidden while the prompt has text

### `02-session-summaries.ts`

Shows realistic compaction and branch summary data in one transcript column.

Variants, switched with `1`-`4`:

1. current full-width `customMessageBg` block, for comparison
2. inline row, no surface: `[compaction] 48,200 tokens · ctrl+o to expand`
3. inline row plus a one-line preview of the summary
4. slim surface: one header row plus summary body on a subtle surface

Each variant has a collapsed and expanded state (`Enter`, click, or `ctrl+o`). Expanded
content uses a realistic summary section with headings, bullets, and file paths.

Settles:

- collapsed row height and whether it carries a preview
- whether the result keeps any background surface
- label wording and token formatting
- whether expanded text gets a left guide or plain indentation
- parity between compaction and branch results

### `03-message-surface.ts`

Shows the transcript user message and the composer as two labeled sections.

Transcript variants, switched with `1`-`4`:

1. current full-width background with one blank padded row above/below
2. flush full-width background, no vertical padding (one-line prompt = one row)
3. flush background with a `›` prefix
4. no background, `›` prefix only

Composer variants, switched with `5`-`7`:

5. current three-row band
6. one-row band at rest, growing only when text wraps
7. one-row band plus a status row directly above it, no gap row

Settle whether "message input" means the transcript row, the composer, or both.

### Stage 0 acceptance

- All three scripts run with `node` after `npm run build`.
- `npm run check` includes them because they live under `packages/*/test/**/*`.
- They render at 80 and 120 columns in dark and light themes without truncation errors.
- No product source is changed before variant approval.

### Stage 0 decisions

- Activity: working, thinking, auto-compaction, manual compaction, and branch
  summarization share the fading dot, swept label, and elapsed-seconds tail.
- Results: compaction and branch summaries use the inline row with no surface.
- Message surface: the transcript user message keeps the three-row padded background and
  gains the composer's indent and `›` arrow.

## Stage 1 - persist model and effort on every change

Goal: an explicit model or effort change is the new default immediately. `Ctrl+S` is no
longer needed in either selector.

Files:

- `src/modes/interactive/components/model-selector.ts`
- `src/modes/interactive/components/thinking-selector.ts`
- `src/modes/interactive/interactive-mode.ts`
- `src/core/keybindings.ts`
- `docs/models.md`
- `docs/keybindings.md`

Changes:

- Model selector: `Enter` calls the select callback, which now persists. Remove
  `onSelectAsDefaultCallback`, the `app.models.save` branch, and the bottom hint row.
  Keep the `default` badge and the current-model marker.
- Effort selector: `Enter` persists. Remove `onSelectAsDefault`, the `app.thinking.save`
  branch, the bottom hint row, and the stale "cycles thinking levels in-session" helper
  line. Keep the default marker in the descriptions.
- Interactive mode:
  - `showModelSelector()` selects with `persist: true`.
  - `/model <exact>` uses `persist: true`.
  - `cycleModel()` uses `persist: true`.
  - `showThinkingSelector()` selects with `persist: true`.
  - `/effort <level>` uses `persist: true`.
  - `cycleThinkingLevel()` uses `persist: true`.
  - Status text becomes `Model: ...` / `Thinking level: ...`; drop the "Default ..."
    wording.
- Keep `app.models.save` for the scoped-model selector; narrow its description to
  saving the model scope. Remove `app.thinking.save` entirely.
- Keep the model selector's `Tab` scope hint; it is a feature control, not a redundant
  navigation hint.
- Docs: say selections are saved automatically; remove the two `Ctrl+S` instructions
  and the `app.thinking.save` row. Update the sentence claiming resumed sessions restore
  model/effort without changing defaults, because explicit selection now does change the
  defaults.

Tests:

- `test/model-selector.test.ts`: Enter selects; no save-key branch; no hint text.
- `test/thinking-selector.test.ts`: same.
- `test/keybindings.test.ts`: `app.thinking.save` is gone; `app.models.save` remains.
- Cover `/model`, `/effort`, and both cycle paths through the session options.

Manual check:

- Select a model, quit, relaunch: the model is the default.
- Select an effort, quit, relaunch: the effort is the default.
- Rebind `app.models.save`: `/scoped-models` still saves the scope.

## Stage 2 - interrupt hint and hotkey bar order

Goal: the hint row reads `esc to interrupt · ← for agents · ? for shortcuts` whenever an
interruptible operation is active. The key is bright white, the effect is dark gray.

Files:

- `src/modes/interactive/components/hotkey-hints.ts`
- `src/modes/interactive/interactive-mode.ts`
- `src/modes/interactive/components/status-indicator.ts`

Changes:

- Add an explicit display order to `HotkeyHints` items, or otherwise guarantee:
  `interrupt` first, `agents` second, `shortcuts` third. `addFront` alone is fragile
  because `applySubagentHint()` can run while a status is active.
- Register the interrupt hint with `keyText("app.interrupt")` and `footerHint` so it
  follows rebinding and keeps the existing two-tone styling.
- Add/remove it when the active status indicator changes. Treat `working`, `compaction`,
  `branchSummary`, and `retry` as interruptible because Esc has an action in all four.
  If the requirement is strict - only `working` - narrow this to that kind.
- Remove the inline interrupt/cancel text from `WorkingStatusIndicator` reset labels,
  `CompactionStatusIndicator`, `BranchSummaryStatusIndicator`, and
  `RetryStatusIndicator`. The hotkey row becomes the single place for the hint.
- Keep the existing rule that the whole row hides while the prompt has text unless review
  decides the interrupt hint must remain visible while typing.

Tests:

- `test/hotkey-hints.test.ts`: order is interrupt, agents, shortcuts; interrupt can be
  removed and re-added without disturbing the others; blank/hidden behavior unchanged.
- `test/status-indicator.test.ts`: no inline `esc` text remains.
- A small unit test for the active-kind predicate if it is extracted.

Manual check:

- Idle: `← for agents · ? for shortcuts`.
- Working, thinking, compacting, summarizing, retrying: `esc to interrupt` first.
- Finish the operation: interrupt disappears, other hints stay put.
- Rebind interrupt: the row shows the new key.

## Stage 3 - unify compaction and branch-summary activity with working

Goal: auto-compaction, manual compaction, and branch summarization use the same fading
dot and swept label as `Working` / `Thinking`, in the same status slot.

Files:

- `src/modes/interactive/components/status-indicator.ts`
- `src/modes/interactive/interactive-mode.ts`
- `test/status-indicator.test.ts`

Changes:

- Make the fading-dot frames the default for `StatusIndicator`, or introduce a shared
  `SweepingStatusIndicator` used by `WorkingStatusIndicator`,
  `CompactionStatusIndicator`, and `BranchSummaryStatusIndicator`. Retry may keep the dot
  too, but keeps its countdown message.
- Move the swept-label logic out of `WorkingStatusIndicator` into the shared activity
  indicator. Compaction and branch labels sweep instead of rendering plain muted text.
- Labels lose the inline `(esc to cancel)` text; Stage 2 owns the hint.
- Use labels such as `Compacting context`, `Auto-compacting`,
  `Context overflow, compacting`, and `Summarizing branch`. The demo decides whether an
  elapsed tail is appended.
- Remove the now-unused `colorFn` plumbing for compaction if the dot frames are rendered
  verbatim in grayscale, like the working dot.
- Remove the stray `Spacer(1)` added before the `/tree` branch indicator in
  `interactive-mode.ts`.
- Keep the retry countdown behavior; only its inline hint and default frames change.

Tests:

- Compaction and branch indicators contain the same dot frames as working and no braille
  frames.
- Their labels sweep (256-color gray ramp) and never contain `esc`.
- Border embedding and narrow-width fallback still keep exact visible width.
- Retry still updates its countdown and disposes its timer.
- Branch summary indicator appears without adding a chat spacer.

Manual check:

- Trigger `/compact`, threshold compaction, overflow recovery, and `/tree` summarize.
- Each shows the same visual activity line as a normal turn.

## Stage 4 - compaction and branch summary results

Goal: replace the padded full-width result block with a compact, readable row that fits
the rest of the transcript. Compaction and branch results share one renderer.

Files:

- `src/modes/interactive/components/compaction-summary-message.ts`
- `src/modes/interactive/components/branch-summary-message.ts`
- new shared implementation file if both remain thin wrappers
- `src/modes/interactive/interactive-mode.ts` for spacing
- `test/collapsible-message-components.test.ts`

Changes, following the approved Stage 0 variant:

- Keep the exported class names and constructor signatures; both are package API.
- Collapsed: one row, no vertical padding and no full-width `customMessageBg` block by
  default. Use the existing label color, muted detail, and `keyText("app.tools.expand")`
  for the hint. Show the compaction token count for compaction results.
- Expanded: label row plus summary Markdown, indented to the transcript padding. Use a
  subtle surface or left guide only if the demo approves it; do not keep the current
  padded box by default.
- Keep click-to-toggle and `ctrl+o` through the existing expandable component path.
- Keep Markdown transformers seeing only the summary body, not the Toucan header.
- Recheck the spacer before the result in `addMessageToChat`; keep one blank line between
  transcript items, not five rows of surface.
- Do not change `customMessageBg` for extension/custom messages.

Tests:

- Collapsed compaction result is one content row plus no padded background rows, contains
  the token count and expand hint, and hides the summary.
- Collapsed branch result is one content row, contains the expand hint, and hides the
  summary.
- Click and `ctrl+o` expand both; a second click collapses.
- Expanded content still runs `summary` transformers with the correct message id.
- Width handling is exact at 1, 20, 80, and 120 columns.

Manual check:

- Compact a long session: the result is quiet in the transcript and expands to readable
  Markdown.
- Navigate the tree with summarization: the branch result uses the same row language.
- Toggle `ctrl+o` expands/collapses both.

## Stage 5 - message input surface

Goal: make the selected message surface a one-row background.

The wording points at the transcript user message, but Stage 0 also demos the composer.
Implementation follows the approved option; if it is the composer, the TUI editor needs a
one-row band mode, so that sub-stage also updates `packages/tui`.

### Option A - transcript user message (recommended reading)

Files:

- `src/modes/interactive/components/user-message.ts`
- `test/user-message.test.ts`
- `test/assistant-message.test.ts`

Changes:

- Drop the vertical Markdown padding for user messages, or make it configurable if review
  wants both. A one-line prompt becomes one full-width `userMessageBg` row; longer prompts
  grow one row per line.
- Keep horizontal `outputPad`.
- Keep OSC 133 markers on the first/last rendered line.
- If the demo prefers a `›` prefix or no background, implement that variant instead.
- Do not change assistant or thinking padding.

Tests:

- One-line user message renders one background row, not three.
- Multi-line message renders exactly its wrapped line count.
- OSC 133 start/end markers still land on the first/last line.
- Markdown transformers and message identity are unchanged.

### Option B - composer band

Files:

- `packages/tui/src/components/editor.ts`
- `src/modes/interactive/components/custom-editor.ts` (`inputBandOptions`)
- `test/launch-layout.test.ts` and its snapshot
- `test/status-indicator.test.ts`
- `test/input-shine.test.ts`
- `packages/tui/test/editor.test.ts`

Changes:

- Add a band-padding option, or make `minLines: 1` mean one row instead of forcing one
  blank row above and below. Keep the current three-row behavior available.
- Set the composer to the one-row band.
- Keep the status row above the band, no `editorBg` on it.
- Keep the band shine geometry correct for the new row count.

Tests:

- Empty composer renders one filled row with prompt and placeholder.
- Wrapped text grows the band; no blank padded rows.
- Launch snapshot and status/menu row indices are updated.
- Band shine still paints the full band and returns to the resting fill.

## Stage 6 - final pass

- Update `docs/keybindings.md`, `docs/models.md`, and any docs that describe the old
  result blocks or activity hints.
- Add changelog entries under `[Unreleased]`.
- Run `npm run check` after every stage.
- Run targeted tests per stage. Run `./test.sh` before the final handoff if requested.
- Manual pass in a real terminal at 80 and 120 columns in dark and light themes.
- Verify no demo script is imported by app code and no test file name collision was added.

## Decisions to settle in the Stage 0 review

1. Compaction/branch activity: label only, or label plus elapsed seconds?
2. Summary result: inline row, inline row with preview, or slim surface?
3. Message input: transcript user message, composer, or both?
4. Hint row while typing: keep the existing hide-on-input rule, or keep only
   `esc to interrupt` visible?
5. Menu hints: remove the whole bottom hint row from model/effort selectors, or only the
   `Ctrl+S` segment? This plan recommends removing the whole row; `Enter`/`Esc` are
   standard and the scope hint stays on the model selector.

## Suggested order

1. Stage 0 demos and review.
2. Stage 1 persistence and menu hints.
3. Stage 2 interrupt hint and hotkey order.
4. Stage 3 activity indicators.
5. Stage 4 result rows.
6. Stage 5 message surface.
7. Stage 6 docs, changelog, final QA.

Stages 1 and 2 are independent of the visual demo approval and can ship first. Stages 3
and 4 are the visual core. Stage 5 waits on the message-surface interpretation.

## Detailed build process

Each stage below is a separate change with its own exit criteria. Do not start a stage
until its dependencies are done. Stage 1 and Stage 2 can run in parallel after Stage 0 is
approved.

### Stage 0 build order

1. Add `test/ui-demos/demo-kit.ts` with terminal setup, theme toggle, width marker, and the
   fake session/footer used by `launch-layout.test.ts`.
2. Build `01-activity-and-hints.ts` first. It is the simplest stack and settles the
   indicator/hint questions that Stages 2 and 3 depend on.
3. Build `02-session-summaries.ts`. Keep the current components alongside the candidate
   variants so the comparison is live.
4. Build `03-message-surface.ts`. Include both readings of "message input"; do not force
   a choice before review.
5. Run `npm run build`, then each demo. Check 80 and 120 columns in dark and light.
6. Record the chosen variants in the decision list in this plan. Rejected variants stay in
   the demo until the matching implementation lands, then the demo is updated to use the
   real component.

Exit criteria: all demos run from `node`, `npm run check` passes, and no file outside
`test/ui-demos/` changed.

### Stage 1 build order

1. Update the selector tests to state the intended behavior first: Enter selects and
   persists; the save hint and save key path are absent.
2. Change `ModelSelectorComponent`: remove `onSelectAsDefaultCallback`, the
   `app.models.save` branch, and the bottom hint row. Keep the current/default markers.
3. Change `ThinkingSelectorComponent`: remove `onSelectAsDefault`, the
   `app.thinking.save` branch, the bottom hint row, and the stale in-session cycle line.
4. Change `interactive-mode.ts`: every explicit model/effort path passes
   `persist: true`, including `/model`, `/effort`, and both cycle methods. Remove the
   "Default ..." status wording.
5. Remove `app.thinking.save` from `keybindings.ts`. Narrow `app.models.save` to the
   scoped-model selector.
6. Update `docs/models.md` and `docs/keybindings.md`.
7. Run `model-selector`, `thinking-selector`, and `keybindings` tests, then
   `npm run check`.
8. Manual: select model and effort, quit, relaunch, confirm both came back. Then confirm
   `/scoped-models` still saves with `app.models.save`.

Exit criteria: no selector shows a save hint; changing model or effort writes the default
immediately; scoped-model persistence is unchanged.

### Stage 2 build order

1. Add ordering to `HotkeyHints` before adding the new item: interrupt 0, agents 1,
   shortcuts 2. Update the unit tests for insertion and re-add behavior.
2. Add one interactive-mode helper that registers or removes the interrupt hint from the
   active status kind. Call it from `showStatusIndicator()` and `clearStatusIndicator()`
   so it cannot drift.
3. Register the hint with `keyText("app.interrupt")` and `footerHint()`.
4. Remove the inline interrupt text from the working reset label, compaction, branch, and
   retry indicators.
5. Update `status-indicator` tests for the new labels; add a test for the active-kind
   predicate if it is extracted.
6. Run the hotkey and status tests, then `npm run check`.
7. Manual: idle, working, compacting, summarizing, retrying, and finish. Confirm the
   order and that the hint disappears on finish.

Exit criteria: `esc to interrupt` is always first when present, agents second, shortcuts
third; no duplicate inline interrupt hint remains.

### Stage 3 build order

1. Extract the fading-dot frames and swept-label rendering into one shared activity
   indicator. Leave `WorkingStatusIndicator` behavior unchanged in this step and keep its
   tests green.
2. Make compaction and branch indicators use the shared indicator. Remove their inline
   cancel text and the now-unused `colorFn` plumbing if the dot is rendered verbatim.
3. Pass the same embedded/standalone placement path as working; no new status container.
4. Remove the stray chat spacer in the `/tree` summarize path.
5. Extend `status-indicator.test.ts`: same dot frames, swept labels, no braille, no
   inline `esc`, exact width at narrow widths, retry countdown still works.
6. Run the status tests, then `npm run check`.
7. Manual: `/compact`, threshold compaction, overflow recovery, and tree summarization.

Exit criteria: all four activity kinds read as one visual family; placement and width
behavior match working.

### Stage 4 build order

1. Choose the Stage 0 summary variant and implement a shared renderer. Keep
   `CompactionSummaryMessageComponent` and `BranchSummaryMessageComponent` as thin,
   API-compatible wrappers.
2. Implement the collapsed row first, including token count, label, expand hint, click,
   and `setExpanded`.
3. Implement the expanded body: header plus summary Markdown, correct indentation,
   transformer context, and no accidental full-width padding.
4. Recheck `addMessageToChat` spacing; keep one blank line between transcript items.
5. Update `collapsible-message-components.test.ts` for row height, text, click toggles,
   transformers, and exact width. Keep the skill component tests untouched.
6. Run the summary tests, then `npm run check`.
7. Manual: compact a long session, expand, collapse, navigate the tree with summarize,
   and toggle `ctrl+o`.

Exit criteria: collapsed results are quiet one-row entries, expanded results are readable,
and both result kinds share one implementation.

### Stage 5 build order

1. Confirm the Stage 0 decision: transcript user message, composer, or both.
2. If transcript: remove the vertical Markdown padding in `UserMessageComponent` (or make
   it an option only if both styles are wanted), keep horizontal padding and OSC 133
   markers, and update `user-message.test.ts`.
3. If composer: add a band-padding option to `packages/tui` or make `minLines: 1` mean one
   row, switch `inputBandOptions()`, then update the launch snapshot, status tests, shine
   tests, and editor tests.
4. Run the affected tests, then `npm run check`.
5. Manual: empty input, one-line prompt, wrapped prompt, composer with status row, and
   band shine.

Exit criteria: the chosen surface has a one-row background at one line of content, grows
correctly, and all existing layout snapshots are updated deliberately.

### Stage 6 build order

1. Update remaining docs that mention the old result blocks, menu save keys, or inline
   interrupt hints.
2. Add changelog entries under `[Unreleased]`.
3. Run `npm run check`.
4. Run the targeted tests for every changed package, then `./test.sh` if a full non-e2e
   pass is wanted.
5. Manual pass at 80 and 120 columns, dark and light, with subagents on and off.
6. Verify the demo scripts still run and that no app code imports them.

Exit criteria: checks pass, docs match behavior, and each stage's manual checklist is
signed off.
