---
id: N-para-001-shift-setup
title: Your First paradigm shift
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-001
  - paradigm-shift-is
  - paradigm-directory-holds
  - claudemd-and-agentsmd
symbols: []
difficulty: beginner
estimatedMinutes: 2
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-001.json
---

## Hands On in 60 Seconds

Open a terminal in any project directory and run:

```bash
paradigm shift
```

That is it. One command, and your project is Paradigm-aware.

### What Just Happened?

Look at your directory. Several new files and a new folder appeared:

```
.paradigm/            ← Configuration, roster, tags, indexes
  config.yaml         ← Project settings (name, discipline, enforcement)
  roster.yaml         ← Your agent team
  agents.yaml         ← Model tier assignments
  tags.yaml           ← Tag taxonomy
CLAUDE.md             ← Instructions for Claude Code
AGENTS.md             ← Instructions for any AI agent
.purpose              ← Root-level purpose file (describes your project)
```

Each file has a specific job:

- **`.paradigm/config.yaml`** is the brain — it stores your project name, discipline (web, backend, mobile, etc.), enforcement level, and feature flags. Paradigm auto-detected your discipline from project markers like `package.json`, `Cargo.toml`, or `go.mod`.

- **`CLAUDE.md`** and **`AGENTS.md`** are instruction files that AI tools read automatically. They are generated from your Paradigm configuration — you do not edit them by hand. When you change config, re-running `paradigm shift` regenerates them.

- **`.purpose`** is the most important file type in Paradigm. It describes what code in a directory does using a structured format with **symbols** — you will learn all five symbol types in PARA 101. For now, just know that `.purpose` files are how AI agents understand your codebase.

- **`roster.yaml`** lists which agents are on your team. More on this in the next lesson.

### Hooks Are Installed

`paradigm shift` also installed Git hooks and Claude Code hooks. These run automatically when you commit or finish a task, checking that your Paradigm metadata stays in sync with your code.

By default, hooks use **minimal enforcement** — they warn but never block. You will not lose work or get stuck. As you get comfortable, you can upgrade to balanced or strict enforcement (covered in PARA 301).

### Try It: Explore What Was Created

Run these commands to see what Paradigm set up:

```bash
cat .paradigm/config.yaml      # Your project configuration
cat .paradigm/roster.yaml       # Your agent team
cat .purpose                    # Root purpose file
```

Notice how `config.yaml` already knows your project type, and `roster.yaml` has agents selected for that type. This is the auto-detection at work — no manual configuration needed.
