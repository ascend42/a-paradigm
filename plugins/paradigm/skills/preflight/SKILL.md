---
name: preflight
description: Run pre-task compliance checks before starting implementation. Use when starting a new task, when the user says "preflight", "before I start", "what should I check", or proactively before complex tasks that affect 3+ files.
---

# Pre-Task Compliance Check

You are running Paradigm's pre-flight compliance check to ensure the task is
properly scoped and all dependencies are understood before writing code.

## Step 1: Identify the Task

If the user provided a task description, use it directly.
If not, ask: "What task are you about to work on?"

Use `$ARGUMENTS` if provided — this is the task description.

## Step 2: Run Pre-flight

Call `paradigm_pm_preflight` with the task description:

```
paradigm_pm_preflight({ task: "<task description>" })
```

This returns:
- **Affected symbols**: Which existing symbols will be impacted
- **Required checks**: What needs to be validated before starting
- **Suggested agents**: Which specialized agents should be involved
- **Compliance requirements**: portal.yaml updates, .purpose updates, etc.

## Step 3: Analyze Impact

For each affected symbol returned by preflight:

1. Call `paradigm_ripple` to understand the blast radius:
   ```
   paradigm_ripple({ symbol: "<symbol>", depth: 2 })
   ```

2. Call `paradigm_wisdom_context` to check for team wisdom:
   ```
   paradigm_wisdom_context({ symbols: ["<symbol1>", "<symbol2>"] })
   ```
   This reveals antipatterns to avoid and past decisions to respect.

3. Call `paradigm_history_fragility` to check stability:
   ```
   paradigm_history_fragility({ symbols: ["<symbol1>", "<symbol2>"] })
   ```
   Fragile symbols (many recent changes/failures) need extra care.

## Step 4: Check Authorization Impact

If the task involves API endpoints or user-facing features:

1. Call `paradigm_gates_for_route` for any new endpoints
2. Read `portal.yaml` to understand existing gate patterns
3. Flag if new gates will be needed

## Step 5: Check Flow Impact

If the task affects symbols involved in flows:

1. Call `paradigm_flows_affected` for each affected symbol
2. List which flows will be impacted
3. Note which flow steps need validation after implementation

## Step 6: Evaluate Preflight Habits

Call `paradigm_habits_check` with the preflight trigger to check habit compliance:

```
paradigm_habits_check({
  trigger: "preflight",
  symbolsTouched: ["#component-a", "#component-b"],
  taskDescription: "<task description>"
})
```

Include any warnings (skipped discovery habits like ripple or wisdom checks)
in the pre-flight report below.

## Step 7: Compile Pre-flight Report

Present a structured report to the user:

```
Pre-flight Report: <task title>
===================================

Affected Symbols:
  #component-a (stability: stable, 0 recent failures)
  #component-b (stability: fragile, 3 recent changes)
  ^gate-x (authorization gate)

Impact Radius:
  Direct: 3 symbols
  Indirect: 7 symbols (2 levels deep)

Team Wisdom:
  - Antipattern: "Don't use direct DB queries in component-a" (api-001)
  - Decision: "Use JWT for all API auth" (decision-003)

Flows Affected:
  $checkout-flow (steps 2-4 impacted)
  $user-onboarding (step 1 impacted)

Compliance Checklist:
  [ ] Update .purpose files for modified components
  [ ] Update portal.yaml if adding endpoints
  [ ] Update flow definitions if changing step order
  [ ] Record lore entry when done (3+ files expected)

Suggested Agents:
  architect — for design review
  security — for auth changes
```

## Step 8: Recommendations

Based on the analysis, recommend:
- Whether to proceed directly or plan first
- Which files to read before starting
- Which patterns to follow from existing code
- Any risks to be aware of
