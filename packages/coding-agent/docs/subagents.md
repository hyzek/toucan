# Subagents

Toucan ships a built-in `subagent` tool. It runs a task in an isolated child agent session: the subagent works on its own with its own system prompt and tools, finishes the task, and reports its final answer back to the calling agent.

Subagents are **off by default**. Set `"subagents": { "enabled": true }` in your settings (user or project) to register the tool and with it the agent command center (`Left` at an empty prompt, `/agents`) and its footer hint. Disabled, Toucan does not register the `subagent` tool at all, so no allow-list can bring it back.

Subagents are useful for work that is self-contained and would otherwise fill the main conversation with intermediate steps: broad codebase searches, audits, research questions, plan drafts.

## How the tool works

```
subagent({ action: "spawn", agent: "explore", task: "Find every file that handles authentication and summarize how sessions are validated." })
```

- By default the spawn is **background**: the call returns the agent's id right away, and its result arrives as a follow-up message when it finishes, before the next step of your work. It shows in the transcript as tool-style rows (one row per finished agent with its answer under a `└─` guide, folded like a read row), not as a prompt. Pass `background: false` to block the call and get the answer inline.
- The subagent does not see the conversation that spawned it. Write the `task` so it carries everything the subagent needs.
- The subagent runs with its own tools, model, and system prompt, decided by its agent type (below). It cannot call `subagent` itself.
- Child tool calls pass through the parent's tool-call extension hooks and explicit allow/deny lists. Read, shell, edit and write tools must also be active in the parent session; grep, find and ls require the parent's read tool.
- Each run gets its own session file next to the calling session and nests under it in `/resume`.
- Press Esc while a `background: false` call runs to stop the subagent; the partial output is reported as incomplete. Background runs keep going; stop one with the `stop` action.

## Other actions

| Action | What it does |
| --- | --- |
| `send` | Injects a message into a running agent; it redirects the agent after its current tool call. |
| `stop` | Aborts a running or queued agent. Its partial output is reported as incomplete. |
| `status` | Lists all agents of the session, or with `agent_id` returns one agent's full result. `wait: true` blocks until the agent finishes. |

Every spawn returns an id like `agent-1kz9ab`; pass it as `agent_id`.

## Resuming a finished agent

A finished subagent keeps its session file. Spawn with `resume` set to its id to continue that conversation instead of starting fresh:

```
subagent({ action: "spawn", resume: "agent-1kz9ab", task: "Now also check the RPC path." })
```

The continuation re-reads the agent type's current definition (its `model:`, `tools:` etc. as they are now), gets a fresh `max_turns` budget, and runs background or foreground like any other spawn. A resumed agent that never had a session file (an in-memory parent) cannot be resumed.

## Built-in agent types

| Type | Tools | Prompt |
| --- | --- | --- |
| `general-purpose` | all built-in tools | the default Toucan prompt, plus a short subagent note |
| `explore` | read, grep, find, ls | standalone read-only exploration prompt |
| `plan` | read, grep, find, ls | standalone read-only architect prompt |

## Custom agent types

A custom agent type is a markdown file. The filename is the type name.

```md
---
description: Security code reviewer
tools: read, grep, find, bash
model: anthropic/claude-haiku-4-5
thinking: low
---

You are a security auditor. Review code for vulnerabilities and report
findings with file paths, line numbers, severity, and remediation advice.
```

Files are discovered from two places; a project file overrides a user file with the same name, and either one overrides a built-in:

| Location | Scope |
| --- | --- |
| `.toucan/agents/<name>.md` | project (loaded only when the project is trusted) |
| `<agent dir>/agents/<name>.md` | user, everywhere (default agent dir `~/.toucan/agent`) |

### Frontmatter fields

All fields are optional.

| Field | Default | Meaning |
| --- | --- | --- |
| `name` | filename | the type name used by the tool |
| `description` | first body line | shown to the model when it picks a type |
| `tools` | all built-in tools | comma-separated tool names: `read, bash, edit, write, grep, find, ls, powershell`. An empty list grants no tools |
| `model` | the parent's model | `provider/modelId`, or a fuzzy name such as `"haiku"` matched against configured models |
| `thinking` | the parent's level | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `max_turns` | unlimited | agentic turns before the agent is told to wrap up; the run aborts after a 5-turn grace period. A `max_turns` on the spawn call applies when the file sets none; the file wins when it does |
| `prompt_mode` | `replace` | `replace`: the body is the whole system prompt and project instruction files are not loaded. `append`: the body is added to the default prompt, with instruction files loaded as usual |
| `enabled` | `true` | set `false` to keep a type defined but unavailable, for example to disable a built-in |

The body of the file is the agent's system prompt, used as described by `prompt_mode`.

## Enabling and disabling

`subagent` is one of the default tools. Like any tool it can be removed with the `defaultTools` setting or `--tools`, or disabled per project (`"defaultTools": ["-subagent"]`).

## Related settings and limits

- `subagents.maxConcurrent` (default 10): how many background subagents run at once; further background spawns queue behind them.
- Custom agents inherit the project's trust decision: an untrusted project's `.toucan/agents/` is not read.
- Subagents are disabled inside subagent sessions; letting an agent spawn its own agents is planned separately.

## Agent command center

Press Left with an empty prompt, or run `/agents`, to open the agent command center. It takes over the whole screen: the chat and input band are hidden until you leave:

- Tabs `All` / `Working` / `Ready` filter the list; counts update as agents run. `Tab` cycles tabs (`Shift+Tab` backwards).
- The left tree lists this session's subagents with a status dot: a blinking dot while the agent works, green when done, red on error, grey when stopped.
- The right pane shows the selected agent's status, model, prompt, and its answer (or partial answer) once settled.
- Enter opens the agent's transcript: its prompts, answers, and tool calls, scrollable with `↑`/`↓`.
- `esc` returns to the chat. Agents keep running in the background while the screen is closed.
