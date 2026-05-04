---
id: N-para-301-paradigm-shift
title: The paradigm shift Command
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-05-04'
tags:
  - course
  - para-301
  - paradigm-shift-is
  - six-steps-init
  - non-interactive-by-default
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-301.json
---

## One Command, Full Setup

`paradigm shift` is the universal onboarding command. It transforms any project directory into a Paradigm-aware workspace in a single run. Whether you are starting a new project or adopting Paradigm in an existing codebase, this is where you begin.

```bash
paradigm shift
```

## What It Does (6 Steps)

The command runs six steps in sequence:

### Step 1: Initialize
Creates the `.paradigm/` directory with `config.yaml`, `tags.yaml`, and starter files. If the directory already exists, it updates configuration without overwriting your customizations.

### Step 2: Auto-Migrate
Detects if your project uses an older Paradigm version and applies breaking-change migrations automatically. This keeps projects up to date without manual migration effort.

### Step 3: Scan & Index
Discovers all symbols in your codebase by reading `.purpose` files and `portal.yaml`. Builds the navigator index for fast symbol lookup. Skip this step with `--quick` for faster initialization.

### Step 4: Sync IDEs
Generates instruction files for your AI tools:
- `CLAUDE.md` — Claude Code instructions
- `AGENTS.md` — Universal agent instructions
- `.cursor/rules/` — Cursor IDE rules

These files are regenerated from your Paradigm configuration every time you run shift or sync.

### Step 5: Install Hooks
Sets up Git hooks (pre-commit, post-commit) and Claude Code/Cursor hooks for automated enforcement. The hooks run compliance checks based on your enforcement level.

### Step 6: Roster & Model Tiers
Suggests an agent roster based on your detected project type (web, backend, mobile, etc.) and configures model tiers (tier-1/tier-2/tier-3) based on your environment.

## Key Flags

| Flag | Effect |
|------|--------|
| `--quick` | Skip symbol scanning (fast init) |
| `--verify` | Run `paradigm doctor` health checks at the end |
| `--workspace <name>` | Create or join a multi-project workspace |
| `--force` | Reinitialize (overwrite existing config) |

## When to Re-Run

Run `paradigm shift` again when:
- You upgrade Paradigm to a new version (auto-migrates)
- You want to refresh IDE instruction files after config changes
- You add the project to a workspace
- After major restructuring that changes project type

The command is idempotent — running it multiple times is safe. It updates what changed and leaves the rest alone.

## What Comes Out

After `paradigm shift`, your project has:

```
.paradigm/
  config.yaml       # Project configuration (enforcement.level: none by default)
  tags.yaml         # Tag taxonomy
  roster.yaml       # Agent team roster
  agents.yaml       # Agent tier assignments
CLAUDE.md            # Claude Code instructions
AGENTS.md            # Universal agent instructions
.purpose             # Root purpose file (if new project)
portal.yaml          # Auth topology (if gates detected)
```

Plus Git hooks and IDE-specific instruction files, all derived from your Paradigm configuration.
