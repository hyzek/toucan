# Master Review — Engineering Audit of `main` (46 commits)

Branch: `master-review` (based on `main` at `012890dcf`). Spec: `docs/reviews/master-review-goal.md`.
Audit only: no code or behavior changes were made on either branch.

---

## 1. Executive summary

`main` contains 46 commits: one squashed fork import (`e1fd0ec6f`) plus 45 authored commits
that reshape the Toucan coding agent around a new chat UI (tool rows, diff blocks, band
composer), and add four substantial features — built-in subagents, opt-in Toucan Web, plan
mode, and the question/handoff decision tools — plus release-versioning tooling.

**Overall assessment: good architecture, good per-commit quality, bad branch hygiene.**
The feature work is well designed: policy isolated in dedicated modules (`plan-mode.ts`,
`subagents/`, `resource-tree.ts`, `shine.ts`), tested against the faux provider, and wired
with clean injection seams. The dominant problem is that **the test suite is red on `main`
right now**: CI run 43616289195 fails (`test (other)` ✗, `test (coding-agent)` ✗) and a full
local `./test.sh` reproduces the same failures. Five distinct regression clusters are verified
with commit attribution (Section 9, H1–H5). None of them require deep fixes — most are test
expectations that were not updated when defaults changed — but they poison the signal for
every future change.

A sixth, structural problem: `interactive-mode.ts` is a 7,303-line god class and its test
seam is an ad-hoc `Object.create(prototype)` fake host. That combination is exactly why
commit 54f8ac4a8 broke seven tests silently (the fake host lacked the new method).

No meaningful performance problem was found, in line with the spec's expectation. Two small
items (import-time git spawn, serial `/stats` scan) are recorded as Low.

Verified problems are marked **VERIFIED**; analysis-based judgments are marked **hypothesis**
or **analysis** with confidence.

---

## 2. Verification evidence (what was actually run)

| Action | Result |
|---|---|
| `npm run build` | exit 0 (log kept during audit) |
| `./test.sh` (full non-e2e suites, Node 26.13) | **exit 1**; failure list in Section 3 |
| CI run 43616289195 (`main` @ `012890dcf`) | `test (other)` **X**, `test (coding-agent)` **X**, `test (durable)` ✓, `mcp-conformance` ✓ |
| `vitest test/system-prompt-updates.test.ts` (targeted) | 1 failed / 8 passed; received `[read, bash, edit, write, question, handoff]`, expected 4 tools |
| Live probe of `isReadOnlyBashCommand` (Section 7.1) | `find -delete`, `curl -X POST`, `echo evil \| sh`, `sed -n -i` **ALLOWED** |
| `time git --no-optional-locks rev-list --count HEAD` | 6 ms |
| `wc -l` | `interactive-mode.ts` 7,303 lines; `agent-session.ts` 4,672; `agent-loop.ts` 959 |

CI and local agree on every real regression. The delta between the two lists is fully
explained by environment (Section 3.2).

### 2.1 mcp-conformance caveat (hypothesis, med confidence)

The `mcp-conformance` job reports ✓ but its log contains sub-suite failures:
`FAIL auth/scope-retry-limit`, `FAIL auth/basic-cimd`, `FAIL elicitation-sep1034-client-defaults`.
Either the runner tolerates failing suites or they are treated as expected-fail. Either way a
green job is hiding red suites; this deserves a follow-up (M6).

---

## 3. Test-failure triage

### 3.1 Verified regressions on `main` (CI + local)

1. `test/interactive-tui.test.ts` — 7 × `TypeError: this.clearInterruptConfirmation is not a function`
   (throws from `interactive-mode.ts:2212, 2233`). Introduced by **54f8ac4a8** (H1).
2. `test/system-prompt-updates.test.ts` — expects `[read, bash, edit, write]`, gets
   `+question, +handoff`. Expectation reverted by **924b0ff73**; broken by **de39e361e**
   and **457a9c016** (H3).
3. `test/suite/regressions/3592-…` (11 vs 9 active tools) and `5109-exclude-tools` — same
   root cause as (2): new default tools not reflected in fixtures (H3).
4. `test/read-line-range-display.test.ts` — expects `Read notes.txt:25-37`, renders
   `Read notes.txt (offset=25, limit=13)`. New row format introduced by **924b0ff73**
   (`core/tools/renderers/read.ts` `formatReadLineRange`); test last touched by `b3e65ebde`
   and never updated (H4).
