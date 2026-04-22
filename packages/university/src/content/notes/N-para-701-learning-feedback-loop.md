---
id: N-para-701-learning-feedback-loop
title: 'Lesson 9: The Learning Feedback Loop'
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-701
  - session-work-log
  - auto-expertise-adjustment-003
  - teacher-model-runs
symbols: []
difficulty: beginner
estimatedMinutes: 6
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-701.json
---

## The Full Loop: DO-RECORD-ASSESS-LEARN-ADAPT-DO

PARA 601 introduced the six-phase learning loop. In the context of the agent system, this loop operates at the agent level: each agent does work, records its contributions, receives verdicts, learns from the feedback, and adapts its behavior for the next session. The agent system provides the concrete mechanisms that make each phase work.

## Phase 1: DO — Agent Work

Agents perform work during orchestration. The builder writes code. The security agent reviews gates. The designer proposes UI patterns. Each contribution is captured in the session work log as an `agent-contribution` entry:

```typescript
interface SessionWorkEntry {
  timestamp: string;
  type: 'agent-contribution' | 'user-verdict' | 'decision';
  agent?: string;
  contribution?: string;
  attribution?: string;
  symbols?: string[];
}
```

The session work log is stored at `.paradigm/events/session-log.jsonl` as append-only JSONL, bounded to 200 entries per session. Unlike breadcrumbs (which are recovery-focused with a 50-entry limit), the session work log captures rich context specifically for the learning pass.

## Phase 2: RECORD — Verdict Capture

When a human accepts, dismisses, or revises an agent's contribution, the verdict is recorded:

```typescript
{
  type: 'user-verdict',
  agent: 'security',
  nominationId: 'nom-2026-03-24-001',
  verdict: 'accepted' | 'dismissed' | 'revised' | 'deferred',
  reason: 'Gate coverage recommendation was accurate',
  symbols: ['^authenticated', '#payment-service'],
  revisionDelta?: '...',  // What the human changed (for revised)
}
```

Four verdict types capture the full range of human feedback:

- **accepted** — The contribution was correct and applied as-is.
- **dismissed** — The contribution was wrong or irrelevant.
- **revised** — The contribution was partially correct; the human modified it. The `revisionDelta` captures what changed.
- **deferred** — The contribution may be valid but is not relevant now.

Each verdict is linked to the agent and the symbols involved, enabling per-symbol confidence tracking.

## Phase 3: ASSESS — Auto-Expertise Adjustment

When a verdict is recorded, the session work log automatically adjusts the agent's expertise confidence:

```typescript
const delta = entry.verdict === 'accepted' ? 0.03
  : entry.verdict === 'dismissed' ? -0.02
  : entry.verdict === 'revised' ? -0.01
  : 0; // deferred = no change
```

This adjustment is asymmetric by design:

- **+0.03 for accepted** — Positive reinforcement is slightly stronger than negative. This prevents a single bad review from tanking an otherwise reliable agent.
- **-0.02 for dismissed** — A dismissed contribution means the agent was wrong. Confidence should decrease, but not catastrophically.
- **-0.01 for revised** — A revised contribution was partially right. The penalty is smaller because the agent was in the right direction.
- **0 for deferred** — Deferral says nothing about correctness, only timing. No confidence change.

The adjustment is applied per-symbol. If the security agent's gate recommendation for `^authenticated` was accepted, its confidence on `^authenticated` increases by 0.03. Its confidence on unrelated symbols is unchanged.

```typescript
for (const symbol of entry.symbols!) {
  const exp = profile.expertise!.find(e => e.symbol === symbol);
  if (exp) {
    exp.confidence = Math.max(0, Math.min(1, exp.confidence + delta));
    exp.sessions = (exp.sessions || 0) + 1;
    exp.lastTouch = new Date().toISOString();
  }
}
```

Confidence is clamped to `[0.0, 1.0]`. Sessions are incremented. The `lastTouch` timestamp is updated. This all happens as a fire-and-forget side effect of recording the verdict — the human never manually adjusts expertise scores.

