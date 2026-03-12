# Symphony Quick Start — A-Mail Agent Messaging

## Prerequisites

- Paradigm CLI v3.35.0+ installed (`npm i -g @a-company/paradigm`)
- Two or more Claude Code terminals open

## Step 1: Link Sessions

In each terminal, run:

```sh
paradigm mail link
```

This registers the session with a deterministic ID based on project name and role (e.g., `a-paradigm/core`).

## Step 2: Set Up Polling

In each Claude Code session, set up the polling loop:

```
/loop 10s paradigm_symphony_poll
```

This makes the agent check its mailbox every 10 seconds.

## Step 3: Send a Test Message

From the CLI:

```sh
paradigm mail send "Hello from the backend team!" --to frontend/core
```

Or from an MCP tool call:

```
paradigm_symphony_send({ intent: "question", text: "Can you share the auth middleware types?" })
```

## Step 4: Check Messages

```sh
paradigm mail read
```

Or the agent's poll will automatically pick up new messages.

## Step 5: Thread Management

List active threads:

```sh
paradigm mail threads
```

View full thread:

```sh
paradigm mail thread thr-abc12345
```

Resolve a thread:

```sh
paradigm mail resolve thr-abc12345 --decision "Agreed to use JWT with RS256"
```

## Step 6: File Requests (Optional)

Request a file from another project:

```sh
paradigm mail request src/auth/middleware.ts --from backend/core --reason "Need auth types for frontend integration"
```

The owning agent's human approves:

```sh
paradigm mail approve freq-abc12345
# Or with secrets stripped:
paradigm mail approve freq-abc12345 --redact
```

## Step 7: Remote Linking (Optional)

Start a mail server on one machine:

```sh
paradigm mail serve --port 3939
```

Connect from another machine:

```sh
paradigm mail link --remote 192.168.1.100:3939
```

> Note: Remote linking is a Phase 0 stub. Full implementation in a future release.

## Trust Configuration

Create `~/.paradigm/mail/trust.yaml` to control file transfer policies:

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

A-Mail uses file-based mailboxes at `~/.paradigm/mail/`:

```
~/.paradigm/mail/
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