5. `test/shell-path-exists.test.ts`, `test/powershell-config.test.ts` — suite collection
   crash: `TypeError: Cannot read properties of undefined (reading 'status')` at
   `src/config.ts:643` (`buildNameFromCheckout` → `spawnProcessSync`). **012890dcf** made
   `BUILD_NAME` a module-level const that spawns `git` at every import; these suites mock
   `spawnSync` (H2).
6. `test/examples/61-tutorial/tutorial.test.ts` — `book.md:174: package.json no longer has
   this block`. The release version sync (**bd44dc001**, **df41ccb58**) rewrote the example
   fixture `package.json` (`0.0.1` → `24.0.0`) that `book.md` quotes verbatim (H5).
7. `test/input-shine.test.ts` — 5 × `not a truecolor background` on CI and locally without
   `COLORTERM=truecolor`. The test hard-requires truecolor; the CI runner offers 256 colors.
   Environment-sensitive test, not a behavior regression (M4).

### 3.2 Environment-only local failures (not regressions)

- `packages/env` — 7 suites (`conformance`, `differential`, `process`, `remote`,
  `ssh`, `ssh-external`, `terminal`) fail collection: the `toucan-env` daemon binary was not
  built locally (log shows the daemon-build marker 14×; CI builds it in a dedicated step).
- `packages/chord` `test/node/plugins/install.test.ts` ×3 — `EALLOWGIT`: local npm config
  disables `git+file:` fetches. CI passes.
- `packages/chord` `test/link/part.test.ts` (compression bomb, 101332 > 50000) — Node 26.13
  vs CI Node 22 zlib ratio difference; does not fail on CI. Worth a look before the repo moves
  its CI Node version (M5).
- `test/suite/regressions/11613-bash-timeout-after-shell-exit.test.ts` — local only,
  timing-sensitive (expects a timeout error that did not fire under local load). Not in CI.

---

## 4. Commit-by-commit review (all 46)

Chronological order. Commit 1 is the fork import, reviewed as context only per the spec.
Each entry: purpose, verdict, and any finding. Full working notes were kept during the audit.

1. **e1fd0ec6f** — `initial fork start rename`. Squashed import of the upstream (pi) codebase
   into the toucan monorepo: packages `ai`, `agent`, `tui`, `coding-agent`, `chord`,
   `durable`, `env`, `mcp`, `schema`, `codemode`, `evals`; `apps/p2`. Reviewed as context:
   the fork inherits a layered design (ai → agent → coding-agent; tui independent). Not
   graded as authored work.
2. **8cd72b4ae** — Start-screen, input band, and footer redesign. Large UI change: filled
   input band, tip line, hotkey hints row, footer bar. Reviewed in full; coherent, no findings
   beyond churn typical of UI redesign.
3. **03f6bf152** — Working status line embedded in the editor. Reviewed mostly in full. OK.
4. **00db80691** — "add exported session transcript": committed `111.txt`, a 19,718-line chat
   dump, at repo root. Deleted in `2a0b3abcc`, but the blob lives in history forever.
   Low (L11): accidental artifact in history.
5. **267ca66c8** — Marker-led tool rows + one-sentence-per-tool-run summaries
   (`ToolGroupComponent`, `TOOL_ROW_MARKER`). Good design: grouping logic in one component.
6. **a256f814d** — Collapse finished thinking runs to a timed "Thought" row. Duration measured
   while rendering and cached per run. OK.
7. **fe71f6f79** — Print sub-second thinking durations with one decimal. Trivial, clean.
8. **9963a0f39** — Syntax-highlighted diff rows with folding and split layout. New
   `core/tools/diff-lines.ts` parses the display diff string into a structured `DiffLine`
   model; parse cost is size-capped. Reasonable; re-parsing a display string is slightly
   backwards but contained.
9. **6a84382f5** — Show single-file shell edits (`sed -i`, `tee`, redirects) as edit rows.
   `bash-edit.ts` refuses conservatively on pipes/vars/globs — never claims an edit it can't
   verify. Good security posture.
10. **b3e65ebde** — Diff blocks with box guide (`├│└`), hunk names, change-block renderer,
    turn-duration row. 34 files; source reviewed in full. OK.
