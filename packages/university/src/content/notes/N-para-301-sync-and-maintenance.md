---
id: N-para-301-sync-and-maintenance
title: Sync & Maintenance
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-301
  - paradigm-sync-for
  - paradigm-scan-for
  - ai-maintenance-protocol
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-301.json
---

## Sync & Maintenance

Paradigm metadata needs to stay synchronized with the actual code. As developers add features, rename files, and refactor modules, the `.purpose` files, `portal.yaml`, and `navigator.yaml` can drift out of date. Paradigm provides two key maintenance commands to keep everything aligned.

**`paradigm sync`** synchronizes metadata with the codebase. It detects when source files have moved, when new files appear that should be registered, and when existing registrations point to files that no longer exist. Think of it as a reconciliation between what Paradigm knows about and what actually exists on disk.

**`paradigm scan`** performs a full rebuild of the index and regenerates `navigator.yaml`. This is a heavier operation that re-reads every `.purpose` file, rebuilds the symbol graph, and produces a fresh structure map. Run scan when the index feels stale, when navigator.yaml is missing, or after bulk operations like branch merges that may have changed many files at once.

```bash
# Light sync -- detect drift and reconcile
$ paradigm sync

# Full rebuild -- regenerate everything from .purpose files
$ paradigm scan
```

Beyond these commands, the **AI Maintenance Protocol** defines when and how to update Paradigm files during development:

| Change Type | Required Paradigm Update |
|---|---|
| Add a feature | Create or update the nearest `.purpose` file with `#component` |
| Add a protected route | Update `portal.yaml` with the new route and its `^gates` |
| Add an event or signal | Add `!signal` to the emitting component's `.purpose` file |
| Add a multi-step process | Document as `$flow` with ordered steps |
| Rename or delete a symbol | Update all `.purpose` files that reference it |
| Discover a pattern or antipattern | Capture with `paradigm_wisdom_record` |
| Add a cross-cutting rule | Create `~aspect` with required code anchors |

The maintenance protocol is not optional -- it is how the metadata stays valuable. Stale metadata is worse than no metadata because it actively misleads. When `.purpose` files accurately reflect the code, AI agents can navigate efficiently, ripple analysis produces correct results, and the doctor finds real issues instead of false positives.

A practical rhythm for maintenance:
1. **Before work**: `paradigm_wisdom_context` and `paradigm_ripple` on symbols you will touch
2. **During work**: Update `.purpose` files as you go, not after
3. **After work**: Run `paradigm doctor` to catch any drift, record wisdom if applicable
4. **Periodically**: Run `paradigm scan` to rebuild the full index
