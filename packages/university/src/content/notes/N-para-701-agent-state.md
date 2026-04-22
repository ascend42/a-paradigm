---
id: N-para-701-agent-state
title: 'Lesson 4: Agent State & Continuity'
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-701
  - project-state-at
  - global-state-at
  - buildprofileenrichment-injects-agent
symbols: []
difficulty: beginner
estimatedMinutes: 6
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-701.json
---

## The Continuity Problem

Every AI session starts from zero. The model has no memory of previous sessions. If the security agent reviewed 8 files yesterday, identified 3 gate coverage gaps, and deferred 2 items to today — all of that context is lost when the session ends. The next session's security agent starts fresh, potentially re-reviewing the same files and missing the deferred items entirely.

Agent state solves this by persisting key information between sessions at two scopes: project-level state (what happened on this specific project) and global state (career statistics across all projects).

## Project State: AgentProjectState

Project-scoped state lives at `.paradigm/agent-state/{agent-id}.yaml` and captures what the agent has done on THIS project:

```typescript
interface AgentProjectState {
  id: string;                    // Agent ID
  project: string;               // Project name
  lastSession: {                 // Most recent session summary
    date: string;                // ISO timestamp
    sessionId: string;           // Session identifier
    summary: string;             // What was done
    filesReviewed?: string[];    // Files the agent looked at
    symbolsTouched?: string[];   // Symbols the agent worked on
    decisions?: string[];        // Decisions made in the session
  };
  pendingWork: string[];         // Items deferred to next session
  recentPatterns: string[];      // Patterns learned about this project
  sessionsOnProject: number;     // Total session count
  lastPurposeUpdate?: string;    // When .purpose was last updated
}
```

The `lastSession` field is the most valuable for continuity. When the agent is invoked in the next session, `buildProfileEnrichment()` injects this into the prompt:

```markdown
## Your Recent Work on This Project
Last session (3h ago): Reviewed auth middleware, found 2 missing gate
declarations for POST /api/payments and PUT /api/subscriptions.
Sessions on this project: 8
**Pending from last session:**
- Review the new webhook endpoint for gate coverage
- Check Sentinel for auth anomalies on the payment routes
**Project patterns you've learned:**
- This project uses sliding-window JWT rotation
- RLS policies follow the tenant-scoped pattern
```

The agent now has context. It knows what it did last time, what remains unfinished, and what project-specific patterns it has discovered. It does not re-review files it already checked. It picks up the pending items and continues where it left off.

## Pending Work Tracking

The `pendingWork` array is a simple but powerful mechanism. When an agent encounters work it cannot complete in the current session, it adds items:

```typescript
addPendingWork('security', rootDir, [
  'Review webhook endpoint /api/webhooks/stripe for gate coverage',
  'Check Sentinel for auth anomalies on payment routes',
]);
```

When the work is completed in a future session:

```typescript
completePendingWork('security', rootDir, [
  'Review webhook endpoint /api/webhooks/stripe for gate coverage',
]);
```

Pending items accumulate across sessions until explicitly completed. This creates a persistent to-do list that survives session boundaries. If the security agent defers 3 items across 3 different sessions, all 3 appear in the next session's prompt enrichment.

## Recent Patterns

The `recentPatterns` array captures project-specific knowledge:

```typescript
addProjectPattern('security', rootDir,
  'This project uses Supabase RLS with tenant-scoped policies'
);
```

Patterns are kept to a maximum of 10 (oldest are dropped when new ones are added). These are different from transferable patterns in the `.agent` file — recent patterns are project-specific and do not travel. The security agent learning "this project uses tenant-scoped RLS" is only relevant to this project. The transferable pattern "always check RLS policies on Supabase tables" applies everywhere.

## Global State: GlobalAgentState

Global state lives at `~/.paradigm/agents/{agent-id}/state.yaml` and tracks the agent's career across all projects:

```typescript
interface GlobalAgentState {
  id: string;                    // Agent ID
  totalSessions: number;         // Lifetime session count
  lastActiveProject: string;     // Most recent project
  lastActiveDate: string;        // ISO timestamp
  projectHistory: Array<{        // Per-project stats
    project: string;
    sessions: number;
    lastActive: string;
  }>;
}
```

Global state provides aggregate context: "This agent has worked 47 sessions across 5 projects, most recently on dealoracle 2 hours ago." This is useful for:

- **Expertise calibration** — An agent with 47 total sessions has more experience than one with 3.
- **Project affinity** — An agent with 30 sessions on project A and 2 on project B has deep expertise on A.
- **Recency** — An agent that was last active 3 months ago may need a full onboarding pass.

Global state is updated automatically whenever `recordAgentSession()` is called — it increments `totalSessions`, updates `lastActiveProject` and `lastActiveDate`, and maintains the `projectHistory` array sorted by most recent.

## How State Feeds Into Prompts

The `buildProfileEnrichment()` function accepts an optional `agentState` parameter:

```typescript
buildProfileEnrichment(
  profile,
  relevantSymbols,
  notebookEntries,
  ambientContext,
  agentState: {
    lastSession: { summary: '...', date: '...' },
    pendingWork: ['...'],
    recentPatterns: ['...'],
    sessionsOnProject: 8
  }
);
```

The function assembles this into a `## Your Recent Work on This Project` section with:

1. **Last session summary with age** — "Last session (3h ago): Reviewed auth middleware..." The age is computed from the timestamp and displayed as hours or days.
2. **Session count** — "Sessions on this project: 8" (context for experience level)
3. **Pending work** — Up to 5 items from the pending work list.
4. **Project patterns** — Up to 5 recently learned patterns.

This section typically consumes 100-300 tokens depending on the amount of pending work and patterns. It is one of the highest-value sections in the prompt because it provides the specific, recent context that enables continuity.

## Recording Sessions

At the end of an orchestration pass, the orchestrator calls `recordAgentSession()` for each agent that participated:

```typescript
recordAgentSession('security', rootDir, {
  sessionId: 'sess-2026-03-24-001',
  summary: 'Reviewed 5 new routes for gate coverage. Found 2 gaps.',
  filesReviewed: ['src/routes/payments.ts', 'src/routes/webhooks.ts'],
  symbolsTouched: ['^authenticated', '^payment-owner', '#payment-service'],
  decisions: ['Recommended adding ^payment-owner gate for refund endpoints'],
  pendingWork: ['Review webhook endpoint for Stripe signature verification'],
  patterns: ['This project stores Stripe webhook secrets in Supabase vault'],
});
```

This writes the project state file, increments the session count, and also updates global state. The next time the security agent is invoked on this project, it will see this session's summary and pending work in its prompt.

## Loading All States

The `loadAllAgentStates()` function reads all agent state files for a project, returning an array of `AgentProjectState` objects. This is useful for:

- **Dashboard views** — Conductor's agent roster view shows each agent's last session and pending work count.
- **Orchestration planning** — The orchestrator can check which agents have pending work on the current project and prioritize their inclusion.
- **Stale detection** — If an agent's last session was months ago, the orchestrator may trigger a fresh onboarding pass.
