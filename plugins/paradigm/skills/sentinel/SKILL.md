---
name: sentinel
description: Triage and manage incidents using Paradigm Sentinel. Use when the user says "check incidents", "triage errors", "sentinel status", "what errors happened", or when investigating production issues or test failures.
---

# Sentinel Incident Triage

You are using Paradigm Sentinel to triage, analyze, and manage incidents —
errors, failures, and near-misses tracked across the project.

## Step 1: Get Overview

Call `paradigm_sentinel_stats` to get the current health metrics:

```
paradigm_sentinel_stats({ period: "7d" })
```

This shows:
- Total incidents (open, investigating, resolved)
- Incident trend over the period
- Most affected symbols
- Pattern match rates

## Step 2: Triage Open Incidents

Call `paradigm_sentinel_triage` to list incidents that need attention:

```
paradigm_sentinel_triage({ status: "open", limit: 10 })
```

For each incident, note:
- Incident ID (e.g., INC-001)
- Error message and type
- Affected symbols
- Environment
- Pattern matches (if any)

## Step 3: Analyze Priority Incidents

For the most critical incidents (or the one the user is asking about):

1. **Get full details**:
   ```
   paradigm_sentinel_show({
     incidentId: "INC-XXX",
     includeTimeline: true,
     includeSimilar: true
   })
   ```

2. **Check the affected symbol's history**:
   ```
   paradigm_history_context({ symbols: ["#affected-component"] })
   ```
   Look for recent changes that might have introduced the issue.

3. **Check fragility**:
   ```
   paradigm_history_fragility({ symbols: ["#affected-component"] })
   ```
   High fragility means this symbol has a history of problems.

4. **Check for patterns**:
   ```
   paradigm_sentinel_patterns({ symbol: "#affected-component" })
   ```
   See if known failure patterns match this incident.

## Step 4: Investigate Root Cause

Based on the incident details:

1. **Read the affected code**: Use the symbol's file path from the incident
   to read the relevant source files.

2. **Check recent changes**: Run via Bash:
   ```bash
   git log --oneline -10 -- <affected-file-path>
   ```

3. **Check the flow**: If the incident occurred during a multi-step flow,
   call `paradigm_flows_affected` to understand the flow context.

4. **Check wisdom**: Call `paradigm_wisdom_context` for the affected symbols —
   there might be known antipatterns or past decisions relevant to this issue.

## Step 5: Suggest Resolution

Based on the analysis, recommend a resolution strategy:

| Strategy | When to use |
|---|---|
| `fix-code` | Bug in the implementation |
| `fix-data` | Bad data causing the error |
| `retry` | Transient failure (network, timeout) |
| `fallback` | Need alternative path |
| `escalate` | Need human expertise |
| `ignore` | Known non-issue, expected behavior |

If a new failure pattern was discovered:

```
paradigm_sentinel_add_pattern({
  id: "pattern-id",
  name: "Pattern Name",
  pattern: {
    symbols: { component: "#affected" },
    errorContains: ["specific error text"]
  },
  resolution: {
    description: "How to fix this",
    strategy: "fix-code",
    priority: "high"
  }
})
```

## Step 6: Resolve Incidents

If the incident is resolved (or being resolved):

```
paradigm_sentinel_resolve({
  incidentId: "INC-XXX",
  notes: "Root cause: race condition in auth middleware. Fixed by adding mutex.",
  commitHash: "<commit-hash-if-available>"
})
```

## Step 7: Compile Report

Present findings to the user:

```
Sentinel Triage Report
======================

Period: Last 7 days
Open Incidents: X
Investigating: Y
Resolved: Z

Critical Issues:
  INC-001: [error message] → #component (suggested: fix-code)
  INC-003: [error message] → #component (pattern match: auth-timeout)

Trends:
  Most fragile: #component-x (3 incidents this week)
  Improving: #component-y (0 incidents, was 2 last week)

Recommendations:
  1. Fix INC-001 first (critical, affects checkout flow)
  2. Add retry logic for INC-003 (known transient failure)
  3. Consider refactoring #component-x (high fragility score)
```

## When to Proactively Suggest This

Suggest `/paradigm:sentinel` when:
- The user encounters an error during testing
- A test suite fails unexpectedly
- The user mentions production issues
- After deploying new code ("let's check if anything broke")
