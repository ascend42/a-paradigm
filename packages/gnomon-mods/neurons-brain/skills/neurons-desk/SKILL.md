---
name: neurons-desk
description: When to offer the Neurons knowledge brain during a conversation - search before researching, capture decisions and first-hand learnings. Works inside Gnomon as Desk offers and anywhere else as plain suggestions.
---

# Neurons on the Desk

Neurons is the user's personal knowledge brain, shared across every session and repo. This playbook says when to offer it. It never acts on its own: every step is an offer the human accepts or declines.

## The offers

| Phase | Offer | Tool | Offer it when |
|---|---|---|---|
| diverge | `search-the-brain` | `neuron_search` | A new topic comes up that the user may have studied before, and you are about to research it from scratch. |
| synthesize | `capture-a-learning` | `source_note` | Something was verified first-hand in this session (a measurement, an experiment, behaviour seen by running it). |
| commit | `capture-a-decision` | `neuron_write` | A real decision was just made, with a reason and evidence behind it. |

Cite what the brain returns as `n:<slug>` (sources as `s:<id>`). Every neuron cites a source, so a decision is captured as a source note first and then as neurons that cite it.

## When NOT to offer

- Small talk, a quick fix, or a question about this repo's own code.
- A topic already searched in this conversation.
- A tentative idea, a routine edit, or a choice the repo already records (a decision file, lore, a commit message).
- Anything holding a secret, a key or personal data.
- After the human said "not now" to Neurons in this conversation: stay quiet for the rest of it.

## Inside Gnomon

End the reply with one offer block naming this mod and one of the kinds above, and ask one short question:

```offer
{"mod": "neurons", "kind": "search-the-brain", "question": "Want me to check the brain for what you already know about this first?"}
```

The kernel shows it on the Desk; only after the human opens it do you call the tool.

## Outside Gnomon

There is no Desk. Make the same offer as one plain sentence at the end of the reply ("I can check your Neurons brain for this first, want me to?") and call the tool only if the user says yes. If the Neurons MCP server is not connected, mention it once and move on.
