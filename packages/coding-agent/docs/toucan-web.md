# Toucan Web

Toucan Web adds web search, page fetching, source checks, GitHub and PDF handling, YouTube and local video analysis, and stored-result retrieval. No API key is required for the default Exa MCP search; provider keys enable the other search and fetch providers.

It is implemented on the open-source [pi-web-access](https://github.com/nicobailon/pi-web-access) package; its `web-search.json` schema applies. Place that file at `<agent-dir>/web-search.json`, for example `~/.toucan/agent/web-search.json`. Provider keys, routing, proxies, fetch modes, and video settings are documented in the [upstream README](https://github.com/nicobailon/pi-web-access#readme).

## Tools

| Tool | Purpose |
|---|---|
| `web_search` | Search the web through a configured provider |
| `fetch_content` | Read pages, PDFs, GitHub repositories, images, and videos |
| `get_search_content` | Page through content stored by earlier search or fetch calls |
| `source_check` | Gather cited passages for a claim |
| `web_enable` | Activate the web tools on the next model request when dynamic activation is configured |

Tool rows use Toucan's marker and guide language. A request in flight says `Searching…` or `Fetching…`; it does not draw a progress bar. The call row carries the elapsed time, and the result row reports the search count, fetched URLs, content size, or citations like the built-in tools.

## Commands

| Command | Description |
|---|---|
| `/search` | Browse stored search and fetch results |
| `/google-account` | Show the active Google account for Gemini Web |

The curator browser UI is disabled. `/websearch`, `/curator`, and their shortcut are not registered, and `web_search` always runs with `workflow: "none"`, so searches return results without opening a browser window.

## Disable it

Disable Toucan Web under Built-in in `toucan config`, or add `-builtin:toucan-web` to the `extensions` setting. `--no-extensions` disables it for one run.
