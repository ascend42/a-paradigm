---
id: N-para-601-maestro-team-collab
title: 'Maestro: Visible Team Orchestration'
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-601
  - maestro-is-a
  - attributed-responses-nickname
  - agent-profiles-carry
symbols: []
difficulty: beginner
estimatedMinutes: 6
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-601.json
---

## From Synthesized Summaries to Attributed Conversations

Traditional multi-agent orchestration has a visibility problem. An orchestrator spawns three agents, waits for their responses, synthesizes a summary, and presents it to the human. The human sees one voice — the orchestrator's — and loses all nuance from individual agent perspectives. If the architect disagreed with the security agent, you would never know. If the builder had a novel approach, it gets flattened into a consensus view.

The Maestro model inverts this pattern. Every agent speaks for itself.

## The Maestro Model

Maestro is not a separate system — it is a behavior pattern for the active Claude Code session. When you ask a complex question that benefits from multiple perspectives, Maestro:

1. **Evaluates expertise** — Which agents have the highest confidence scores on the relevant symbols?
2. **Loads ambient context** — Recent team decisions, journal insights, pending nominations are injected into each agent's prompt via `buildProfileEnrichment()`.
3. **Spawns subagents** — Each agent receives its full profile: personality, expertise history, transferable patterns, notebook entries, and the ambient context.
4. **Presents attributed responses** — Each agent's response appears with a `[role]` or `[nickname (role)]` prefix. You see exactly who said what.
5. **Records to Symphony** — Each contribution is written as a Symphony message, creating a persistent team thread visible in Conductor and the Platform dashboard.
6. **Learns from feedback** — At session end, `paradigm_ambient_learn` adjusts each agent's attention threshold based on acceptance/dismissal rates.

## Agent Profiles and Nicknames

Each agent has an `.agent` YAML file in `~/.paradigm/agents/` with:

- **personality** — style (deliberate/rapid/exploratory/methodical), risk tolerance, verbosity
- **expertise** — per-symbol confidence scores, exponential moving average from lore
- **attention** — threshold, symbol/path/concept/signal subscriptions
- **collaboration** — default stance toward other agents, debate behavior
- **nomination** — urgency patterns, communication style
- **nickname** — optional display name (e.g., "George" for the architect)
- **benched** — if true, Maestro skips this agent entirely

The `nickname` field makes agents feel like team members. Terminal output shows `[George (architect)]` instead of the generic `[architect]`.

## Bench and Activate

Not every agent should speak on every task. The bench system lets you silence noisy agents:

- `paradigm agent bench security` — security agent stops nominating and is excluded from orchestration
- `paradigm agent activate security` — restore to active status
- `paradigm agent roster` — see who is active vs benched with stats

Benched agents are skipped in both `paradigm_orchestrate_inline` and the nomination engine's `processEvent`. Their profiles remain intact — bench is a pause, not a delete.

## Symphony Team Threads

Every orchestration creates a thread prefixed `thr-orch-`. Maestro writes each agent contribution as a Symphony message from the agent's identity (`{project}/{role}`). This creates:

- **Persistent record** — The team conversation survives session restarts
- **Conductor visibility** — The TeamThreadView shows messages with colored role prefixes
- **Platform dashboard** — The Team section displays the same thread in a browser
- **Recovery context** — Next session's handoff includes which agents contributed and what they said

## The Neverland Test

Named after the validation criteria in the spec, the Neverland test tracks whether agent learning actually works across sessions:

- **Sessions 1-3**: Agents accumulate — touching symbols, recording lore, discovering patterns
- **Sessions 4-5**: Maestro routes based on learned confidence scores
- **Sessions 6-10**: Accepted suggestions lower threshold (agent speaks more). Dismissed suggestions raise it (agent speaks less).

Measurable targets:
- By session 10, Maestro routes to the right agent >80% of the time
- Agent acceptance rate improves from ~50% (cold start) to >70%

Track progress with `paradigm_ambient_health` — returns per-agent stats and overall health status (cold-start → accumulating → calibrating → mature).

## Postflight Learning Loop

The postflight skill closes the feedback loop after every task:

1. **Step 8b** runs `paradigm_ambient_learn` for each contributing agent — adjusts attention thresholds based on accept/dismiss rates
2. Runs `paradigm_ambient_promote` — auto-promotes high-confidence journal patterns to the agent's notebook
3. Records contributions via Symphony if not already done during execution

This ensures every session makes agents incrementally smarter. The handoff skill captures agent performance summaries so the next session inherits this knowledge.

## The Teacher Model

The learning loop has a quality problem: the nomination engine only sees file paths, never content. Briefs like "review for consistency" get dismissed, which raises the agent's threshold, which silences the agent. The system learns to be *silent* instead of *better*.

The Teacher Model fixes this. Maestro (the active session) acts as a teacher who observes the full session and writes targeted feedback.

### Session Work Log

During each session, a running JSONL log at `.paradigm/events/session-log.jsonl` captures:
- **Agent contributions**: what each agent was asked to do (from orchestration)
- **User verdicts**: accepted / dismissed / revised, with the reason why

This is the data Maestro reads at postflight to write meaningful learning feedback.

### Postflight Learning Pass

At session end, Step 8b reads the session work log and writes journal entries per agent:

- **Accepted** → `human_feedback` trigger, confidence 0.85, extract the pattern that was confirmed correct
- **Dismissed** → `correction_received` trigger, confidence 0.4, explain what was wrong and what to do differently
- **Revised** → `correction_received` trigger, confidence 0.65, include the delta between proposal and actual

These journal entries include `pattern.applies_when` and `pattern.correct_approach` fields — the exact knowledge that gets promoted to notebooks.

### Training New Behaviors

The journal → notebook → `buildProfileEnrichment` pipeline is also how you teach agents new skills. If you say "documentor, also update CHANGELOG from now on," Maestro writes a journal entry. It promotes to a notebook entry. Next session, that knowledge is in the agent's context. No configuration needed.

## The Documentor Agent

The 6th core agent. Its sole job: maintain Paradigm metadata files after other agents finish their work.

- Always runs as the **final orchestration stage**
- Reviews what changed (git diff, session work log)
- Updates .purpose files, portal.yaml, symbol registrations
- Uses ONLY `paradigm_purpose_*`, `paradigm_portal_*`, and `paradigm_reindex` MCP tools
- Never modifies source code
- Relieves all other agents of Paradigm compliance

This separation of concerns means architect, builder, security, and reviewer can focus purely on their domain. The documentor handles the bookkeeping.