11. **2eb55b7de** — tui `SelectListLayoutOptions` (selection marker, solid selection,
    keep-in-view, hide scroll info); autocomplete above editor. Clean.
12. **5457d4064** — Write results as diff blocks; read rows count lines loaded; shared
    `file-snapshot.ts` (256 KB cap). Note (L6): every write snapshots before+after even when
    nothing renders; bounded and async, accepted.
13. **62db77c3c** — `/stats` overlay (`core/usage-stats.ts`), `/thinking`→`/effort` rename,
    menu above input, footer drops git branch. Note (L3): usage-stats scans every session
    JSONL serially with `await` per file; fine at today's scale.
14. **3b7e47a70** — tui demo scripts named `*-demo.ts` so the vitest glob skips them. OK.
15. **59091bb05** — Fading-dot working indicator + input-band shine; new pure `tui/src/shine.ts`.
    Shine ANSI-walk runs only while animating. Note (L4): Tab no longer triggers the forced
    file listing, but `AutocompleteProvider.force` / `shouldTriggerFileCompletion` remain in the
    public interface unused — dead API surface kept "for extensions".
16. **c8f609591** — Hide the launch tip once any chat history exists; new `chat-notice.ts`
    with a clean `hasChatTranscript` predicate. Clean.
17. **90327d1d6** — Drop the gray block surface from diffs; only changed lines are banded.
    Good subtraction.
18. **edfef7d5d** — "Jump to latest" moved from floating pill to the tip slot, clickable.
    Clean.
19. **1756deda4** — Root README. *(Retraction of an interim note: both `./toucan-test.sh` and
    `./test.sh` exist at repo root, and the "skips sub-agents" wording is gone — verified.)*
    New finding (L9): the README says Toucan "skips features like plan mode", which has been
    stale since **53b312999** shipped plan mode (README last touched by `66b604c06`).
20. **156256124** — Keep 1 blank band row above/below the editor past `minLines`. Small, tested.
21. **9719407ee** — Footer single-space separators. Trivial.
22. **9e01fddd0** — README npm install + nix line. Trivial.
23. **bd44dc001** — Build-number versioning (`b23`): all package versions to `23.0.0`,
    `--version` prints `BUILD_NAME`, `release.mjs` cuts builds from `git rev-list --count`,
    mirrored mapping in `scripts/build-name.mjs` (duplicated in `src/config.ts` by design,
    tested on both sides). Finding → H5 starts here: the version sync also rewrote chord
    example fixtures (`61-tutorial` etc.) that docs quote verbatim.
24. **66b604c06** — Built-in subagents + agent command center (largest feature commit).
    New `core/subagents/` (registry, default-agents, runner, manager, tool, renderers),
    `agents-command-center.ts`, `subagent-results-message.ts`. Manager: queue behind
    `maxConcurrent`, steer/stop, deferred parent notes with redelivery on turn end,
    `stopAll` on dispose; children are isolated `AgentSession`s with own tool subsets;
    project agents gated on trust. Thorough faux-provider suite. Design sound (see P1).
    Subagent tool added to default active tools here.
25. **df41ccb58** — Release b24: mechanical version bump 23.0.0→24.0.0. Repeats the fixture
    damage from (23): `61-tutorial/package.json` version rewritten, `book.md:174` quote no
    longer matches → `tutorial.test.ts` fails on `main` (H5, VERIFIED).
26. **fc8181de7** — Add `[Unreleased]` changelog sections post-release. Trivial.
27. **f2e7205ca** — Built-in web access: loads npm `pi-web-access` as a replaceable built-in
    extension; `@earendil-works/pi-*` peer names aliased to Toucan packages in the extension
    loader (`getAliases` + virtual modules); `PI_CODING_AGENT_DIR` env shim with restore in
    `finally` (correct). Note (M2): the upstream package ships prebuilt dist JS and its module
    imports resolve to Toucan internals — a compat-shim/supply-chain surface outside repo review.
28. **a968a9d7c** — `/skills` and `/context` resource trees. New `resource-tree.ts` (pure
    formatters) + thorough tests. Note (L7): user-vs-project classification by
    `isPathWithin(dir, cwd)` can label a parent-directory AGENTS.md under "user".
29. **8bd7d9edc** — Working line: full dot-grouped token counts, h/m/s timer. Clean.
30. **352570c1e** — tui: keep the working status row above an open slash menu; new protected
    `renderAutocompleteBelowHeader()` hook. Small, tested.
