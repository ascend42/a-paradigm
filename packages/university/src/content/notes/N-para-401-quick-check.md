---
id: N-para-401-quick-check
title: 'Quick-Check: Ask Before You Build'
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-401
  - quick-check-is-a
  - two-agents-jinx
  - two-outcomes-greenlight
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-401.json
---

## The Lightweight Pre-Check

Not every task needs full orchestration with architect, security, builder, tester, and reviewer stages. Sometimes you just want to know: *is this task ready to build, or does it need more planning?*

That is what **quick-check mode** does. It runs a lightweight risk assessment (~3–4k tokens) and returns one of two verdicts:

- **GREENLIGHT** — proceed to implementation. The task is well-scoped, low-risk, and does not need multi-agent planning.
- **ESCALATE** — this needs full orchestration. The task has unaddressed risks, ambiguous requirements, or cross-cutting concerns.

### How It Works

Quick-check uses two agents:

**Jinx (advocate)** stress-tests your assumptions:
- "What if the user loses their second factor?"
- "What happens when the payment provider is down?"
- "Did you consider rate limiting on this endpoint?"

**Reviewer** checks feasibility:
- Does this touch auth, security, or shared state?
- How many files will this change?
- Are there dependencies that need updating?

Their combined assessment produces the verdict. If either agent raises concerns that cannot be resolved in a quick check, the verdict is ESCALATE.

### Usage

```
paradigm_orchestrate_inline({
  task: "Add a 'last seen' timestamp to user profiles",
  mode: "quick"
})
```

Compare with full orchestration:
```
paradigm_orchestrate_inline({
  task: "Add two-factor authentication to the login flow",
  mode: "plan"
})
```

### When to Use Quick-Check vs Full Orchestration

| Signal | Quick-Check | Full Orchestration |
|--------|-------------|-------------------|
| Single file change | Yes | Overkill |
| UI-only change (styling, layout) | Yes | Overkill |
| Touches auth or security | Depends on scope | Usually yes |
| 3+ files affected | Depends on complexity | Yes |
| New API endpoint | Depends on gates needed | Usually yes |
| Infrastructure change | No | Yes |
| Unknown scope ("make it faster") | No | Yes |

**Rule of thumb:** If you can describe the complete change in one sentence and it touches ≤2 files, quick-check is appropriate. If you find yourself saying "and also..." or "but we need to consider...", go straight to full orchestration.

### Quick-Check and Enforcement

Quick-check satisfies the `orchestration-required` enforcement check. On balanced or strict enforcement, the stop hook requires that complex tasks go through orchestration before building. A GREENLIGHT from quick-check counts — you do not need to run full orchestration after a greenlight.

However, if you get an ESCALATE verdict and proceed to build anyway, the stop hook will flag that you bypassed the recommendation. The verdict is recorded and traceable.

### Example Walkthrough

**Task:** "Add a 'forgot password' link to the login page"

**Jinx:** "Where does the reset email get sent from? Is there rate limiting on reset requests? What happens if the email is not in the system — do you reveal that?"

**Reviewer:** "This touches auth (password reset flow), requires a new API endpoint (/reset-password), involves email sending infrastructure, and needs rate limiting. Estimated: 4+ files."

**Verdict: ESCALATE** — the task looks simple but involves auth, a new endpoint, email, and rate limiting. Full orchestration with security and architect (multi-file design) is recommended.

Compare: "Change the login button color from blue to green" → **GREENLIGHT** (single CSS change, no logic, no auth).
