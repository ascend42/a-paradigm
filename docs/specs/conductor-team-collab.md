# Conductor Team Collaboration — The Maestro Model

> **Status:** Planning | **Priority:** P0 | **Target:** v6.0
>
> The Maestro (your active Claude Code session) orchestrates the team. Agents spawn as focused subagents, contribute visibly, and learn across sessions. Conductor is the display and approval layer.

## North Star

You ask me to add rate limiting to the messages endpoint. I know the team — architect, security, builder — and I know their expertise from prior sessions. I spawn architect and security as subagents, injecting their learned patterns and journal insights. Their responses appear as distinct messages in the thread. Architect says put the limiter before auth in the chain. Security says add a ^rate-limited gate. You see both takes, tap Approve on security's gate suggestion in Conductor. I tell builder to implement with those constraints. Builder works. Security's acceptance rate goes up. Next session, security's threshold is lower — it speaks up more readily. Architect's notebook has a new pattern: "rate limiters go before auth middleware."

## Architecture

```
┌─────────────────────────────────────┐
│  You ↔ Maestro (Claude Code)       │
│         │                           │
│         ├── spawn → Architect       │
│         │           └→ response     │
│         ├── spawn → Security        │
│         │           └→ response     │
│         ├── spawn → Builder         │
│         │           └→ implements   │
│         │                           │
│         ├── synthesize / reconcile  │
│         ├── record learning         │
│         └── update lore + journal   │
└─────────────────────────────────────┘
          │
          │ Symphony messages
          │ (agent contributions as messages)
          ▼
┌─────────────────────────────────────┐
│  Conductor.app (display layer)     │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  Team Thread (read-only)    │   │
│  │                             │   │
│  │  You: Add rate limiting     │   │
│  │  architect: Put limiter     │   │
│  │    before ^authenticated    │   │
│  │  security: Add ^rate-limited│   │
│  │    gate to portal.yaml      │   │
│  │    [Approve] [Revise]       │   │
│  │  builder: Implementing...   │   │
│  │    [View Diff] [Approve]    │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  Agent Roster               │   │
│  │  ● architect  83% accepted  │   │
│  │  ● security   75% accepted  │   │
│  │  ● builder    working       │   │
│  │  ○ tester     benched       │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

## How It Works

### The Maestro Role

The active Claude Code session (me) is always the Maestro. I:

1. **Know the roster.** On session start, I load all `.agent` profiles — personality, expertise, attention patterns, journal insights, notebook entries, collaboration stance, nomination stats.

2. **Decide who to consult.** When you ask something, I evaluate which agents have relevant expertise. I don't always spawn everyone — if it's a pure UI task, I might only spawn builder. If it touches auth, security joins automatically.

3. **Spawn with rich context.** Each subagent gets a one-shot prompt with:
   - Their `.agent` personality and collaboration stance
   - Relevant expertise entries (confidence scores, session counts)
   - Recent journal insights (transferable learnings)
   - Relevant notebook entries (proven patterns)
   - Pending nominations from ambient (if any)
   - The specific question or task

4. **Present contributions visibly.** Instead of silently synthesizing, I present each agent's response as a distinct attributed message. You see who said what.

5. **Route approvals.** When an agent proposes work, I present it for your approval. In the terminal, this is a question. In Conductor, this is a button.

6. **Record learning.** After the session:
   - Which agent contributions you accepted → raises their acceptance rate
   - Which you dismissed → raises their threshold next time
   - Patterns discovered → journal entries → notebook promotion
   - Decisions made → team decisions store

### Agent Lifecycle

```
             ┌──── Between Sessions ────┐
             │                          │
             │  .agent file persists:   │
             │  - expertise scores      │
             │  - attention patterns    │
             │  - journal entries       │
             │  - notebook patterns     │
             │  - acceptance rate       │
             │  - threshold             │
             │                          │
             └──────────┬───────────────┘
                        │
                        ▼
