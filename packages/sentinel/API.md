# Sentinel API Reference

Base URL: `http://localhost:3838` (configurable)

## Authentication

When auth is enabled, include a Bearer token:

```
Authorization: Bearer <token>
```

---

## Logs

### POST /api/logs

Send structured log entries in batches.

**TypeScript:**
```ts
import { createSentinelClient } from '@a-company/sentinel';

const client = createSentinelClient({ service: 'my-app' });
client.info('#checkout', 'Order placed', { orderId: '123' });
await client.flush();
```

**Python:**
```python
import requests

requests.post("http://localhost:3838/api/logs", json={
    "entries": [{
        "level": "info",
        "symbol": "#checkout",
        "message": "Order placed",
        "service": "my-app",
        "data": {"orderId": "123"}
    }]
})
```

**Rust:**
```rust
let sentinel = sentinel_client::client("my-app")
    .url("http://localhost:3838")
    .build();

sentinel.info("#checkout", "Order placed").await;
sentinel.flush().await?;
```

**Swift:**
```swift
var request = URLRequest(url: URL(string: "http://localhost:3838/api/logs")!)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = try JSONEncoder().encode([
    "entries": [["level": "info", "symbol": "#checkout", "message": "Order placed", "service": "my-app"]]
])
URLSession.shared.dataTask(with: request).resume()
```

**Kotlin:**
```kotlin
val client = OkHttpClient()
val body = """{"entries":[{"level":"info","symbol":"#checkout","message":"Order placed","service":"my-app"}]}"""
    .toRequestBody("application/json".toMediaType())
val request = Request.Builder().url("http://localhost:3838/api/logs").post(body).build()
client.newCall(request).execute()
```

**curl:**
```bash
curl -X POST http://localhost:3838/api/logs \
  -H 'Content-Type: application/json' \
  -d '{"entries":[{"level":"info","symbol":"#checkout","message":"Order placed","service":"my-app"}]}'
```

### GET /api/logs

Query logs with filters.

| Param | Type | Description |
|-------|------|-------------|
| level | string | Filter by level (debug, info, warn, error) |
| symbol | string | Filter by symbol |
| service | string | Filter by service name |
| search | string | Full-text search in messages |
| since | string | ISO timestamp lower bound |
| until | string | ISO timestamp upper bound |
| limit | number | Max results (default: 100) |
| offset | number | Pagination offset |

```bash
curl 'http://localhost:3838/api/logs?level=error&service=my-app&limit=50'
```

---

## Metrics

### POST /api/metrics

Send metric data points.

```bash
curl -X POST http://localhost:3838/api/metrics \
  -H 'Content-Type: application/json' \
  -d '{"entries":[{"name":"http.duration","type":"histogram","value":42.5,"service":"my-app","tags":{"method":"POST","status":"200"}}]}'
```

### GET /api/metrics

Query metrics with filters: `name`, `type`, `service`, `tag` (key=value), `since`, `until`, `limit`.

### GET /api/metrics/aggregate/:name

Get aggregation (count, sum, min, max, avg, p50, p95, p99) for a named metric.

---

## Traces

### POST /api/traces

Submit a trace span.

```bash
curl -X POST http://localhost:3838/api/traces \
  -H 'Content-Type: application/json' \
  -d '{"traceId":"abc","spanId":"def","service":"my-app","symbol":"#checkout","operation":"POST /checkout","startTime":"2026-01-01T00:00:00Z","durationMs":150,"status":"ok"}'
```

### GET /api/traces

Query traces: `service`, `symbol`, `since`, `until`, `limit`.

### GET /api/traces/:traceId

Get full trace with all spans.

---

## Services

### POST /api/services

Register a service.

```bash
curl -X POST http://localhost:3838/api/services \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-app","version":"1.0.0","environment":"production"}'
```

### GET /api/services

List all registered services.

---

## State

### POST /api/state

Push an application state snapshot.

```bash
curl -X POST http://localhost:3838/api/state \
  -H 'Content-Type: application/json' \
  -d '{"service":"my-app","sessionId":"abc","state":{"cartItems":3},"activeFlows":["$checkout-flow"]}'
```

### GET /api/state

Get latest state for all services (or filter with `?service=my-app`).

---

## Health

### GET /api/health

```bash
curl http://localhost:3838/api/health
# {"status":"ok","timestamp":"2026-02-25T00:00:00.000Z"}
```

---

## WebSocket

Connect to `ws://localhost:3838` for real-time streaming.

**Messages (JSON-RPC 2.0):**

```json
{"method": "subscribe", "id": 1}
{"method": "ping", "id": 2}
{"method": "query_logs", "params": {"level": "error"}, "id": 3}
```

**Server pushes:**
- `{"type": "log", "entry": {...}}` — new log entry
- `{"type": "flow_event", ...}` — flow/signal/gate activity
