---
name: scan
description: Rebuild the Paradigm symbol index after file changes. Use when symbols seem out of date, after creating or moving files, or when search results are stale.
disable-model-invocation: true
allowed-tools: Read, Glob
---

# Rebuild Symbol Index

You are rebuilding the Paradigm symbol index to ensure all symbols, navigation,
and flow data are fresh.

## Step 1: Check Current State

Call `paradigm_status` to see the current symbol counts. Note them — you'll
compare after the scan to show what changed.

## Step 2: Rebuild Index

Call `paradigm_reindex` to rebuild all three index files:
- `scan-index.json` — symbol index with references
- `navigator.yaml` — directory structure map
- `flow-index.json` — flow dependency graph

## Step 3: Verify Results

Call `paradigm_status` again and compare with the counts from Step 1.

Report to the user:
- Total symbols found (and delta from before)
- Breakdown by type: `#components`, `$flows`, `^gates`, `!signals`, `~aspects`
- Any new symbols that appeared
- Any symbols that disappeared (may indicate deleted code without .purpose cleanup)

## Step 4: Check for Issues

If the scan found 0 symbols:
- Check if `.purpose` files exist: use Glob for `**/.purpose`
- If none exist, suggest running `/paradigm:init` first
- If they exist but are empty, suggest populating them with `paradigm_purpose_add_component`

If symbols decreased significantly:
- Warn the user that some symbols may have been lost
- Suggest running `/paradigm:doctor` to check for issues

## When to Suggest This Skill

Proactively suggest `/paradigm:scan` when:
- You notice MCP tool results seem stale or incomplete
- After a large refactoring session
- After moving or renaming directories
- When `paradigm_search` returns unexpected empty results
