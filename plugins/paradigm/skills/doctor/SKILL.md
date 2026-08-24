---
name: doctor
description: Run a comprehensive health check on the Paradigm setup. Use when something seems wrong, after major changes, or when the user says "check paradigm health", "paradigm doctor", or "is paradigm set up correctly".
allowed-tools: Read, Grep, Glob
---

# Paradigm Health Check

You are running a comprehensive health check on the project's Paradigm setup.
Check everything systematically and report findings with clear fix actions.

## Quick Context

Config exists: !`ls .paradigm/config.yaml 2>/dev/null`
Portal exists: !`ls portal.yaml 2>/dev/null`
Scan index: !`ls -l .paradigm/scan-index.json 2>/dev/null`
Lore entries: !`ls .paradigm/lore/entries/ 2>/dev/null`

## Step 1: Project Overview

Call `paradigm_status` to get the high-level view:
- Is Paradigm initialized? (`.paradigm/` exists)
- Symbol counts by type
- Project health indicators

If Paradigm is not initialized, stop here and suggest `/paradigm:init`.

## Step 2: Validate .purpose Files

Call `paradigm_purpose_validate` to check all `.purpose` files for:
- YAML syntax errors
- Missing required fields
- Invalid symbol references
- Orphaned symbols (referenced but not defined)

Record each issue found.

## Step 3: Check Portal Authorization

Use the Glob tool to check if `portal.yaml` exists.

If it exists:
- Read it and check for well-formed gate definitions
- Verify each gate has a `description` and `check` expression
- Check that routes reference defined gates

If it doesn't exist:
- Use the Grep tool to search for route patterns in the codebase:
  `\.(get|post|put|patch|delete)\s*\(` in `*.ts`, `*.js`, `*.py`, `*.rs`, `*.go`
- If routes are found, flag this as a violation — portal.yaml is needed

## Step 4: Check .purpose Coverage

Use Glob to find all source directories that contain code files but no `.purpose`
file in their path:

1. Glob for `**/*.ts`, `**/*.js`, `**/*.py`, `**/*.rs` (source files)
2. Glob for `**/.purpose` (purpose files)
3. For each source directory, walk up to find a covering `.purpose`
4. Report any uncovered directories

## Step 5: Check Aspect Anchors

Call `paradigm_navigate` with intent "explore" and target "aspects" to find all
defined aspects. For each aspect that has anchors:
- Verify the anchor file exists on disk using Glob
- Report any broken anchors

## Step 6: Check Lore Setup

Use Glob to check if `.paradigm/lore/` directory exists:
- If yes, check if `entries/` subdirectory exists
- Count existing lore entries
- Report status

If no lore directory and the project has substantial history (check git log count),
suggest setting up lore tracking.

## Step 7: Check Sentinel Setup

Use Glob to check if `.sentinel.yaml` exists:
- If yes, report it's configured
- If no, mention it's optional but available for incident tracking

## Step 8: Compile Report

Present findings as a structured health report:

```
Paradigm Health Report
======================

Overview:
  Status: initialized / not initialized
  Symbols: X components, Y flows, Z gates, W signals, V aspects

Checks:
  [PASS/FAIL] .purpose file validity
  [PASS/FAIL] Portal authorization coverage
  [PASS/FAIL] Source directory .purpose coverage
  [PASS/FAIL] Aspect anchor integrity
  [INFO] Lore: X entries / not configured
  [INFO] Sentinel: configured / not configured

Issues Found: N
  1. [description] → Fix: [action]
  2. [description] → Fix: [action]
  ...

Recommendations:
  - [ordered by priority]
```

## Severity Levels

- **FAIL**: Something is broken and will cause stop hook violations
- **WARN**: Not broken but should be addressed
- **INFO**: Informational, no action needed
- **PASS**: Check passed successfully
