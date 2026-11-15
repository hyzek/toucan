<h1 align="center">Toucan</h1>

<p align="center">
  <img alt="A toco toucan (Ramphastos toco)" src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Toco_toucan_%28Ramphastos_toco%29_close-up.jpg/1280px-Toco_toucan_%28Ramphastos_toco%29_close-up.jpg" width="100%">
</p>

Toucan is a minimal, extensible agent harness and the set of packages it is built from. The centerpiece is [Toucan Coding Agent](packages/coding-agent/README.md): a terminal coding agent you make your own with extensions, skills, prompt templates, and themes, shared as packages over npm or git. It ships with powerful defaults — subagents, plan mode, web access, a question tool — and you adapt Toucan to your workflows, not the other way around.

This repository is the monorepo for the whole stack, from the model API up to the terminal UI:

| Package | Description |
| --- | --- |
| [`coding-agent`](packages/coding-agent/README.md) | The interactive CLI, print/JSON mode, RPC server, and TypeScript SDK |
| [`agent`](packages/agent/README.md) | Stateful agent with tool execution and event streaming |
| [`ai`](packages/ai/README.md) | Unified LLM API with provider auth, token and cost tracking, model catalog |
| [`tui`](packages/tui/README.md) | Terminal UI framework with differential, flicker-free rendering |
| [`codemode`](packages/codemode/README.md) | Runs model-written JavaScript in a QuickJS WASM VM that can only call injected tools |
| [`durable`](packages/durable/README.md) | Experimental durable agent harness; turns and tool calls commit to storage before anything is shown |
| [`chord`](packages/chord/README.md) | Distributed objects that live across processes and survive plugin reloads |
| [`env`](packages/env/README.md) | Remote execution environments: agent tools run over SSH, state stays local |
| [`mcp`](packages/mcp/README.md) | Standalone Model Context Protocol client with stdio and HTTP transports |
| [`schema`](packages/schema/README.md) | JSON Schema builders and validation without `eval` |
| [`telemetry`](packages/telemetry/README.md) | Vendor-neutral telemetry contracts |
| [`evals`](packages/evals/README.md) | Behavioral evals for the coding agent |

## What Toucan adds over [Pi](https://github.com/earendil-works/pi)

Toucan is a fork of Pi and keeps Pi's core: the extension model (extensions, skills, prompt templates, themes, packages), the session model, and the CLI, RPC, and SDK surfaces. Everything below was added in this repository after the fork.

| Addition | Description |
| --- | --- |
| [Subagents and the agent command center](packages/coding-agent/docs/subagents.md) | The `subagent` tool runs a task in an isolated child session and reports back. Three types ship built in (`general-purpose`, `explore`, `plan`) and more are markdown files in `.toucan/agents/`. Runs are background by default, with live status, steering, and resume; `/agents` opens a command center listing this session's agents and their transcripts. Opt in with `subagents.enabled`. |
| Plan mode | `shift+tab` or `/plan` switches to read-only research: `edit`, `write`, and `subagent` are deactivated, `bash` is limited to an allowlist, the system prompt gains a plan-mode section, and the footer shows the mode. It persists in the session. |
| `question` tool | The model asks one or more questions as a single form drawn in the input band: numbered options, a free-text row each, multi-select where allowed, and a Yes/No submit that recaps every answer before sending the set in one go. |
| `handoff` tool | At a decision point the model presents a menu of next steps and waits for one pick. The option marked as starting implementation turns plan mode off, so planning ends with your approval rather than an assumption. |
| [Toucan Web](packages/coding-agent/docs/toucan-web.md) | Built-in `web_search`, `fetch_content`, `source_check`, and `get_search_content`, plus `/search` and `/google-account`. The default search path needs no API key. |
| `/uhm <idea>` | Reformulates a rambling idea dump into one clear task prompt with the session's model, prefills it in the editor for an edit, and hands it to a fresh session on Enter. |
| Transcript rendering | Tool calls are marker-led rows that fold consecutive calls into one sentence (`Read 1 file, ran 3 shell commands`). Diffs are syntax-coloured with word-level changes, named hunks, folding, and a side-by-side layout in wide terminals; writes and shell commands that rewrite one file render as diffs too. A thinking run streams inline, then collapses to `Thought for 3s`. |
| Working status | A fading-dot indicator with a swept label, full token counts, and an elapsed timer. Compaction and branch summaries use the same indicator and collapse to one expandable row instead of full-width panels. |
| Input band, menus, footer | Redesigned start screen and composer. The `/` menu and the selectors open above the input on a solid selection bar, and the footer bar reads `model · effort · name · directory` with model display names. |
| `/stats` | Token usage as bold counts for this project and for every session on the machine, above a 7-day strip. |
| `/skills` and `/context` | Every loaded skill and `AGENTS.md` context file as a tree grouped by where it loads from; `/context` leads with the estimated context use. |
| Two-press interrupt | The first `Esc` swaps the hint row to `esc again to interrupt` for two seconds, so one stray keypress cannot kill a running turn. |
| [Channel builds](packages/coding-agent/docs/cli.md#channel-builds) | `scripts/install.sh` clones a channel (`stable`, `nightly`, `dev`) into `~/.toucan`, builds it from source behind a memory preflight, and links a launcher into your `PATH`. `toucan update` refreshes the current channel, `toucan channel` switches between them. |
| Continuous releases | Every commit to `main` becomes a build. The build number is the commit count, so `toucan --version`, the `bN` tag, and the npm version `N.0.0` all agree, and a fix is installable minutes after it lands. |

## Getting started

Toucan requires Node.js 22.19 or newer. Install the CLI:

```bash
npm install -g --ignore-scripts @hyzek/toucan-coding-agent
```

On macOS and Linux, Nix users can install the latest release with `nix profile add github:hyzek/toucan/stable`.

Instead of npm, you can install a channel build with the installer (macOS and Linux). It builds Toucan from GitHub into `~/.toucan`, installs the launcher at `~/.toucan/bin/toucan`, and adds it to your `PATH`:

```bash
curl -fsSL https://raw.githubusercontent.com/hyzek/toucan/main/scripts/install.sh | sh
```

The script takes one optional argument, the channel to install: `stable` (default, the newest release tag), `nightly`, or `dev`. It reads two environment variables: `TOUCAN_HOME` (state root, default `~/.toucan`) and `TOUCAN_REPO_URL` (repository to clone, default the GitHub repository). It requires `git`, `npm`, and Node.js 22.19 or newer; re-run the same command to repair or update an installation. Afterward, channels update themselves with `toucan update` and you switch between them with `toucan channel` — see [Channel builds](packages/coding-agent/docs/cli.md#channel-builds).

Start it in the directory you want it to work in, run `/login` to connect a provider, and give it a task:

```bash
cd /path/to/project
toucan
```

See the [coding-agent readme](packages/coding-agent/README.md) and its [documentation](packages/coding-agent/docs/index.md) for full setup and usage.

## Development

```bash
git clone https://github.com/hyzek/toucan
cd toucan
npm install --ignore-scripts
./toucan-test.sh
```

Before submitting changes, run `npm run check` and `./test.sh`. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution gate and quality bar, and [AGENTS.md](AGENTS.md) for repository implementation rules.

## License

MIT

Image: [Toco toucan (Ramphastos toco) close-up](https://commons.wikimedia.org/wiki/File:Toco_toucan_(Ramphastos_toco)_close-up.jpg) by AntanO, CC BY-SA 4.0.
