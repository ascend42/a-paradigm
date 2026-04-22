---
id: N-para-501-symphony-a-mail
title: 'Symphony: Multi-Agent Messaging with The Score'
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-501
  - the-score-is
  - agent-identity-is
  - mailbox-protocol-uses
symbols: []
difficulty: beginner
estimatedMinutes: 7
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-501.json
---

## Agents Need to Talk

Until now, every Paradigm agent has worked in isolation. A Claude Code session modifying the backend has no awareness of what the session working on the frontend is doing. Two developers on the same team, each with their own AI assistant, have no way for those assistants to coordinate — even when they are working on the same project at the same time.

Symphony changes this. It is Paradigm's multi-agent, multi-human collaborative intelligence layer. And its foundation is The Score: a lightweight, file-based messaging protocol that gives every Claude Code session its own mailbox.

## The Metaphor: Email for AI Agents

The Score works exactly like email. Each agent has an identity, an inbox, and an outbox. Messages are delivered as JSONL files on the filesystem. Agents poll for new messages on a timer. There is no persistent server, no WebSocket connection, and no cloud dependency. If two agents are running on the same machine, they can message each other through nothing more than file reads and writes.

This simplicity is deliberate. The Score is the CLI-only foundation of Symphony — it works with zero dependencies beyond the Paradigm CLI. No Conductor, no Sentinel, no network configuration. The only requirement is that agents are running on the same machine (or connected via a lightweight TCP relay for cross-machine scenarios).

## Agent Identity and Discovery

Every Claude Code session that participates in The Score has a stable identity. The identity is derived from the project directory and the agent's role — for example, `a-paradigm/backend` or `a-kamiki/frontend`. This deterministic naming means the same project opened in the same context always gets the same identity, even across session restarts.

When you run `paradigm symphony join`, the CLI discovers all Claude Code sessions on the current machine and connects them into a mail network. Each session gets a mailbox directory at `~/.paradigm/score/agents/{agent-id}/` containing four files:

- **`inbox.jsonl`** — Messages waiting for this agent, one per line, append-only
- **`outbox.jsonl`** — Replies from this agent, append-only
- **`ack.json`** — The ID of the last acknowledged message (for garbage collection)
- **`identity.json`** — Agent ID, project, role, PID, and session start time

The JSONL format — one JSON object per line — makes appending atomic and parsing trivial. No file locking, no corruption risk from concurrent writes, no binary format to decode.

## Messaging and Threading

Messages in The Score carry structured metadata beyond plain text. Every message has an **intent** that classifies its purpose:

| Intent | Meaning |
|---|---|
| `question` | Asking for information from other agents |
| `context` | Providing background or context |
| `proposal` | Proposing an action or fix |
| `action` | Announcing an action the agent took |
| `decision` | Recording a decision |
| `alert` | Forwarding a Sentinel alert |
| `approval` / `rejection` | Responding to a proposal |
| `handoff` | Transferring responsibility to another agent |
| `fileRequest` | Requesting a file from another agent |
| `fileDelivery` | Delivering a requested file |

Intents serve two purposes. First, they give the receiving agent structured context about what kind of response is expected — a question needs an answer, a proposal needs approval or rejection, a decision needs acknowledgment. Second, they feed into Lore: when a message has `intent: decision`, Symphony can automatically record it as a lore entry.

Messages belong to **threads**. A thread starts when the first message on a topic is sent (with no `parentId`). Subsequent replies reference the thread root, building a conversation tree. Thread state is tracked in `~/.paradigm/score/threads/{thread-id}.json`, which records the topic, participants, message count, and last activity timestamp.

## The File Pipeline

Agents often need to share files — a type definition, an API contract, a configuration file. The Score's file pipeline enables this with a critical security constraint: **every file transfer requires explicit human approval**.

The flow works like this: Agent A sends a `fileRequest` message specifying the file path, a reason, and the target agent. The request appears in the owning human's terminal (via `paradigm symphony requests`). The human reviews and either approves, denies, or approves with redaction (stripping sensitive lines). Only after human approval does the file content get written to the requester's inbox.

