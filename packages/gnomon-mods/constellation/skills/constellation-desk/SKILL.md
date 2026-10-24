---
name: constellation-desk
description: When to offer the Constellation idea map during a conversation - map ideas on the board and write the session summary. Works inside Gnomon as Desk offers and anywhere else as plain suggestions.
---

# Constellation on the Desk

Constellation is the user's local idea map: Spaces hold sessions, and each session holds a map of stars and beams. This playbook says when to offer it. It never acts on its own: every step is an offer the human accepts or declines.

## The offers

| Phase | Offer | Tool | Offer it when |
|---|---|---|---|
| diverge | `map-the-idea` | `apply` | Several ideas or options are on the table and seeing them side by side would help. Read the map with `get` first. |
| synthesize | `summarize-the-session` | `summarize` | The work reached a natural stopping point with real progress. Read `summary` (the outline) before writing one. |

## When NOT to offer

- A single linear task, a quick fix, or a yes/no question.
- Mid-task, or when a summary was already written in this stretch of work.
- After the human said "not now" to Constellation in this conversation: stay quiet for the rest of it.

## Inside Gnomon

When an offer fits, end that reply with at most one offer block (never more than one per reply across all mods). Name this mod and one of the kinds above, and ask one short question:

```offer
{"mod": "gnomon.constellation", "kind": "map-the-idea", "question": "Want me to map these options on the Constellation board?"}
```

The kernel shows it on the Desk. Call the tool only after the human opens it.

## Outside Gnomon

There is no Desk. Make the same offer as one plain sentence at the end of the reply ("I can lay these options out on your Constellation map, want me to?") and call the tool only if the user says yes. If the Constellation MCP server is not connected, mention it once and move on.
