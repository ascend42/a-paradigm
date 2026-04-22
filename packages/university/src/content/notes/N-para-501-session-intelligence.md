---
id: N-para-501-session-intelligence
title: Session Intelligence
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-501
  - four-checkpoint-phases
  - breadcrumbs-auto-track-every
  - paradigmsessionrecover-restores-last
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-501.json
---

## The Session Problem

AI agent sessions are ephemeral. When a session ends — whether by completion, crash, context exhaustion, or human interruption — everything the agent knew vanishes. The next session starts blank, with no memory of what was explored, decided, or partially implemented. Session Intelligence solves this with checkpoints, breadcrumbs, and a global brain that persists knowledge across sessions and even across projects.

## Session Checkpoints

Checkpoints are deliberate snapshots saved at phase transitions. There are four phases:

| Phase | When to Checkpoint | What to Capture |
|---|---|---|
| `planning` | After reading requirements, before coding | Plan, approach, key decisions |
| `implementing` | After starting code changes | Modified files, symbols touched, decisions made |
| `validating` | After implementation, before tests | All modified files, test plan |
| `complete` | Task finished | Summary, final file list |

Create a checkpoint with `paradigm_session_checkpoint`:

```
paradigm_session_checkpoint({
  phase: "implementing",
  context: "Adding JWT auth middleware — RS256 signing, httpOnly refresh tokens",
  modifiedFiles: ["src/middleware/auth.ts", "src/handlers/refresh.ts"],
  symbolsTouched: ["#auth-middleware", "^authenticated"],
  decisions: ["RS256 over HS256 for public key verification"]
})
```

Only `phase` and `context` are required — everything else is optional. The context field should be a concise 1-3 sentence summary of your current state of mind. Think of it as answering "if I were teleported into this session right now, what would I need to know?"

Checkpoints are stored in `.paradigm/session-checkpoint.json` and auto-expire after 7 days.

## Breadcrumb Tracking

While checkpoints are deliberate, breadcrumbs are automatic. Every MCP tool call generates a breadcrumb recording the timestamp, tool name, symbol being modified (if applicable), and a human-readable summary. Breadcrumbs are stored in `.paradigm/session-breadcrumbs.json` with a maximum of 50 entries (auto-rotating — oldest dropped when full).

Breadcrumbs capture the narrative of a session: "searched for payment symbols → checked ripple on #payment-service → read auth middleware → modified #auth-handler → created ^refund-eligible gate." This trail lets the next session understand not just what was done but the reasoning path.

## Session Recovery

Recovery is the payoff. Call `paradigm_session_recover` (or let it happen automatically — recovery data is surfaced on your first Paradigm tool call in a new session) to get:

- **breadcrumbs** — The last session's tool call trail
- **lastCheckpoint** — The most recent checkpoint with phase, context, and details
- **symbolsModified** — All symbols that were changed
- **recentActivity** — A human-readable summary of what happened

This is crash recovery for AI agents. If a session dies at 87% context with half-finished auth middleware, the next session immediately knows: phase was `implementing`, auth middleware was being added, RS256 was chosen, these files were modified, and tests still need to be written.

## The Global Brain

Session Intelligence extends beyond individual projects through the Global Brain at `~/.paradigm/`. This user-level directory stores:

- **Global wisdom** — Antipatterns and decisions that apply everywhere (e.g., "never use HS256 for JWT signing in production")
- **Global habits** — Behavioral overrides that apply to all projects
- **Cross-project practice events** — Compliance data aggregated across projects

The distinction between project scope and global scope is important:

| Scope | Location | Applies To | Example |
|---|---|---|---|
| Project | `.paradigm/` | This project only | "Use Redis for caching in this app" |
| Global | `~/.paradigm/` | All projects | "Always check fragility before modifying critical symbols" |

## Wisdom Promotion

When a project-local wisdom entry proves universally valuable, promote it to global scope with `paradigm_wisdom_promote`. This copies the entry from `.paradigm/wisdom/` to `~/.paradigm/wisdom/`, making it available in every project.

For example, if a team discovers that "always wrap Express v5 async middleware in try-catch" prevents errors across multiple projects, promoting this wisdom means every future project session gets this advice automatically when touching Express middleware.

## Handoff Persistence

When context usage exceeds 80-85%, `paradigm_session_health` recommends a handoff. `paradigm_handoff_prepare` creates a structured handoff document with: summary of work done, modified files, symbols touched, next steps, and open questions. This document is stored alongside session data so the receiving session can `paradigm_session_recover` and pick up exactly where the previous session left off.

The handoff is not just a note — it is a contract between sessions. The outgoing session declares what was done and what remains. The incoming session validates against the actual file state and continues.

## Best Practices

- Checkpoint at every phase transition — the cost is ~100 tokens, the value is crash recovery
- Write `context` as if briefing a stranger with no prior knowledge
- Promote wisdom that survives 3+ projects to global scope
- Use handoffs proactively at 80% context, not reactively at 95%
- Let breadcrumbs accumulate naturally — don't try to manage them manually
