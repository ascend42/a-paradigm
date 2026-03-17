# Automation Tier Graduation — Specification

> **Status:** Draft
> **Author:** Claude (Opus 4.6) + Matt Canoy
> **Date:** 2026-03-17
> **Symbols:** #graduation-engine, #graduation-store, $graduation-flow, $demotion-flow, !habit-graduated, !habit-demoted, ~graduation-safety

## Problem

Paradigm has three automation tiers but no mechanism to migrate behaviors between them:

| Tier | Mechanism | Context Cost | Example |
|------|-----------|-------------|---------|
| **1 — MCP tools** | Agent calls manually | High (~100-11K tokens) | `paradigm_reindex`, `paradigm_pm_postflight` |
| **2 — Habits** | System reminds, agent acts | Medium (~200 tokens) | `ripple-before-modify`, `record-lore-for-significant` |
| **3 — Hooks** | Shell auto-fires | Zero | stop hook, pre-commit reindex, post-write tracking |

Items get stuck at whatever tier they were first built. Five stop-hook checks duplicate five habit evaluations. Agents waste ~17K tokens/session on compliance overhead that could be ~270 tokens.

## Design Principles

1. **Graduate down, never up** — behaviors move from expensive → cheap as confidence grows
2. **Data-driven** — graduation requires measured compliance, not gut feel
3. **Reversible** — hooks that start failing demote back to habits automatically
4. **Never graduate cognition** — if the agent needs to *think about* the result, it stays agent-driven
5. **Deduplicate first** — before building new graduation, mark already-graduated items

---

## Part 1: Immediate Wins (No New Code)

### 1A. Retroactive Graduation Markers

Five habits are ALREADY enforced by the stop hook. Mark them as `tier: hook` so `paradigm_habits_check` skips them:

| Stop Hook Check | Habit ID | Status |
|---|---|---|
| Check 1, 2, 5 (.purpose coverage) | `purpose-coverage` | Already a hook |
| Check 3, 11 (portal gates) | `gates-for-routes` | Already a hook |
| Check 7 (lore entry for 3+ files) | `record-lore-for-significant` | Already a hook |
| Check 8 (blocking habits) | `verify-before-done` | Partially a hook |
| Pre-commit auto-index | `postflight-compliance` (reindex portion) | Already a hook |

**Effect:** `paradigm_habits_check` responds with "5 habits enforced by hooks (zero cost). Evaluating remaining 8..." — saves ~80 tokens per evaluation.

### 1B. Eliminate Postflight/Stop-Hook Duplication

`paradigm_pm_postflight` performs 7 checks. 5 of them are identical to stop-hook checks:

| Postflight Check | Stop Hook Equivalent |
|---|---|
| Routes without portal.yaml | Check 3 |
| .purpose coverage | Check 1, 2 |
| Gate symbol validation | Check 11 |
| Aspect coverage | Check 6 |
| Habit evaluation | Check 8 |

**Action:** Update CLAUDE.md to say agents should NOT call `paradigm_pm_postflight` in Claude Code — the stop hook handles it. Keep postflight for Cursor (which has different hook timing) and CI pipelines.

### 1C. Never-Graduate List

These habits require agent cognition — a hook cannot substitute:

| Habit | Why It Can't Graduate |
|---|---|
| `explore-before-implement` | Agent must read ripple results and *reason* about them |
| `ripple-before-modify` | Same — output informs decisions |
| `check-fragility` | Agent must decide whether to proceed carefully |
| `wisdom-before-implement` | Agent must read antipatterns and apply judgment |
| `confidence-on-decisions` | Inherently cognitive (assigning a confidence score) |
| `university-onboarded` | Learning requires interpretation |
| `university-content-valid` | Validation requires interpretation |

Any habit with `check.type: tool-called` where the tool's OUTPUT matters (not just that it was called) cannot graduate.

---

## Part 2: Graduation Engine

### Data Model

```typescript
// graduation-types.ts

interface GraduationState {
  habitId: string;
  tier: 'mcp' | 'habit' | 'hook';
  previousTier: 'mcp' | 'habit' | 'hook' | null;
  graduatedAt: string | null;       // ISO timestamp
  demotedAt: string | null;         // ISO timestamp
  complianceAtGraduation: number;   // 0-100
  hookScript: string | null;        // Generated script path
  failureCount: number;             // Since graduation
  cooldownUntil: string | null;     // Cannot re-graduate until
  neverGraduate: boolean;
}

interface GraduationConfig {
  enabled: boolean;
  thresholds: {
    minComplianceRate: number;       // Default: 90
    minEvents: number;               // Default: 20
    timeWindowDays: number;          // Default: 30
    minConsecutiveSessions: number;  // Default: 5
    recencyDays: number;             // Default: 7
  };
  demotion: {
    failureThreshold: number;        // Default: 3
    failureWindowDays: number;       // Default: 7
    cooldownDays: number;            // Default: 14
  };
  neverGraduate: string[];
}
```

