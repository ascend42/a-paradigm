---
name: health
description: Agent learning health dashboard — Neverland metrics, nomination stats, threshold drift, notebook growth. Use when the user says "health", "agent health", "neverland", "learning metrics", "how are agents doing", or wants to check the learning system.
---

# Agent Learning Health Dashboard

You are presenting a comprehensive view of how the agent learning system
is performing — combining Neverland metrics, nomination stats, and notebook
growth into one actionable dashboard.

## Step 1: Neverland Metrics

```
paradigm_ambient_health({})
```

## Step 2: Nomination Stats Per Agent

For each active agent from the Neverland response, get detailed stats:

```
paradigm_ambient_learn({ agent: "<agent-id>", dry_run: true })
```

This returns stats without adjusting thresholds.

## Step 3: Agent Roster Context

```
paradigm_agent_list({ scope: "all" })
```

## Step 4: Present Dashboard

Combine all data into a single dashboard:

```
Agent Learning Health
=====================

Overall: {healthStatus}
  Avg accept rate: {avgAcceptRate}% | Target: >70%
  Avg threshold: {avgThreshold} | Range: 0.0–1.0
  Total expertise: {totalExpertise} symbols
  Total notebooks: {totalNotebooks} entries
  Total transferable: {totalTransferable} patterns

Per-Agent Breakdown
-------------------

  architect {✓ active | ⏸ benched}
    Accept: {rate}% ({accepted}/{total}) | Threshold: {threshold}
    Expertise: {count} symbols | Notebooks: {count}
    Direction: {↑ improving | → stable | ↓ declining}
    {recommendation if any}

  builder {✓ active | ⏸ benched}
    Accept: {rate}% | Threshold: {threshold}
    ...

  security {✓ active | ⏸ benched}
    Accept: {rate}% | Threshold: {threshold}
    ...

  (repeat for all agents)

Neverland Progress
------------------

  cold-start [====                ] Sessions 1-3
  accumulating   [========            ] Sessions 3-5
  calibrating    [============        ] Sessions 5-8
  mature         [====================] Sessions 8+

  Current: {healthStatus} ← you are here

  Target milestones:
    □ Agents have divergent expertise scores (by session 5)
    □ Maestro routes to right agent >80% (by session 10)
    □ Agent acceptance rate >70% (by session 10)
    □ Cross-project patterns appear in enrichment
```

## Step 5: Recommendations

Based on the health data:

**If cold-start:**
- "Run more sessions with orchestration (`paradigm_orchestrate_inline`) to generate events and nominations"
- "Use `/paradigm:teach` to give agents initial domain knowledge"

**If accumulating (accept rate <50%):**
- "Agents are generating nominations but most are being dismissed"
- "Check dismiss reasons — if briefs are too generic, the Teacher Model will fix this over time"
- "Consider `/paradigm:teach` for agents with 0% accept rate"

**If calibrating (accept rate 50-70%):**
- "Learning loop is working — thresholds are adjusting"
- "Check which agents have notebook entries — those with notebooks should produce better nominations"
- "Monitor for agents trending down — may need teaching or benching"

**If mature (accept rate >70%):**
- "The team is well-calibrated"
- "Focus on cross-project transfer — patterns learned here should appear in other projects"
- "Consider publishing successful agent profiles to nevr.land"
