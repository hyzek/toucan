# Chat UI design sketches

These are demos, not tests. Each script renders the shipped TUI components in a terminal
as a reference for the final look. `03` also keeps a few alternative surfaces for
comparison.

From the repo root, build once. Then run the sketches from `packages/coding-agent`:

```bash
# repo root
npm run build

# packages/coding-agent
cd packages/coding-agent
node test/ui-demos/01-activity-and-hints.ts
node test/ui-demos/02-session-summaries.ts
node test/ui-demos/03-message-surface.ts
```

Common keys: `t` switches dark/light, `q` quits.

| Script | What it shows |
|---|---|
| `01-activity-and-hints.ts` | Shipped shared activity indicator for working/thinking, auto-compaction, manual compaction, and branch summarization; interrupt hint order and styling. Keys `1`-`6`, `a`, `i`. |
| `02-session-summaries.ts` | Shipped inline compaction and branch result rows. `e` expands. |
| `03-message-surface.ts` | Shipped padded user-message band with indent and arrow, plus composer band variants. |
