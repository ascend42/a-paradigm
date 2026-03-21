# Maestro Learning Spec — The Teacher Model

> **Status:** Implemented (v5.5.0)
> **Author:** ascend + Claude
> **Date:** 2026-03-21
> **Depends on:** Maestro Phase 1-5 (v5.4.0), Knowledge Streams, Agent Profiles

## Problem Statement

The ambient nomination pipeline generates nominations mechanically from thin events (`file-modified` → path only). This produces:

- **Generic briefs**: "review for consistency" regardless of actual change content
- **Flat scoring**: all builders 0.7, all others 0.5 — no differentiation
- **Self-silencing loop**: bad briefs → dismissed → threshold rises → agent goes quiet
- **No content awareness**: the pipeline never sees what actually changed

Field test results (deus-backend, 2026-03-21):
- Builder: 71% dismiss rate, threshold 0.70→0.75 (correct direction, wrong cause)
- Security: 0% accept rate despite auth/e2ee file changes (blind to content)
- Architect: 80% dismiss rate, generic compliance warnings only
- Reviewer: fully silent

**Root cause:** The nomination engine tries to learn from the bottom up with no context. The events are thin, the briefs are templates, and the threshold is a single number per agent with no semantic dimension.

## Solution: Maestro as Teacher

Maestro has what the nomination engine never will: **full session context**. It sees the actual code changes, the user's reactions, the reasoning behind acceptance/rejection, and the relationship between agent contributions and outcomes.

Instead of relying on the mechanical nomination → engage → threshold pipeline for learning quality, Maestro actively observes the session and writes meaningful feedback to agent knowledge stores.

### Analogy

A teacher in a classroom doesn't just count right/wrong answers and adjust difficulty. They:
1. Watch each student work
2. Understand *why* an answer was wrong
3. Give targeted feedback ("you missed the rate limiting pattern, not the auth check")
4. Record what each student needs to learn
5. Adjust future lessons based on accumulated understanding

Maestro does the same for agents.

## Architecture

### Current Flow (Bottom-Up, Context-Free)

```
Hook fires → thin event → flat score → template brief → user dismisses → threshold +0.05
```

### New Flow (Top-Down, Context-Rich)

```
Session runs
  ↓
Maestro observes (via session work log):
  - What files were modified and what changed
  - Which agents were consulted (orchestration)
  - What each agent recommended
  - What the user accepted / rejected / revised
  - Why (from user's feedback, revisions, or conversation)
  ↓
Maestro writes learning records:
  - Journal entry per agent: specific, contextual insight
  - Work log entry: what happened this session
  - Decision record: if a non-obvious choice was made
  ↓
Postflight promotes:
  - High-confidence journal entries → notebook
  - Notebook entries appear in future buildProfileEnrichment()
  ↓
Next session:
  - Agent spawns with notebook knowledge in context
  - "When auth files change, look for: audit logging, rate limiting, token rotation"
  - Not "review for consistency"
```

### The Session Work Log

Each Claude Code session maintains a **running work log** — a structured record of what's happening that Maestro can cross-reference when writing agent feedback.

```typescript
interface SessionWorkLog {
  sessionId: string;
  startedAt: string;

  // Accumulated during session
  entries: SessionWorkEntry[];
}

interface SessionWorkEntry {
  timestamp: string;
  type: 'file-change' | 'agent-contribution' | 'user-feedback' | 'decision' | 'tool-call';

  // File changes
  file?: string;
  changeType?: 'created' | 'modified' | 'deleted';
  changeSummary?: string;       // "Added rate limiting middleware before auth gate"
  symbolsTouched?: string[];

  // Agent contributions (from orchestration)
  agent?: string;
  contribution?: string;        // What the agent said/recommended
  attribution?: string;         // "[architect] ..."

  // User feedback (from accept/reject/revise)
  accepted?: boolean;
  revised?: boolean;
  dismissReason?: string;       // Why the user rejected this
  revisionDelta?: string;       // What the user changed from the agent's recommendation

  // Contextual
  symbols?: string[];
  relatedFiles?: string[];
}
```

**Who writes to it:**
- `paradigm_orchestrate_inline` (execute mode) → logs agent contributions
- Post-write hook → logs file changes with symbol context
- `paradigm_ambient_engage` → logs accept/dismiss with reason
- Maestro (the active session) → logs user revisions and decisions

**Who reads it:**
- Maestro at postflight → cross-references to write targeted journal entries
- `paradigm_ambient_neverland` → reads for per-session metrics
- Handoff → includes in handoff summary

### Maestro's Postflight Learning Pass

At postflight (or session end), Maestro reads the session work log and writes agent feedback:

**For each agent that contributed:**

1. **Scan work log** for that agent's contributions and the user's response
2. **If accepted:** Write journal entry with trigger `human_feedback`:
   - "User accepted rate limiting recommendation for #api-routes. Pattern: middleware ordering (limiter → auth → handler) confirmed as correct approach for this project."
   - Confidence: 0.85 (high — user accepted)
   - Transferable: true (pattern applies across projects)
3. **If dismissed:** Write journal entry with trigger `correction_received`:
   - "User dismissed compliance warning for auth/login.ts — the change was adding audit logging, not a vulnerability. Security briefs should distinguish between security-positive changes (audit, logging, monitoring) and actual vulnerabilities."
   - Confidence: 0.4 (low — correction needed)
   - Pattern: `{ applies_when: "auth file modified with logging changes", correct_approach: "recognize security-positive changes, don't flag as violations" }`
