---
name: postflight
description: Run post-task compliance checks after finishing implementation. Use when done with a task, when the user says "postflight", "am I done", "check my work", or proactively before ending a session where source files were modified.
context: fork
agent: paradigm:reviewer
allowed-tools: Read, Grep, Glob
---

# Post-Task Compliance Check

You are running Paradigm's post-flight compliance check to verify that all
paradigm files are properly updated after implementation work.

## Step 1: Gather What Changed

Uncommitted changes:
!`git diff --name-only HEAD 2>/dev/null`

Staged changes:
!`git diff --name-only --cached 2>/dev/null`

Categorize the modified files:
- **Source files**: `.ts`, `.js`, `.py`, `.rs`, `.go`, `.tsx`, `.jsx`, etc.
- **Paradigm files**: `.purpose`, `portal.yaml`, `.paradigm/*`
- **Other**: `.md`, `.json`, `.lock`, config files

Count each category.

## Step 2: Identify Symbols Touched

Based on the modified files:

1. For each modified source file, determine which Paradigm symbol it belongs to
2. Call `paradigm_search` with directory names or component names to find symbols
3. Build a list of all symbols that were affected

## Step 3: Run Post-flight

Call `paradigm_pm_postflight` with the gathered data:

```
paradigm_pm_postflight({
  filesModified: ["src/auth/login.ts", "src/api/routes.ts", ...],
  symbolsTouched: ["#login-handler", "#api-routes", "^authenticated"]
})
```

This checks for:
- Unregistered components (new code without .purpose entries)
- Uncaptured gates (new routes without portal.yaml entries)
- Missing flow updates
- Stale aspect anchors

## Step 4: Validate .purpose Files

Call `paradigm_purpose_validate` to check all .purpose files are valid:
- Syntax correctness
- Required fields present
- References resolve

## Step 5: Check Each Violation

For each violation returned by postflight, provide a specific fix:

**Missing .purpose file**:
- Identify which directory needs one
- Offer to create it: "Want me to run `paradigm_purpose_init` for `src/auth/`?"

**Missing component registration**:
- Identify the unregistered code
- Offer to add it: "Want me to register `#login-handler` in the .purpose file?"

**Missing portal.yaml entry**:
- Identify the unprotected route
- Call `paradigm_gates_for_route` for suggestions
- Offer to add the route and gates

**Stale aspect anchor**:
- Identify which anchor file is missing
- Offer to update or remove the aspect

## Step 6: Check Lore Requirement

Count the source files modified. If 3 or more:
- Check if a lore entry was recorded (look for `.paradigm/lore/entries/` in modified files)
- If not, warn: "You modified X source files — record a lore entry before finishing."
- Offer to help: "Want me to run `/paradigm:lore` to record one now?"

## Step 7: Rebuild Index

If any .purpose or portal.yaml files were modified:
- Call `paradigm_reindex` to ensure the index is fresh
- Confirm the reindex completed

## Step 8: Evaluate Habits

Call `paradigm_habits_check` with the postflight trigger to evaluate habit compliance:

```
paradigm_habits_check({
  trigger: "postflight",
  filesModified: ["src/auth/login.ts", ...],
  symbolsTouched: ["#login-handler", ...],
  record: true
})
```

Include the results in the compliance report below. If any habits were skipped,
note the recommendations.

## Step 9: Compile Report

Present a structured compliance report:

```
Post-flight Report
==================

Changes Summary:
  Source files modified: X
  Paradigm files modified: Y
  Symbols touched: #a, #b, ^c

Compliance Checks:
  [PASS] All source directories have .purpose coverage
  [PASS] portal.yaml covers all routes
  [FAIL] Missing lore entry (3+ files modified)
  [PASS] Aspect anchors valid
  [PASS] .purpose files valid

Actions Required:
  1. Record lore entry → /paradigm:lore

Actions Completed:
  - Rebuilt symbol index
  - Validated .purpose files
```

## Step 10: Final Status

If all checks pass:
- "All compliance checks passed. You're clear to commit and finish."

If there are failures:
- List each failure with the specific fix command
- Offer to fix them automatically
- After fixes, re-run the checks to confirm
