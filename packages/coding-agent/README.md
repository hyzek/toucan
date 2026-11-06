<p align="center">
  <a href="https://pi.dev">
    <img alt="Toucan logo" src="https://pi.dev/logo-auto.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@hyzek/toucan-coding-agent"><img alt="npm" src="https://img.shields.io/npm/v/@hyzek/toucan-coding-agent?style=flat-square&logo=npm&logoColor=white" /></a>
</p>

> New issues and PRs from new contributors are closed automatically. Maintainers review closed submissions daily. See [CONTRIBUTING.md](https://github.com/hyzek/toucan/blob/main/CONTRIBUTING.md).

# Toucan

Toucan is a minimal, extensible agent harness that you can make your own.

Adapt Toucan to your workflows, not the other way around. Customize Toucan with [extensions](docs/extensions.md), [skills](docs/skills.md), [prompt templates](docs/prompt-templates.md), and [themes](docs/themes.md). Bundle them as [Toucan packages](docs/packages.md) and share via npm or git.

Toucan ships with powerful defaults but skips features like sub-agents and plan mode. Ask Toucan to build what you want, or install a package that does it your way.

Use Toucan [interactively](docs/usage.md), automate it in [print or JSON mode](docs/cli.md), control it over [RPC](docs/rpc.md), or build apps with the [Toucan TypeScript SDK](docs/sdk.md). See [OpenClaw](https://github.com/OpenClaw/OpenClaw) for a real-world integration.

## Getting started

Install the command-line interface:

```bash
curl -fsSL https://pi.dev/install.sh | sh
```

On Windows:

```shell
powershell -c "irm https://pi.dev/install.ps1 | iex"
```

The installer pins all dependencies and updates Toucan with `toucan update`. Alternatively, install directly with npm, which does not pin transitive dependencies:

```bash
npm install -g --ignore-scripts @hyzek/toucan-coding-agent
```

Toucan requires Node.js 22.19 or newer. The macOS, Linux, and Windows installers can install it if needed. Toucan does not require dependency lifecycle scripts for a normal npm installation.

On macOS and Linux, Nix users can install the latest release with `nix profile add github:hyzek/toucan/stable`. See the [quickstart](docs/quickstart.md#1-install-toucan) for updating and pinning releases.

Start Toucan in the directory where you want it to work:

```bash
cd /path/to/project
toucan
```

For a built-in AI provider, run `/login` inside Toucan to connect a subscription or API key. Then give Toucan a task.

See the [documentation](docs/index.md) for full setup and usage instructions.

## Share your OSS coding agent sessions

If you use Toucan for open source work, please share your coding agent sessions.

Public OSS session data helps improve models, prompts, tools, and evaluations using real development workflows.

For the full explanation, see [this post on X](https://x.com/badlogicgames/status/2037811643774652911).

To publish sessions, use [`badlogic/toucan-share-hf`](https://github.com/badlogic/toucan-share-hf) using a Hugging Face account and the Hugging Face CLI.

- [Demo video](https://x.com/badlogicgames/status/2041151967695634619) on how to publish Toucan sessions
- Published Toucan development sessions: [`badlogicgames/pi-mono` on Hugging Face](https://huggingface.co/datasets/badlogicgames/pi-mono).

## Development

Clone the repository, install its dependencies, and run Toucan from source:

```bash
git clone https://github.com/hyzek/toucan
cd toucan
npm install --ignore-scripts
./toucan-test.sh
```

`toucan-test.sh` can be called from any directory and preserves the caller's working directory.

Before submitting changes, run:

```bash
npm run check
./test.sh
```

Read [CONTRIBUTING.md](https://github.com/hyzek/toucan/blob/main/CONTRIBUTING.md) before opening an issue or pull request. It defines the contribution gate, issue quality bar, and required checks. Read [AGENTS.md](https://github.com/hyzek/toucan/blob/main/AGENTS.md) for repository-specific implementation, testing, dependency, and release rules.

## License

MIT