4. **If revised:** Write journal entry with trigger `correction_received`:
   - "User accepted architect's proposal but moved the rate limiter after auth, not before. Reason: rate limiting unauthenticated requests wastes compute on invalid tokens."
   - Include the delta between what agent said and what user did
5. **Update expertise scores** for symbols the agent touched this session

**For the overall session:**
- Record a work log entry summarizing what all agents contributed
- If any non-obvious decisions were made, record team decisions

### Notebook Promotion

The existing `autoPromoteJournalEntries` pipeline handles promotion:

- Journal entries with `confidence_after >= 0.8` and trigger `pattern_discovered` or `human_feedback` get promoted
- Promoted entries become notebook entries with `context`, `snippet`, `concepts`
- `buildProfileEnrichment` injects relevant notebook entries into agent prompts

**New:** Maestro-written journal entries with `human_feedback` trigger and high confidence should be prime promotion candidates. The pattern field makes them actionable:

```yaml
# In security agent's notebook after promotion:
- context: "auth file changes"
  snippet: |
    When auth-related files are modified, distinguish between:
    - Security-positive changes (audit logging, monitoring, rate limiting) → acknowledge, don't flag
    - Actual vulnerabilities (hardcoded secrets, missing validation, auth bypass) → flag with specific concern
  concepts: [auth, security-positive, audit-logging, false-positive-avoidance]
```

Next time security is spawned for auth-related work, this knowledge is in its context.

### Scoring Implications

The current flat scoring problem resolves naturally:

1. **Short term:** Maestro's journal entries teach agents what to look for → better briefs when agents nominate
2. **Medium term:** Notebook entries give agents domain-specific knowledge → nominations become contextual
3. **Long term:** Per-symbol expertise scores (already tracked) become meaningful because they're updated by Maestro based on actual outcomes, not just "file was touched"

The nomination engine's `generateBrief` doesn't need to become content-aware itself. Instead, agents that have notebook knowledge will produce better nominations because they *understand* what they're looking at.

### What Changes vs What Stays

| Component | Current | Change |
|-----------|---------|--------|
| Event pipeline | Thin events from hooks | **No change** — events are triggers, not knowledge |
| Nomination engine | Scores + generates briefs | **No change** — still handles "should agent speak up?" |
| `generateBrief` | Template from path + role | **No change short term** — quality comes from notebooks, not templates |
| Threshold adjustment | Per-agent single number | **No change** — still useful for noise control |
| Session work log | Doesn't exist | **NEW** — running record of session activity |
| Postflight learning | Runs ambient_learn + promote | **ENHANCED** — Maestro writes targeted journal entries from work log |
| Journal entries | Agent self-records | **ENHANCED** — Maestro writes on behalf of agents with full context |
| Notebook promotion | Auto-promotes high-confidence | **No change** — Maestro's entries flow through same pipeline |
| `buildProfileEnrichment` | Injects notebooks + decisions | **No change** — richer notebooks = richer context |

### Stale Nomination Fix

Separate from the Maestro learning model, pending nominations older than 7 days should auto-expire. This prevents old stale nominations from diluting engagement ratios and blocking threshold adjustment.

```typescript
// In loadNominations or getNominationStats:
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
nominations = nominations.filter(n =>
  n.engaged || (Date.now() - new Date(n.timestamp).getTime() < STALE_THRESHOLD_MS)
);
```

## Implementation Phases

### Phase 0: Session Work Log (Infrastructure)
- `SessionWorkLog` type + `session-work-log.ts` loader
- Write entries from orchestration, post-write hook, ambient engage
- Read entries at postflight
- Storage: `.paradigm/events/session-log.jsonl` (bounded, per-session)

### Phase 1: Maestro Postflight Learning Pass
- Update postflight skill to read session work log
- Write agent journal entries with `human_feedback` / `correction_received` triggers
- Include pattern extraction for dismissed/revised contributions
- Update expertise scores from actual outcomes

### Phase 2: Stale Nomination Expiry
- Auto-expire pending nominations > 7 days in `loadNominations`
- Filter stale from `getNominationStats` engagement calculations

### Phase 3: Validation
- Run Neverland metrics before/after across 5+ sessions
- Track notebook growth per agent
- Track brief quality improvement (qualitative)
- Verify threshold drift stabilizes as agents accumulate knowledge

## Token Budget

| Activity | Cost |
|----------|------|
| Session work log writes | ~0 (file I/O) |
| Postflight work log read | ~500 tokens (one-time scan) |
| Journal entry writes per agent | ~200 tokens × N agents |
| Notebook promotion | ~0 (existing pipeline) |
| Total per session (3 agents) | ~1,100 tokens |

## Success Criteria

1. After 5 sessions: agents have 3+ notebook entries with project-specific patterns
2. After 10 sessions: security agent distinguishes security-positive from vulnerability changes
3. Nomination briefs improve qualitatively (agent knowledge → better nominations)
4. Neverland health status progresses: cold-start → accumulating → calibrating → mature
5. User dismiss rate decreases as agents accumulate relevant knowledge
6. No increase in per-session token cost (work log is file I/O, not MCP calls)