### Storage: `.paradigm/graduation.yaml`

```yaml
version: "1.0"
config:
  enabled: true
  thresholds:
    minComplianceRate: 90
    minEvents: 20
    timeWindowDays: 30
    minConsecutiveSessions: 5
    recencyDays: 7
  demotion:
    failureThreshold: 3
    failureWindowDays: 7
    cooldownDays: 14
  neverGraduate:
    - explore-before-implement
    - ripple-before-modify
    - check-fragility
    - wisdom-before-implement
    - confidence-on-decisions
    - university-onboarded
    - university-content-valid

states:
  purpose-coverage:
    tier: hook
    graduatedAt: "2026-03-17T00:00:00Z"
    complianceAtGraduation: 100
    hookScript: null  # Handled by paradigm-common.sh Check 1/2/5
    failureCount: 0
    neverGraduate: false
  gates-for-routes:
    tier: hook
    graduatedAt: "2026-03-17T00:00:00Z"
    complianceAtGraduation: 100
    hookScript: null  # Handled by paradigm-common.sh Check 3/11
    failureCount: 0
    neverGraduate: false
  explore-before-implement:
    tier: habit
    neverGraduate: true
```

### Graduation Thresholds

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| Compliance rate | >= 90% | High confidence behavior is established |
| Minimum events | >= 20 | Statistical significance |
| Time window | 30 days | Covers multiple sessions |
| Consecutive sessions | >= 5 | Not just one good run |
| Recency | 1+ event in last 7 days | Habit is still active |

### Eligibility Algorithm

```
for each habit where tier != 'hook' AND !neverGraduate AND !cooldownActive:
  events = queryPracticeEvents(habitId, last 30 days)
  if events.count < 20: skip (insufficient data)

  complianceRate = events.filter(followed).count / events.count
  if complianceRate < 0.90: skip (not consistent enough)

  recentEvents = events.filter(last 7 days)
  if recentEvents.isEmpty: skip (habit gone dormant)

  sessions = uniqueSessions(events)
  consecutiveFollowed = longestConsecutiveStreak(sessions)
  if consecutiveFollowed < 5: skip (not sustained)

  → ELIGIBLE for graduation
```

### Hook Templates

Each `check.type` maps to a shell script template. The graduation engine fills in parameters.

| check.type | Graduatable? | Hook Template | Trigger |
|---|---|---|---|
| `file-exists` | Yes | Check glob patterns in modified dirs | Stop |
| `file-modified` | Yes | Check if files in git diff | Stop |
| `lore-recorded` | Yes | Check `.paradigm/lore/entries/{today}/` | Stop |
| `gates-declared` | Yes | Grep routes, check portal.yaml | Stop |
| `tests-exist` | Yes | Check test file patterns | Stop |
| `git-clean` | Yes | `git status --porcelain` | Stop |
| `symbols-registered` | Yes | Check scan-index.json | Stop |
| `aspect-anchored` | Yes | Check aspect anchors | Stop |
| `commit-message-format` | Yes | Validate message regex | PreToolUse (git commit) |
| `flow-coverage` | Yes | Check flow-index.json | Stop |
| `tool-called` | **No** | Requires agent MCP session | N/A |
| `context-checked` | **No** | Requires agent action | N/A |

Generated hook script structure:
```bash
#!/bin/sh
# GRADUATED HOOK — generated by paradigm graduate
# Source habit: ${HABIT_ID}
# Graduated: ${DATE} (compliance: ${RATE}%)
# Template: ${CHECK_TYPE}
# Demotion marker: .paradigm/.graduation-failures/${HABIT_ID}

# ... check logic from template ...

if [ "$FAILED" = "true" ]; then
  # Track failure for demotion
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> ".paradigm/.graduation-failures/${HABIT_ID}"
  echo "[paradigm] Graduated check failed: ${HABIT_NAME}" >&2
  exit ${EXIT_CODE}  # 0 for advisory, 2 for block
fi
```

### Demotion

Automatic demotion when graduated hooks fail:

1. Each graduated hook writes timestamps to `.paradigm/.graduation-failures/{habit-id}`
2. Stop hook reads failure files after compliance checks
3. If failures >= 3 in 7 days → demote:
   - Update `graduation.yaml`: tier → 'habit', set `cooldownUntil` (+14 days)
   - Remove generated hook script
   - Emit `!habit-demoted`
   - Surface on next MCP tool call: "Habit X demoted from hook to habit due to failures"
4. Cool-down: 14 days before re-graduation eligible

