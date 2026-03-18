---
title: CLI Reference
order: 6
description: Complete reference for the paradigm command-line interface.
---

## Installation

```bash
npm install -g @a-company/paradigm
```

## Core Commands

| Command | Description |
|---------|-------------|
| `paradigm init` | Initialize Paradigm in a project |
| `paradigm shift` | Configure project settings and install hooks |
| `paradigm scan` | Rebuild symbol index from .purpose files |
| `paradigm status` | Show project overview and symbol counts |
| `paradigm doctor` | Health check — validate setup and find issues |

## Navigation

| Command | Description |
|---------|-------------|
| `paradigm search <query>` | Search symbols by name, description, or tag |
| `paradigm graph` | Launch interactive symbol graph visualization |

## Documentation

| Command | Description |
|---------|-------------|
| `paradigm docs serve` | Launch interactive docs viewer (port 3850) |
| `paradigm docs build` | Generate static documentation site |

## Lore (Knowledge Management)

| Command | Description |
|---------|-------------|
| `paradigm lore record` | Record a decision, insight, or reflection |
| `paradigm lore list` | List recent lore entries |
| `paradigm lore show <id>` | View a lore entry |
| `paradigm lore timeline` | Visual timeline of project history |
| `paradigm lore serve` | Launch lore viewer UI |

## Multi-Agent Orchestration

| Command | Description |
|---------|-------------|
| `paradigm team spawn <agent>` | Spawn a single agent |
| `paradigm team orchestrate "task"` | AI orchestrator coordinates agents |
| `paradigm team handoff` | Prepare context handoff to another agent |

## Symphony (Agent Messaging)

| Command | Description |
|---------|-------------|
| `paradigm symphony send` | Send message to another agent |
| `paradigm symphony inbox` | Read incoming messages |
| `paradigm symphony threads` | List active threads |
| `paradigm symphony serve` | Start relay server for cross-machine messaging |
| `paradigm symphony watch` | Real-time inbox monitoring |

## University

| Command | Description |
|---------|-------------|
| `paradigm university list` | List available content |
| `paradigm university quiz <id>` | Take a quiz interactively |
| `paradigm university status` | Content overview and diplomas |

## Platform

| Command | Description |
|---------|-------------|
| `paradigm serve` | Launch full Platform UI |
| `paradigm conductor` | Launch Conductor (macOS native app) |

## Workspace (Multi-Project)

| Command | Description |
|---------|-------------|
| `paradigm workspace init` | Create workspace from sibling projects |
| `paradigm workspace status` | Show member status and symbol counts |
| `paradigm workspace reindex` | Rebuild all member indices |

## Global Options

| Option | Description |
|--------|-------------|
| `--help` | Show help for any command |
| `--version` | Show Paradigm version |
