---
name: team
description: Show what your agent team did this session — contributions, verdicts, learning results. Use when the user says "team", "what did the team do", "session summary", "who contributed", or wants to see agent activity.
---

# Team Session Summary

You are showing what the agent team contributed during this session and
what learning resulted from their work.

## Step 1: Read Session Work Log

Read the session work log:
!`cat .paradigm/events/session-log.jsonl 2>/dev/null`

If empty or missing, report "No team activity recorded this session" and skip
to Step 4 for general agent stats.

## Step 2: Summarize Contributions

Parse the JSONL entries and organize by agent:

For each agent that has `agent-contribution` entries:
- What task they were assigned
- Their attribution prefix

For each agent that has `user-verdict` entries:
- Whether their work was accepted, dismissed, revised, or deferred
- The reason (if provided)

Present as:

```
Team Activity — This Session
=============================

[architect] Designed rate limiting middleware placement
  → Accepted ✓

[security] Flagged auth/login.ts for review
  → Dismissed ✗ — "change was audit logging, not a vulnerability"

[builder] Implemented rate limiter before auth gate
  → Revised ~ — user moved limiter after auth instead

[documentor] Updated .purpose and portal.yaml
  → Accepted ✓
```

## Step 3: Learning Impact

Check if the postflight learning pass has run by looking for recent journal entries:

```
paradigm_journal_search({ limit: 10 })
```

If journal entries from today exist for contributing agents, summarize:
- How many journal entries were written per agent
- Any patterns extracted (applies_when → correct_approach)
- Whether any were promoted to notebooks

```
Learning Results
================

architect: 1 journal entry (human_feedback, confidence 0.85)
  Pattern: "rate limiting before auth gate confirmed for this project"
  → Promoted to notebook ✓

security: 1 journal entry (correction_received, confidence 0.4)
  Pattern: "distinguish audit logging from vulnerabilities in auth files"
  → Pending promotion (needs confidence ≥ 0.8)
```

## Step 4: Agent Health Snapshot

Call Neverland metrics:
```
paradigm_ambient_neverland({})
```

Present a compact health summary:

```
Team Health: calibrating
  Avg accept rate: 58% | Avg threshold: 0.52
  Total expertise: 47 symbols | Notebooks: 5 entries
  Agents: 5 active, 1 benched
```

## Step 5: Recommendations

Based on the data, offer actionable suggestions:
- If an agent has >60% dismiss rate: "Consider benching {agent} or teaching it specific patterns via /paradigm:teach"
- If an agent has 0 notebook entries: "{agent} hasn't accumulated domain knowledge yet — more sessions needed"
- If health is cold-start: "Run more sessions with orchestration to build agent expertise"
- If a verdict has a reason that suggests a pattern: "The dismiss reason for {agent} could be a teachable pattern — run /paradigm:teach {agent}"
