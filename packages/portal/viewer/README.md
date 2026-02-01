# @a-company/portal-viewer

Real-time visualization and testing dashboard for portal (gate) activations.

## Features

- **Live Constellation View**: Gates displayed as interconnected stars that "light up" when activated
- **Event Timeline**: Scrolling log of all portal events with filtering
- **Testing Checklist**: Auto-ticking checklist for QA verification
- **Session Recording**: Capture test sessions for reporting
- **Flow Visualization**: Track progress through multi-gate flows
- **Webhook Reporting**: Send session reports to Slack, Discord, email, or custom endpoints

## Installation

```bash
npm install @a-company/portal-viewer
```

## Usage

### As a CLI (via paradigm)

```bash
# Start the portal viewer
paradigm portal watch
```

### Programmatically

```typescript
import { ViewerServer } from '@a-company/portal-viewer';

const server = new ViewerServer({
  port: 42196,     // WebSocket port for SDK connections (marathon + 1)
  uiPort: 42195,   // HTTP port for UI (marathon: 42.195km)
  configPath: './portal.yaml',
});

await server.start();
```

## Architecture

```
┌─────────────────────┐      ┌─────────────────────┐
│   Your App (:8080)  │      │ Portal Viewer       │
│                     │      │                     │
│  ┌───────────────┐  │      │  ┌───────────────┐  │
│  │  Portal SDK   │──┼─────►│  │ WebSocket     │  │
│  │               │  │      │  │ Server(:42196)│  │
│  │ portal.check()│  │      │  └───────┬───────┘  │
│  └───────────────┘  │      │          │          │
│                     │      │  ┌───────▼───────┐  │
└─────────────────────┘      │  │ Constellation │  │
                             │  │ UI (:42195)   │  │
                             │  └───────────────┘  │
                             └─────────────────────┘
```

## Ports

| Port | Purpose |
|------|---------|
| 42195 | HTTP server for UI (marathon: 42.195km) |
| 42196 | WebSocket server for SDK connections |

## Views

### Constellation View

A visual star map where each portal is a node. When portal events occur:

- **Checking**: Yellow pulse animation
- **Passed**: Green glow effect
- **Failed**: Red glow effect

### Checklist View

List of all gates with checkboxes that auto-tick when gates are hit:

- ⬜ Unchecked - gate not yet visited
- ✅ Passed - gate was allowed
- ❌ Failed - gate was denied
- ⚠️ Mixed - gate had both passes and failures

### Timeline View

Scrolling log of all events with:

- Gate name
- Decision (allow/deny)
- Reason
- Entity ID
- Timestamp
- Duration

## Session Recording

Start a session to capture all events:

```
1. Click "Start Recording"
2. Run your tests
3. Click "End Session"
4. Export or send to webhooks
```

## Webhook Integration

Configure webhooks in `.paradigm/portal-webhooks.yaml`:

```yaml
webhooks:
  slack-qa:
    type: slack
    url: https://hooks.slack.com/services/xxx/yyy/zzz
    enabled: true
    triggers: [session-end, gate-fail]
```

## Development

```bash
# Install dependencies
npm install

# Start dev server (UI only)
npm run dev

# Start WebSocket server
npm run dev:server

# Build everything
npm run build
```

## License

MIT