## Phase 4: LEARN — Teacher Model and Journal Entries

At the end of an orchestration session, the Teacher Model runs a postflight learning pass. It reads the session work log, identifies patterns in the verdicts, and writes journal entries for each agent that participated:

```yaml
# Learning journal entry written by Teacher Model
id: LJ-2026-03-24-001
agent: security
timestamp: '2026-03-24T16:00:00.000Z'
trigger: human_feedback
insight: >-
  Security review of webhook endpoints should check for Stripe
  signature verification, not just gate coverage. The human revised
  the gate recommendation to include webhook-specific checks.
project: dealoracle
transferable: true
confidence_before: 0.85
confidence_after: 0.84
pattern:
  id: webhook-stripe-signature
  applies_when: Reviewing webhook endpoints that receive Stripe events
  correct_approach: Check for webhook signature verification in addition to gate coverage
```

The Teacher Model synthesizes verdict patterns into actionable journal entries. A single "revised" verdict becomes an insight about what the agent should do differently. The `trigger: human_feedback` records that this learning came from a human correction, not self-reflection.

## Phase 5: ADAPT — Journal Promotion to Notebooks

Journal entries that prove valuable over time are promoted into notebook entries by Sensei (trainer). The promotion pipeline:

```
Journal entry (agent-private) → Sensei reviews → 
promoteFromLore() → Notebook entry (reusable snippet) → 
buildProfileEnrichment() → Injected into future prompts
```

The key distinction: journal entries are raw learnings ("I was wrong about X because Y"). Notebook entries are distilled knowledge ("When doing X, use this pattern"). Sensei's job is to transform the former into the latter.

Not every journal entry becomes a notebook entry. Sensei evaluates:
- Is the insight transferable to other projects?
- Is it actionable (specific enough to apply)?
- Has the same insight appeared in multiple sessions (pattern confirmation)?
- Is the confidence high enough to be reliable?

## Phase 6: The Nomination Engine

The nomination engine connects the learning loop to real-time project activity. As events flow through the event stream, each active agent scores them against their attention patterns:

```
Event (file-modified, gate-added, etc.)
  ↓
scoreEventForAgent(event, agentId, attention)
  ↓
AttentionScore { score, shouldNominate, breakdown }
  ↓
If shouldNominate → Create nomination
  ↓
Nomination surfaced in orchestration or paradigm_ambient_nominations
```

The nomination engine is the adaptive component: as an agent's attention patterns evolve (new concepts, adjusted thresholds), its nominations change. As its expertise confidence adjusts, its contributions become more or less influential. The system adapts based on empirical performance, not fixed rules.

## The Complete Cycle

Putting all six phases together for a single agent:

```
1. DO:     Security agent reviews webhook endpoint, flags missing gate
2. RECORD: Human accepts the gate recommendation → verdict: accepted
3. ASSESS: Security confidence on ^authenticated: 0.85 → 0.88 (+0.03)
4. LEARN:  Teacher Model writes journal entry about webhook gate patterns
5. ADAPT:  Sensei promotes journal → notebook entry for webhook security
6. DO:     Next session, security agent starts with webhook pattern in
           its prompt via buildProfileEnrichment(). It applies the pattern
           without needing to rediscover it.
```

Each iteration through the loop makes the agent incrementally better. After 10 sessions with consistent feedback, the security agent's webhook review pattern is battle-tested, high-confidence, and automatically injected into every relevant orchestration. The human no longer needs to remind the agent about webhook-specific checks — the learning loop closed.

## What Makes This Different

Most AI systems have observation without adaptation. They log what happened but do not feed it back. Paradigm's agent system closes the loop through four mechanisms:

1. **Per-symbol expertise tracking** — Confidence adjusts based on verdicts, not manual scoring
2. **Asymmetric reinforcement** — +0.03/-0.02/-0.01 prevents a single bad session from destroying confidence
3. **Teacher Model postflight** — Journal entries are written automatically, not relying on agents to self-reflect
4. **Notebook promotion** — Insights become reusable patterns via Sensei, surfaced through buildProfileEnrichment()
