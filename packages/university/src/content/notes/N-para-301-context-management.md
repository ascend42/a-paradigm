---
id: N-para-301-context-management
title: Context Management
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-301
  - paradigmsessionhealth-for-monitoring
  - paradigmhandoffprepare-for-session
  - paradigmsessionrecover-for-continuity
symbols: []
difficulty: beginner
estimatedMinutes: 2
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-301.json
---

## Context Management

AI agents operate within a finite context window. Every file read, every tool call response, and every message in the conversation consumes tokens from that budget. When the context fills up, the agent loses the ability to recall earlier information, make coherent plans, or maintain awareness of all the changes it has made. Paradigm provides tools to monitor, manage, and gracefully handle context limits.

**`paradigm_session_health`** monitors current context usage. Call it periodically during long sessions (every 10-15 tool calls is a good cadence) to get a recommendation. The response tells you whether to "continue" (plenty of room), "be-cautious" (usage is climbing), or "handoff-soon" (>85% consumed). You can optionally pass your estimated total tokens and context window size for more accurate assessment.

```
paradigm_session_health({
  contextWindowSize: 200000,
  estimatedTotalTokens: 150000
})
// Recommendation: "handoff-soon" -- context at ~75%, prepare handoff
```

When a handoff is needed, **`paradigm_handoff_prepare`** creates a structured summary of the current session. It captures what was done, which symbols were touched, which files were modified, what still needs to happen, and any open questions. This summary becomes the starting point for the next session.

```
paradigm_handoff_prepare({
  summary: "Implemented Apple Pay in checkout flow",
  symbolsTouched: ["#payment-service", "$checkout-flow", "#apple-pay-button"],
  modifiedFiles: ["src/services/payment.ts", "src/components/checkout/ApplePayButton.tsx"],
  nextSteps: ["Add unit tests for Apple Pay handler", "Update portal.yaml with new gates"],
  openQuestions: ["Should we support Apple Pay in the mobile app too?"]
})
```

On the receiving end, **`paradigm_session_recover`** loads breadcrumbs from the previous session. A new agent session calls this at startup to understand what was done before, pick up where the last session left off, and avoid redoing work.

For cost awareness, **`paradigm_session_stats`** shows the current session's MCP interactions, estimated token usage, and cost breakdown. This is useful for understanding which operations are expensive and optimizing your workflow.

The context management workflow forms a cycle: **monitor** usage with context_check, **prepare** handoff when limits approach, **recover** in new sessions with session_recover, and **track** costs with session_stats. Mastering this cycle means you can handle tasks that are larger than any single context window by splitting them across multiple sessions without losing progress.
