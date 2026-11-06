# Environment Variables

Toucan uses environment variables in three ways:

- Variables such as `TOUCAN_OFFLINE` configure the Toucan process.
- Toucan sets process markers so child processes can identify Toucan as the launching agent.
- Commands run by the LLM-callable shell tools receive `TOUCAN_*` variables describing the current session.

Provider API-key variables are documented separately in [Providers](providers.md#use-an-api-key-from-the-environment).

## Process Marker

The CLI and RPC entry points set two process markers:

- `AI_AGENT=toucan` is a generic marker that lets tooling identify Toucan as the agent that launched the process.
- `TOUCAN_CODING_AGENT=true` is Toucan-specific and lets child processes detect that they run inside Toucan.

Child processes inherit both markers. They are not session-specific and are not set automatically when Toucan is embedded through the SDK.

## Shell Tool Session Environment

Commands run by the `bash` and `powershell` tools receive the current Toucan session state:

| Variable | Description |
|----------|-------------|
| `TOUCAN_SESSION_ID` | Current session ID |
| `TOUCAN_SESSION_FILE` | Absolute path to the current session JSONL file; unset for ephemeral sessions |
| `TOUCAN_PROVIDER` | Currently selected model provider |
| `TOUCAN_MODEL` | Currently selected model ID |
| `TOUCAN_REASONING_LEVEL` | Current effective reasoning level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` |

The values are resolved when each command starts. Switching models or changing the reasoning level therefore affects the next shell command without restarting Toucan. `TOUCAN_PROVIDER` and `TOUCAN_MODEL` identify the selected Toucan model, not a different upstream model that a router may choose internally.

When asked which model or provider is running, inspect these variables instead of inferring the answer from the system prompt:

```bash
printf '%s/%s\n' "$TOUCAN_PROVIDER" "$TOUCAN_MODEL"
printf 'reasoning=%s session=%s\n' "$TOUCAN_REASONING_LEVEL" "$TOUCAN_SESSION_ID"
```

The session file can be inspected directly when the session is persistent:

```bash
if [ -n "$TOUCAN_SESSION_FILE" ]; then
  tail -n 1 "$TOUCAN_SESSION_FILE"
fi
```

These variables are injected into the LLM-callable `bash` and `powershell` tools. They are not injected into user-entered `!` or `!!` commands.

### Custom Shell Tools

Tools created with `createBashTool()` or `createPowerShellTool()` expose the session environment by default when registered with Toucan. Injection happens before `spawnHook`, so a hook receives the variables in `ctx.env`:

```typescript
const bashTool = createBashTool(cwd, {
  spawnHook: (ctx) => ({
    ...ctx,
    env: { ...ctx.env, CI: "1" },
  }),
});
```

Disable session metadata independently of the spawn hook:

```typescript
const powershellTool = createPowerShellTool(cwd, {
  exposeSessionEnvironment: false,
  spawnHook: (ctx) => ctx,
});
```

When disabled, Toucan removes inherited values for these variables so nested Toucan processes do not expose stale parent-session metadata.

## Toucan Process Configuration

These variables are read by Toucan itself:

| Variable | Description |
|----------|-------------|
| `TOUCAN_CODING_AGENT_DIR` | Override the config directory; default is `~/.toucan/agent` |
| `TOUCAN_CODING_AGENT_SESSION_DIR` | Override session storage; overridden by `--session-dir` |
| `TOUCAN_PACKAGE_DIR` | Override the package directory, useful for Nix/Guix store paths |
| `TOUCAN_OFFLINE` | Disable automatic network activity, including model catalog refreshes |
| `TOUCAN_SKIP_VERSION_CHECK` | Disable the `pi.dev` latest-version request |
| `TOUCAN_SELF_UPDATE_COMMAND` | Command `toucan update` runs to update Toucan itself, split on whitespace, with `{packageName}`, `{version}`, and `{installSpec}` placeholders. Takes precedence over the `selfUpdateCommand` setting. See [Custom update command](cli.md#custom-update-command) |
| `TOUCAN_TELEMETRY` | Override install/update telemetry and provider attribution headers: `1`/`true`/`yes` or `0`/`false`/`no` |
| `TOUCAN_CODEMODE_MAX_WORKERS` | Maximum codemode workers alive at once across all sessions in the process; default `2`. Each worker's script may use up to 256 MB. Raise it when one process runs several sessions, such as in-process subagents. Further scripts wait for a free worker. See [Codemode](codemode.md) |
| `TOUCAN_CACHE_RETENTION` | Set to `long` for extended provider prompt caching where supported |
| `TOUCAN_SHARE_VIEWER_URL` | Override the base URL used by `/share` |
| `TOUCAN_RADIUS_GATEWAY` | Override the Radius gateway origin used by `/bug` uploads |
| `TOUCAN_CLEAR_ON_SHRINK` | Set to `1` to clear empty rows when rendered content shrinks; the `terminal.clearOnShrink` setting takes precedence. See [Settings](settings.md) |
| `TOUCAN_HARDWARE_CURSOR` | Set to `1` to show the hardware cursor; see [Terminal setup](terminal-setup.md) |
| `TOUCAN_CLIPBOARD_OSC52` | Set to `1` to also send copied text to the terminal with OSC 52 after the local clipboard write, as Toucan does over SSH. Use it when a remote client reaches Toucan without SSH variables, such as a multiplexer attached from another machine or a remote IDE daemon |
| `TOUCAN_HYPERLINKS` | Override OSC 8 hyperlink detection with `1`, `0`, or `auto` |
| `TOUCAN_PROGRAM_STATUS` | Override OSC 7501 program status detection: `1` always reports, `0` never reports; otherwise Toucan reports only after the terminal confirms support. See [Terminal setup](terminal-setup.md#program-status) |
| `TOUCAN_IMAGE_PROTOCOL` | Override inline image detection with `kitty`, `iterm2`, `none`, or `auto` |
| `TOUCAN_TRUE_COLOR` | Override truecolor detection with `1`, `0`, or `auto` |
| `TOUCAN_TUI_ESC_TIMEOUT` | How long to wait after a lone ESC before treating it as Escape, in milliseconds; defaults to `100` over SSH and `10` otherwise. Increase if Alt-key input is misread as Escape |
| `VISUAL`, `EDITOR` | External editor fallback when `externalEditor` is unset |
| `HTTP_PROXY`, `HTTPS_PROXY` | Proxy outbound HTTP requests |

Provider credentials such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and provider-specific configuration are listed in [Providers](providers.md#use-an-api-key-from-the-environment).
