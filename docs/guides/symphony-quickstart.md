# Symphony Quick Start — The Score Agent Messaging

## Prerequisites

- Paradigm CLI v3.35.0+ installed (`npm i -g @a-company/paradigm`)
- Two or more Claude Code terminals open

## Step 1: Link Sessions

In each terminal, run:

```sh
paradigm symphony join
```

This registers the session with a deterministic ID based on project name and role (e.g., `a-paradigm/core`).

## Step 2: Set Up Polling

In each Claude Code session, set up the polling loop:

```
/loop 10s paradigm_symphony_poll
```

This makes the agent check its part every 10 seconds.

## Step 3: Send a Test Message

From the CLI:

```sh
paradigm symphony send "Hello from the backend team!" --to frontend/core
```

Or from an MCP tool call:

```
paradigm_symphony_send({ intent: "question", text: "Can you share the auth middleware types?" })
```

## Step 4: Check Messages

```sh
paradigm symphony read
```

Or the agent's poll will automatically pick up new messages.

## Step 5: Thread Management

List active threads:

```sh
paradigm symphony threads
```

View full thread:

```sh
paradigm symphony thread thr-abc12345
```

Resolve a thread:

```sh
paradigm symphony resolve thr-abc12345 --decision "Agreed to use JWT with RS256"
```

## Step 6: File Requests (Optional)

Request a file from another project:

```sh
paradigm symphony request src/auth/middleware.ts --from backend/core --reason "Need auth types for frontend integration"
```

The owning agent's human approves:

```sh
paradigm symphony approve freq-abc12345
# Or with secrets stripped:
paradigm symphony approve freq-abc12345 --redact
```

## Step 7: Remote Linking

Connect Symphony agents across machines using the WebSocket relay.

### LAN Pairing (Same WiFi)

On Machine A (hub):

```sh
paradigm symphony serve
```

This displays a 6-digit pairing code. Share it with the person connecting.

On Machine B (spoke):

```sh
paradigm symphony join --remote 192.168.1.42:3939
```

Enter the pairing code when prompted. Once connected, messages flow bidirectionally.

### Internet Direct Connect

On Machine A:

```sh
paradigm symphony serve --public
```

This shows a connection string with the pairing code embedded.

On Machine B:

```sh
paradigm symphony join --remote 73.162.44.103:3939#847291
```

No interactive prompt needed — the code after `#` is used automatically.

> **Note:** Internet mode requires port 3939 to be reachable (port forward, VPN, or SSH tunnel).

### Managing Peers

```sh
paradigm symphony peers          # List trusted peers
paradigm symphony peers revoke <id>  # Revoke + disconnect
paradigm symphony peers forget --force  # Clear all peer trust
```

### How It Works

The relay uses a hub-and-spoke topology. The `serve` machine acts as hub, and each `join --remote` machine is a spoke. The hub relays messages between all connected machines. Pairing codes rotate every 5 minutes, and authentication uses HMAC-SHA256 challenge-response.

Remote agents appear in `paradigm symphony list` with a `(remote: peer-name)` tag. Messages to/from remote agents land in local inboxes — no changes to your workflow.

## Trust Configuration

Create `~/.paradigm/score/trust.yaml` to control file transfer policies:

```yaml
trust:
  users:
    kevin:
      level: teammate
      autoApprove:
        - "docs/**"
        - "*.md"
      neverApprove:
        - ".env*"
  defaults:
    level: restricted
    autoApprove: []
    neverApprove:
      - ".env*"
      - "**/*.key"
      - "**/*.pem"
      - "**/credentials*"
      - "**/secrets/**"
```

## Architecture

The Score uses file-based parts at `~/.paradigm/score/`:

```
~/.paradigm/score/
  agents/{project}/{role}/
    inbox.jsonl      <- Messages for this agent
    outbox.jsonl     <- Messages from this agent
    ack.json         <- Last read message ID
    identity.json    <- Agent registration
  threads/           <- Thread metadata
  file-requests/     <- Pending file transfers
  trust.yaml         <- Trust configuration
```

No server required — everything is file-based, using JSONL for append-only writes.
