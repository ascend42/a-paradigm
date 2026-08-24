---
name: observe
description: View live logs, metrics, and traces from Sentinel. Use when the user says "show logs", "check metrics", "view traces", "what's happening", or when monitoring application behavior.
allowed-tools: Bash(curl *), Read
---

# Sentinel Observability

You are using Paradigm Sentinel's observability features to view logs, metrics,
and traces from running applications.

## Step 1: Check Connected Services

Call `paradigm_sentinel_stats` to see which services are reporting:

```
paradigm_sentinel_stats({ period: "1h" })
```

This shows active services, log volume, and recent activity.

## Step 2: View Logs

### Recent logs for a service
```bash
curl -s http://localhost:3838/api/logs?service=my-app&limit=20 | jq .
```

### Filter by symbol
```bash
curl -s "http://localhost:3838/api/logs?symbol=%23checkout&limit=10" | jq .
```

### Filter by level
```bash
curl -s "http://localhost:3838/api/logs?level=error&limit=10" | jq .
```

## Step 3: View Metrics

```bash
curl -s http://localhost:3838/api/metrics?service=my-app | jq .
```

## Step 4: View Traces

```bash
curl -s http://localhost:3838/api/traces?service=my-app&limit=10 | jq .
```

### View a specific trace
```bash
curl -s http://localhost:3838/api/traces/<traceId> | jq .
```

## Step 5: Cross-Reference with Paradigm

When you find interesting log entries or errors:

1. **Identify the symbol** from the log entry's `symbol` field
2. **Check history**: `paradigm_history_context({ symbols: ["#the-symbol"] })`
3. **Check fragility**: `paradigm_history_fragility({ symbols: ["#the-symbol"] })`
4. **If it's an error**: Use `/paradigm:sentinel` to triage it as an incident

## Step 6: Open Dashboard

For a visual overview, open the Sentinel dashboard:

```bash
open http://localhost:3838
```

## Integration Setup

If the user's app isn't sending logs to Sentinel yet:

### TypeScript (with Paradigm Logger)
```typescript
import { log } from '@a-company/paradigm-logger';
import { enableSentinel } from '@a-company/sentinel/transport';

enableSentinel(log, { service: 'my-app' });
// All log.component('#x').info(...) calls now also go to Sentinel
```

### Rust (with tracing)
```rust
use tracing_subscriber::prelude::*;

let sentinel = sentinel_client::client("my-app")
    .environment("development")
    .build();

tracing_subscriber::registry()
    .with(sentinel_client::tracing_layer::SentinelLayer::new(sentinel))
    .init();
// All tracing::info!(...) calls now also go to Sentinel
```

## When to Proactively Suggest This

Suggest `/paradigm:observe` when:
- The user asks "what's happening in my app"
- After deploying or starting a service
- When debugging behavior (not just errors — use sentinel for errors)
- The user wants to verify their logging is working
