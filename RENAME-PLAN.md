# Rename plan: toucan → toucan

Fork-wide rename. Decisions (confirmed):

- Scope + names: `@hyzek/toucan-*` → `@hyzek/toucan-*`
- Runtime names renamed too, **no back-compat**: `TOUCAN_*` → `TOUCAN_*`, `~/.toucan` → `~/.toucan`, CLI `toucan` → `toucan`
- Executed in 4 steps, `npm run check` + targeted tests after each

## Step 1 — Package renames (biggest, everything builds on it)

Rename 12 workspace packages (name + all import specifiers):

| dir | old | new |
|---|---|---|
| packages/agent | @hyzek/toucan-agent-core | @hyzek/toucan-agent-core |
| packages/ai | @hyzek/toucan-ai | @hyzek/toucan-ai |
| packages/chord | @hyzek/chord | @hyzek/chord |
| packages/codemode | @hyzek/toucan-codemode | @hyzek/toucan-codemode |
| packages/coding-agent | @hyzek/toucan-coding-agent | @hyzek/toucan-coding-agent |
| packages/durable | @hyzek/toucan-durable | @hyzek/toucan-durable |
| packages/env | @hyzek/toucan-env | @hyzek/toucan-env |
| packages/evals | @hyzek/toucan-evals | @hyzek/toucan-evals |
| packages/mcp | @hyzek/toucan-mcp | @hyzek/toucan-mcp |
| packages/schema | @hyzek/toucan-schema | @hyzek/toucan-schema |
| packages/telemetry | @hyzek/toucan-telemetry | @hyzek/toucan-telemetry |
| packages/tui | @hyzek/toucan-tui | @hyzek/toucan-tui |

Note: `chord` has no `toucan-` prefix but shares the old scope; renamed with it.

Mechanics:

- Root `package.json` name: `toucan-monorepo` → `toucan-monorepo`; `eval` workspace script
- 1,034 source files with `@hyzek/toucan-*` import specifiers (sed across `packages/*/src|test`, `apps/*`, examples)
- Dependency pins in all `package.json`s (workspace deps, `"1.5.0"` exact pins)
- `packages/coding-agent/install-lock/` (`@hyzek/toucan-coding-agent-install`) + `scripts/generate-coding-agent-install-lock.mjs`; regen with `node scripts/generate-coding-agent-install-lock.mjs`
- `scripts/check-pinned-deps.mjs`, `check-runtime-deps.mjs`, `check-entry-graphs.mjs`, bundle/build scripts, `.github/workflows/*` (publish, preview-packages, build-binaries) — check for hardcoded names
- Example extensions: names `toucan-extension-*` → `toucan-extension-*`
- `package-lock.json` rewrite via `npm install --package-lock-only --ignore-scripts` (commit later needs `TOUCAN_ALLOW_LOCKFILE_CHANGE=1`... after step 3 the flag itself becomes `TOUCAN_ALLOW_LOCKFILE_CHANGE`)
- NOT renamed: external dep `@earendil-works/gondolin` (third-party, not ours)

## Step 2 — CLI binary + app identity

- `packages/coding-agent/package.json`: `"bin": { "toucan": ... }` → `"toucan"`, `"toucanConfig"` key → `"toucanConfig"` (read in `src/config.ts:584-606`)
- `src/config.ts`: `APP_NAME` default `"toucan"` → `"toucan"`, `APP_TITLE` `"π"` → `"Toucan"` (or a toucan glyph — open question)
- Docs/help text/branding: `ToucanLogo`, `TOUCAN_LOGO_*` (step 3 for the vars), startup UI, smoke scripts (`coding-agent-smoke.mjs`), `scripts/build-binaries.sh` output names, `nix/package.nix` + `flake.nix` (`toucan = ...`, `bin/toucan`)
- `check:browser-smoke`, install docs referencing `npm i -g @hyzek/toucan-coding-agent`

## Step 3 — Env vars, config dirs, runtime strings

- 85 `TOUCAN_*` env vars → `TOUCAN_*` (incl. `TOUCAN_ALLOW_LOCKFILE_CHANGE`, `TOUCAN_CODING_AGENT_DIR`, `TOUCAN_ENV_SSH_*`, `TOUCAN_EVAL_*`, test-only vars). Sources: `packages/*/src|test`, `apps`, `scripts/*.mjs|sh`, `.github/workflows`, `nix`
- `~/.toucan` → `~/.toucan`: `CONFIG_DIR_NAME` default `.toucan` → `.toucan`, project dir `.toucan/` → `.toucan/`, `.toucan-update-incomplete` suffix, skills/extensions paths, `~/.toucan/agent/auth.json` help text
- Repo-local `.toucan/skills/` dir (referenced by AGENTS.md) → `.toucan/skills/`
- `packages/coding-agent/src/core/toucan-manifest.ts` → `toucan-manifest.ts`; extension package.json manifest key `"toucan": {...}` → `"toucan": {...}` (breaking for third-party extensions — accepted, no back-compat)
- File renames: `toucan-test.sh/.ps1/.bat` → `toucan-test.*`, `scripts/auto-toucan.sh` → `auto-toucan.sh`
- Codemode `packages/codemode/package.json` keyword `"toucan"`

### Open question — pi.dev endpoints

`https://pi.dev` (install.sh, `/api/latest-version`, oauth, schemas, `radius.pi.dev` gateway) is an upstream service this fork does not host. Options: leave URLs as-is (self-update/share would talk to upstream toucan), or disable those features. Recommend: leave URLs untouched for now, decide separately.

## Step 4 — Docs, prose, cleanup

- AGENTS.md, CONTRIBUTING.md, SECURITY.md, READMEs across packages, comment prose "toucan" → "toucan" (word-boundary sed, manual review — "toucan" appears in math/pid-like words; review diff)
- Type identifiers: `ToucanCodingAgent*`, `ToucanMessages*`, `ToucanManifest`, `ToucanAnthropic` etc. (~55 usages) → `Toucan*` / drop prefix
- CHANGELOG.md historical entries + `github.com/hyzek/toucan` issue links: **left untouched** (immutable history); new entries use toucan links
- `apps/p2` prose/branding

## Verification per step

1. `npm run check` (biome + pinned/runtime-dep checks + tsc)
2. `npm run build` where dist consumers matter
3. Targeted tests: `./test.sh` at the end; p2 separately (`cd apps/p2 && npm run check`)
4. Manual: run `node packages/coding-agent/dist/bundle/cli.js --version` / startup

## Out of scope (unless asked)

- Back-compat shims for old names/env vars/dirs
- Publishing to npm under @hyzek
- Renaming git remote / repo
