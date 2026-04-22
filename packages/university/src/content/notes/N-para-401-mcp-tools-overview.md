---
id: N-para-401-mcp-tools-overview
title: MCP Tools Overview
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-401
  - four-tool-categories
  - token-economics-of
  - paradigmsearch-paradigmnavigate-paradigmripple
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-401.json
---

## MCP Tools Overview

Model Context Protocol (MCP) tools are the primary interface between AI agents and the Paradigm framework. Rather than reading raw files to understand project structure, agents call MCP tools that return structured, token-efficient responses. Understanding the full tool inventory and when to use each tool is fundamental to effective Paradigm orchestration.

Paradigm exposes approximately 15 tool modules, organized into four categories:

### Discovery Tools
These tools help agents understand the codebase without reading files directly.

- **`paradigm_search`** (~150 tokens) -- Fuzzy search across symbol names, descriptions, and tags. Supports type filtering (component, flow, gate, signal, aspect).
- **`paradigm_navigate`** (~200 tokens) -- Three intents: `find` (symbol lookup), `explore` (area browsing), `context` (task-based discovery).
- **`paradigm_ripple`** (~300 tokens) -- Dependency analysis showing what depends on a symbol, 1-5 levels deep.
- **`paradigm_related`** (~200 tokens) -- All symbols connected to a given symbol, both upstream and downstream.

### Knowledge Tools
These tools access the project's institutional memory.

- **`paradigm_wisdom_context`** -- Retrieves preferences, antipatterns, and decisions for specified symbols.
- **`paradigm_wisdom_record`** -- Captures new antipatterns or architectural decisions.
- **`paradigm_wisdom_expert`** -- Identifies human experts for symbols or areas.
- **`paradigm_history_context`** -- Retrieves implementation history for symbols.
- **`paradigm_history_record`** -- Logs implementation events.
- **`paradigm_history_fragility`** -- Checks stability scores.

### Validation Tools
These tools verify metadata integrity.

- **`paradigm_purpose_validate`** -- Validates `.purpose` files and optionally `portal.yaml`.
- **`paradigm_flow_check`** -- Validates flow definitions against the codebase.
- **`paradigm_aspect_check`** -- Verifies that aspects have valid code anchors.

### Management Tools
These tools modify Paradigm metadata.

- **`paradigm_purpose_add_component`**, **`paradigm_purpose_add_signal`**, **`paradigm_purpose_add_flow`**, etc. -- Add symbols to `.purpose` files.
- **`paradigm_portal_add_gate`**, **`paradigm_portal_add_route`** -- Manage `portal.yaml` gates and routes.
- **`paradigm_purpose_rename`** -- Rename symbols across all `.purpose` files.
- **`paradigm_tags`**, **`paradigm_tags_suggest`** -- Manage the tag bank.

### Token Economics

Every tool call has a token cost. The general principle is that MCP queries are 5-20x cheaper than reading files:

| Operation | Approximate Cost |
|---|---|
| `paradigm_status` | ~100 tokens |
| `paradigm_search` | ~150 tokens |
| `paradigm_navigate` | ~200 tokens |
| `paradigm_ripple` | ~300 tokens |
| Reading a small file | ~500 tokens |
| Reading a large file | ~2000+ tokens |

The rule of thumb: **use MCP tools for discovery and knowledge retrieval; use file reads only when you need exact source code for implementation.** An agent that reads 10 files to understand a feature (10,000+ tokens) versus one that calls `paradigm_navigate` with context intent (200 tokens) has a 50x cost difference for the same information.

### Practice Tools

These tools manage behavioral discipline and project memory.

**Habits Tools:**
- **`paradigm_habits_list`** -- List habit definitions with filters (category, trigger, severity, enabled status).
- **`paradigm_habits_check`** -- Evaluate and record practice compliance. Triggers: `preflight`, `postflight`, `on-stop`, `on-commit`.
- **`paradigm_habits_status`** -- Practice profile with compliance rates, category breakdowns, trends, and incident correlations.
- **`paradigm_practice_context`** -- Proactive habit warnings before modifying symbols. Returns relevant habits and recent compliance rates.

**Lore Tools:**
- **`paradigm_lore_search`** -- Search lore entries by symbol, author, date range, tags, type, and review status.
- **`paradigm_lore_record`** -- Record new entries (agent sessions, decisions, milestones, incidents, reviews).
- **`paradigm_lore_get`** -- Fetch a single entry by ID with full detail.
- **`paradigm_lore_update`** -- Update an existing entry's fields (title, summary, type, symbols, tags, learnings).
- **`paradigm_lore_delete`** -- Delete an entry by ID. Requires `confirm: true` to prevent accidental deletion.
- **`paradigm_lore_timeline`** -- Timeline overview with recent entries, hot symbols, and active authors.
