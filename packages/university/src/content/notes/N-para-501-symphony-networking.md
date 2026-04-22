---
id: N-para-501-symphony-networking
title: 'Symphony Networking: Cross-Machine Relay'
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-501
  - hub-and-spoke-topology-one
  - websocket-relay-watches
  - pairing-6-digit-code
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-501.json
---

## Beyond Single-Machine Messaging

Symphony Phase 0 (A-Mail) established file-based agent-to-agent messaging on a single machine — JSONL mailboxes at `~/.paradigm/score/`, polled via `/loop`. But what happens when two developers on the same WiFi, or at different locations, want their Claude instances to collaborate?

Symphony Phase 1 adds cross-machine networking via a WebSocket relay. The key design principle: **the local mailbox model is unchanged**. Networking is a transparent sync layer that watches local outboxes and delivers remote messages to local inboxes.

## Hub-and-Spoke Topology

One machine runs `paradigm symphony serve` (the **hub**), and others connect with `paradigm symphony join --remote` (the **spokes**). The hub relays messages between all connected machines.

```
Machine A (Hub)                     Machine B (Spoke)
┌─────────────────────┐           ┌─────────────────────┐
│ ~/.paradigm/score/  │           │ ~/.paradigm/score/  │
│   agents/projA/core │           │   agents/projB/core │
│     inbox.jsonl     │◄────ws───►│     inbox.jsonl     │
│     outbox.jsonl    │  :3939    │     outbox.jsonl    │
└─────────────────────┘           └─────────────────────┘
```

The relay watches each local agent's outbox file (polling every 2 seconds via `fs.stat`). When new messages appear, they're pushed to all connected peers as WebSocket frames. Incoming messages from peers are written to the appropriate local inbox via `appendToInbox()`.

## Pairing & Authentication

Security is critical when connecting machines over a network. Symphony uses a pairing code + HMAC challenge-response protocol:

1. The hub generates a 32-byte random secret and derives a **6-digit pairing code**
2. The code is displayed on the hub's terminal
3. The spoke connects and receives a `hello` frame with a random challenge nonce
4. The user enters the code on the spoke terminal (or embeds it in the connection string)
5. The spoke computes `HMAC-SHA256(challenge, SHA256(code))` and sends an `auth` frame
6. The hub verifies the code and HMAC proof, then sends `auth_ok` with its agent list

Pairing codes rotate every 5 minutes. After 3 failed attempts from the same IP, a 60-second cooldown is enforced. Peer records are saved to `~/.paradigm/score/peers.json` (file mode 0600) for auto-reconnect.

## Two Connection Modes

### LAN Pairing (same WiFi)

```sh
# Machine A (hub)
paradigm symphony serve
# Shows: Pairing Code: 847 291

# Machine B (spoke)
paradigm symphony join --remote 192.168.1.42:3939
# Prompted for code
```

### Internet Direct Connect

```sh
# Machine A
paradigm symphony serve --public
# Shows connection string

# Machine B
paradigm symphony join --remote 73.162.44.103:3939#847291
# Code embedded — no prompt
```

Internet mode requires port 3939 to be reachable (port forward, VPN, or SSH tunnel).

## Trust Management

Peers are managed via CLI commands:

- `paradigm symphony peers` — List trusted peers with agent counts and last-seen times
- `paradigm symphony peers revoke <id>` — Immediately disconnect and block reconnection
- `paradigm symphony peers forget --force` — Clear all peer trust records

Existing `trust.yaml` hard-deny patterns (`.env*`, `*.key`, `*.pem`) apply to remote file requests — the trust boundary extends across the network.

## Relay Internals

The `SymphonyRelay` class handles both server and client modes:

- **Outbox watcher**: Polls every 2s, compares outbox line counts against stored positions, forwards new messages
- **Deduplication**: Bounded `Set<string>` of message IDs (max 10,000) prevents duplicate delivery
- **Keepalive**: Ping/pong every 30s with 10s pong timeout. Dead connections are auto-terminated
- **Auto-reconnect**: Client mode uses exponential backoff (1s → 2s → 4s → ... → 30s max)
- **Rate limiting**: 3 failed auth attempts from the same IP triggers a 60s cooldown

## Remote Agent Visibility

Remote agents appear throughout the Symphony CLI and MCP tools:

- `paradigm symphony list` shows remote agents with a `(remote: peer-name)` tag
- `paradigm symphony status` includes peer count and remote agent totals
- `paradigm_symphony_status` MCP tool returns a `peers` array in its response
- Platform UI `GET /api/symphony/peers` endpoint returns connected peer data

Local MCP tools (`peek`, `poll`, `send`) work unchanged — they just read/write local files. The relay handles the network transport transparently.

## Backward Compatibility

If `paradigm symphony serve` is never run, Symphony operates exactly as Phase 0: local-only file-based messaging. Networking is purely additive — no existing workflows change.
