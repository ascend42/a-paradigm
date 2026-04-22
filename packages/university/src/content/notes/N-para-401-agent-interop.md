---
id: N-para-401-agent-interop
title: Agent Interoperability
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-401
  - agentsmd-is-a
  - llmstxt-is-a
  - agentsmd-contains-instructions
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-401.json
---

## AGENTS.md and llms.txt

Paradigm generates two standard files that make projects accessible to any AI agent, regardless of which IDE or platform is used.

### AGENTS.md — Universal Agent Instructions

AGENTS.md is a cross-IDE standard backed by Google, OpenAI, Cursor, and others. It is a pure Markdown file at the repo root containing everything an AI agent needs to be productive:

- **Symbol system** — the five operational symbols and conventions
- **MCP tools reference** — when to use each tool and what it returns
- **Workflow protocol** — before/after task checklists
- **Commit conventions** — format with Symbols: trailer
- **Session recovery** — how to pick up where a previous agent left off
- **Habits compliance** — behavioral expectations at each workflow stage
- **Lore recording** — when and how to record project history
- **Session checkpoints** — crash recovery protocol

Regenerate with: `paradigm sync agents`

Paradigm enriches AGENTS.md with sections that most projects don't include — habits, lore recording, checkpoint protocol, and llms.txt reference. This gives agents a richer behavioral contract than bare instructions.

### llms.txt — LLM-Readable Project Summary

The llms.txt standard provides a plain-text project summary optimized for LLM consumption. Unlike AGENTS.md (which contains instructions), llms.txt contains facts:

- Project name and overview
- Symbol table (prefixes, names, descriptions)
- Key files from navigator.yaml
- Defined flows and their triggers
- Gates and protected routes
- Conventions

Regenerate with: `paradigm sync-llms`

llms.txt is useful for RAG pipelines, chat interfaces, and any context where a quick project overview is needed without the full instruction set.

### When to Use Which

| File | Purpose | Audience | Content |
|------|---------|----------|---------|
| AGENTS.md | Agent instructions | AI agents working on the repo | How to behave, tools to use, conventions to follow |
| llms.txt | Project summary | Any LLM consuming project info | What the project is, what exists, how it is structured |
| CLAUDE.md | Claude-specific instructions | Claude Code / Claude API | Superset of AGENTS.md with Claude-specific features |

All three can coexist. `paradigm sync --all` regenerates AGENTS.md alongside other IDE files. `paradigm sync-llms` handles llms.txt separately because it is not IDE-specific.

## Enhanced MCP Tool Descriptions

Every MCP tool description now includes three pieces of information that help agents make better decisions:

1. **What it does** — the core functionality
2. **What it returns** — the shape of the response data
3. **Token cost** — approximate cost in tokens (~100 to ~400)

This information is embedded directly in the tool description string, so agents can evaluate tool choice before calling. For example, an agent deciding between `paradigm_search` (~150 tokens) and reading 5 files (~2500 tokens) can make an informed cost/benefit decision.

## The Fresh Context Principle

When agents are spawned in isolation (via `paradigm_orchestrate_inline` or IDE task tools), they start with a blank context window. They must orient themselves before working. Paradigm's interop files solve this:

1. **Agent reads AGENTS.md** — learns the symbol system, tools, and workflow
2. **Agent calls `paradigm_session_recover`** — gets previous session breadcrumbs
3. **Agent calls `paradigm_navigate` with context intent** — finds relevant code

This three-step orientation costs ~500 tokens total and gives the agent full context. Without these files, the agent would need to read dozens of source files to achieve the same understanding.