┌─── Session Start ────────────────────────────┐
│                                              │
│  Maestro loads all agent profiles            │
│  Recovery preamble includes pending          │
│  nominations from ambient                    │
│                                              │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌─── During Session ───────────────────────────┐
│                                              │
│  User asks something                         │
│  Maestro evaluates: who's relevant?          │
│  Spawn subagents with enriched context       │
│  Agents respond (visible in thread)          │
│  User approves / revises / discusses         │
│  Approved agent does work                    │
│  Other agents may review                     │
│                                              │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌─── Session End ──────────────────────────────┐
│                                              │
│  adjustAttentionFromFeedback per agent       │
│  autoPromoteJournalEntries                   │
│  Record lore entry                           │
│  Update expertise from symbols touched       │
│                                              │
│  Agent is smarter next session               │
│                                              │
└──────────────────────────────────────────────┘
```

### What Agents Carry Across Sessions

Each `.agent` file accumulates:

| Field | What it stores | How it's used |
|-------|---------------|---------------|
| `expertise` | Per-symbol confidence scores (EMA from lore) | Maestro routes symbol-related questions to highest-confidence agent |
| `attention.threshold` | Self-tuning relevance threshold | Higher = agent speaks less (was too noisy). Lower = speaks more (was useful) |
| `transferable` | Cross-project patterns with success rates | Injected into subagent prompt: "In project X, you learned that..." |
| `contexts[project]` | Per-project focus areas, session count | Agent knows what it's worked on in this project before |
| Journal entries | What agent learned (corrections, discoveries) | Transferable insights injected into prompt for next session |
| Notebook entries | Proven patterns promoted from journal | Curated snippets included in `buildProfileEnrichment` |
| Nomination stats | Accept/dismiss/defer rates | Drives threshold adjustment, graduation candidacy |

### The Neverland Test

Project Neverland is the validation target. For agent learning to prove itself:

1. **Cold start.** Agents begin with default expertise (0.5 confidence across the board). First session in Neverland, they have no project-specific knowledge.

2. **Session 1-3: Accumulation.** Agents touch symbols, record lore, discover patterns. Security learns that Neverland's auth uses a specific JWT pattern. Builder learns the test framework conventions. Architect learns the module boundary structure.

3. **Session 4-5: Recognition.** When a new task touches auth, the Maestro routes to security — not because it was told to, but because security has the highest confidence score on `#auth-*` symbols in this project. Security's prompt includes the JWT pattern from its notebook.

4. **Session 6-10: Calibration.** If security's gate suggestions keep getting accepted, its threshold drops — it speaks up more readily. If architect's structural observations keep getting dismissed for this project, its threshold rises. Each agent self-tunes to the project's actual needs.

5. **Cross-project transfer.** When an agent moves to a new project, transferable patterns come along. Security's "JWT middleware ordering" pattern from Neverland appears in the next project's prompt with its success rate.

**Measurable success:** By session 10, the Maestro should be routing to the right agent >80% of the time without explicit direction, and agent suggestions should have a >70% acceptance rate — up from ~50% at cold start.

## Phases

### Phase 1: Visible Team Orchestration

**What:** Make existing orchestration visible and learning-aware.

**Changes to Maestro behavior:**
- Load all `.agent` profiles at session start (via `paradigm_context_compose` or direct load)
- When spawning subagents, use `buildProfileEnrichment` with full ambient context (journal, notebook, decisions, nominations)
- Present subagent responses as attributed messages: "**architect:** ..." not a synthesized summary
- After session, run `adjustAttentionFromFeedback` and `autoPromoteJournalEntries` for each agent that contributed

**Changes to ambient tools:**
- `paradigm_context_compose` becomes the pre-spawn enrichment call
- `paradigm_ambient_learn` runs automatically at session end (or via postflight skill)
- `paradigm_ambient_promote` runs automatically at session end

**Symphony integration:**
- Maestro writes each agent's contribution as a Symphony message (from `{project}/{role}`)
- Thread captures the full team conversation for Conductor to display
- Messages persist in mailbox — visible in next session's recovery preamble

**New files:**
- None required for core behavior — this is Maestro behavioral changes via CLAUDE.md and skill prompts

**Paradigm files:**
- Update `paradigm:orchestrate` skill to inject agent profiles
- Update `paradigm:postflight` skill to run learning + promotion
- Update `paradigm:handoff` to include agent performance summary

### Phase 2: Conductor Thread View

**What:** Conductor displays the team conversation from Symphony messages.

**New Conductor views:**
- `TeamThreadView.swift` — chat-style display of Symphony thread messages
  - Agent messages with colored name + avatar
  - Human messages (from maestro) with distinct style
  - Code blocks with syntax highlighting
  - Symbol references as tappable links
  - Auto-scroll with scroll-back
