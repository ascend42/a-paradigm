---
id: N-para-401-commit-conventions
title: Commit Conventions
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-401
  - commit-format-typesymbol
  - symbols-trailer-for
  - post-commit-hook-automatic
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-401.json
---

## Commit Conventions

Paradigm extends conventional commit format with symbol references, creating a machine-readable history that powers automatic history capture. Every commit message follows a specific structure that both humans and the Paradigm toolchain can parse.

### Commit Message Format

The format has three parts: subject line, body, and trailers.

```
type(#primary-symbol): short description

- Detail with #component references
- Gate changes: ^gate-name
- Signals emitted: !signal-name
- Flow updates: $flow-name

Symbols: #symbol-a, #symbol-b, !signal-c, $flow-d
```

**Subject line**: `type(#primary-symbol): description` -- The type follows conventional commit types (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`). The primary symbol in parentheses indicates the main component affected. The description is a concise summary under 70 characters.

**Body**: References all affected symbols using their prefixes (`#`, `$`, `^`, `!`, `~`). Describe what changed, what gates were added or modified, what signals are emitted, and what flows were updated.

**Symbols trailer**: A machine-readable line starting with `Symbols:` followed by a comma-separated list of every symbol affected. This trailer is **parsed by the post-commit hook** to automatically create `paradigm_history_record` entries.

### Full Example

```
feat(#payment-form): add Apple Pay support

- Add #apple-pay-button component for payment method selection
- Update $checkout-flow with new Apple Pay payment step
- Emit !payment-method-added signal when user selects Apple Pay
- Gate: ^authenticated required for payment submission
- Aspect: ~pci-compliant applied to payment data handling

Symbols: #payment-form, #apple-pay-button, $checkout-flow, !payment-method-added, ^authenticated, ~pci-compliant
```

### Why the Symbols Trailer Matters

The `Symbols:` trailer is not just documentation -- it is the bridge between git and Paradigm's history system. The post-commit hook reads this line, parses the symbols, and automatically calls `paradigm_history_record` with the commit hash, affected symbols, and the commit message as the description. This means every commit with a Symbols trailer is automatically captured in the Paradigm history log without any manual recording.

Without the trailer, the commit is just a git commit. With the trailer, it becomes a tracked event in Paradigm's history system, feeding into fragility analysis, expertise tracking, and team wisdom.

### Type Mapping

The commit type maps to the history record fields:

| Commit Type | History Type | History Intent |
|---|---|---|
| `feat` | implement | feature |
| `fix` | implement | fix |
| `refactor` | refactor | refactor |
| `revert` | rollback | (automatic) |
| `test` | implement | confirmed |
| `docs` | (not recorded) | -- |
| `chore` | (not recorded) | -- |

By following these conventions, your git history becomes a structured input to Paradigm's operational tools. Every `feat` commit feeds fragility scores. Every `fix` commit increases the fix-to-feature ratio. Every `revert` becomes a rollback event. The commit message is the entry point for the entire history-wisdom-fragility pipeline.