31. **924b0ff73** — Opt-in subagents + Toucan-style tool rows (60 files).
    `subagents.enabled` (default off); tool never registered when off — correct gating.
    Tool rows ported from pi-claude-code-ui: bash headline summarizer (`bash-command.ts`),
    right-aligned duration, search/list rows collapse to counts, web-access rows replace
    upstream progress bars via a Proxy intercepting `registerTool`/`Command`/`Shortcut`.
    Findings: reverted `system-prompt-updates.test.ts` expectation to 4 tools (H3 setup);
    changed read-row range format to `(offset=, limit=)` without updating
    `read-line-range-display.test.ts` (H4). Notes (L5): reload path auto-activates
    newly-registered default tools; the web Proxy binds all api methods to the target.
32. **1a0888974** — mock-subagents example: omit unresolved `resume` argument. Trivial.
33. **72892c728** — `/context` usage line (percent/tokens/window; null-after-compaction and
    no-model states handled). Plan file added at root (later moved in 38). Note (L8):
    `toLocaleString()` makes digits locale-dependent — consistent with the footer, acceptable.
34. **12c6bab27** — Footer shows the model display name. Trivial, tested.
35. **3f11996ac** — `/context` heading restyled bold-accent. Trivial.
36. **8a4b3d24c** — Chat polish: shared `SessionSummaryMessageComponent` (branch/compaction
    now subclasses — good dedup), fixed hint-row display orders replacing `addFront` churn,
    elapsed-seconds tails with disposed intervals, banded user messages, selectors always
    persist (removed `app.thinking.save`). Note (L10): always-persist is a behavior change,
    intentional per changelog.
37. **8c29184b8** — Rename web access to Toucan Web: wrapper strips upstream branding from
    tool label/description and swallows the upstream update notice via a nested Proxy on
    `ctx.ui.notify`. Note (L12): string-matched notice filtering (`startsWith("pi-web-access
    updated from ")`) is brittle to upstream wording changes; bounded to this shim.
38. **2a0b3abcc** — Repo hygiene: loose root plan files moved to `docs/plans/`, `111.txt`
    deleted. Fixes the root-file drift from 23/33/36. No code changes.
39. **c14312daa** — Test-only: drop delisted Fireworks model, re-point compat tests with an
    explanatory comment. Good practice (catalog drift handled openly). Clean.
40. **53b312999** — Plan mode (shift+tab, `/plan`). Policy isolated in `core/plan-mode.ts`
    (removed/ensured tool sets, prompt section, bash allowlist); tool swap captured and
    restored; persisted as a custom session entry re-validated on restore; re-applied after
    `/reload`; footer badge + editor border theme token. Finding (M1): the "read-only" bash
    allowlist has verified escape classes — see 7.1. Tests cover happy path + basics.
41. **de39e361e** — Question tool: N questions in one blocking TUI form (tabs, options,
    free-text, multi-select); non-TUI degrades to an instructive error. Added `question` to
    default active tools. Finding (H3): updated `default-tools-setting.test.ts` but missed
    `system-prompt-updates.test.ts` and the two regression fixtures.
42. **457a9c016** — Handoff tool: plan→build decision menu; `startImplementation` calls
    `exitPlanMode` via injected closures (clean seam). Added `handoff` to defaults; compounds
    H3. `handoff-menu.ts` band-style picker.
43. **96929c724** — Question-form fixes: space toggles, Enter advances/answers (so
    multi-select can submit); tab-row background painted continuously across chips and gaps
    with ANSI `49m` reset accounting, verified by segment-count tests. Careful ANSI work.
44. **54f8ac4a8** — Double-Esc interrupt confirmation: `requestInterrupt()` /
    `clearInterruptConfirmation()` gate every destructive Esc (abort turn, abort bash,
    compaction, retry, branch summary); 2 s window; `showWithInput` hint option; ownership
    flag coordinates the hint with the working indicator. Finding (H1): the ad-hoc fake host
    in `test/interactive-tui.test.ts` lacks the new method → 7 failures, also red on CI.
45. **126897a3c** — Question-form overflow: per-line gutter prefix on wrap, new
    `addGutterRow`. ANSI-correct, tested at width 40. Clean fix.
