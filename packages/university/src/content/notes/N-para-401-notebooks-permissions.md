---
id: N-para-401-notebooks-permissions
title: Agent Notebooks & Permission Scoping
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-401
symbols: []
difficulty: beginner
estimatedMinutes: 2
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-401.json
---

## Agent Notebooks

Agent notebooks are curated snippet libraries distilled from lore entries. They provide reusable knowledge that agents can apply across sessions and projects.

### NotebookEntry Format

Each entry contains:
- **context**: When to apply this snippet (retrieval key)
- **snippet**: The reusable code/knowledge
- **provenance**: Where it came from (lore, manual, transfer)
- **concepts[]**: Concept tags for retrieval (e.g., ["auth", "middleware"])
- **appliedCount**: How many times used in orchestration
- **confidence**: 0.0-1.0 reliability score

### Storage

- Global: `~/.paradigm/notebooks/{agent-id}/` — travels across projects
- Project: `.paradigm/notebooks/{agent-id}/` — project-specific

### MCP Tools

- `paradigm_notebook_search` — find entries by concept, tag, or keyword
- `paradigm_notebook_add` — create a new curated entry
- `paradigm_notebook_promote` — extract from lore entry with provenance linking

### Orchestration Integration

`buildProfileEnrichment()` appends a "Relevant Notebook Entries" section with context + snippet for matching entries. This enriches the orchestration prompt with reusable patterns.

## Agent Permissions

Permission scoping controls what agents can access:

### Permission Fields

- **paths.read/write**: Glob patterns for file access
- **paths.deny**: Always-deny patterns (overrides read/write)
- **tools.allow/deny**: Tool name patterns
- **dangerous_actions**: Actions requiring explicit approval

### Integrity Hashing

SHA-256 hash of `{id, role, permissions}` stored as `integrityHash`. `verifyIntegrity()` detects tampering — agents must never modify their own config.

### In Orchestration

Permissions appear as constraints in orchestration prompts, informing agents of their boundaries.
