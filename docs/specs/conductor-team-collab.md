# Conductor Team Collaboration — The Maestro Experience

> **Status:** Planning | **Priority:** P0 | **Target:** Conductor Sprint 17+
>
> One input pane. Multiple headless agents. Chat-style thread. Inline approvals. Zero terminal noise.

## North Star

You open Conductor, hit "Launch Team," and 3 agents spin up headlessly. You type a message in the maestro pane — all agents see it. The architect responds first with a structural take. Security interjects about a gate. Builder says "I can do that, here's my approach." You tap "Approve" on the builder's message. Builder starts working. You watch the thread. Security flags something mid-build. Builder adjusts. Work completes. You never opened a terminal.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Conductor.app (macOS)                                      │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Agent Bar                                            │  │
│  │  ● architect (active)  ● security (active)            │  │
│  │  ● builder (working)   ○ tester (benched)             │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Thread View (chat-style)                             │  │
│  │                                                       │  │
│  │  You (maestro)                           10:32 AM     │  │
│  │  Add rate limiting to the /api/messages endpoint      │  │
│  │                                                       │  │
│  │  architect                               10:32 AM     │  │
│  │  This affects $message-flow. The limiter should sit   │  │
│  │  before ^authenticated in the middleware chain.       │  │
│  │  I'd suggest a sliding window approach.               │  │
│  │                                                       │  │
│  │  security                                10:33 AM     │  │
│  │  Agree. Also need ^rate-limited gate in portal.yaml.  │  │
│  │  Current config has no per-user throttling.           │  │
│  │  ⚠ This endpoint has no abuse protection today.       │  │
│  │                                                       │  │
│  │  builder                                 10:33 AM     │  │
│  │  I'll implement the sliding window limiter as         │  │
│  │  middleware + add the ^rate-limited gate.              │  │
│  │  Files: src/middleware/rate-limit.ts, portal.yaml     │  │
│  │                                                       │  │
│  │  ┌─────────┐ ┌─────────┐ ┌──────────┐               │  │
│  │  │ Approve │ │ Revise  │ │ Discuss  │               │  │
│  │  └─────────┘ └─────────┘ └──────────┘               │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Maestro Input                                        │  │
│  │  │ Type a message...                            Send │ │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Phases

### Phase 0: Push-Based Symphony Local (No Polling)

**The foundation.** Without this, everything bleeds tokens.

**What:** Replace file-polling with a local Unix domain socket. When an agent sends a Symphony message, the relay pushes it to all connected local agents instantly.

**New components:**
- `SymphonyLocalRelay` — Unix socket server at `~/.paradigm/symphony.sock`
- Agent sessions connect on startup, receive pushed messages
- Conductor connects to observe all traffic (for ThreadView)
- Zero cost when idle — no polling, no token consumption

**Files:**
- `packages/paradigm-mcp/src/utils/symphony-local-relay.ts` — socket server + client
- `packages/paradigm/src/commands/symphony/local-relay.ts` — CLI to start relay
- `packages/conductor/Sources/Conductor/Services/SymphonyLocalClient.swift` — Conductor socket client

**Token cost:** Zero when idle. Messages only when agents have something to say.

### Phase 1: Headless Agent Sessions

**What:** Conductor spawns Claude Code instances without visible terminal windows. Agents run in background, connected to Symphony local relay.

**New components:**
- `TeamManager` — launches/stops/monitors agent sessions per project
- `AgentSession` — wraps a headless Claude Code process with Symphony identity
- Each session gets a startup prompt injecting agent identity + "join Symphony, listen for messages"

**Startup prompt template:**
```
You are the {role} agent for {project}. Your Symphony identity is {project}/{role}.
Your personality: {personality}. Your attention: {attention patterns}.

You are in a team collaboration session. Messages arrive via Symphony.
When you receive a message, evaluate it through your {role} expertise.
Respond in the Symphony thread. Be concise. Reference symbols with prefixes.

If you have nothing to add, stay quiet. If you disagree with another agent,
say so with evidence. If you're asked to do work, confirm what you'll do
and which files you'll modify.

Wait for messages. Do not act until instructed.
```

**Files:**
- `packages/conductor/Sources/Conductor/Services/TeamManager.swift`
- `packages/conductor/Sources/Conductor/Models/AgentSession.swift`
- Extend `AgentProcessManager` for headless mode

### Phase 2: Maestro Pane + Thread View

**What:** Conductor UI for typing messages and viewing the conversation.

**Maestro pane:**
- Text input at bottom of Conductor overlay
- Send button broadcasts to all active agents via Symphony
- Sent as `conductor/maestro` participant with `type: human`
- Support for `@agent` mentions to direct to specific agent

