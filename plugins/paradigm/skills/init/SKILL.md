---
name: init
description: Initialize Paradigm in the current project. Use when a user says "set up paradigm", "initialize paradigm", "add paradigm to this project", or when you detect a project has no .paradigm/ directory.
disable-model-invocation: true
allowed-tools: Read, Write, Bash, Glob, Grep
---

# Initialize Paradigm

You are setting up Paradigm in the current project. Follow these steps carefully.

## Step 1: Check Current State

Call `paradigm_status` to check if Paradigm is already initialized.

- If the project already has a `.paradigm/` directory with symbols, tell the user
  it's already set up and show them the status. Ask if they want to re-scan instead.
- If not initialized, continue to Step 2.

## Step 2: Detect Project Type

Before initializing, understand what kind of project this is:

1. Use the Glob tool to check for key files:
   - `package.json` → Node.js/TypeScript project
   - `Cargo.toml` → Rust project
   - `pyproject.toml` or `setup.py` → Python project
   - `go.mod` → Go project
   - `*.xcodeproj` or `Package.swift` → Swift/iOS project

2. Check for frameworks:
   - `next.config.*` → Next.js
   - `vite.config.*` → Vite
   - `tauri.conf.json` → Tauri
   - `src-tauri/` → Tauri (Rust backend)

3. Note the primary language and framework for the init command.

## Step 3: Initialize

Run the following via Bash:

```bash
npx @a-company/paradigm init
```

If the user wants a specific stack (detected from Step 2), pass it:

```bash
npx @a-company/paradigm init --stack <type>
```

Available stacks: `web`, `api`, `mobile`, `desktop`, `library`, `cli`, `fullstack`

## Step 4: Scan for Symbols

After initialization, scan the codebase to build the symbol index:

```bash
npx @a-company/paradigm scan auto
```

## Step 5: Generate CLAUDE.md

Sync the Paradigm context to Claude Code's instruction file:

```bash
npx @a-company/paradigm sync --claude
```

## Step 6: Report Results

Call `paradigm_status` again and report to the user:

1. How many symbols were discovered (components, gates, signals, flows, aspects)
2. Which directories have `.purpose` files
3. Whether `portal.yaml` was created (if routes were detected)
4. Next steps:
   - "Your project is now set up with Paradigm"
   - "CLAUDE.md has been generated — I'll follow these conventions automatically"
   - "Use `/paradigm:doctor` to check health anytime"
   - "Use `/paradigm:scan` after major file changes to rebuild the index"

## Error Handling

- If `npx` is not available, tell the user to install Node.js >= 18
- If the init command fails, read the error output and help debug
- If scan finds 0 symbols, suggest creating `.purpose` files manually using
  `paradigm_purpose_init` and `paradigm_purpose_add_component`