46. **012890dcf** (HEAD) — Build name follows the checkout's commit count:
    `buildNameFromCheckout()` walks up to the monorepo root (guards: `node_modules` skip,
    root `package.json` name check), runs `git rev-list --count HEAD` via `spawnProcessSync`.
    `BUILD_NAME` is a module-level const → one sync git spawn at **every import** of
    `config.ts` in a source checkout. Well tested for itself, but crashes unrelated suites
    that mock `spawnSync` (H2, VERIFIED). Startup cost itself measured at 6 ms — irrelevant;
    the side effect at import time is the problem.

---

## 5. Architecture analysis

### 5.1 Package graph and boundaries

```
packages/schema → packages/ai → packages/agent → packages/coding-agent
                     (providers, models)  (loop, ~1.6 kLoC)   (the application)
packages/tui (self-contained terminal toolkit) ──┘
packages/chord, durable, env, mcp, codemode, evals — side packages, not on the CLI path
apps/p2 — separate app, outside root checks
```

The layering is honest: `packages/agent/src/agent-loop.ts` (959 lines) is a small, provider-agnostic
turn loop (stream → execute tool calls, parallel or sequential → loop; `beforeToolCall`/`afterToolCall`
hooks; steering via pending-message queue). `packages/ai` isolates providers behind a catalog
(regenerated, never hand-edited). `packages/tui` knows nothing about agents. The boundaries
held up well under 45 commits of heavy feature work.

The problem is inside `packages/coding-agent`, not between packages:

- `src/modes/interactive/interactive-mode.ts` — **7,303 lines**. Key handling, slash commands,
  overlays, shortcuts, interrupts, indicators, session lifecycle in one class. Every UI feature
  since commit 2 has touched it.
- `src/core/agent-session.ts` — **4,672 lines**. Tool registry, run orchestration, compaction
  triggers, plan mode state, subagent gating, queueing.

Both are "everything classes". They grew organically and every one of the four new features
(subagents, plan mode, question, handoff) reached into both. The parts that *were* extracted
(`plan-mode.ts`, `subagents/`, `resource-tree.ts`, tool renderers) are the parts that are
testable; what stayed in the classes is tested through `Object.create(prototype)` fake hosts —
a seam that silently rotted (H1).

### 5.2 Extension system

The loader aliases (`getAliases`, virtual modules) let built-ins load Pi-era packages without
peer installs. It works and is documented, but it means third-party prebuilt code (pi-web-access,
M2) runs against Toucan internal APIs. Defensible for first-party built-ins; risky as a general
compat promise.

### 5.3 Design decisions re-evaluated

- **`_baseToolsOverride` + default active tool list** (in `agent-session.ts`): every new tool
  addition (subagent, question, handoff) had to touch the defaults and three fixture sites;
  two of three additions missed one (H3). The fixture problem is a symptom; the real fragility
  is that "which tools are on by default" is asserted in scattered literal arrays instead of
  derived from one exported constant.
- **Built-in extension via npm package** (web access): keeps the repo lean but permanently
  couples releases to an upstream package's wording, branding, and module graph (M2, L12).
- **Tool-row renderers as pure functions over `(args, result, options, theme, context)`**
  (924b0ff73): right call; makes the ANSI correctness tests (43, 45) possible.

---

## 6. Important execution flows

Traced by reading current sources.

1. **Startup.** `bin toucan` → `dist/bundle/cli.js` → `src/cli.ts` (`setupCli(); main(argv)`)
   → `src/main.ts` parses args, resolves auth/model/session, applies HTTP proxy settings, then
   dispatches to `InteractiveMode.run()`, `runPrintMode`, or `runRpcMode`. Importing
   `config.ts` triggers `BUILD_NAME`'s sync `git rev-list` in source checkouts (H2 mechanism;
   6 ms).
2. **Agent turn.** `AgentSession.prompt()` → extension-command short-circuit → `_preparePrompt`
   (input hooks, skill/template expansion, steer/followUp queueing while streaming) →
   `_startRun` → `packages/agent` `runAgentLoop`: stream assistant response → `executeToolCalls`
   (parallel unless tool opts into sequential; hooks fire per call) → append results → loop until
   no tool calls → settle. Steering messages are drained between tool rounds; the turn ends only
   when both tool calls and steering are exhausted.
