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

### Internet Connect — Behind NAT (Power Users)

If both machines are behind NAT (no public IP, no port forwarding), you need a tunnel. Three options, from easiest to most manual:

#### Option 1: Tailscale (Recommended)

[Tailscale](https://tailscale.com) creates a private network between your machines. Free tier, no config.

```sh
# Both machines: install Tailscale and log in
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# Check your Tailscale IP
tailscale ip -4
# Example: 100.64.0.1 (Machine A), 100.64.0.2 (Machine B)

# Machine A: start Symphony relay
paradigm symphony serve

# Machine B: join using Tailscale IP
paradigm symphony join --remote 100.64.0.1:3939
# Enter the pairing code when prompted
```

That's it. Tailscale handles NAT traversal, encryption (WireGuard), and DNS. Both machines see each other as if on the same LAN.

#### Option 2: ngrok (Quick, No Install on Remote)

[ngrok](https://ngrok.com) exposes a local port to the internet via their relay. Free tier has connection limits.

```sh
# Machine A: install ngrok and expose Symphony
ngrok tcp 3939
# Output:
#   Forwarding tcp://0.tcp.ngrok.io:12345 -> localhost:3939

# Machine A: also start Symphony
paradigm symphony serve

# Machine B: join using ngrok URL
paradigm symphony join --remote 0.tcp.ngrok.io:12345
# Enter the pairing code when prompted
```

ngrok gives you a public address that tunnels to your local relay. Machine B connects outbound to ngrok, ngrok forwards to Machine A. No port forwarding needed on either side.

> **Note:** Free ngrok has session time limits and connection caps. Good for testing, not for always-on use.

#### Option 3: SSH Tunnel (Power Users with a Server)

If either person has a server with SSH access (VPS, cloud box, work machine with port 22 open):

```sh
# Scenario: Machine A runs Symphony, Machine B tunnels through a shared server

# Machine A: start Symphony relay
paradigm symphony serve

# Machine A: expose local relay through the server (reverse tunnel)
ssh -R 3939:localhost:3939 user@your-server.com
# This makes your-server.com:3939 forward to Machine A's localhost:3939

# Machine B: connect to the server
paradigm symphony join --remote your-server.com:3939
# Enter the pairing code when prompted
```

Alternative — both tunnel through the server:

```sh
# Machine A: reverse tunnel (expose relay on server)
ssh -R 3939:localhost:3939 user@server.com

# Machine B: local tunnel (make server:3939 appear as localhost:3939)
ssh -L 3939:localhost:3939 user@server.com

# Machine B: join via local tunnel
paradigm symphony join --remote localhost:3939
```

> **Note:** SSH tunnels require both users to have SSH access to the same server. The tunnel is encrypted but the Symphony relay itself uses plain `ws://` — the SSH layer provides the security.

#### Coming Soon: nevr.land Relay

A managed relay at `relay.nevr.land` is planned so you can connect with just:

```sh
paradigm symphony join --relay nevr.land
```

Both users connect outbound (no port config), relay bridges them, auth via nevr.land accounts. Until then, use one of the options above.

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
