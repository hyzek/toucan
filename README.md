<h1 align="center">Toucan</h1>

<p align="center">
  <img alt="A toco toucan (Ramphastos toco)" src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Toco_toucan_%28Ramphastos_toco%29_close-up.jpg/1280px-Toco_toucan_%28Ramphastos_toco%29_close-up.jpg" width="100%">
</p>

Toucan is a minimal, extensible agent harness and the set of packages it is built from. The centerpiece is [Toucan Coding Agent](packages/coding-agent/README.md): a terminal coding agent you make your own with extensions, skills, prompt templates, and themes, shared as packages over npm or git. It ships with powerful defaults but skips features like sub-agents and plan mode; you adapt Toucan to your workflows, not the other way around.

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

## Getting started

Toucan requires Node.js 22.19 or newer. Install the CLI:

```bash
npm install -g --ignore-scripts @hyzek/toucan-coding-agent
```

On macOS and Linux, Nix users can install the latest release with `nix profile add github:hyzek/toucan/stable`.

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
