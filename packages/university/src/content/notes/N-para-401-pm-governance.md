---
id: N-para-401-pm-governance
title: PM Governance
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-401
  - pre-flight-checks-symbols
  - post-flight-checks-registration
  - errorwarningsuggestion-severity-levels
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-401.json
---

## PM Governance

The PM (Project Manager) layer is Paradigm's enforcement mechanism that ensures orchestrated tasks follow project discipline. Without governance, agents might implement features without updating `.purpose` files, add endpoints without portal.yaml gates, or ignore team wisdom. The PM layer adds automated pre-flight and post-flight checks that catch these oversights.

### Pre-Flight Checks

Before any implementation begins, the PM runs pre-flight checks to set up the task correctly:

1. **Symbol identification** -- What symbols will this task create or modify? The PM uses `paradigm_search` and `paradigm_navigate` to identify all affected symbols.
2. **Ripple analysis** -- For each affected symbol, run `paradigm_ripple` to map the blast radius. Flag any fragile dependents.
3. **Portal requirements** -- If the task adds endpoints, run `paradigm_gates_for_route` to determine required gates. Flag if portal.yaml is missing or needs updates.
4. **Wisdom check** -- Pull relevant wisdom with `paradigm_wisdom_context` to surface antipatterns and decisions that agents should know about.
5. **Orchestration recommendation** -- Based on task complexity, recommend whether to use single-agent or multi-agent orchestration.

```
// Pre-flight output example:
{
  affectedSymbols: ["#payment-service", "$checkout-flow"],
  rippleImpact: { direct: 3, indirect: 7, fragile: ["#notification-handler"] },
  portalRequired: true,
  requiredGates: ["^authenticated", "^payment-authorized"],
  relevantWisdom: ["antipattern: api-001 (direct API calls from UI)"],
  recommendation: "multi-agent: architect + security + builder"
}
```

### Post-Flight Checks

After implementation completes, the PM verifies compliance:

1. **Purpose registration** -- Are all new components registered in `.purpose` files? Did renamed symbols get updated across all references?
2. **Portal compliance** -- Are all new endpoints listed in portal.yaml with appropriate gates? Are there unprotected routes that should be protected?
3. **Aspect anchors** -- If aspects were modified, do their anchors still point to valid code?
4. **Wisdom capture** -- Were any decisions made during implementation that should be recorded? Did any antipatterns surface?
5. **History recording** -- Was the implementation logged with `paradigm_history_record`?

The PM reports issues in categories: **errors** (must fix before proceeding), **warnings** (should fix), and **suggestions** (good practice). A clean post-flight means full compliance.

### Enabling PM Governance

In the CLI, add the `--pm` flag to orchestrate commands:

```bash
paradigm team orchestrate "Add refund endpoint" --pm
```

This wraps the orchestration with pre-flight checks before the first agent runs and post-flight checks after the last agent completes. The PM does not modify code itself -- it reviews and reports, leaving fixes to you or the agents.

PM governance is especially valuable for teams onboarding new developers or working with AI agents that do not yet have deep project familiarity. It is the safety net that ensures Paradigm metadata stays consistent with the code, regardless of who (or what) is writing that code.
