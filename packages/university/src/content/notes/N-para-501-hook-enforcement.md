---
id: N-para-501-hook-enforcement
title: Hook Enforcement & Automation
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-501
  - stop-hook-blocks
  - post-write-hook-tracks
  - pre-commit-hook-auto-rebuilds
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-501.json
---

## The Compliance Gap

Paradigm's value depends on discipline. Purpose files must be updated when code changes. Portal.yaml must reflect route additions. Lore must be recorded for significant sessions. Aspect anchors must point to real code. Without enforcement, these requirements become suggestions that erode over time.

Hooks close this gap. They are automated checks that run at specific points in the development workflow, catching violations before they become technical debt. Paradigm uses three hooks, each with a distinct role and severity.

## The Stop Hook

The stop hook is the primary enforcer. It runs before an agent session completes and can **block** the session from finishing if compliance checks fail.

**Trigger**: Before agent session end (Claude Code: Stop hook, Cursor: pre-finish)

**Seven checks, in order:**

1. **Source files modified without .purpose updates** — If 2+ source files were modified but zero paradigm metadata files (.purpose, portal.yaml, etc.) were updated, the hook blocks. This catches the "implement and forget" pattern.

2. **Modified directories missing .purpose coverage** — The hook walks up the directory tree from each modified source file looking for a covering .purpose file. If no .purpose exists anywhere in the ancestor chain (including the project root), it blocks.

3. **Route patterns without portal.yaml** — The hook scans modified files for route declaration patterns (Express `.get()`, `.post()`, decorators like `@Get()`, Rust macros like `#[actix_web::get]`). If routes are detected and portal.yaml was neither present nor modified, it blocks.

4. **Stale aspect anchors** — The hook parses .purpose files for `anchors:` sections and validates that each referenced file still exists. If an anchor points to a deleted file, it blocks.

5. **Pending .purpose freshness** — The post-write hook tracks files edited without .purpose updates in `.paradigm/.pending-review`. The stop hook checks this list: if source files are pending and their covering .purpose was not also modified during the session, it blocks.

6. **Aspect coverage advisory** — If the project uses `~aspects`, the hook advises (non-blocking) to verify that anchor line numbers are still accurate after code changes.

7. **Lore entry for significant sessions** — If 3+ source files were modified and no lore entry was recorded in `.paradigm/lore/entries/`, the hook blocks.

**When blocked**, the hook outputs a clear list of violations with remediation steps. Fix the violations, then complete the session.

## The Post-Write Hook

The post-write hook runs after every file edit (Edit or Write tool calls). It is **advisory only** — it never blocks.

**Trigger**: After Edit or Write tool completes

**Actions:**
1. Extracts the edited file path
2. Skips non-source files (.purpose, portal.yaml, .md, .lock, .json, .yaml, .gitignore, .env files) and paradigm directories (.paradigm/, .claude/, .cursor/)
3. Appends source file paths to `.paradigm/.pending-review` (deduplicated)
4. Checks if a .purpose file covers the edited directory
5. If no .purpose exists: reminds "No .purpose file covers {dir}/ — Create one"
6. Every 3 source files edited: general reminder to update .purpose files

The `.pending-review` file is the bridge between the post-write hook and the stop hook. Post-write accumulates the list; stop hook validates against it.

## The Pre-Commit Hook

The pre-commit hook runs before `git commit` and handles index maintenance. It **never blocks**.

**Trigger**: Before Bash commands containing `git commit`

**Actions:**
1. Runs `paradigm index --quiet` to rebuild scan-index.json, navigator.yaml, and flow-index.json
2. Stages the rebuilt files so they are included in the commit
3. Exits 0 (always succeeds)

This ensures that every commit has a fresh symbol index. Without this hook, the index would drift from the actual codebase between manual `paradigm scan` runs.

## Hook Installation

Hooks are installed automatically by `paradigm shift` (full setup) or manually with `paradigm hooks install`. The installer detects the IDE (Claude Code or Cursor) and writes the appropriate hook format.

For Claude Code, hooks are configured in `.claude/settings.json` using the hooks API — stop hooks, PreToolUse matchers (for Bash commands matching `git commit`), and PostToolUse matchers (for Edit/Write tool calls).

## Remediation Workflow

When the stop hook blocks you:

1. **Read the violation list** — Each violation names the specific check that failed
2. **Update .purpose files** — For modified directories without coverage, create or update the nearest .purpose file
3. **Update portal.yaml** — If routes were added, add the route and gate definitions
4. **Fix stale anchors** — If aspect anchors point to deleted/moved files, update the anchor paths
5. **Record lore** — If 3+ files were modified, call `paradigm_lore_record` with the session summary
6. **Run `paradigm_reindex`** — Rebuild the index to reflect your updates
7. **Complete the session** — The stop hook runs again and should pass

The key insight is that the stop hook is not punitive — it is protective. Every check it enforces prevents a real problem: stale documentation, unprotected routes, orphaned anchors, or lost institutional knowledge.
