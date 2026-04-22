---
id: N-para-501-sentinel-deep-dive
title: Sentinel Deep Dive
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-501
  - symbolic-incident-records
  - flow-position-tracking
  - automatic-incident-grouping
symbols: []
difficulty: beginner
estimatedMinutes: 6
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-501.json
---

## Beyond Stack Traces

Traditional error tracking gives you a stack trace and a count. Paradigm Sentinel gives you *symbolic context* — which component failed, where in a flow it failed, what gate was being evaluated, and which known pattern matches the failure. This transforms incident response from "read the stack trace and hope" to "match against institutional knowledge and follow a resolution strategy."

## Symbolic Incident Records

When Sentinel records an incident, it captures both technical and symbolic context:

```yaml
id: INC-042
timestamp: "2026-02-21T02:15:00Z"
status: open
error:
  message: "Cannot read property 'id' of null"
  stack: "at PaymentProcessor.processRefund (payment-processor.ts:142)"
  type: TypeError
symbols:
  component: "#payment-processor"
  flow: "$refund-flow"
  gate: "^authenticated"
flowPosition:
  flowId: "$refund-flow"
  expected: ["^authenticated", "^refund-eligible", "#process-refund", "!refund-completed"]
  actual: ["^authenticated", "^refund-eligible", "#process-refund"]
  missing: ["!refund-completed"]
  failedAt: "#process-refund"
environment: production
```

The `flowPosition` field is critical — it tells you exactly where in the defined flow the failure occurred. The refund flow expected 4 steps; only 3 completed. The failure happened at `#process-refund`, and the `!refund-completed` signal never fired. This immediately narrows the investigation to the refund processing logic.

## Incident Grouping

Sentinel automatically groups related incidents using symbolic similarity. When two incidents share the same component, flow, and error pattern, they form a group. The grouping algorithm uses a similarity threshold of 0.6 — incidents must share at least 60% of their symbolic context to cluster.

An `IncidentGroup` tracks the common symbols, error patterns, occurrence count, first/last seen timestamps, and which environments are affected. If a group matches a known failure pattern, Sentinel attaches it as a `suggestedPattern`.

## Failure Patterns

Patterns are the institutional knowledge of your error handling. Each pattern defines matching criteria and a resolution strategy:

```yaml
id: payment-null-ref-001
name: "Null reference in payment processing"
pattern:
  symbols:
    component: "#payment-processor"
  errorType: [TypeError]
  errorContains: ["Cannot read property", "null"]
resolution:
  description: "Add null check before accessing refund object properties"
  strategy: fix-code
  priority: high
  symbolsToModify: ["#payment-processor"]
  filesLikelyInvolved: ["src/services/payment-processor.ts"]
confidence:
  score: 85
  timesMatched: 12
  timesResolved: 10
  timesRecurred: 2
```

Six resolution strategies exist: `retry` (transient failure), `fallback` (use alternative path), `fix-data` (data issue), `fix-code` (bug), `ignore` (known harmless), and `escalate` (needs human decision). Pattern priority ranges from `low` through `medium` and `high` to `critical`.

Patterns come from four sources: `manual` (team-created), `suggested` (Sentinel auto-generated from groups), `imported` (from another project), and `community` (shared patterns). Paradigm ships 26 seed patterns covering common failures like incomplete flows, gate bypasses, state race conditions, and unhandled signals.

## The Triage Workflow

Sentinel follows a defined lifecycle for incidents:

1. **Record** — `paradigm_sentinel_record` creates the incident with error details, symbolic context, and optional flow position. The incident starts as `open`.

2. **Triage** — `paradigm_sentinel_triage` lists incidents filtered by status, symbol, environment, or error text. The matcher automatically suggests patterns that fit each incident.

3. **Investigate** — `paradigm_sentinel_show` with `includeTimeline: true` shows the full flow timeline — every gate passed, signal emitted, and state change leading up to the failure. With `includeSimilar: true`, it surfaces related incidents that may share a root cause.

4. **Resolve** — `paradigm_sentinel_resolve` closes the incident with a resolution: which pattern applied (if any), the fix commit hash, PR URL, and notes. Resolved incidents feed back into pattern confidence scores.

5. **Pattern** — `paradigm_sentinel_add_pattern` creates new patterns from resolved incidents. When you fix a novel failure, capture the fix as a pattern so the next occurrence resolves faster.

The sequence is: **record → triage → show → resolve → add pattern**. This cycle builds institutional knowledge with every incident.

## Stats and Health Metrics

`paradigm_sentinel_stats` provides operational intelligence for a given time period: total incidents, open vs resolved counts, incidents by environment and day, pattern effectiveness (which patterns resolve most incidents vs which recur), symbol hotspots (components with the highest incident rates), and resolution metrics (average time to resolve, pattern vs manual resolution rates).

The `symbolHealth` view shows per-symbol incident history — use it to identify which components need hardening or refactoring.

## Logger Transports

Sentinel integrates with the Paradigm logger through a transport layer. The `LogTransport` interface defines a simple contract: a transport receives structured log entries and delivers them somewhere — a file, a remote API, a database, or Sentinel's ingestion endpoint.

```typescript
interface LogTransport {
  name: string;
  send(entry: LogEntry): void | Promise<void>;
}
```

The logger supports multiple transports simultaneously via `addTransport(transport)` and `removeTransport(name)`. By default, logs go to the console. Adding a `SentinelTransport` sends them to Sentinel's server as well, without changing any of your existing logging calls.

## The SentinelTransport Bridge

Connecting the Paradigm logger to Sentinel is a one-liner:

```typescript
import { enableSentinel } from '@a-company/sentinel';

enableSentinel({ endpoint: 'http://localhost:3001' });
```

This call creates a `SentinelTransport` instance and registers it with the logger via `addTransport`. From that point forward, every `log.component(...)`, `log.gate(...)`, and `log.signal(...)` call is forwarded to Sentinel as a structured log entry. Error-level logs are automatically promoted to incident candidates.

The beauty of this design is zero code changes to your application. Your existing logger calls remain unchanged — the transport layer silently bridges them to Sentinel's observability pipeline.

## Metrics API

Sentinel's server exposes a metrics API for recording and querying application metrics:

**POST /api/metrics** — Record a metric data point. Supports three metric types:
- `counter` — Monotonically increasing values (e.g., request count, error count)
- `gauge` — Point-in-time values that can go up or down (e.g., active connections, queue depth)
- `histogram` — Distribution of values over time (e.g., response latency, payload size)

```json
{
  "name": "api.requests.total",
  "type": "counter",
  "value": 1,
  "labels": { "method": "POST", "route": "/api/payments" },
  "timestamp": "2026-02-21T14:30:00Z"
}
```

**GET /api/metrics** — Query metrics with optional filters by name, type, labels, and time range. Returns aggregated data suitable for dashboards and alerting.

## Traces API

Sentinel supports distributed tracing through span trees:

**POST /api/traces** — Record a trace span. Each span has a `traceId`, `spanId`, optional `parentSpanId`, `operationName`, `startTime`, `endTime`, and `tags`. Spans with the same `traceId` form a tree — the root span has no parent, and child spans reference their parent via `parentSpanId`.

**GET /api/traces** — Query traces by operation name, service, time range, or minimum duration. Returns full span trees with timing breakdowns.

## Service Registry

Sentinel maintains a live registry of services reporting data:

**POST /api/services** — Register or update a service. Each service entry includes name, version, environment, health status, and last-seen timestamp.

**GET /api/services** — List all registered services with their current health status and metadata. This provides a real-time view of what is running and where.
