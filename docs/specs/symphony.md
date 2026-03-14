# Paradigm Symphony

> Real-time networked multi-agent, multi-human collaborative intelligence layer
>
> **Codename:** Symphony | **Status:** Spec Draft | **Author:** ascend + opus
> **Date:** 2026-03-12

---

## 1. Vision

Symphony transforms Paradigm from a single-developer AI toolchain into a **networked
collaborative intelligence layer** where multiple AI agents and multiple humans
participate as peers in a shared conversation graph.

**The metaphor is a live band.** Each musician (agent or human) has their own
instrument (codebase, specialty, context), but they hear each other in real-time,
can riff off each other's ideas, call for solos, and converge on a shared groove.
Conductor is the bandleader. Sentinel is the mixing board. Lore is the setlist.

### What it looks like

A triage session in Symphony:

1. Sentinel alert fires on `#payment-service`
2. **Backend Opus** (Dev A's machine) picks it up, inspects the error
3. Backend Opus asks **Frontend Opus** (Dev A's machine): "Did you change the contract on `/api/tasks`?"
4. Frontend Opus checks `git log`, responds with the diff
5. Backend Opus proposes a fix, emits it to the conversation
6. **Backend Opus** (Dev B's machine, same project) flags: "That fix breaks the migration — I saw this last week"
7. **Dev A** speaks via Conductor voice: "Skip the migration, hotfix the serializer"
8. All agents adjust — Backend Opus A writes the fix, Frontend Opus updates the types
9. Sentinel tree shows the **full threaded conversation** in real-time
10. Lore records the decision, linked to the commit

---

### Two tiers

Symphony has two operational tiers — A-Mail (CLI-only) and Conductor (full orchestration).
You don't need Conductor to use Symphony. Conductor makes it effortless.

| Capability | A-Mail (CLI only) | + Conductor |
|---|---|---|
| Link agents together | `paradigm symphony join` (manual) | Auto-discovers all windows |
| Send messages | `paradigm_symphony_send` | Same + voice, gaze targeting |
| Poll for messages | `/loop 10s paradigm_symphony_poll` | Auto-registers loop |
| Cross-machine | `paradigm symphony join --remote <ip>` | Bonjour auto-discovery |
| Conversation UI | Sentinel viewer (browser) | Same + overlay panel |
| Human participation | Sentinel UI text input | + Conductor voice |

**A-Mail = giving AI agents an email address.** They can send and receive, but only
when they're awake (session is running). Conductor is the mail carrier that
auto-discovers everyone on the block and delivers without you addressing envelopes.

---

## 2. Architecture Overview

### Full Stack (with Conductor)

```
                    ┌─────────────────────────────────────────────┐
                    │              SENTINEL HUB                   │
                    │    (Event aggregator + conversation tree)    │
                    │         ws://sentinel-hub:3838/ws            │
                    └──────┬──────────────┬───────────────┬───────┘
                           │              │               │
              ┌────────────┴──┐     ┌─────┴────────┐   ┌──┴───────────┐
              │  CONDUCTOR A  │     │ CONDUCTOR B  │   │ CONDUCTOR C  │
              │  (Dev A Mac)  │     │ (Dev B Mac)  │   │ (Dev C Mac)  │
              └───┬───┬───┬───┘     └──┬───┬───┬───┘   └──┬───┬──────┘
                  │   │   │            │   │   │           │   │
                CC1  CC2  CC3        CC1  CC2  CC3       CC1  CC2
               core  be   fe        core  be   fe       core  be
```

### CLI Only (A-Mail, no Conductor)

```
    ┌──────────────┐        ~/.paradigm/score/
    │  CC1 (core)  │───────── outbox.jsonl ──┐
    │  /loop poll  │◄──────── inbox.jsonl    │
    └──────────────┘                         │
                                    ┌────────┴────────┐
                                    │   Mail Router    │
    ┌──────────────┐                │  (file-based)    │
    │  CC2 (backend)│───────── outbox.jsonl  │
    │  /loop poll  │◄──────── inbox.jsonl ───┘
    └──────────────┘

    # No Conductor needed. Just:
    paradigm symphony join          # link sessions on this machine
    paradigm symphony join --remote 192.168.1.42   # link to remote
```

### Key Principles

1. **A-Mail works standalone** — CLI-only messaging between agents, no Conductor required
2. **Conductor auto-links** — when running, automatically links all detected sessions
3. **Agents communicate via mailbox** — file-based protocol, polled by `/loop`
4. **Sentinel is the shared brain** — aggregates all events, renders the conversation tree
5. **Humans are first-class participants** — same message protocol as agents
6. **`/loop` is the heartbeat** — each Claude Code session polls for incoming messages
7. **Lore captures outcomes** — decisions auto-extracted from conversation threads

---

## 3. CLI Commands — `paradigm symphony` & `paradigm symphony`

### 3.0 A-Mail: The CLI-Only Foundation

A-Mail is the base layer. It works with zero dependencies beyond the Paradigm CLI.
No Conductor, no Sentinel, no network config. Just agents talking to each other
through the filesystem.

#### `paradigm symphony` — Agent Messaging Commands

```bash
# === IDENTITY ===

paradigm symphony whoami
# Output: agent-abc123 (core-lib) — 3 linked peers, 2 active threads

paradigm symphony list
# Output:
#   AGENT ID        PROJECT         STATUS    LINKED
#   agent-abc123    a-paradigm      awake     ●
#   agent-def456    a-paradigm      awake     ●
#   agent-ghi789    a-kamiki        asleep    ○
#   agent-jkl012    a-paradigm      awake     ● (remote: 192.168.1.42)

# === LINKING ===

paradigm symphony join
# Auto-discovers Claude Code sessions on this machine via ~/.conductor/sessions/
# and links them together. Each session gets a mailbox.
# Output: Linked 3 sessions. Run `/loop 10s paradigm_symphony_poll` in each.

paradigm symphony join --remote 192.168.1.42
# Links to a remote machine's mail router (requires paradigm symphony serve on remote)
# Output: Linked to jordan's machine (3 agents). Total network: 6 agents.

paradigm symphony leave
# Removes this session from the mail network

paradigm symphony serve
# Starts a lightweight TCP server for remote mail linking (port 3939)
# Other machines can `paradigm symphony join --remote <this-ip>`
# Output: Mail server listening on 0.0.0.0:3939

# === MESSAGING (for humans from terminal) ===

paradigm symphony send "Hey backend, did you change the /api/tasks contract?"
# Sends to all linked agents (broadcast)

paradigm symphony send --to agent-def456 "Check #payment-serializer for the regression"
# Direct message to specific agent

paradigm symphony send --thread thr-abc "I agree, let's hotfix it"
# Reply to an existing thread

paradigm symphony read
# Show unread messages (what agents would see on next /loop poll)
# Output:
#   THREAD: "Payment service 500s" (4 messages)
#   ├─ 🤖 agent-def456 (backend): "Seeing 500s on POST /api/payments..."
#   ├─ 🤖 agent-abc123 (frontend): "Yes, added currency field in abc123"
#   ├─ 🤖 agent-jkl012 (backend@jordan): "That breaks the migration"
#   └─ 👤 ascend: "Skip migration, hotfix serializer"

paradigm symphony threads
# List active threads
# Output:
#   THREAD ID    TOPIC                        MSGS  LAST ACTIVITY
#   thr-abc      Payment service 500s         4     2m ago
#   thr-def      Type contract update         2     15m ago

paradigm symphony thread thr-abc
# Show full thread with all messages

paradigm symphony resolve thr-abc
# Mark thread as resolved → triggers Lore entry

# === STATUS ===

paradigm symphony status
# Network overview
# Output:
#   Mail Network: 4 agents linked (1 remote)
#   Active threads: 2
#   Unread messages: 3
#   Mail server: running on :3939
```

#### `paradigm symphony` — Orchestration Commands

```bash
# === SESSION MANAGEMENT ===

paradigm symphony join
# Register this terminal as a Symphony participant
# Auto-runs: /loop 10s paradigm_symphony_poll
# Output: Joined Symphony as agent-abc123 (a-paradigm/core)

paradigm symphony leave
# Unregister from Symphony, stop polling
# Output: Left Symphony. 2 agents remaining in network.

paradigm symphony status
# Full Symphony overview (local + network + Conductor if available)
# Output:
#   === SYMPHONY STATUS ===
#   Local agents: 3 (core, backend, frontend)
#   Remote agents: 3 (jordan's machine: core, backend, frontend)
#   Conductor: running (auto-link active)
#   Sentinel hub: ws://192.168.1.10:3838/ws
#   Active threads: 2
#   Messages today: 47
#   Decisions captured: 5

# === THREAD MANAGEMENT ===

paradigm symphony thread create "Discuss migration strategy for v2 schema"
# Start a new conversation thread
# Output: Created thread thr-xyz. All linked agents will be notified.

paradigm symphony thread list
# Same as `paradigm symphony threads` but with richer metadata

paradigm symphony thread resolve thr-abc --decision "Hotfix serializer, skip migration"
# Resolve with explicit decision → Lore entry

# === CONDUCTOR INTEGRATION ===

paradigm symphony conductor
# Show Conductor status and auto-link state
# Output:
#   Conductor: running
#   Auto-linked sessions: 3
#   Peer Conductors: 1 (jordan's MacBook)
#   Voice participation: enabled
#   Gaze targeting: enabled
```

### Command Hierarchy

```
paradigm
  ├── mail                    # A-Mail: lightweight agent messaging
  │   ├── whoami              # Show this agent's identity
  │   ├── list                # List all known agents
  │   ├── link                # Link sessions together
  │   ├── unlink              # Remove from network
  │   ├── serve               # Start remote mail server
  │   ├── send                # Send a message (human → agents)
  │   ├── read                # Read unread messages
  │   ├── threads             # List threads
  │   ├── thread <id>         # Show thread
  │   ├── resolve <id>        # Resolve thread → Lore
  │   └── status              # Network status
  │
  ├── symphony                # Full orchestration layer
  │   ├── join                # Register + start polling
  │   ├── leave               # Unregister + stop polling
  │   ├── status              # Full network overview
  │   ├── thread
  │   │   ├── create          # Start a thread
  │   │   ├── list            # List threads
  │   │   └── resolve         # Resolve → Lore
  │   └── conductor           # Conductor integration status
  │
  └── team                    # (existing) Agent spawning & orchestration
      ├── orchestrate         # (existing) Multi-agent task execution
      ├── spawn               # (existing) Single agent spawning
      └── ...
```

### Relationship: `mail` vs `symphony` vs `team`

| Command | Scope | Purpose |
|---|---|---|
| `paradigm symphony` | Messaging | Send/receive messages between running agents |
| `paradigm symphony` | Session | Join/leave the live conversation network |
| `paradigm team` | Orchestration | Spawn/manage background agent processes |

They compose naturally:
- `team orchestrate` spawns agents → each agent runs `symphony join` → they communicate via `mail`
- A human can `mail send` without any orchestration
- `symphony` manages the session lifecycle, `mail` handles the messages

---

## 4. System Components

### 4.1 Conductor Network Layer (Swift — `packages/conductor/`)

#### 4.1.1 Peer Discovery (`Network/PeerDiscovery.swift`)

Uses Apple's Network framework (NWBrowser + NWListener) for zero-config
LAN discovery. No server, no configuration, no cloud.

```swift
// Bonjour service type
let serviceType = "_paradigm-symphony._tcp"

// Advertised metadata (TXT record)
struct ConductorAdvertisement {
    let conductorId: String        // UUID, persisted across restarts
    let displayName: String        // e.g. "ascend's MacBook"
    let projectNames: [String]     // e.g. ["a-paradigm", "a-kamiki"]
    let agentCount: Int            // number of active Claude Code sessions
    let sentinelEndpoint: String?  // if running Sentinel hub
    let version: String            // conductor version for compat
}
```

**Discovery flow:**
1. On launch, Conductor advertises itself via NWListener
2. NWBrowser discovers peers on the LAN
3. Peers exchange capabilities via TXT record
4. Direct TCP connection established for messaging (NWConnection)
5. If a peer is running Sentinel, all Conductors connect to it as hub

**Failure modes:**
- Peer goes offline → NWBrowser fires `.removed` → mark unavailable
- Network change → re-browse, re-advertise
- No peers → local-only mode (existing behavior, zero degradation)

#### 4.1.2 Message Relay (`Network/MessageRelay.swift`)

Conductor acts as the message router between:
- Local Claude Code sessions (via `/loop` polling)
- Remote Conductors (via peer TCP connections)
- Local human (via voice/keyboard/gesture)

```swift
struct SymphonyMessage: Codable, Identifiable {
    let id: String                     // UUID
    let parentId: String?              // thread/reply reference
    let threadRoot: String?            // root message of the thread
    let timestamp: Date
    let sender: Participant
    let recipients: [Participant]?     // nil = broadcast to thread
    let intent: MessageIntent
    let content: MessageContent
    let symbols: [String]              // Paradigm symbols referenced
    let attachments: [Attachment]?     // diffs, files, screenshots
    let metadata: MessageMetadata?
}

struct Participant: Codable {
    let id: String                     // unique across network
    let name: String                   // display name
    let type: ParticipantType          // .agent or .human
    let conductor: String              // conductor ID (which machine)
    let project: String?               // project context
    let role: String?                  // architect, builder, etc.
}

enum ParticipantType: String, Codable {
    case agent                         // Claude Code session
    case human                         // Developer via Conductor
}

enum MessageIntent: String, Codable {
    case question                      // Asking for information
    case context                       // Providing context/background
    case clarification                 // Asking for clarification
    case proposal                      // Proposing an action/fix
    case verification                  // Confirming understanding
    case action                        // Announcing an action taken
    case decision                      // Recording a decision
    case alert                         // Sentinel alert forwarding
    case approval                      // Approving a proposal
    case rejection                     // Rejecting with reason
    case reference                     // Pointing to existing resource
    case handoff                       // Transferring responsibility
    case fileRequest                   // Requesting a file from another agent
    case fileApproved                  // File transfer approved by human
    case fileDenied                    // File transfer denied by human
    case fileDelivery                  // File content being delivered
}

struct MessageContent: Codable {
    let text: String                   // Human-readable message
    let structured: [String: Any]?     // Machine-readable data
    let diff: String?                  // Code diff if relevant
    let codeBlock: String?             // Specific code reference
}

struct FileRequest: Codable {
    let requestId: String              // Unique ID for this file request
    let filePath: String               // Relative path requested
    let reason: String                 // Why the agent needs this file
    let requester: Participant         // Who's asking
    let urgency: FileUrgency           // .normal, .urgent
}

enum FileUrgency: String, Codable {
    case normal                        // Can wait for human approval
    case urgent                        // Flag as high priority in UI
}

struct FileDelivery: Codable {
    let requestId: String              // Matches the original FileRequest
    let filePath: String
    let content: String                // File content (text) or base64 (binary)
    let encoding: FileEncoding         // .utf8 or .base64
    let size: Int                      // Bytes
    let hash: String                   // SHA-256 for integrity
}

enum FileEncoding: String, Codable {
    case utf8
    case base64
}

struct Attachment: Codable {
    let type: AttachmentType           // .diff, .file, .screenshot, .lore
    let name: String
    let content: String                // Base64 for binary, raw for text
}

struct MessageMetadata: Codable {
    let model: String?                 // e.g. "claude-opus-4-6"
    let tokenEstimate: Int?            // rough size of this message
    let confidence: Double?            // agent confidence in response
    let symbolsModified: [String]?     // symbols this message affects
    let filesModified: [String]?       // files referenced or changed
}
```

#### 4.1.3 Agent Mailbox (`Network/AgentMailbox.swift`)

Each Claude Code session gets a mailbox that accumulates messages between
`/loop` polls. This is the bridge between async network messages and
synchronous Claude Code turns.

```swift
struct AgentMailbox {
    let agentId: String                // Claude Code session identifier
    let projectDir: String
    private var pending: [SymphonyMessage] = []
    private var acknowledged: Set<String> = []

    /// Called by MessageRelay when a message arrives for this agent
    mutating func deliver(_ message: SymphonyMessage)

    /// Called by /loop poll — returns unread messages, marks as read
    mutating func collect() -> [SymphonyMessage]

    /// Called by agent to send a reply
    mutating func send(_ reply: SymphonyMessage)
}
```

**Integration with `/loop`:**
```
# In each Claude Code session:
/loop 10s check conductor mailbox for new messages

# The loop prompt resolves to:
paradigm_symphony_poll → returns pending messages → agent processes + replies
```

#### 4.1.4 Mailbox File Protocol

Conductor writes messages to a well-known filesystem location that the
MCP tool can read. This avoids needing a second WebSocket/IPC channel
between Conductor (Swift) and paradigm-mcp (Node.js).

```
~/.conductor/mailbox/{pid}/
    inbox.jsonl          # Messages waiting for this agent (append-only)
    outbox.jsonl         # Replies from this agent (append-only)
    ack.json             # Last acknowledged message ID
```

- Conductor writes to `inbox.jsonl`, reads from `outbox.jsonl`
- MCP tool reads from `inbox.jsonl`, writes to `outbox.jsonl`
- File watching (dispatch source) for low-latency notification
- JSONL format — one message per line, append-only, trivial to parse
- Conductor garbage-collects acknowledged messages periodically

#### 4.1.5 File Pipeline — Human-Gated File Sharing

Agents can request files from other agents across the network. **Every file
transfer requires explicit human approval** from the file owner's side.
No agent can silently send files to another machine.

**The flow:**

```
Agent BillyBob              Conductor (Kevin's)           Kevin (human)
(Kevin's machine)                  │                          │
     │                             │                          │
     │  "I need Thing.md           │                          │
     │   from ascend's project"    │                          │
     │                             │                          │
     ├─ fileRequest ──────────────►│                          │
     │                             │                          │
     │                             │──── relay to ───────────►│
     │                             │     ascend's Conductor   │
     │                             │                          │
                                                              │
Agent on ascend's machine    Conductor (ascend's)        ascend (human)
     │                             │                          │
     │                             │◄── fileRequest arrives   │
     │                             │                          │
     │                             ├─── PROMPT ──────────────►│
     │                             │                          │
     │                             │    ┌─────────────────────────┐
     │                             │    │ Agent BillyBob          │
     │                             │    │ (user: Kevin) is        │
     │                             │    │ requesting:             │
     │                             │    │                         │
     │                             │    │   📄 Thing.md           │
     │                             │    │   📁 a-paradigm/docs/   │
     │                             │    │   💬 "Need the API      │
     │                             │    │      contract for the   │
     │                             │    │      payment refactor"  │
     │                             │    │                         │
     │                             │    │ May I send it over?     │
     │                             │    │                         │
     │                             │    │  [1. Yes]  [2. No]     │
     │                             │    │  [3. Yes, redacted]    │
     │                             │    └─────────────────────────┘
     │                             │                          │
     │                             │◄──── 1. Yes ─────────────┤
     │                             │                          │
     │◄── read file, send ─────────┤                          │
     │    fileDelivery              │                          │
     │                             │                          │
     │── relay to Kevin's ─────────┤                          │
     │   Conductor                 │                          │
```

**Approval options:**

| Choice | Behavior |
|---|---|
| **Yes** | Send the file as-is |
| **No** | Deny with optional reason ("that file contains secrets") |
| **Yes, redacted** | Send with sensitive lines stripped (env vars, keys, tokens) |
| **Yes, snippet** | Send only the relevant section (human selects lines) |
| **Always allow** | Auto-approve future requests for this file from this user |
| **Always allow from user** | Auto-approve all file requests from this user |

**Trust levels (configurable per user/per project):**

```yaml
# ~/.paradigm/score/trust.yaml
trust:
  users:
    kevin:
      level: teammate            # teammate, restricted, blocked
      autoApprove:
        - "docs/**"              # Always approve doc requests from Kevin
        - "*.md"
      neverApprove:
        - ".env*"                # Never send env files
        - "**/secrets/**"
        - "**/*.pem"
  defaults:
    level: restricted            # Default for unknown users
    autoApprove: []
    neverApprove:
      - ".env*"
      - "**/*.key"
      - "**/*.pem"
      - "**/credentials*"
      - "**/secrets/**"
```

**File request via MCP:**

```typescript
// Agent sends a file request
paradigm_symphony_send({
  intent: "fileRequest",
  text: "Need the API contract for the payment refactor",
  fileRequest: {
    filePath: "docs/Thing.md",
    reason: "Updating frontend types to match new backend contract",
    urgency: "normal"
  },
  recipients: ["a-paradigm/backend"]   // specific agent
})
```

**File request via CLI:**

```bash
# Request a file from another agent
paradigm symphony request "docs/Thing.md" --from kevin --reason "Need API contract"

# Check pending file requests (as the owner being asked)
paradigm symphony requests
#   REQUEST ID    FROM              FILE               STATUS
#   req-abc123    kevin/backend     docs/Thing.md      pending
#   req-def456    jordan/frontend   src/types.ts       pending

# Approve/deny from terminal
paradigm symphony approve req-abc123
paradigm symphony deny req-abc123 --reason "Contains secrets"

# Approve with redaction
paradigm symphony approve req-abc123 --redact
```

**What agents see (on poll):**

```markdown
## File Request from BillyBob (user: Kevin)

Kevin's backend agent is requesting: `docs/Thing.md`
Reason: "Need the API contract for the payment refactor"

⏳ Waiting for your human (ascend) to approve.
You will be notified when the file is delivered or denied.
```

And when approved:

```markdown
## File Delivered: docs/Thing.md

Requested by: BillyBob (Kevin's backend agent)
Size: 2.3 KB | SHA-256: abc123...
Content attached below.

---
[file content here]
---
```

**Security rules:**
- Files in `.neverApprove` patterns are **always denied**, even if human clicks Yes
- Binary files > 10MB are denied by default (configurable)
- File content is transmitted via the same mailbox protocol (JSONL)
- Large files are chunked into 1MB segments
- SHA-256 hash for integrity verification on delivery
- File requests expire after 1 hour if not approved
- All file transfers are logged in Sentinel as `file:requested`, `file:approved`,
  `file:denied`, `file:delivered` events

### 4.2 MCP Tools (TypeScript — `packages/paradigm-mcp/`)

New MCP tools for agent participation in Symphony:

#### 4.2.1 `paradigm_symphony_poll`

The heartbeat tool. Called by `/loop` or manually.

```typescript
// Input
{ }  // No params — reads from mailbox

// Output
{
  messages: SymphonyMessage[],       // Pending messages for this agent
  threadSummary: {                   // Context for ongoing threads
    threadId: string,
    participants: Participant[],
    messageCount: number,
    lastActivity: string             // ISO timestamp
  }[],
  instruction: string               // Suggested action for the agent
}
```

**Agent behavior on poll:**
1. Read pending messages from `~/.conductor/mailbox/{pid}/inbox.jsonl`
2. For each message, the agent sees it as a structured prompt
3. Agent processes and responds via `paradigm_symphony_send`
4. The response goes to `outbox.jsonl` → Conductor picks up → relays

#### 4.2.2 `paradigm_symphony_send`

Send a message to the conversation.

```typescript
// Input
{
  parentId?: string,                 // Reply to specific message
  threadRoot?: string,               // Join existing thread
  recipients?: string[],            // Participant IDs (null = broadcast)
  intent: MessageIntent,
  text: string,                      // Human-readable message
  symbols?: string[],               // Paradigm symbols referenced
  diff?: string,                     // Code diff attachment
  decision?: string                  // Decision to record in Lore
}
```

#### 4.2.3 `paradigm_symphony_status`

Overview of the Symphony network.

```typescript
// Output
{
  localConductor: {
    id: string,
    agents: { id, project, status }[]
  },
  peers: {
    id: string,
    name: string,
    agents: { id, project, status }[],
    latency: number                  // ms
  }[],
  activeThreads: {
    id: string,
    topic: string,
    participants: number,
    lastActivity: string
  }[],
  sentinelHub: string | null         // endpoint if available
}
```

#### 4.2.4 `paradigm_symphony_thread`

Get full context of a conversation thread.

```typescript
// Input
{
  threadId: string,
  depth?: number                     // How many messages back (default: all)
}

// Output
{
  thread: SymphonyMessage[],         // Ordered by timestamp
  participants: Participant[],
  decisions: string[],               // Extracted decisions
  symbolsDiscussed: string[],
  filesReferenced: string[]
}
```

#### 4.2.5 `paradigm_symphony_request_file`

Request a file from another agent. Requires human approval on the owner's side.

```typescript
// Input
{
  filePath: string,                  // Relative path in their project
  from: string,                      // Agent/project identifier
  reason: string                     // Why you need this file
}

// Output (immediate — before approval)
{
  requestId: string,
  status: "pending",
  message: "File request sent. Waiting for human approval on the owner's side."
}

// Delivered later via paradigm_symphony_poll when approved
{
  intent: "fileDelivery",
  fileDelivery: {
    requestId: string,
    filePath: string,
    content: string,
    encoding: "utf8" | "base64",
    size: number,
    hash: string
  }
}
```

#### 4.2.6 `paradigm_symphony_approve_file`

Approve or deny a pending file request (called by the owning agent after
human confirms via Conductor prompt or CLI).

```typescript
// Input
{
  requestId: string,
  action: "approve" | "deny" | "approve-redacted",
  reason?: string                    // Why denied (shown to requester)
}
```

### 4.3 Sentinel Conversation Schema

New Sentinel event schema for Symphony conversations. Leverages existing
generic event infrastructure (schema registry, scope-based grouping,
causality tracking, visualization hints).

#### 4.3.1 Schema Declaration

```typescript
const symphonySchema: EventSchemaDeclaration = {
  id: "paradigm-symphony",
  version: "1.0.0",
  name: "Symphony Conversations",
  description: "Multi-agent, multi-human collaborative conversations",

  scope: {
    field: "threadId",
    type: "thread",
    ordering: "sequential",
    sessionField: "conductorId"
  },

  eventTypes: [
    {
      type: "message:question",
      category: "dialogue",
      fields: [
        { name: "senderId", type: "string", indexed: true },
        { name: "senderType", type: "string", indexed: true },  // agent|human
        { name: "senderName", type: "string" },
        { name: "text", type: "string" },
        { name: "symbols", type: "string[]", indexed: true },
        { name: "conductor", type: "string", indexed: true }
      ]
    },
    { type: "message:context",       category: "dialogue",   /* same fields */ },
    { type: "message:clarification", category: "dialogue",   /* same fields */ },
    { type: "message:proposal",      category: "action",     /* + diff field */ },
    { type: "message:verification",  category: "dialogue",   /* same fields */ },
    { type: "message:action",        category: "action",     /* + filesModified */ },
    { type: "message:decision",      category: "outcome",    /* + decision field */ },
    { type: "message:alert",         category: "system",     /* + incidentId */ },
    { type: "message:approval",      category: "outcome",    /* same fields */ },
    { type: "message:rejection",     category: "outcome",    /* + reason */ },
    { type: "message:handoff",       category: "lifecycle",  /* + handoffTo */ },
    {
      type: "file:requested",
      category: "transfer",
      fields: [
        { name: "requestId", type: "string", indexed: true },
        { name: "filePath", type: "string" },
        { name: "requester", type: "string", indexed: true },
        { name: "owner", type: "string", indexed: true },
        { name: "reason", type: "string" },
        { name: "urgency", type: "string" }
      ]
    },
    { type: "file:approved",   category: "transfer",  /* requestId, approver, redacted? */ },
    { type: "file:denied",     category: "transfer",  /* requestId, denier, reason */ },
    {
      type: "file:delivered",
      category: "transfer",
      fields: [
        { name: "requestId", type: "string", indexed: true },
        { name: "filePath", type: "string" },
        { name: "size", type: "number" },
        { name: "hash", type: "string" },
        { name: "redacted", type: "boolean" }
      ]
    },
    {
      type: "thread:created",
      category: "lifecycle",
      fields: [
        { name: "topic", type: "string" },
        { name: "initiator", type: "string", indexed: true },
        { name: "trigger", type: "string" }  // "sentinel-alert", "human", "agent"
      ]
    },
    {
      type: "thread:resolved",
      category: "lifecycle",
      fields: [
        { name: "resolution", type: "string" },
        { name: "decisionsCount", type: "number" },
        { name: "loreEntryId", type: "string" }
      ]
    },
    {
      type: "participant:joined",
      category: "lifecycle",
      fields: [
        { name: "participantId", type: "string", indexed: true },
        { name: "participantType", type: "string" },
        { name: "conductor", type: "string" }
      ]
    },
    {
      type: "participant:left",
      category: "lifecycle",
      fields: [
        { name: "participantId", type: "string", indexed: true },
        { name: "reason", type: "string" }   // "done", "handoff", "disconnect"
      ]
    }
  ],

  causality: {
    parentField: "parentId",
    depthField: "depth",
    scopeStartEvents: ["thread:created"],
    scopeEndEvents: ["thread:resolved"]
  },

  visualization: {
    defaultView: "tree",
    categoryColors: {
      dialogue: "#7dd3fc",       // sky blue
      action: "#86efac",         // green
      outcome: "#fbbf24",        // amber
      system: "#f87171",         // red
      lifecycle: "#a78bfa",      // purple
      transfer: "#34d399"        // emerald — file transfers
    },
    summaryFields: ["senderName", "text"],
    defaultExclusions: []
  }
};
```

#### 4.3.2 Conversation Tree View (`ui/src/views/ConversationView.tsx`)

New Sentinel UI view — the centerpiece of Symphony visualization.

```
┌─────────────────────────────────────────────────────────────────┐
│  Symphony                                                  [Live]│
├─────────────┬───────────────────────────────────────────────────┤
│  Threads    │  Thread: "Payment service 500 errors"            │
│             │                                                   │
│  ● Payment  │  ┌─ 🤖 Backend Opus A (ascend)         2:34 PM  │
│    500s     │  │  "Seeing 500s on POST /api/payments since     │
│             │  │   deploy at 2:31. Stack trace points to        │
│  ○ Type     │  │   #payment-serializer. @Frontend — did the    │
│    contract │  │   contract change?"                            │
│    update   │  │                                                │
│             │  ├── 🤖 Frontend Opus (ascend)          2:34 PM  │
│  ○ Migrate  │  │   "Yes — added `currency` field to            │
│    to v2    │  │    PaymentRequest in commit abc123.            │
│    schema   │  │    Diff attached."                             │
│             │  │   📎 [diff: +currency: string]                │
│             │  │                                                │
│             │  ├── 🤖 Backend Opus B (jordan)         2:35 PM  │
│             │  │   "Careful — that field isn't in the           │
│             │  │    migration yet. If you add it to the         │
│             │  │    serializer without the migration,           │
│             │  │    existing rows will throw."                  │
│             │  │                                                │
│             │  ├── 👤 ascend (voice)                  2:35 PM  │
│             │  │   "Skip the migration for now. Hotfix the      │
│             │  │    serializer to default currency to 'USD'."  │
│             │  │   ⚡ DECISION                                  │
│             │  │                                                │
│             │  ├── 🤖 Backend Opus A                  2:35 PM  │
│             │  │   "On it. Making currency optional with        │
│             │  │    default 'USD' in #payment-serializer."      │
│             │  │   ✅ ACTION                                    │
│             │  │                                                │
│             │  └── 🤖 Frontend Opus                   2:36 PM  │
│             │      "Updated PaymentRequest type to mark         │
│             │       currency as optional. Types in sync."       │
│             │      ✅ ACTION                                    │
│             │                                                   │
├─────────────┴───────────────────────────────────────────────────┤
│  Participants: 🤖×3  👤×1  │  Machines: 2  │  Symbols: 3      │
│  [Reply via voice]  [Reply via text]  [Mark resolved]          │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- **Thread list** (left panel) — active conversations, sorted by last activity
- **Conversation tree** (main panel) — threaded messages with indent levels
- **Participant badges** — agent (robot) vs human (person), with conductor/machine label
- **Intent indicators** — DECISION, ACTION, ALERT, QUESTION badges
- **Attachment previews** — inline diffs, file references, screenshots
- **Human input bar** — text input + voice button (triggers Conductor voice pipeline)
- **Live mode** — new messages animate in via WebSocket
- **Decision extraction** — auto-highlights decision messages, feeds to Lore

### 4.4 Sentinel Hub Mode

For multi-machine Symphony, one Sentinel instance acts as the **hub** —
aggregating events from all Conductors on the network.

#### 4.4.1 Hub Election

```
1. Each Conductor checks: "Am I running Sentinel?"
2. If yes → advertise sentinelEndpoint in Bonjour TXT record
3. If multiple Sentinels → lowest conductorId wins (deterministic)
4. All Conductors connect to the elected hub
5. If hub goes down → re-election via Bonjour
```

No configuration needed. First person to have Sentinel running becomes the hub.

#### 4.4.2 Event Forwarding

Each Conductor forwards Symphony messages to the hub as Sentinel events:

```typescript
// Conductor → Sentinel Hub
POST /api/events
{
  schemaId: "paradigm-symphony",
  eventType: "message:question",
  scopeValue: threadId,           // groups by thread
  sessionId: conductorId,         // which machine
  data: {
    senderId: participant.id,
    senderType: "agent",
    senderName: "Backend Opus A",
    text: "Did you change the contract?",
    symbols: ["#payment-serializer"],
    conductor: "ascend-macbook"
  },
  parentEventId: parentMessageId,  // causality
  depth: 1                         // thread depth
}
```

Hub broadcasts to all WebSocket subscribers → all Sentinel viewers update live.

### 4.5 Lore Integration

#### 4.5.1 Auto-Decision Capture

When a message has `intent: "decision"`, Symphony auto-records to Lore:

```typescript
paradigm_lore_record({
  title: `Symphony decision: ${extractTopic(thread)}`,
  summary: decisionMessage.text,
  type: "decision",
  tags: ["arc:symphony", `thread:${threadId}`, ...symbols],
  linkedCommits: extractCommitRefs(thread),
  body: renderThreadSummary(thread)  // Full conversation context
})
```

#### 4.5.2 Thread Resolution → Lore Entry

When a thread is marked resolved, a comprehensive lore entry is created:

```typescript
{
  title: `Resolved: ${thread.topic}`,
  type: "incident" | "decision" | "insight",
  summary: "...",
  body: `
    ## Conversation Thread
    ${renderThreadAsMarkdown(thread)}

    ## Decisions Made
    ${extractDecisions(thread).join('\n')}

    ## Actions Taken
    ${extractActions(thread).join('\n')}

    ## Participants
    ${thread.participants.map(p => `- ${p.name} (${p.type})`).join('\n')}
  `,
  tags: ["arc:symphony", ...thread.symbols],
  linkedCommits: [...],
  linkedLore: [...]
}
```

### 4.6 `/loop` Integration Protocol

The glue that makes agents responsive to Symphony messages.

#### 4.6.1 Auto-Registration

When a Claude Code session starts and Conductor is running:

```
1. paradigm_conductor_register → writes ~/.conductor/sessions/{pid}.json
2. Conductor detects new session → creates AgentMailbox
3. Agent runs: /loop 10s paradigm_symphony_poll
4. Agent is now a live participant in Symphony
```

#### 4.6.2 Poll Response Format

The `paradigm_symphony_poll` tool returns messages formatted as a natural
prompt that the agent can reason about:

```markdown
## Symphony Messages (3 new)

### From: Frontend Opus (ascend's machine) — Question
> Did you change the contract on `/api/tasks`?
> Symbols: #task-api, #payment-serializer
> Thread: "Payment service 500 errors" (4 messages)

**Suggested action:** Check recent changes to #task-api and respond
with relevant diffs or confirmation.

---

### From: ascend (voice) — Decision
> Skip the migration for now. Hotfix the serializer.
> Thread: "Payment service 500 errors"

**Suggested action:** Implement the hotfix as directed.
Respond with confirmation when done.
```

The agent then naturally processes this and calls `paradigm_symphony_send`
with its response, which flows back through Conductor to the network.

---

## 5. Data Flow

### 5.1 Agent → Agent (Same Machine)

```
CC1 (core)                   Conductor                    CC2 (backend)
    │                            │                            │
    ├─ symphony_send() ──────►   │                            │
    │  (writes outbox.jsonl)     │                            │
    │                            ├─ reads outbox ────────►    │
    │                            │  routes to CC2 mailbox     │
    │                            ├─ writes inbox.jsonl ──►    │
    │                            │                            │
    │                            │                    /loop fires
    │                            │                            │
    │                            │            symphony_poll() ─┤
    │                            │            (reads inbox)    │
    │                            │                            │
    │                            │            agent processes  │
    │                            │                            │
    │                            │            symphony_send() ─┤
    │                            │            (writes outbox)  │
```

### 5.2 Agent → Agent (Cross Machine)

```
CC1 (Dev A)         Conductor A         Conductor B         CC1 (Dev B)
    │                   │                   │                   │
    ├─ send() ─────►    │                   │                   │
    │                   ├─ TCP relay ──────►│                   │
    │                   │                   ├─ write inbox ───►│
    │                   │                   │              /loop │
    │                   │                   │           poll() ──┤
    │                   │                   │                   │
    │                   │                   │           send() ──┤
    │                   │                   │◄── read outbox ───┤
    │                   │◄── TCP relay ─────┤                   │
    │              inbox◄──┤                │                   │
    │         /loop fires  │                │                   │
    │         poll() ──────┤                │                   │
```

### 5.3 Human → Conversation

```
Human (voice)        Conductor           Sentinel Hub
    │                   │                    │
    ├─ speech ─────►    │                    │
    │  (WhisperKit)     │                    │
    │                   ├─ SymphonyMessage ──┤
    │                   │  (intent: decision)│
    │                   │                    ├─ broadcast WS
    │                   │                    │  (all viewers update)
    │                   │                    │
    │                   ├─ route to agents ──┤
    │                   │  (all in thread)   │
    │                   │                    │
    │                   ├─ write mailboxes   │
    │                   │                    │
```

### 5.4 Sentinel Alert → Conversation

```
Sentinel              Conductor            Agent
    │                     │                  │
    ├─ WS event ─────►   │                  │
    │  (error pattern)    │                  │
    │                     ├─ create thread   │
    │                     │  "Alert: ..."    │
    │                     │                  │
    │                     ├─ pick best agent │
    │                     │  (by project +   │
    │                     │   symbol match)  │
    │                     │                  │
    │                     ├─ write inbox ───►│
    │                     │  intent: alert   │
    │                     │                  │
    │                     │          /loop ──┤
    │                     │          picks up│
    │                     │          triages │
```

---

## 6. Implementation Phases

### Phase 0: A-Mail — CLI-Only Agent Messaging
> **Goal:** Agents on the same machine can message each other with zero dependencies
> beyond the Paradigm CLI. No Conductor, no Sentinel, just `paradigm symphony`.

**CLI Commands (TypeScript — `packages/paradigm/src/commands/mail/`):**
- [ ] `paradigm symphony join` — discover Claude Code sessions on this machine
      (reads `~/.conductor/sessions/` or creates own registry at `~/.paradigm/score/sessions/`)
- [ ] `paradigm symphony leave` — remove this session from the network
- [ ] `paradigm symphony whoami` — show this agent's identity + linked peers
- [ ] `paradigm symphony list` — list all known agents and their status
- [ ] `paradigm symphony send` — send a message (human → agents from terminal)
- [ ] `paradigm symphony read` — show unread messages
- [ ] `paradigm symphony threads` — list active threads
- [ ] `paradigm symphony thread <id>` — show full thread
- [ ] `paradigm symphony resolve <id>` — resolve thread → Lore entry
- [ ] `paradigm symphony status` — network overview
- [ ] `paradigm symphony serve` — start TCP server for remote mail (port 3939)
- [ ] `paradigm symphony join --remote <ip>` — link to remote mail server

**Mailbox Protocol (file-based):**
- [ ] Mailbox directory: `~/.paradigm/score/agents/{agent-id}/`
- [ ] `inbox.jsonl` — messages waiting for this agent (append-only)
- [ ] `outbox.jsonl` — replies from this agent (append-only)
- [ ] `ack.json` — last acknowledged message ID
- [ ] `identity.json` — agent ID, project, role, PID, start time
- [ ] Thread index: `~/.paradigm/score/threads/{thread-id}.json`
- [ ] JSONL format — one message per line, trivial to parse
- [ ] Garbage collection of acknowledged messages (periodic)

**MCP Tools (TypeScript — `packages/paradigm-mcp/src/tools/symphony.ts`):**
- [ ] `paradigm_symphony_poll` — read inbox, return formatted messages
- [ ] `paradigm_symphony_send` — write to outbox with intent classification
- [ ] `paradigm_symphony_status` — list local agents + active threads
- [ ] `paradigm_symphony_thread` — get full thread context

**Agent Identity:**
- [ ] Stable identity = `{project-name}/{role}` (e.g., `a-paradigm/backend`)
- [ ] When a Claude Code session starts, it registers with a deterministic ID
      based on project directory + working context, not PID
- [ ] PID maps to identity via `identity.json`, survives session restart
      for the same project

**Integration:**
- [ ] `/loop 10s paradigm_symphony_poll` — agent heartbeat
- [ ] Thread auto-creation on first message without parentId
- [ ] Delivery confirmation (ack protocol)
- [ ] `paradigm symphony join` convenience command (registers + starts loop)

**File Pipeline (CLI):**
- [ ] `paradigm symphony request <file> --from <agent>` — request a file
- [ ] `paradigm symphony requests` — list pending file requests (as owner)
- [ ] `paradigm symphony approve <id>` / `paradigm symphony deny <id>` — approve/deny
- [ ] `paradigm symphony approve <id> --redact` — send with sensitive lines stripped
- [ ] Trust config at `~/.paradigm/score/trust.yaml` (auto-approve patterns, never-approve patterns)
- [ ] Default deny list: `.env*`, `*.key`, `*.pem`, `**/credentials*`, `**/secrets/**`

**File Pipeline (MCP):**
- [ ] `paradigm_symphony_request_file` — agent requests a file
- [ ] `paradigm_symphony_approve_file` — approve/deny after human confirms
- [ ] File delivery via `paradigm_symphony_poll` (fileDelivery intent)
- [ ] File request expiry (1 hour TTL)

**Validation:**
- [ ] `paradigm symphony join` discovers 2+ Claude Code sessions on one machine
- [ ] `paradigm symphony send "test"` delivers to all linked agents
- [ ] Agent A runs `/loop`, polls, sees message, responds via `paradigm_symphony_send`
- [ ] Agent B's next poll picks up the response
- [ ] Thread tracking works across 5+ message exchanges
- [ ] `paradigm symphony read` shows unread messages from terminal (human view)
- [ ] Agent requests a file → human sees prompt → approves → agent receives file
- [ ] `.env` files are always denied regardless of approval
- [ ] File request expires after 1 hour without action

### Phase 1: Conductor Auto-Link
> **Goal:** Conductor automatically links all detected Claude Code sessions
> into the A-Mail network — zero manual `paradigm symphony join` needed

**Conductor (Swift):**
- [ ] On detecting a new Claude Code session → auto-create mailbox
- [ ] `AgentMailbox` integration — Conductor writes to `~/.paradigm/score/agents/`
- [ ] `MessageRelay` — route messages between local mailboxes (same file protocol)
- [ ] Thread tracking (thread roots, participant lists)
- [ ] Mailbox garbage collection

**Integration:**
- [ ] Conductor reads `outbox.jsonl`, routes to appropriate `inbox.jsonl`
- [ ] Auto-register `/loop` when Conductor manages the session
- [ ] Conductor UI shows active threads in overlay panel

**File Pipeline (Conductor UI):**
- [ ] File request notification in Conductor overlay (native macOS alert)
- [ ] Approve/deny/redact buttons in overlay
- [ ] Voice approval: "approve" / "deny" via Conductor voice pipeline
- [ ] File transfer activity in Conductor status panel

**Validation:**
- [ ] Start Conductor + 2 Claude Code sessions → auto-linked, no commands needed
- [ ] Same messaging works as Phase 0 but with zero setup
- [ ] Conductor shows thread activity in overlay
- [ ] File requests show as native notifications with approve/deny actions

### Phase 2: Sentinel Conversation View
> **Goal:** Live visualization of agent conversations in Sentinel

**Sentinel Schema:**
- [ ] Register `paradigm-symphony` event schema
- [ ] Forward Symphony messages as Sentinel events (from Conductor)
- [ ] Causality tracking (parentId → parent event)
- [ ] Thread scoping (threadId → scope grouping)

**Sentinel UI:**
- [ ] `ConversationView.tsx` — new view in the Sentinel viewer
- [ ] Thread list sidebar (active conversations)
- [ ] Threaded message tree with indent levels
- [ ] Participant badges (agent vs human, machine label)
- [ ] Intent indicators (DECISION, ACTION, QUESTION badges)
- [ ] Attachment rendering (inline diffs, file references)
- [ ] Live WebSocket updates (new messages animate in)
- [ ] Decision highlighting (auto-extracted from intent)

**Validation:**
- [ ] Conversations from Phase 0 appear live in Sentinel
- [ ] Tree structure renders correctly with proper nesting
- [ ] New messages appear without page refresh
- [ ] Can distinguish agents vs humans, machines vs machines

### Phase 3: Human Participation
> **Goal:** Humans can join conversations via Conductor voice or Sentinel UI

**Conductor (Swift):**
- [ ] Voice message injection — speak into a thread
- [ ] Thread selector — gaze/click to choose which thread to join
- [ ] Human participant registration in threads
- [ ] Voice → SymphonyMessage with `type: .human`

**Sentinel UI:**
- [ ] Text input bar at bottom of ConversationView
- [ ] Reply-to-message (click message → reply)
- [ ] Reference existing message ("re: msg-123")
- [ ] Mark thread as resolved (triggers Lore entry)
- [ ] Decision promotion (click message → mark as decision)

**Validation:**
- [ ] Developer can speak a reply via Conductor, agents see it
- [ ] Developer can type a reply in Sentinel UI, agents see it
- [ ] Agents adjust behavior based on human decisions
- [ ] Thread resolution creates Lore entry

### Phase 4: Network Discovery
> **Goal:** Conductors on the same LAN discover each other automatically

**Conductor (Swift):**
- [ ] `PeerDiscovery` — NWBrowser + NWListener for `_paradigm-symphony._tcp`
- [ ] TXT record advertisement (conductor ID, projects, agent count)
- [ ] Peer connection management (connect/disconnect/reconnect)
- [ ] Peer list in Conductor UI (who's online)

**Conductor UI (Swift):**
- [ ] Network status indicator in panel
- [ ] Peer list view (name, projects, agent count, latency)
- [ ] Connection quality indicators

**Validation:**
- [ ] Two Macs on same WiFi see each other within 5 seconds
- [ ] Peer list updates when machines join/leave
- [ ] No configuration required — fully zero-config
- [ ] Graceful handling of network changes

### Phase 5: Cross-Machine Messaging
> **Goal:** Agents on different machines can converse

**Conductor (Swift):**
- [ ] TCP message transport between peers (NWConnection)
- [ ] Message serialization (Codable JSON over length-prefixed frames)
- [ ] Cross-machine thread coordination
- [ ] Message deduplication (seen-set by message ID)
- [ ] Participant namespace: `{conductorId}/{agentId}` for uniqueness

**Conductor (Swift) — Routing:**
- [ ] Thread subscription — Conductor subscribes to threads its agents care about
- [ ] Symbol-based routing — messages mentioning `#my-component` auto-route to relevant agent
- [ ] Broadcast within thread — all participants in a thread get all messages
- [ ] Cross-project awareness — agents in related projects can be addressed

**Validation:**
- [ ] Agent on Machine A can ask Agent on Machine B a question
- [ ] Agent on Machine B responds, Machine A agent sees it
- [ ] Thread appears consistently on both machines' Sentinel viewers
- [ ] Latency < 500ms for message delivery on LAN

### Phase 6: Sentinel Hub + Lore
> **Goal:** Unified view across all machines, automatic decision capture

**Sentinel Hub:**
- [ ] Hub election via Bonjour (lowest conductor ID wins)
- [ ] All Conductors forward Symphony events to hub
- [ ] Hub broadcasts to all WebSocket subscribers
- [ ] Hub failover (re-election on disconnect)
- [ ] Cross-machine event deduplication

**Lore Integration:**
- [ ] Auto-record decisions from `intent: decision` messages
- [ ] Thread resolution → comprehensive Lore entry
- [ ] `arc:symphony` tag for all Symphony-originated lore
- [ ] Thread summary rendering (participants, decisions, actions)
- [ ] Link Lore entries to commits mentioned in thread

**Validation:**
- [ ] Single Sentinel UI shows conversations from all machines
- [ ] Decisions auto-appear in Lore
- [ ] Lore entry includes full conversation context
- [ ] Hub election works transparently

### Phase 7: Intelligent Routing + Polish
> **Goal:** Smart agent selection, conversation quality, production readiness

**Smart Routing:**
- [ ] Symbol affinity — route messages about `#payment-service` to the agent
      working in that codebase
- [ ] Role awareness — architect questions → architect agent, code questions → builder
- [ ] Load balancing — if two agents cover the same project, route to the idle one
- [ ] Priority escalation — Sentinel alerts get priority delivery

**Conversation Quality:**
- [ ] Thread summarization — long threads get periodic AI summaries
- [ ] Decision extraction — AI identifies implicit decisions in conversation
- [ ] Conflict detection — flag when two agents propose contradictory changes
- [ ] Context windowing — agents get thread summary + last N messages (not entire history)

**Production Hardening:**
- [ ] Rate limiting (messages per minute per agent)
- [ ] Message size limits (prevent runaway context)
- [ ] Thread archival (old threads → Lore + archive)
- [ ] Metrics: message latency, delivery rate, thread resolution time
- [ ] Auth: optional bearer token for Sentinel hub connections

---

## 7. Security Considerations

### 7.1 Network Security

- **LAN only** — Bonjour/mDNS is link-local, does not cross routers
- **No cloud** — all communication is direct machine-to-machine
- **Optional TLS** — NWConnection supports TLS for peer connections
- **No secrets in messages** — agents should not relay API keys, tokens, or credentials
- **Conductor identity** — UUID persisted locally, not transferable

### 7.2 Agent Guardrails

- **Human override** — human `decision` intent always takes priority
- **Action confirmation** — destructive actions (delete, force push) require explicit approval
- **Thread scope** — agents can only see threads they're participants in
- **Rate limiting** — prevent agent loops (A asks B, B asks A, repeat)
- **Loop detection** — if agent A and agent B exchange > 10 messages without
  human input or a decision, pause and flag for human attention

### 7.3 Data Privacy

- **Project isolation** — agents only see messages relevant to their project
- **No persistent storage in Conductor** — mailboxes are ephemeral
- **Sentinel retention** — follows existing Sentinel retention policy
- **Lore is explicit** — only `decision` and `resolution` messages become Lore

### 7.4 File Transfer Security

- **Human-gated** — every file transfer requires explicit human approval from the owner
- **Never-approve list** — `.env*`, `*.key`, `*.pem`, `**/credentials*`, `**/secrets/**`
  are **always denied**, even if the human clicks approve (hard block)
- **Trust levels** — per-user trust config with auto-approve glob patterns
- **Redaction** — option to strip sensitive lines before sending
- **Expiry** — file requests expire after 1 hour without action
- **Integrity** — SHA-256 hash on delivery for verification
- **Size limits** — binary files > 10MB denied by default
- **Audit trail** — all file requests/approvals/denials logged in Sentinel
- **No ambient access** — agents cannot browse another agent's filesystem,
  only request specific files by path

---

## 8. Model Interactions

### 8.1 How Agents Experience Symphony

From the agent's perspective, Symphony messages arrive as structured prompts
during their `/loop` cycle. The agent doesn't need special Symphony training —
the MCP tool formats messages as natural language with clear context:

```markdown
## Symphony: 2 new messages in "Payment service 500 errors"

### 1. Frontend Opus (ascend's machine) — Question (2:34 PM)
> Did you change the contract on `/api/tasks`?
> Symbols: #task-api

### 2. ascend — Decision (2:35 PM)
> Skip the migration. Hotfix the serializer to default 'USD'.

You are participating in a live multi-agent conversation. Respond naturally:
- Use paradigm_symphony_send to reply
- Set intent to reflect your message type (context, action, proposal, etc.)
- Reference symbols with # $ ^ ! ~ prefixes
- If you take an action (edit files), report it with intent: "action"
- If you need info from another agent, ask with intent: "question"
```

### 8.2 Agent Conversation Guidelines

Embedded in the poll response as system context:

1. **Be concise** — other agents and humans are reading your messages
2. **Reference symbols** — use #component, $flow, ^gate, !signal prefixes
3. **Attach diffs** — when you change code, include the relevant diff
4. **Declare intent** — question, proposal, action, decision
5. **Respect decisions** — when a human makes a decision, act on it
6. **Don't loop** — if you've exchanged 3+ messages without progress, summarize and ask for human input
7. **Scope replies** — reply to specific messages, don't broadcast unless necessary
8. **Request files explicitly** — use `paradigm_symphony_request_file` with a reason; never assume you can read another agent's files
9. **Report file needs early** — if you'll need a file from another project, request it before you need it (approval takes human time)

---

## 9. Configuration

### 9.1 Conductor Settings

```yaml
# ~/.conductor/config.yaml (new section)
symphony:
  enabled: true
  pollInterval: 10                   # seconds (default: 10)
  maxThreads: 20                     # max concurrent threads
  autoRegisterLoop: true             # auto-setup /loop on agent registration
  sentinelForwarding: true           # forward messages to Sentinel
  voiceParticipation: true           # allow voice messages via Conductor
  networkDiscovery: true             # enable Bonjour peer discovery
  loopDetectionThreshold: 10        # max agent-agent exchanges before pause
```

### 9.2 Per-Project Settings

```yaml
# .paradigm/config.yaml (new section)
symphony:
  enabled: true
  autoJoinThreads: true              # agents auto-join threads about their symbols
  symbolRouting: true                # route messages by symbol affinity
  loreCapture: true                  # auto-record decisions to Lore
```

---

## 10. Metrics & Observability

Symphony emits its own metrics via Sentinel:

| Metric | Type | Description |
|--------|------|-------------|
| `symphony.messages.sent` | counter | Messages sent by agent/human |
| `symphony.messages.delivered` | counter | Messages successfully delivered |
| `symphony.messages.latency` | histogram | Time from send to delivery |
| `symphony.threads.active` | gauge | Currently active threads |
| `symphony.threads.resolved` | counter | Threads resolved |
| `symphony.peers.connected` | gauge | Connected Conductors |
| `symphony.decisions.captured` | counter | Decisions auto-recorded to Lore |
| `symphony.loops.detected` | counter | Agent-agent loops caught |

---

## 11. Existing Infrastructure Leverage

### What we already have → What it becomes in Symphony

| Existing | Symphony Role |
|----------|--------------|
| **Conductor ClaudeCodeDetector** | Agent discovery (which sessions exist) |
| **Conductor SessionFileWatcher** | Agent registration trigger |
| **Conductor AXDispatchTarget** | Message injection fallback (if mailbox fails) |
| **Conductor WhisperVoiceProvider** | Human voice input to conversations |
| **Conductor GazeZoneRouter** | Thread/agent targeting via gaze |
| **Conductor SentinelWSClient** | Event forwarding to Sentinel hub |
| **Conductor WorkspaceManager** | Multi-agent window management |
| **Sentinel WebSocket server** | Real-time conversation broadcasting |
| **Sentinel generic events** | Symphony message storage |
| **Sentinel causality tracking** | Thread tree structure |
| **Sentinel scope grouping** | Thread-based event grouping |
| **Sentinel visualization hints** | Tree view for conversations |
| **Team AgentRelay** | Message format inspiration |
| **Team agent-provider** | Agent spawning for on-demand experts |
| **Lore entries** | Decision persistence |
| **Lore arc tags** | `arc:symphony` grouping |
| **`/loop`** | Agent heartbeat / message polling |
| **`paradigm_conductor_register`** | Session → mailbox creation |

### What's genuinely new

| New Component | Package | Effort |
|---------------|---------|--------|
| `AgentMailbox` | conductor (Swift) | Small — file I/O + queue |
| `MessageRelay` | conductor (Swift) | Medium — routing logic |
| `PeerDiscovery` | conductor (Swift) | Medium — Network.framework |
| TCP transport | conductor (Swift) | Medium — NWConnection |
| Hub election | conductor (Swift) | Small — deterministic from Bonjour |
| `paradigm_symphony_*` MCP tools | paradigm-mcp (TS) | Medium — 6 new tools |
| `paradigm symphony` CLI commands | paradigm (TS) | Medium — 11 commands |
| `ConversationView` | sentinel (React) | Medium — new view component |
| Symphony event schema | sentinel (TS) | Small — schema declaration |
| Lore auto-capture | paradigm-mcp (TS) | Small — hook into existing |
| Mailbox file protocol | both | Small — JSONL read/write |
| File pipeline + trust config | both | Medium — request/approve/deny/deliver |
| File approval UI | conductor (Swift) | Small — native notifications |

---

## 12. Open Questions

1. **Thread initiation** — Should agents be able to start threads, or only humans/Sentinel alerts?
   *Recommendation:* Both. Agents can start threads when they detect issues or need
   cross-project input. Humans can start threads from Sentinel UI or voice.

2. **Message persistence** — Should mailbox messages survive Conductor restart?
   *Recommendation:* No. Mailboxes are ephemeral. Persistent record lives in Sentinel.
   On restart, agents can query Sentinel for thread history.

3. **Agent identity across sessions** — Same Claude Code session PID changes on restart.
   How to maintain thread continuity?
   *Recommendation:* Use project directory + role as stable identity. Thread participants
   are addressed by role@project, not by PID.

4. **Polling interval** — 10 seconds means up to 10s latency. Too slow for real-time triage?
   *Recommendation:* Start with 10s. If too slow, explore: (a) shorter interval for active
   threads, (b) file system event notification to trigger immediate poll, (c) direct stdin
   injection as stretch goal.

5. **Context budget** — Each poll consumes agent context. How to prevent Symphony
   overhead from crowding out actual work?
   *Recommendation:* Poll returns compact summaries. Full thread context only on
   `paradigm_symphony_thread`. Agents can "mute" threads they're not actively in.

6. **Cross-project symbol resolution** — Agent A references `#payment-service` from
   project X. Agent B is in project Y. How to resolve?
   *Recommendation:* Leverage existing workspace infrastructure. Symbols in messages
   are qualified: `projectName/#payment-service`. Local symbols don't need prefix.

---

## 13. Success Criteria

### Phase 0 (A-Mail — CLI Only)
- `paradigm symphony join` discovers sessions on this machine
- Two agents exchange 5+ messages via file-based mailboxes
- Agent responds to a question within 15 seconds of it being asked
- `paradigm symphony read` shows conversation from human terminal
- Works with zero dependencies beyond Paradigm CLI
- Agent requests a file → human approves via `paradigm symphony approve` → file delivered
- `.env` files hard-blocked even with human approval
- Trust config controls auto-approve patterns per user

### Phase 1 (Conductor Auto-Link)
- Conductor auto-links all Claude Code sessions — no manual commands
- Same messaging as Phase 0 but with zero setup
- File requests show as native macOS notifications with approve/deny

### Phase 2 (Sentinel View)
- Conversation tree renders live in browser
- Can distinguish agent vs human, see intent badges
- New messages appear without refresh

### Phase 3 (Human Participation)
- Developer speaks a decision via Conductor, agents act within 30 seconds
- Developer types a reply in Sentinel UI, agents see it
- Thread resolution creates a Lore entry with full context

### Phase 4-5 (Network)
- Two Macs on same WiFi discover each other within 5 seconds
- Cross-machine message delivery < 500ms
- No configuration required (Bonjour) OR `paradigm symphony join --remote` (CLI)

### Phase 6 (Hub + Lore)
- Single Sentinel shows conversations from all machines
- Decision capture rate > 90% (decisions identified and recorded)

### Phase 7 (Smart Routing)
- Messages about `#X` auto-route to the agent working on `#X`
- Loop detection catches infinite agent-agent exchanges

---

*Let's rock and roll. 🎸*
