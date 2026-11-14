# Master Review — Audit Specification

Authoritative task definition for the comprehensive engineering audit of this repository.
The final report lives in `docs/reviews/master-review.md`.

## Scope

- Branch under review: `master-review`, based on `main` at `012890dcf` (the branch named
  `master` in the original request is `main` in this repo; `main` has exactly 46 commits,
  `e1fd0ec6f` root commit `initial fork start rename` through `012890dcf` HEAD).
- All 46 commits, individually and cumulatively. Commit 1 is the upstream fork import
  (entire squashed codebase); it is reviewed as context/architecture, commits 2–46 are
  reviewed as authored changes.
- Cumulative architecture, abstractions, dependencies, module boundaries, execution paths.

## Objective

Review the entire implementation, not just individual commits. Understand how features
interact, how the application executes, and whether the resulting architecture and
implementation are efficient, reliable, and maintainable.

## Areas to investigate

1. Review all 46 commits individually; understand purpose and implementation.
2. Evaluate cumulative architecture, abstractions, dependencies, module boundaries.
3. Trace important execution paths; identify unnecessary operations, overhead,
   duplication, complexity.
4. Investigate performance improvements across CPU, memory, I/O, concurrency,
   initialization, runtime execution.
5. Review correctness, error handling, edge cases, security, reliability.
6. Run builds, tests, integration tests, benchmarks where feasible.
7. Identify missing tests and potential regressions.
8. Evaluate whether existing design decisions remain appropriate as the project evolved.

Constraint: no noticeable performance problems exist today. Focus on meaningful
optimizations, not invented bottlenecks or theoretical gains.

## Documentation requirements (docs/reviews/master-review.md)

- Executive summary and overall assessment.
- Commit-by-commit review of all 46 commits.
- Architecture and implementation analysis.
- Important execution flows.
- Performance optimization opportunities.
- Correctness, reliability, and security findings.
- Positive implementations worth preserving.
- Prioritized findings (Critical, High, Medium, Low, Informational).
- Concrete recommendations and an implementation roadmap.

Reference actual files, functions, and code locations. Explain reasoning, expected
impact, risks, and confidence behind recommendations. Distinguish verified problems
from hypotheses.

## Working rules

- Audit, not refactoring. No code changes, no behavior changes.
- Never claim tests or benchmarks passed without running them; show evidence.
- Isolate all work on `master-review`; do not modify `main`.
- Only commit files authored by this audit (`docs/reviews/*`).
- Keep progress committed incrementally so the audit survives across iterations.

## Method

1. Enumerate commits with metadata and diffs (`git show --stat`, targeted full diffs).
2. Map the monorepo: packages, apps, dependency graph, entry points.
3. Trace key flows: CLI startup, TUI render loop, agent turn (prompt -> LLM -> tool
   -> result), session persistence, RPC/browser mode.
4. Run verification: `npm run build`, `./test.sh` (non-e2e suites), targeted vitest
   files, profile scripts where feasible. Record real output.
5. Deep-read the hot areas: coding-agent (largest churn), tui, ai.
6. Synthesize findings with severity, evidence, confidence.

## Definition of done

- Every one of the 46 commits has a written review entry.
- Build/test/benchmark evidence recorded from actual runs (or explicit note of failure
  to run and why).
- All documentation sections of the report complete.
- Report committed on `master-review`.
