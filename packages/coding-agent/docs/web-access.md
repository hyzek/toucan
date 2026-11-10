# Web access

Toucan ships [pi-web-access](https://github.com/nicobailon/pi-web-access) as the built-in `web-access` extension. It adds web search, page fetching, source checks, GitHub and PDF handling, YouTube and local video analysis, and stored-result retrieval. No API key is required for the default Exa MCP search; provider keys enable the other search and fetch providers.

## Tools

| Tool | Purpose |
|---|---|
| `web_search` | Search the web through a configured provider |
| `fetch_content` | Read pages, PDFs, GitHub repositories, images, and videos |
| `get_search_content` | Page through content stored by earlier search or fetch calls |
| `source_check` | Gather cited passages for a claim |
| `web_enable` | Activate the web tools on the next model request when dynamic activation is configured |

The package's `web-search.json` schema applies. Place it at `<agent-dir>/web-search.json`, for example `~/.toucan/agent/web-search.json`. Provider keys, routing, proxies, fetch modes, and video settings are documented in the [pi-web-access README](https://github.com/nicobailon/pi-web-access#readme).

## Commands

| Command | Description |
|---|---|
| `/websearch [queries]` | Open the search curator, optionally prefilled with comma-separated queries |
| `/curator [on\|off\|summary-review\|auto-summary]` | Toggle or configure the curator workflow |
| `/search` | Browse stored search and fetch results |
| `/google-account` | Show the active Google account for Gemini Web |

Browser launch for the curator uses the platform opener. Without it, the curator prints its URL so you can open it manually.

## Disable it

Disable `web-access` under Built-in in `toucan config`, or add `-builtin:web-access` to the `extensions` setting. `--no-extensions` disables it for one run.