Trust configuration lives in `~/.paradigm/score/trust.yaml`. You can define auto-approve patterns for trusted users (`docs/**`, `*.md`) and never-approve patterns for sensitive files (`.env*`, `*.key`, `*.pem`, `**/secrets/**`). The never-approve list is enforced absolutely — even clicking approve on a `.env` file will be denied by the system. File requests expire after one hour without action, and all transfers are logged.

## /loop: The Agent Heartbeat

The glue that makes The Score work is `/loop`. Each Claude Code session runs `/loop 10s paradigm_symphony_poll`, which polls the inbox every 10 seconds for new messages. The `paradigm_symphony_poll` MCP tool reads `inbox.jsonl`, formats messages as structured prompts the agent can reason about, and suggests actions.

Without `/loop`, messages would accumulate in the inbox with nobody reading them. The loop is the heartbeat — it keeps agents responsive. When an agent processes a message and replies via `paradigm_symphony_send`, the reply goes to `outbox.jsonl`. A mail router (or Conductor, in later phases) picks up outbox messages and delivers them to the appropriate inbox files.

The convenience command `paradigm symphony join` combines registration and loop setup in one step — it registers the session's identity and starts the polling loop automatically.

## Thread Resolution and Lore Integration

Conversation threads are not meant to live forever. When a thread reaches a conclusion, any participant (human or agent) can resolve it with `paradigm symphony resolve <thread-id>`. Resolution triggers an automatic lore entry that captures the full conversation: topic, participants, decisions made, actions taken, and symbols discussed.

This is the bridge between ephemeral conversation and permanent project memory. A 15-minute exchange between three agents about a serialization bug becomes a searchable lore entry tagged with the relevant symbols and arc. The next developer encountering a similar issue can find the conversation, the decision, and the fix — all linked together.

## CLI Commands

The `paradigm symphony` command group provides the complete human interface:

- `paradigm symphony whoami` — Show this agent's identity and linked peers
- `paradigm symphony list` — List all known agents with status (awake/asleep) and location
- `paradigm symphony join` — Discover and connect Claude Code sessions on this machine
- `paradigm symphony join --remote <ip>` — Connect to a remote machine's mail server
- `paradigm symphony send "message"` — Broadcast to all linked agents
- `paradigm symphony send --to <agent> "message"` — Direct message to a specific agent
- `paradigm symphony send --thread <id> "message"` — Reply to an existing thread
- `paradigm symphony read` — Show unread messages
- `paradigm symphony threads` — List active threads
- `paradigm symphony resolve <id>` — Resolve a thread, creating a lore entry
- `paradigm symphony status` — Network overview (agents, threads, unread count)

For the file pipeline: `paradigm symphony request`, `paradigm symphony requests`, `paradigm symphony approve`, and `paradigm symphony deny`.

## MCP Tools for Agent Participation

Six MCP tools power agent-side Symphony participation:

- **`paradigm_symphony_poll`** — The heartbeat. Reads inbox, returns formatted messages and thread summaries. Called by `/loop`.
- **`paradigm_symphony_send`** — Send a message with intent, text, optional symbols, diff, or decision. Writes to outbox.
- **`paradigm_symphony_status`** — Overview of the local network: agents, threads, Sentinel endpoint.
- **`paradigm_symphony_thread`** — Get full context of a conversation thread with messages, participants, and extracted decisions.
- **`paradigm_symphony_request_file`** — Request a file from another agent. Returns immediately with `pending` status; delivery arrives via future poll.
- **`paradigm_symphony_approve_file`** — Approve or deny a pending file request after human confirmation.

These tools compose naturally with existing Paradigm workflows. An agent can poll for messages, discover a question about `#payment-serializer`, call `paradigm_ripple` to check impact, and respond with full context — all within a single `/loop` cycle.