3. **Plan mode.** Toggle captures the active tool set, swaps in the read-only set, registers the
   `plan_mode` prompt section, persists a custom session entry (re-validated on restore), and
   installs a `beforeToolCall` gate: bash calls go through `isReadOnlyBashCommand` and are blocked
   with a tool error otherwise. Restored on toggle-off, resume, and `/reload`.
4. **Subagents.** `subagent` tool → `SubagentManager.spawn` → queued if ≥ `maxConcurrent` running
   → `startSubagentSession` builds an isolated child `AgentSession` (own tools/model/thinking) →
   foreground runs await under the tool call's signal; background runs settle into `pendingNotes`
   batched by a 300 ms timer → `notifyParent` (follow-up while the parent runs, new turn when idle)
   → undelivered notes are re-offered at turn end. `stopAll` on dispose.
5. **TUI render loop.** Components call `requestRender()`; `TuiBase` coalesces to one
   `process.nextTick` render (`tui.ts:1033`). Render walks the tree to lines, diffs against
   `previousLines`, and writes only changed rows (`tui-main-screen.ts:320`), with kitty-image
   bookkeeping. Force path resets and renders immediately. This is a sound, minimal-diff design;
   no hot-path waste found in the audit window.
6. **Nested tool calls.** `NestedToolCallRunner` serializes extension-triggered tool executions
   behind a promise queue tail, inheriting each tool's own execution mode.

---

## 7. Correctness, reliability, and security findings

### 7.1 Plan-mode bash allowlist — verified escapes (M1)

`isReadOnlyBashCommand` (`src/core/plan-mode.ts`) is an allowlist of first words with a
destructive-regex blocklist. Probed live against the shipped function:

```
ALLOW  find . -name '*.tmp' -delete          ← deletes files
ALLOW  curl -s -X POST -d 'x=1' https://…    ← network write
ALLOW  echo evil | sh                        ← arbitrary execution
ALLOW  sed -n -i 's/a/b/' file.txt           ← in-place file edit
block  awk 'BEGIN{print "pwned" > "/tmp/…"}' ← (blocked; earlier hypothesis wrong)
block  git config user.email attacker@…      ← (blocked; earlier hypothesis wrong)
```

`curl` is whitelisted with no argument inspection, and the blocklist never catches `-delete`,
`-i`, or pipes into shells. **Assessment: the allowlist is a guardrail against a non-adversarial
model, not a sandbox, and the docs/prompt section call it "read-only."** If plan mode is meant as
a hard boundary, parse argv and deny file-mutating flags/pipes-to-shell, or rename the guarantee.
If it is meant as a commitment signal to the model (which the code comments suggest), it is fine
— but the wording should match. Severity Medium, verified behavior, high confidence.

### 7.2 Import-time side effect in `config.ts` (H2)

`export const BUILD_NAME = buildNameFromCheckout(getPackageDir()) ?? buildName(VERSION)`
(`src/config.ts:657`, spawn at `src/config.ts:643`) executes `spawnProcessSync` during module evaluation of the most
centrally-imported module in the package. Any test that mocks `child_process.spawnSync`
before import gets `undefined` results → collection crash. Verified: 2 suites red locally
and on CI. Reliability severity High (breaks the suite), fix cost trivial (lazy memoized
getter).

### 7.3 Error-handling observations (no findings)

- `prompt()` rejects during compaction with an actionable message; queue paths expand
  templates before queueing — consistent.
- `SubagentManager` truncates notification results to 2,000 chars with full text available
  via `status` — right trade-off.
- Web-access env shim restores env in `finally`; Proxy shims are brittle but bounded (L12).

### 7.4 Security surface notes

- No secret handling on new code paths in these commits beyond auth reuse; nothing found.
- Project-defined agents are gated on project trust (good). Project AGENTS.md/context files
  flow into prompts untrusted-by-design, consistent with upstream posture.
- Supply chain: `pi-web-access` as a runtime npm dependency executing inside the agent process
  (M2). Treat dependency updates as reviewed code (repo already pins exactly — good).

---

## 8. Performance opportunities

Per spec, no invented bottlenecks. Measured/observed:

1. **Import-time git spawn** (H2): 6 ms per process in checkouts — negligible CPU, real
   reliability cost. Fix for reliability, not speed.