---

## Part 3: Additional Automation Gaps

### 3A. Context Budget — Hook-Based Warnings

**Problem:** CLAUDE.md says "call `paradigm_context_check` every 10-15 tool calls" — agents waste 600-1000 tokens/session polling manually.

**Solution:** Add lightweight context estimation to the post-write hook:

```bash
# In paradigm-postwrite.sh
EDIT_COUNT=$(wc -l < ".paradigm/.pending-review" 2>/dev/null || echo 0)
if [ "$EDIT_COUNT" -ge 30 ]; then
  echo "[paradigm] ~${EDIT_COUNT} edits this session. Consider paradigm_context_check or handoff." >&2
fi
```

This is a heuristic (edit count correlates with context usage) not an exact measurement, but it's free. For exact measurement, add to stop hook:

```bash
# In paradigm-stop.sh, before compliance checks
if command -v paradigm >/dev/null 2>&1; then
  CONTEXT_JSON=$(paradigm context check --json 2>/dev/null || echo '{}')
  USAGE=$(echo "$CONTEXT_JSON" | grep -o '"usagePercent":[0-9]*' | cut -d: -f2)
  if [ -n "$USAGE" ] && [ "$USAGE" -ge 70 ]; then
    echo "[paradigm] Context usage at ~${USAGE}%. Consider preparing handoff." >&2
  fi
fi
```

### 3B. Session-Start Parity for Claude Code

**Problem:** Cursor has `sessionStart` hook with `additional_context` injection. Claude Code has no equivalent.

**Current workaround:** CLAUDE.md contains all the guidance Cursor injects dynamically. This works but is static — it can't adapt to project state.

**Proposed workaround (no Claude Code API change needed):** Use the first `PostToolUse` hook call as a pseudo-session-start. Track a `.paradigm/.session-started` marker:

```bash
# In paradigm-postwrite.sh, at top
if [ ! -f ".paradigm/.session-started" ]; then
  # First edit of session — inject one-time guidance
  echo "[paradigm] Session started. Pending: $(cat .paradigm/.pending-review 2>/dev/null | wc -l) uncovered edits from last session." >&2
  touch ".paradigm/.session-started"
fi
```

Stop hook cleans up:
```bash
rm -f ".paradigm/.session-started"
```

**Long-term:** Request `SessionStart` hook type from Anthropic's Claude Code team with `additional_context` support.

### 3C. Preflight Automation

**Problem:** `paradigm_pm_preflight` is "required" per CLAUDE.md but agents must remember to call it (~300 tokens).

**Solution:** The preflight's unique value (not duplicated by hooks) is:
1. Ripple analysis for the task's target symbols
2. Recent compliance profile
3. Task-specific habit reminders

Items 2-3 are automatable. Item 1 requires knowing *what the agent plans to modify*, which a hook can't know.

**Approach:** Split preflight into:
- **Automated portion** (hook): Recent compliance warning, purpose coverage gaps for recently-modified dirs
- **Agent-driven portion** (habit): Ripple analysis for specific symbols the agent plans to touch

The automated portion runs as a pseudo-session-start in the post-write hook (3B above). The agent-driven portion stays as a habit with `neverGraduate: true`.

### 3D. Hook Stderr Token Cost

**Finding:** Hook stderr output IS surfaced to the agent as tool results when hooks block (exit 2). Advisory output (exit 0 with stderr) appears to be shown but costs minimal tokens since it's short text, not structured MCP responses.

**Recommendation:** Keep hook stderr messages concise (1-2 lines). Avoid verbose diagnostics. The current stop hook outputs violation details only on failure — this is correct. Advisory messages should be single-line summaries.

---

## Part 4: New Infrastructure

### CLI Commands

| Command | Description |
|---------|-------------|
| `paradigm graduate check` | Analyze all habits for graduation eligibility |
| `paradigm graduate status` | Show current tier of every habit (table format) |
| `paradigm graduate promote <id>` | Force-graduate a specific habit |
| `paradigm graduate demote <id>` | Force-demote back to habit |
| `paradigm graduate install` | Install all graduated hooks into hooks.json |
| `paradigm graduate history` | Show graduation/demotion events |

### MCP Tools

| Tool | Description | Tokens |
|------|-------------|--------|
| `paradigm_graduate_check` | Check eligibility, return recommendations | ~300 |
| `paradigm_graduate_status` | Current tier map for all habits | ~200 |

### Config Addition

```yaml
# .paradigm/config.yaml
graduation:
  enabled: true
  thresholds:
    minComplianceRate: 90
    minEvents: 20
    timeWindowDays: 30
    minConsecutiveSessions: 5
    recencyDays: 7
  demotion:
    failureThreshold: 3
    failureWindowDays: 7
    cooldownDays: 14
  neverGraduate:
    - explore-before-implement
    - ripple-before-modify
    - check-fragility
    - wisdom-before-implement
    - confidence-on-decisions
    - university-onboarded
    - university-content-valid
```