**Thread view (chat-style):**
- Replaces current ThreadView with a real chat UI
- Agent messages show with colored avatar (agent's assigned color)
- Human messages show differently (right-aligned or distinct style)
- Auto-scroll to latest, with scroll-back
- Inline code blocks with syntax highlighting
- Symbol references (`#auth-middleware`, `^rate-limited`) are clickable → navigate to symbol

**Files:**
- `packages/conductor/Sources/Conductor/UI/Views/MaestroPaneView.swift`
- `packages/conductor/Sources/Conductor/UI/Views/TeamThreadView.swift` (rewrite of ThreadView)
- `packages/conductor/Sources/Conductor/UI/Views/AgentMessageBubble.swift`

### Phase 3: Inline Approvals

**What:** Action buttons on agent messages. Approve, Revise, Discuss.

**Approve** — agent proceeds with proposed work. Conductor sends a Symphony message: `"Approved by human. Proceed."` Agent starts implementing.

**Revise** — opens a reply input pre-filled with the agent's proposal. Human edits and sends back. Agent adjusts.

**Discuss** — opens a sub-thread for back-and-forth without the other agents. Like a DM within the team thread.

**Task integration:** Approved messages create Paradigm tasks (`paradigm_task_create`) automatically. Builder's "I'll implement rate limiting" becomes a tracked task with status.

**Files:**
- `packages/conductor/Sources/Conductor/UI/Views/ApprovalActionBar.swift`
- `packages/conductor/Sources/Conductor/Services/ApprovalManager.swift`
- Extend Symphony message types with `approval_status` metadata

### Phase 4: Agent Roster + Bench

**What:** UI to see all agents, their status, and toggle active/benched.

**Roster view:**
```
ACTIVE
● architect    deliberate · threshold 0.5 · 12 nominations (83% accepted)
● security     methodical · threshold 0.4 · 8 nominations (75% accepted)
● builder      rapid · threshold 0.7 · working on 2 tasks

BENCHED
○ tester       methodical · threshold 0.5 · benched 2d ago
○ reviewer     deliberate · threshold 0.6 · never activated

[Activate]  [Bench]  [Show Profile]
```

**`benched` field** on `.agent` profile. `processEvent` skips benched agents. TeamManager doesn't spawn benched agents.

**CLI:** `paradigm agent bench <id>`, `paradigm agent activate <id>`, `paradigm agent roster`

**Files:**
- `packages/conductor/Sources/Conductor/UI/Views/AgentRosterView.swift`
- `packages/paradigm/src/commands/agent/roster.ts`
- Add `benched: boolean` to `AgentProfile` type

### Phase 5: Ambient Integration

**What:** Connect ambient learning to the team experience.

- Session start: pending nominations surface in the thread as system messages ("Security has a pending observation from last session: ...")
- Engagement happens inline: approve/dismiss nominations in the thread
- Learning runs automatically: after session ends, `adjustAttentionFromFeedback` calibrates all agents
- Journal entries from the session auto-promote to notebooks if high-confidence

**The ambient system becomes the memory layer:**
- Between sessions: what agents learned, what patterns they discovered
- Within sessions: live Symphony collaboration
- After sessions: nominations, learning, promotion

## Token Budget Analysis

| Activity | Old (polling) | New (push) |
|----------|--------------|------------|
| Agent idle (per min) | ~6K tokens (12 polls × 500) | 0 |
| Agent receives message | ~2K tokens | ~2K tokens |
| Agent responds | ~1K tokens | ~1K tokens |
| 30-min session, 3 agents, 20 messages | ~540K polling + 60K work = 600K | 60K work only |

**10x reduction** in token cost by eliminating polling.

## Sprint Mapping

| Sprint | Phase | Deliverables |
|--------|-------|-------------|
| 17 | 0 | SymphonyLocalRelay (Unix socket push) |
| 18 | 1 | TeamManager, headless agent sessions |
| 19 | 2 | MaestroPaneView, TeamThreadView |
| 20 | 3 | Inline approvals, task integration |
| 21 | 4 | Agent roster, bench/activate |
| 22 | 5 | Ambient integration, session memory |

## Dependencies

- **Conductor Sprint 16 complete** (view decomposition) — done
- **Symphony Phase 0-1 complete** (mailbox + relay) — done
- **Ambient v5.3 complete** (nominations, learning, events) — done
- **Swift 6 concurrency** — all protocols already `@MainActor`

## Success Criteria

1. Launch team in <3 seconds
2. Message delivery <500ms (local socket push)
3. Zero tokens consumed when agents are idle
4. Thread view renders agent conversations in real-time
5. Inline approval → agent starts working within 1 message
6. Session learning persists — agents are measurably better after 10 sessions
7. User never opens a terminal during team collaboration
