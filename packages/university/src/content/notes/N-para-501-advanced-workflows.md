---
id: N-para-501-advanced-workflows
title: The Complete Workflow
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-501
  - five-phase-workflow-preflight
  - session-recovery-provides
  - post-write-hook-tracks
symbols: []
difficulty: beginner
estimatedMinutes: 5
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-501.json
---

## Putting It All Together

You have learned the five advanced systems individually. Now let's see how they work together in a complete development workflow. Every system has a role, and the handoffs between them create a feedback loop that gets smarter with every session.

## The Full Cycle

Here is the complete Paradigm workflow for a non-trivial task:

### Phase 1: Preflight

```
1. paradigm_session_recover       → Load previous session context
2. paradigm_pm_preflight           → Get compliance plan for the task
3. paradigm_habits_check(preflight) → Verify discovery habits are followed
4. paradigm_ripple                 → Check impact of planned changes
5. paradigm_wisdom_context         → Get team knowledge for affected symbols
6. paradigm_practice_context       → Get habit-aware warnings for symbols
7. paradigm_session_checkpoint(planning) → Save plan before coding
```

Notice the layering: session recovery provides continuity, preflight ensures preparation, habits check enforces discovery discipline, ripple and wisdom provide context, practice context adds behavioral awareness, and the checkpoint enables crash recovery.

### Phase 2: Implementation

```
8. Write code                      → Implement the feature
   → Post-write hook fires         → Tracks edited files in .pending-review
   → Post-write advisory           → Reminds about .purpose coverage
9. Update .purpose files           → Document new/changed symbols
10. Update portal.yaml             → Add routes and gates (if applicable)
11. paradigm_session_checkpoint(implementing) → Save progress
```

The post-write hook acts as a running tally. Every source file edit is tracked, and periodic reminders keep documentation top of mind. Updating .purpose and portal.yaml during implementation (not after) prevents the stop hook from blocking at the end.

### Phase 3: Validation

```
12. paradigm_flow_check          → Verify flows are complete
13. paradigm_aspect_check           → Verify aspect anchors are valid
14. paradigm_pm_postflight          → Run post-implementation governance
15. paradigm_habits_check(postflight) → Verify documentation/testing habits
16. paradigm_session_checkpoint(validating) → Save pre-test state
```

Validation catches issues before they become stop hook violations. Flow validation ensures multi-step processes are complete. Aspect checks confirm anchors point to real code. Postflight governance catches missing .purpose files and undefined gates.

### Phase 4: Recording

```
17. paradigm_lore_record            → Record the session's work
18. paradigm_history_record         → Log implementation to symbol history
19. paradigm_reindex                → Rebuild the symbol index
20. paradigm_session_checkpoint(complete) → Mark task complete
```

Recording preserves institutional knowledge. The lore entry captures what was done and why. History record logs implementation details to individual symbol timelines. Reindexing ensures the symbol index reflects all changes.

### Phase 5: Commit

```
21. git commit                      → Commit changes
    → Pre-commit hook fires         → Auto-rebuilds index, stages updated files
    → Stop hook fires               → Validates all compliance checks
22. If stop hook blocks             → Fix violations, re-attempt
23. If stop hook passes             → Session complete
```

The commit phase is where enforcement happens. The pre-commit hook ensures the index is fresh. The stop hook validates everything: .purpose coverage, portal.yaml compliance, aspect anchors, lore recording, and pending review freshness.

## How Systems Reinforce Each Other

The power of the complete workflow is in the feedback loops:

**Sentinel catches what Habits miss.** If an agent skips the `ripple-before-modify` habit and introduces a breaking change, Sentinel records the incident. The practice profile then shows that skipping ripple correlates with incidents — evidence to upgrade the habit severity.

**Lore preserves what Sessions forget.** Session breadcrumbs and checkpoints are ephemeral — they expire after 7 days. Lore entries are permanent. The checkpoint gets you through a crash; the lore entry gets the team through the next 6 months.

**Wisdom surfaces what Lore accumulates.** Lore entries record individual sessions. Wisdom distills patterns across sessions: "every time we modify #payment-service, check for null references on the refund object." Wisdom is lore, refined.

**Hooks enforce what Habits recommend.** Habits at `advisory` severity are suggestions. The stop hook at `block` severity is enforcement. The workflow starts with advice (habits check) and ends with enforcement (stop hook). This graduated approach teaches good behavior before punishing bad behavior.

## Capstone Scenario

Imagine you are adding a refund endpoint to a payment system. Here is how the complete workflow plays out:

1. **Session recover** reveals the previous session added the payment processor but did not add refunds
2. **Preflight** shows you need to check `#payment-service`, `$checkout-flow`, and `^authenticated`
3. **Habits check** confirms you called ripple and wisdom — discovery habits followed
4. **Ripple** shows `#payment-service` has 4 downstream dependents
5. **Wisdom** warns: "always null-check refund objects — see incident INC-042"
6. You implement the refund endpoint with proper null checks
7. **Post-write hook** tracks 5 edited files in `.pending-review`
8. You update .purpose with `#refund-handler` and portal.yaml with `^refund-eligible` gate
9. **Postflight** confirms all gates are declared and flows are valid
10. **Lore record** captures the session with the decision to require `^refund-eligible`
11. **Commit** triggers pre-commit (index rebuild) and stop hook (all checks pass)
12. Three weeks later, a similar null reference hits — **Sentinel** matches pattern `payment-null-ref-001` and resolves it in 5 minutes using the recorded fix

This is Paradigm at full power: every system contributing, every session building on the last, every incident making the next resolution faster.
