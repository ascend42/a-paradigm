---
title: MCP Tools Reference
order: 7
description: Reference for all Paradigm MCP tools available to AI agents.
---

## Overview

Paradigm exposes 50+ MCP tools that AI agents can call for context-aware development. These tools are the primary interface between Claude (or any MCP client) and the Paradigm knowledge graph.

## Navigation & Discovery

| Tool | Description | Tokens |
|------|-------------|--------|
| `paradigm_status` | Project overview and symbol counts | ~100 |
| `paradigm_navigate` | Find symbols, explore areas, get task context | ~200 |
| `paradigm_search` | Search symbols by name, tag, or type | ~150 |
| `paradigm_related` | Find connections between symbols | ~200 |
| `paradigm_ripple` | Impact analysis before modifying a symbol | ~300 |

## Context Management

| Tool | Description | Tokens |
|------|-------------|--------|
| `paradigm_context_check` | Check context window usage | ~100 |
| `paradigm_handoff_prepare` | Prepare context for session handoff | ~200 |
| `paradigm_session_checkpoint` | Save work-in-progress state | ~100 |
| `paradigm_session_recover` | Recover previous session context | ~200 |

## Code Quality

| Tool | Description | Tokens |
|------|-------------|--------|
| `paradigm_purpose_validate` | Validate .purpose and portal.yaml | ~200 |
| `paradigm_flow_validate` | Check flow completeness | ~200 |
| `paradigm_flows_affected` | Which flows are impacted by a change | ~200 |
| `paradigm_gates_for_route` | Suggest gates for an API endpoint | ~150 |
| `paradigm_pm_preflight` | Compliance plan before starting work | ~200 |
| `paradigm_pm_postflight` | Check for violations after finishing | ~200 |

## Knowledge & Lore

| Tool | Description | Tokens |
|------|-------------|--------|
| `paradigm_lore_record` | Record a decision or reflection | ~150 |
| `paradigm_lore_search` | Search lore by tag, symbol, or type | ~200 |
| `paradigm_wisdom_context` | Get wisdom for symbols you're modifying | ~200 |
| `paradigm_history_context` | Recent changes to a symbol | ~200 |

## Documentation

| Tool | Description | Tokens |
|------|-------------|--------|
| `paradigm_docs_manifest` | Get documentation sidebar structure | ~200 |
| `paradigm_docs_page` | Get page data for any symbol | ~300 |
| `paradigm_docs_search` | Search across all documentation | ~150 |

## Multi-Agent

| Tool | Description | Tokens |
|------|-------------|--------|
| `paradigm_symphony_send` | Send message to another agent | ~100 |
| `paradigm_symphony_poll` | Check inbox for messages | ~200 |
| `paradigm_symphony_peek` | Near-free inbox stat check | ~15 |
| `paradigm_orchestrate_inline` | Plan multi-agent task decomposition | ~300 |

## University

| Tool | Description | Tokens |
|------|-------------|--------|
| `paradigm_university_search` | Search learning content | ~150 |
| `paradigm_university_onboard` | Get onboarding sequence | ~200 |
| `paradigm_university_quiz` | Get quiz for taking | ~200 |

## Token Budget Tips

- Prefer MCP tools over file reads (~100-300 tokens vs ~2000+ for files)
- Use `response_format: 'concise'` to halve token usage on supported tools
- Call `paradigm_context_check` every 10-15 tool calls to monitor usage
- Results are cached for 30 seconds — repeated calls are free