2. **`/stats` serial scan** (`core/usage-stats.ts`, L3): awaits JSONL parses file-by-file
   on overlay open (backgrounded). Fine today; if session directories grow into thousands of
   files, batch with a small concurrency limit. Do not act now.
3. **Write snapshots** (L6): 2 reads ≤256 KB per write regardless of rendering. Bounded; keep.
4. **Render path**: `HotkeyHints` sorts <4 items per render; plan-mode badge computes
   `visibleWidth` per render; existsSync once per streaming write call. All trivial; noted for
   completeness, no action.
5. **TUI diff renderer** is already the important optimization and it is well implemented.

No CPU/memory/IO finding above Low severity exists in the diff range. Confidence: high, based
on full-diff reads of all 45 authored commits plus targeted hot-file reads.

---

## 9. Prioritized findings

### Critical
None.

### High — all VERIFIED, all on `main` (CI 43616289195 + local `./test.sh`)

- **H1. `interactive-tui.test.ts` 7 failures — missing `clearInterruptConfirmation` on the
  test fake host.** `54f8ac4a8` added the method to `InteractiveMode` and gates Esc handling
  through it (`interactive-mode.ts:2212, 2233`); the `Object.create(InteractiveMode.prototype)`
  fake in the test was not extended. Fix: add the stub or, better, use the prototype harness.
- **H2. `shell-path-exists` + `powershell-config` collection crash — import-time `git` spawn.**
  `012890dcf`, `config.ts:622-657`. Fix: compute `BUILD_NAME` lazily (memoized function).
- **H3. Default-tool additions not reflected in all fixtures — `system-prompt-updates.test.ts`,
  regression `3592` (11 vs 9), `5109`.** Root: expectations reverted to 4 tools by `924b0ff73`;
  `de39e361e`/`457a9c016` added `question`/`handoff` to defaults. Fix: update fixtures; derive
  them from a single exported default-tools constant to stop recurrence.
- **H4. `read-line-range-display.test.ts` — format change without test update.** `924b0ff73`
  changed read rows to `(offset=25, limit=13)`; test still asserts `:25-37`. Fix: update the
  assertion (and the HTML/session-tree variants the same test covers).
- **H5. Release tooling breaks doc-quote fixtures — `61-tutorial` fails.** `bd44dc001`/`df41ccb58`
  rewrote fixture `package.json` versions quoted verbatim in `book.md`. Fix: exempt
  doc-quoted fixture files from version sync (explicit ignore list), or regenerate the quote.

### Medium

- **M1. Plan-mode allowlist escape classes** (7.1, verified): `find -delete`, `curl` POST,
  `echo | sh`, `sed -i` pass while docs promise "read-only". Decide sandbox vs guardrail; at
  minimum deny pipes-to-shell and mutating flags, or fix the wording.
- **M2. pi-web-access runtime supply chain + alias shim coupling** (commits 27, 37): prebuilt
  upstream code running against aliased internal modules; branding/notice filtering via stacked
  Proxies and string matching. Acceptable for now; revisit when upstream API stabilizes.
- **M3. `interactive-mode.ts` (7,303 lines) and its fake-host test seam** — the structural cause
  of H1 and the main maintainability tax of this history. See roadmap R3.
- **M4. `input-shine.test.ts` requires truecolor** — red on CI's 256-color runner. Gate on
  capability or export `COLORTERM=truecolor` in the tui job.
- **M5. Chord compression-bomb test is Node-version-sensitive** (101332 > 50000 on Node 26 vs
  passing on Node 22). Make the margin data-independent before CI moves Node.
- **M6. `mcp-conformance` job is green while logging three failing suites** (2.1). Fix the
  runner's failure propagation.

### Low

- L1. `/effort` lost its argument hint in the menu list (62db77c3c).
- L2. `usage-stats` serial scan (13) — future scaling note.
- L3. Write snapshot cost (12) — accepted.
- L4. Dead autocomplete `force`/trigger API (15).
- L5. Reload auto-activates newly registered default tools — subtle coupling, tested (31).
- L6. `formatContextTree` labels parent-dir context files under "user" (28).
- L7. `toLocaleString()` locale-dependent digits in rendered rows (33) — consistent with footer.
- L8. README stale: claims plan mode is skipped (19, re-verified current wording).
- L9. Selector persistence behavior change — intentional but worth flagging in docs (36).
- L10. `111.txt` chat dump permanently in git history (4).

### Informational

