---
name: ripple
description: Analyze the impact of changing a symbol before modifying it. Use when the user says "what would break", "impact analysis", "ripple check", or before making changes to a core symbol.
context: fork
agent: paradigm:architect
allowed-tools: Read, Grep, Glob
argument-hint: "<symbol>"
---

# Ripple Analysis — Impact Check

You are analyzing the blast radius of changing a Paradigm symbol. This helps
the user understand what will break, what flows are affected, and what needs
updating before they start modifying code.

## Symbol to Analyze

!`ls -l .paradigm/scan-index.json 2>/dev/null`

Analyze this symbol: $ARGUMENTS

If no symbol was provided, ask the user which symbol to analyze.

## Step 1: Direct Impact

Call `paradigm_ripple` with the target symbol:

```
paradigm_ripple({ symbol: "$0", depth: 2 })
```

This returns:
- **Direct dependents**: Symbols that reference this one
- **Indirect dependents**: Symbols 2 levels deep
- **Affected flows**: Flows that include this symbol as a step
- **Affected personas**: Persona journeys that touch this symbol

## Step 2: Flow Impact

Call `paradigm_flows_affected` to see which flows break:

```
paradigm_flows_affected({ symbol: "$0" })
```

For each affected flow, note:
- Which step in the flow uses this symbol
- Whether it's a gate, action, or signal step
- What happens downstream if this step changes

## Step 3: History & Fragility

Call `paradigm_history_fragility` to check stability:

```
paradigm_history_fragility({ symbols: ["$0"] })
```

High fragility means this symbol changes often or has had recent failures.
Extra care needed.

## Step 4: Wisdom Check

Call `paradigm_wisdom_context` for known patterns:

```
paradigm_wisdom_context({ symbols: ["$0"] })
```

Surface any antipatterns or past decisions about this symbol.

## Step 5: Compile Report

```
Ripple Analysis: <symbol>
========================

Direct Impact:
  X symbols directly depend on this
  Y symbols indirectly affected (2 levels)

Flows Affected:
  $flow-a: step 3 (gate check)
  $flow-b: step 1 (trigger)

Stability:
  Fragility: low/medium/high
  Recent changes: N in last 30 days
  Last incident: <date or "none">

Team Wisdom:
  - <antipatterns or decisions if any>

Recommendation:
  - <whether safe to modify, what to watch out for>
```
