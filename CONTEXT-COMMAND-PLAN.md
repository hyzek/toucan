# `/context` plan

## Feature 1: context info (shipped)

`/context` starts with one usage line above the context-file tree:

```text
Context usage: 62% · 124,320 / 200,000 tokens (estimated)

Context files (3)
...
```

- Data comes from `AgentSession.getContextUsage()` (`tokens`, `percent`,
  `contextWindow`). It already follows `routedModel` when a virtual model is active.
- Right after compaction, `tokens` and `percent` are null until the next model
  response. The line then shows the context-window size instead of inventing a count.
- Without a model context window the line says usage is unavailable.
- Files: `modes/interactive/resource-tree.ts`, `handleContextCommand` in
  `modes/interactive/interactive-mode.ts`.

## Feature 2: context analysis (not implemented)

Goal: show where the active context is spent, not only its total. Proposed rows,
each with tokens and percent of the model window:

```text
Context analysis
  System prompt      12,400    6%
  Context files       8,200    4%
    AGENTS.md         6,100
    ~/AGENTS.md       2,100
  Tool definitions   14,600    7%
  Messages           79,100   40%
    user             12,000
    assistant        20,300
    thinking          4,800
    tool calls        5,000
    tool results     37,000
  Free space         85,700   43%
  Compaction reserve 16,384    8%
```

Measurement notes:

- Reconcile the breakdown with `getContextUsage().tokens`. When the last provider
  usage is current, use it as the anchor and distribute only trailing messages with
  `estimateTokens`.
- `estimateTokens` is the only per-message estimator today: chars/4, with
  `SystemMessage.sections` and `toolsAdded` counted for system messages.
- Split the system prompt sections and tool schemas from the same payload the
  provider receives, not from the rendered prompt alone.
- Images count through `ESTIMATED_IMAGE_CHARS` (4,800 chars each), so label the
  breakdown estimated.
- Right after compaction, before the next response, only the estimator is
  available; show the same unknown state as feature 1.
- Compaction reserve is `settingsManager.getCompactionSettings(model).reserveTokens`.
  Free space is window minus used minus reserve.
- Compute on demand when the command runs; no new session writes.

Open questions:

- Split context files individually, or keep one row and reuse the existing file tree?
- Count provider formatting (message wrappers, cache markers) inside the source rows,
  or ignore it?
- Combine free space and compaction reserve when compaction is disabled?
