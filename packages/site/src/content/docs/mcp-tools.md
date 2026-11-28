---
title: MCP Tools Reference
order: 7
description: Reference for all Paradigm MCP tools available to AI agents.
---

## Overview

Paradigm exposes 32 grouped MCP tools (more on demand) that AI agents can call for context-aware development. These tools are the primary interface between Claude (or any MCP client) and the Paradigm knowledge graph. The most commonly used tools are listed below.

## Navigation & Discovery

| Tool | Description |
|------|-------------|
| `paradigm_status` | Project overview and symbol counts |
| `paradigm_navigate` | Find symbols, explore areas, get task context |
| `paradigm_search` | Search symbols by name, tag, or type |
| `paradigm_related` | Find connections between symbols |
| `paradigm_ripple` | Impact analysis before modifying a symbol |

## Context Management

| Tool | Description |
|------|-------------|
| `paradigm_session` (op `health`) | Check context window usage |
| `paradigm_session` (op `handoff_prepare`) | Prepare context for session handoff |
| `paradigm_session` (op `checkpoint`) | Save work-in-progress state |
| `paradigm_session` (op `recover`) | Recover previous session context |

## Code Quality

| Tool | Description |
|------|-------------|
| `paradigm_purpose` (op `validate`) | Validate .purpose and portal.yaml |
| `paradigm_flow` (op `check`) | Check flow completeness |
| `paradigm_flow` (op `affected`) | Which flows are impacted by a change |
| `paradigm_gates_for_route` | Suggest gates for an API endpoint |
| `paradigm_pm` (op `preflight`) | Compliance plan before starting work |
| `paradigm_pm` (op `postflight`) | Check for violations after finishing |

## Knowledge & Lore

| Tool | Description |
|------|-------------|
| `paradigm_lore` (op `record`) | Record a decision or reflection |
| `paradigm_lore` (op `search`) | Search lore by tag, symbol, or type |
| `paradigm_wisdom` (op `context`) | Get wisdom for symbols you're modifying |
| `paradigm_history` (op `context`) | Recent changes to a symbol |

## Documentation

| Tool | Description |
|------|-------------|
| `paradigm_docs` (op `manifest`) | Get documentation sidebar structure |
| `paradigm_docs` (op `page`) | Get page data for any symbol |
| `paradigm_docs` (op `search`) | Search across all documentation |

## Multi-Agent

| Tool | Description |
|------|-------------|
| `paradigm_symphony` (op `send`) | Send message to another agent |
| `paradigm_symphony` (op `poll`) | Check inbox for messages |
| `paradigm_symphony` (op `peek`) | Inbox stat check |
| `paradigm_orchestrate_inline` | Plan multi-agent task decomposition |

## University

| Tool | Description |
|------|-------------|
| `paradigm_university` (op `search`) | Search pack content; pass `id` for the full entry |
| `paradigm_university` (op `pack_list`) | List packs, their content counts and pack skills |

Authoring, onboarding and quizzes moved to the CLI (`paradigm university add|show|quiz|validate`) and the Platform **Academy** section.

## Token Budget Tips

- The default tool list is 32 tools, about 7,800 tokens (estimated as JSON length / 4 on Paradigm's own repository). A test fails the build past 40 tools, or at 8,000 estimated tokens. How many tokens a tool result costs compared with reading the files has not been measured.
- Use `response_format: 'concise'` for a shorter response on supported tools
- Call `paradigm_session` (op `health`) every 10-15 tool calls to monitor usage