- `AgentRosterView.swift` — team roster with status, acceptance rates, bench toggle

**Conductor services:**
- `SymphonyThreadWatcher.swift` — polls Symphony mailbox for new messages (lightweight — just reads JSONL, no API calls, no tokens)
- Thread selection: Conductor shows threads from the active project

**Approval flow:**
- Messages containing proposals (detected by intent or metadata) show Approve/Revise buttons
- Approve click writes a Symphony message from `conductor/maestro`: "Approved. Proceed."
- The active Claude Code session picks this up on next `paradigm_symphony_poll`

### Phase 3: Agent Roster + Bench

**What:** Full agent management in Conductor and CLI.

**`benched` field on AgentProfile:**
- Maestro skips benched agents when deciding who to consult
- `processEvent` skips benched agents for ambient scoring
- TeamManager (Conductor) doesn't show benched agents as available

**CLI commands:**
- `paradigm agent roster` — show all agents with status, expertise, acceptance rate
- `paradigm agent bench <id>` — bench an agent (sets `benched: true`)
- `paradigm agent activate <id>` — activate a benched agent
- `paradigm agent show <id>` — full profile dump (existing, enhanced with stats)

**Conductor UI:**
- Roster view with active/benched sections
- Toggle buttons for bench/activate
- Agent detail panel showing expertise, attention, journal, notebook

### Phase 4: Cross-Platform Display

**What:** Make the team thread and approvals accessible outside macOS.

**Platform web dashboard:**
- Add "Team" section to `paradigm serve` dashboard (alongside existing ambient section)
- Reads Symphony thread messages from mailbox files
- Displays chat-style thread view
- Approval buttons that write Symphony messages
- Agent roster with stats

**This makes the Conductor experience available on Linux/Windows** via the browser. No native app required. The trade-off: no process management (can't spawn agents from the browser), but the display + approval flow works.

**Files:**
- `packages/paradigm/platform-ui/src/sections/team/TeamSection.tsx`
- `packages/paradigm/platform-ui/src/sections/team/store/teamStore.ts`
- `packages/paradigm/src/platform-server/routes/team.ts`

### Phase 5: Neverland Validation

**What:** Run the full learning loop across 10+ sessions in Project Neverland.

**Metrics to track:**
- Agent routing accuracy (did Maestro pick the right agent?)
- Acceptance rate per agent per session (trending up?)
- Threshold drift (are noisy agents self-correcting?)
- Notebook growth (are patterns accumulating?)
- Cross-project transfer (do patterns from project A help in project B?)
- Time-to-useful (how many sessions before agents are noticeably better than cold?)

**Instrumentation:**
- Add `session_number` to lore entries for this project
- Track which agent was consulted for which symbol
- Record acceptance/dismissal with reason tags
- Lore arc: `arc:neverland-learning-validation`

## Token Budget

| Activity | Cost |
|----------|------|
| Load agent profiles at session start | ~500 tokens (one-time) |
| Build enrichment per subagent spawn | ~1K tokens per agent |
| Subagent execution (one-shot) | ~3-5K tokens per agent (prompt + response) |
| Typical task with 3 agents consulted | ~15K tokens total |
| Learning + promotion at session end | ~2K tokens |
| Symphony message writes | ~0 (file I/O, no API) |
| Conductor reads thread | ~0 (file I/O, no API) |

**Compare to persistent model:** 15-20K per task vs 600K+ for polling. **30-40x more efficient.**

## Dependencies

- Ambient v5.3 complete (nominations, learning, events) — done
- Symphony Phase 0-1 (mailbox + relay) — done
- Conductor Sprint 16 (view decomposition) — done
- Agent profiles with renaissance fields — done
- `.agent` expertise, journal, notebook infrastructure — done

## Success Criteria

1. By session 5: agents have divergent expertise scores (not all 0.5)
2. By session 10: Maestro routes to right agent >80% without explicit direction
3. By session 10: agent acceptance rate >70% (up from ~50% cold start)
4. Cross-project: a pattern learned in project A appears in project B's enrichment
5. Conductor displays team thread in real-time with working approval buttons
6. Platform dashboard provides the same experience for non-macOS users
7. Zero tokens consumed by idle agents (no persistent sessions, no polling)
8. Full session (3 agents, 5 tasks) costs <100K tokens total