- I1. Environment-only local failures documented in 3.2; classify before triaging future red.
- I2. Demos named `*-demo.ts` / `test/ui-demos/` deliberately outside the vitest glob — keep.
- I3. `git rev-list --count HEAD` = 6 ms; commit count is also the build name — cheap and
  self-consistent, though it makes every commit a "build bump".

---

## 10. Positive implementations worth preserving

- **P1. Subagent manager** (`core/subagents/subagent-manager.ts`, 66b604c06): the completion
  notification pipeline — 300 ms batching, follow-up vs new-turn delivery, redelivery of
  undelivered notes at turn end, `stopAll` on dispose — is a correct answer to a genuinely hard
  async problem, with tests around each mechanism.
- **P2. Plan-mode policy isolation** (53b312999): all mode policy in one module with captured
  tool-set swap/restore and session-persisted state validated on restore.
- **P3. Question/handoff seams** (41/42): behavior injected via closures (`isPlanMode`,
  `exitPlanMode`) instead of the tool reaching into session internals.
- **P4. ANSI-level render tests** (31, 43, 45): asserting exact segments/widths catches the
  class of bug TUIs usually ship.
- **P5. Conservative shell-edit detection** (`bash-edit.ts`, 6a84382f5): refuses to claim what
  it cannot verify.
- **P6. Catalog drift handled in the open** (39): pinned-model test updates with comments.
- **P7. Faux-provider harness discipline** for all agent-level tests; no real API calls in new
  suites.

---

## 11. Recommendations and roadmap

Ordered by value; R1–R2 restore signal, R3–R5 prevent recurrence.

1. **R1 — Make `main` green again (small, mechanical).** Fixes H1–H5: extend the interactive-tui
   fake host (or switch it to `test/suite/harness.ts`); update the three default-tool fixtures;
   update `read-line-range-display` to the `(offset=, limit=)` format; exempt the 61-tutorial
   fixture from version sync. Risk: none — tests and fixture data only. Confidence: high.
2. **R2 — `BUILD_NAME` lazy.** Replace the module-level const with a memoized
   `getBuildName()`. Removes the import-time spawn (H2) and its mock-interaction class of bug.
   Touches `config.ts` consumers (~few call sites). Risk: low.
3. **R3 — Split `interactive-mode.ts` along existing seams, incrementally.** Natural first
   extractions: interrupt handling (the double-Esc state machine), slash-command handlers,
   status/hint-row coordination. Each extraction should replace an `Object.create` fake host
   with a real component test. Do not big-bang; one seam per change. Benefit: H1-class silent
   breakage stops being cheap to reproduce.
4. **R4 — Single source for default active tools.** Export `DEFAULT_ACTIVE_TOOLS` from
   `plan-mode`-sibling module and assert fixtures against it (with the dynamic additions
   explicit). Eliminates recurrence of H3.
5. **R5 — Plan-mode wording or enforcement.** Decide guardrail vs sandbox (M1). Minimum
   concrete change: reject `| sh|bash|zsh|python…`, `-delete`, and `-i`/`--in-place` flags, and
   state the actual guarantee ("discourages writes; not a sandbox") in docs and the prompt section.
6. **R6 — CI hygiene:** fix mcp-conformance failure propagation (M6); gate or env-provide
   truecolor for tui tests (M4); decouple the chord compression-bomb assertion from Node's
   zlib ratio (M5).
7. **R7 — Housekeeping:** README plan-mode sentence (L8), autocomplete dead API removal or
   wiring (L4), and a `.gitignore` rule for exported transcripts (L10).

---

## 12. Method and retraction notes

- Per-commit diffs saved under `/tmp/opencode/diffs/` during the audit; every commit 2–46 was
  read in full diff form (largest commits read section-by-section to EOF), commit 1 as context.
- All findings labeled VERIFIED were reproduced by running the named test or function on
  `main` HEAD; CI corroboration from run 43616289195.
- Retracted interim finding: an earlier note claimed the README referenced a nonexistent
  `./toucan-test.sh` and a stale "skips sub-agents" line. Both wrong: `toucan-test.sh` exists
  (it is the API-key-stripping wrapper around `test.sh`), and the subagent wording was updated.
  The surviving README issue is the stale "skips features like plan mode" clause (L8).
- No code was modified during the audit; `master-review` contains only `docs/reviews/*`.
