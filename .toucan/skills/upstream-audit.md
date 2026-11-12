---
name: upstream-audit
description: Summarize what upstream pi (badlogic/pi-mono) has that this toucan fork lacks, and audit that summary. Use when asked for upstream changes, drift, or cherry-pick candidates. Read-only: never fetch into this repo, never check out upstream.
---

# Auditing upstream pi changes

The fork's history is squashed: root commit `FORK_ROOT` (found with
`git rev-list --max-parents=0 HEAD`) is a renamed snapshot of upstream pi at some
commit after tag `v1.5.0`. Every upstream change after that snapshot is missing
here unless the fork reimplemented it. The audit has four phases: pin the fork
point, list the delta, write the report, audit the report. Do all commands from
the fork repo root; work entirely inside a scratch clone under `/tmp`.

Why pinning is hard: the pi → toucan rename rewrote ~1900 files, so tree hashes
and per-file content comparisons against source files fail. `CHANGELOG.md` files
are rename-untouched and are the reliable marker.

## Phase 1 — pin the fork point

```bash
WORK=/tmp/opencode/upstream-audit          # scratch clone, fresh each run
rm -rf "$WORK"
git clone --quiet https://github.com/badlogic/pi-mono "$WORK"
FORK_ROOT=$(git rev-list --max-parents=0 HEAD)
cd "$WORK" && git fetch --quiet /home/leo/Desktop/dev/toucan "$FORK_ROOT"   # fork objects into the clone only
```

1. Window: upstream commits whose changelogs match the fork snapshot exactly.
   The window is contiguous; commits before it lack the fork's changelog lines,
   commits after it have new ones.

   ```bash
   git rev-list --topo-order --reverse v1.5.0..origin/main | while read c; do
     git diff --name-only "$FORK_ROOT" "$c" -- '*CHANGELOG.md' | grep -q . || \
       echo "$c $(git log -1 --format='%ad %s' --date=format:'%m-%d %H:%M' $c)"
   done
   ```

2. Inside the window, the base is the commit minimizing the whole-tree diff
   (rename noise is constant, real delta adds files):

   ```bash
   for c in <window>; do echo "$c $(git diff --name-only "$FORK_ROOT" "$c" | wc -l)"; done | sort -k2 -n
   ```

3. Ties (consecutive commits touching already-renamed files) break on content
   markers: pick a string the candidate commit added, check it in the fork tree.

   ```bash
   git show <candidate> | grep -E '^\+' | head -20            # find a distinctive added string
   git grep -c "<string>" "$FORK_ROOT" -- <path>              # in the fork repo
   ```

   The base is the last candidate whose markers are present and whose successor's
   markers are absent. For the current snapshot this yields
   `1ff411300` (11-06 08:10): `keepComposerFocus` from it is present in
   `apps/p2/plugins/chat/web.tsx`, `.local/bin` from its successor `7d984c590`
   is absent from `apps/p2/plugins/envs/sandbox/p2-sandbox.sh`.

If no window is printed, the fork has edited changelogs at the root commit or
history changed; fall back to Phase 2 audits per commit and say so.

## Phase 2 — list the delta

All from `$WORK`, with `BASE` = pinned commit:

```bash
git rev-list --count "$BASE..origin/main"                  # total, incl. merges
git log "$BASE..origin/main" --no-merges --format='%ad %s' --date=short | head -100
git log "$BASE..origin/main" --no-merges --format='%s' \
  | grep -oE '^[a-z]+\([a-z0-9,-]+\)' | sed 's/^[a-z]*(//;s/)$//' | tr ',' '\n' | tr -d ' ' \
  | sort | uniq -c | sort -rn                              # counts per scope
git diff --stat "$BASE..origin/main" -- packages/<pkg>     # per-package shape
```

## Phase 3 — report

Write one report file (e.g. `/tmp/opencode/upstream-audit/REPORT.md`) with:

- Fork point line: base commit hash, its date and subject, scan method, and the
  two marker checks that pinned it.
- Total commit count (`--count`) and non-merge count, counts per scope.
- Feature themes grouped by package, from the subject log; cite commit hashes.
- A "cherry-pick candidates" section: `fix(...)` commits with GitHub issue
  numbers that touch packages the fork maintains (`coding-agent`, `ai`, `tui`,
  `durable`). Note: `p2` and `chord` have diverged (fork edits both), treat
  their deltas as informational only.

## Phase 4 — audit before presenting

The report is a claim until these checks pass; run each and record the result:

1. Rerun the Phase 1 marker checks; the pin must reproduce.
2. For 3+ sampled "missing" fixes: search the fork for the fix's distinctive
   string at `$FORK_ROOT` (absent = truly missing) AND `git log --oneline` in
   the fork for the issue number or topic in case it was reimplemented. The
   fork's own commits (post-root) can silently cover an upstream fix.
3. `git remote -v` in the fork shows only `origin`: the fork never fetched
   upstream, so history-based counting is valid.
4. Subject-log counts must add up against `--count` minus merges; scope greps
   miss subjects without a scope — spot-check the unscoped remainder.
5. Search markers case-insensitively and in both names (`pi`, `toucan`): the
   rename rewrites upstream identifiers, so a marker string may have changed.

Present the summary with the fork point, counts, and themes; state which
sections were audit-verified. Clean up `$WORK` when done.