---

## Part 5: File Plan

### Phase 1: Types + Retroactive (no new logic)

| File | Action | Description |
|------|--------|-------------|
| `packages/paradigm-mcp/src/utils/graduation-types.ts` | Create | Type definitions |
| `packages/paradigm-mcp/src/utils/graduation-store.ts` | Create | YAML read/write for graduation.yaml |
| `packages/paradigm-mcp/src/utils/habits-loader.ts` | Modify | Skip graduated habits in evaluation |
| `.paradigm/graduation.yaml` | Create | Seed with 5 retroactively graduated habits |

### Phase 2: Graduation Engine

| File | Action | Description |
|------|--------|-------------|
| `packages/paradigm-mcp/src/utils/graduation-engine.ts` | Create | Eligibility check, template rendering |
| `packages/paradigm/src/core/graduation/templates.ts` | Create | Hook script templates per check type |
| `packages/paradigm/src/commands/graduate/index.ts` | Create | CLI: check, status, promote, demote, install, history |
| `packages/paradigm-mcp/src/tools/graduation.ts` | Create | MCP tools: graduate_check, graduate_status |

### Phase 3: Demotion + Integration

| File | Action | Description |
|------|--------|-------------|
| `plugins/paradigm/scripts/paradigm-common.sh` | Modify | Add graduated hook failure tracking |
| `plugins/paradigm/scripts/paradigm-stop.sh` | Modify | Run demotion check, clean session marker |
| `plugins/paradigm/scripts/paradigm-postwrite.sh` | Modify | Context heuristic, pseudo-session-start |
| `packages/paradigm-mcp/src/tools/habits.ts` | Modify | Surface graduation in habits_status |
| `packages/paradigm-mcp/src/tools/pm.ts` | Modify | Note duplication in postflight output |
| `packages/paradigm/src/commands/hooks/index.ts` | Modify | Register graduated hooks during install |
| `CLAUDE.md` | Modify | Update agent guidance (skip redundant postflight) |

### Phase 4: Tests

| File | Action | Description |
|------|--------|-------------|
| `packages/paradigm-mcp/src/utils/graduation-engine.test.ts` | Create | Eligibility, template, edge cases |
| `packages/paradigm/src/commands/graduate/index.test.ts` | Create | CLI integration tests |

---

## Part 6: Token Savings Projection

### Current per-session overhead (typical Claude Code session)

| Action | Tokens | Notes |
|--------|--------|-------|
| `paradigm_reindex` (MCP) | ~11,000 | Pre-commit hook now handles this |
| `paradigm_pm_postflight` (MCP) | ~200 | Duplicates stop hook |
| `paradigm_habits_check` on-stop (MCP) | ~200 | 5/13 habits duplicate stop hook |
| `paradigm_context_check` polling (MCP) | ~600 | 6 calls × 100 tokens |
| **Total compliance overhead** | **~12,000** | |

### After graduation system

| Action | Tokens | Notes |
|--------|--------|-------|
| `paradigm_reindex` | 0 | Hook (pre-commit) |
| `paradigm_pm_postflight` | 0 | Eliminated (stop hook covers it) |
| `paradigm_habits_check` (8 remaining) | ~120 | 5 graduated habits skipped |
| `paradigm_context_check` | 0 | Hook-based heuristic |
| **Total compliance overhead** | **~120** | |

**Savings: ~11,880 tokens/session (99% reduction)**

---

## Part 7: Migration Path

### Week 1 — Retroactive Graduation (immediate wins)
- Create `graduation.yaml` with 5 pre-graduated habits
- Modify `habits-loader.ts` to skip graduated habits
- Update CLAUDE.md: remove redundant `paradigm_pm_postflight` recommendation for Claude Code
- Add context heuristic to post-write hook
- Ship `paradigm graduate status` CLI

### Week 2 — Graduation Engine
- Ship `graduation-engine.ts` with eligibility checking
- Ship hook templates for 8 graduatable check types
- Ship `paradigm graduate check` and `paradigm graduate install`
- Ship MCP tools

### Week 3 — Automatic Demotion
- Add failure tracking to `paradigm-common.sh`
- Ship demotion logic
- Ship `!habit-graduated` and `!habit-demoted` signals
- Add pseudo-session-start to post-write hook

### Week 4 — Polish
- University content: graduation lesson + PLSAT questions
- `paradigm_graduate_check` surfaced in `paradigm_pm_preflight` recommendations
- Graduation state in `paradigm_status` output
