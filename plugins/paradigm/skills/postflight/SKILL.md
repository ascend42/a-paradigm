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

## Step 8b: Maestro Learning Pass

You are the Teacher. Read the session work log and write targeted learning
feedback for each agent that contributed this session.

### 8b.1: Read Session Work Log

Read the session work log:
!`cat .paradigm/events/session-log.jsonl 2>/dev/null`

If empty or missing, skip to Step 8b.4 (threshold-only learning).

### 8b.2: Cross-Reference Contributions with Verdicts

For each agent that has entries in the session work log:
1. Collect all `agent-contribution` entries for that agent
2. Collect all `user-verdict` entries for that agent
3. Pair contributions with verdicts where possible

### 8b.3: Write Targeted Journal Entries

For each agent with paired contribution-verdict data, call `paradigm_journal_record`
with specific, contextual feedback. Be SPECIFIC — reference actual file names,
symbol names, and what the change was. Do NOT write generic insights.

**If verdict = accepted:**
```
paradigm_journal_record({
  agent: "{agent-id}",
  trigger: "human_feedback",
  insight: "User accepted {describe specific contribution}. {What this confirms about the agent's understanding}.",
  project: "{project-name from config.yaml}",
  transferable: true,
  confidence_before: 0.6,
  confidence_after: 0.85,
  pattern: {
    id: "{domain-pattern-id}",
    applies_when: "{when this pattern applies}",
    correct_approach: "{what the agent recommended that was confirmed correct}"
  },
  tags: ["{relevant-paradigm-tags}"]
})
```

**If verdict = dismissed:**
```
paradigm_journal_record({
  agent: "{agent-id}",
  trigger: "correction_received",
  insight: "User dismissed: {nomination brief}. Reason: {dismiss reason from verdict, or infer from context}. {What the agent should do differently next time}.",
  project: "{project-name}",
  transferable: true,
  confidence_before: 0.7,
  confidence_after: 0.4,
  pattern: {
    id: "{correction-pattern-id}",
    applies_when: "{the condition the agent mistakenly flagged}",
    correct_approach: "{what the agent should do instead}"
  },
  tags: ["{relevant-tags}", "correction"]
})
```

**If verdict = revised (accepted but user changed something):**
```
paradigm_journal_record({
  agent: "{agent-id}",
  trigger: "correction_received",
  insight: "User accepted {agent}'s proposal but revised: {describe what changed}. {What this teaches about the correct approach}.",
  project: "{project-name}",
  transferable: true,
  confidence_before: 0.6,
  confidence_after: 0.65,
  pattern: {
    id: "{revision-pattern-id}",
    applies_when: "{context where this applies}",
    correct_approach: "{what the user actually did}"
  },
  tags: ["{relevant-tags}", "revision"]
})
```

**Rules for writing journal entries:**
- Be SPECIFIC — reference actual file names, symbol names, change descriptions
- Include the WHY — don't just say "dismissed", explain what was wrong
- Extract actionable patterns — `applies_when` + `correct_approach` are what get promoted to notebooks
- Set confidence_after: accepted=0.8-0.9, dismissed=0.3-0.5, revised=0.6-0.7
- Mark `transferable: true` when the lesson applies beyond this specific project

### 8b.4: Threshold Adjustment + Promotion

After writing journal entries (or if no session work log exists), run the
existing mechanical learning loop:

For each contributing agent (or all agents if no work log):

1. **Adjust attention thresholds**:
   ```
   paradigm_ambient_learn({ agent: "{agent-id}" })
   ```

2. **Promote journal patterns to notebooks**:
   ```
   paradigm_ambient_promote({ agent: "{agent-id}" })
   ```

### 8b.5: Report Learning Results

Include in the compliance report:
- Number of journal entries written per agent
- Any patterns extracted (applies_when → correct_approach)
- Threshold adjustments made (old → new, reason)
- Number of notebook promotions

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
