---
name: agents
description: Manage your agent team — roster, onboard, bench/activate, detail, install from GitHub or nevr.land. Use when the user says "agents", "show my agents", "onboard agents", "install agent", "bench agent", or wants to manage their AI team.
---

# Agent Team Management

You are managing the user's Paradigm agent team — the persistent AI agent
identities that carry expertise, notebooks, and learning across sessions.

## Step 1: Check Current State

Get the current roster:
```
paradigm_agent_list({ scope: "all" })
```

Also check Neverland health:
```
paradigm_ambient_health({})
```

## Step 2: Determine Action

Based on the user's request or the argument provided, take ONE of these actions:

### roster (default if no argument)

Display the agent roster in a clean format:

```
Agent Roster
============

Active:
  architect — deliberate, conservative, detailed
    Top: #auth-middleware (85%), #api-routes (72%) | thr: 0.55
  builder — rapid, balanced, concise
    Top: #payment-form (91%) | thr: 0.75
  documentor — methodical, conservative, concise
    Paradigm file specialist | thr: 0.30

Benched:
  security — methodical, conservative, detailed
    0% accept rate, threshold rising | thr: 0.45

Health: accumulating (avg accept: 42%, 3 notebooks)
```

### onboard

Check which default agents are missing and create + sync them:

Default agents: architect, builder, tester, reviewer, security, documentor

For each missing agent:
1. Call `paradigm_agent_list` to see what exists
2. For each missing: inform the user and suggest creating
3. Create: `! paradigm agent create <id> --global`
4. Sync: `! paradigm agent sync <id>`

Report what was created and synced.

### bench <id>

Bench an agent:
```
paradigm_agent_bench({ id: "<agent-id>" })
```

Confirm with stats: "Benched architect (was at 55% accept rate, threshold 0.55)"

### activate <id>

Activate a benched agent:
```
paradigm_agent_activate({ id: "<agent-id>" })
```

Confirm: "Activated security — will be included in next orchestration"

### show <id>

Get full agent detail:
```
paradigm_agent_get({ id: "<agent-id>" })
```

Present profile in a readable format:
- Personality and role
- Top 10 expertise entries with confidence %
- Transferable patterns with success rates
- Project contexts
- Attention config (threshold, subscriptions)
- Notebook entry count
- Nomination stats (accept/dismiss/defer rates)

### install <source>

Install an agent from an external source.

**GitHub format:** `github:<user>/<repo>` or `github:<user>/<repo>/<path>`
1. Fetch the .agent YAML from the repository
2. Save to `~/.paradigm/agents/<id>.agent`
3. Report what was installed

**nevr.land format:** `@<namespace>/<agent-name>`
1. Fetch from `https://nevr.land/api/agents/<namespace>/<agent-name>`
2. Display the agent's contract: description, trust level, pricing, terms
3. Ask for confirmation before installing
4. Save to `~/.paradigm/agents/<id>.agent`
5. Report what was installed

If the source format is unclear, ask the user to clarify.

## Step 3: Summary

After any action, show a one-line status:
- Total agents, active count, benched count
- Neverland health status if available
