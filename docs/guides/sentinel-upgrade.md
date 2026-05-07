# Sentinel Upgrade Guide — Per-Project Instructions

> **Internal runbook.** This guide covers connecting specific projects to the Sentinel observability server. It is not a general user guide — new users should start with the [Quick Start Guide](./quick-start.md).

How to connect each project to the Sentinel observability server using the new logger transport layer (TS) or tracing Layer (Rust).

**Prerequisites:** Sentinel server running at `http://localhost:3838` (or your configured URL).

---

## a-star (TypeScript, has Paradigm logger)

Already uses `@a-company/paradigm-logger`. One-line setup:

```bash
npm install @a-company/sentinel@latest
```

```typescript
import { log } from '@a-company/paradigm-logger';
import { enableSentinel } from '@a-company/sentinel/transport';

enableSentinel(log, { service: 'a-star', environment: 'development' });

// All existing log.component('#x').info(...) calls now flow to Sentinel
```

That's it. No other code changes needed — every `log.component()`, `log.gate()`, etc. call automatically forwards to Sentinel alongside console output.

---

## a-kamiki (Rust, has tracing)

Already uses the `tracing` crate. Add the Sentinel layer to the subscriber:

```toml
# Cargo.toml
[dependencies]
sentinel-client = { version = "0.2", features = ["tracing"] }
```

```rust
use tracing_subscriber::prelude::*;

let sentinel = sentinel_client::client("a-kamiki")
    .environment("development")
    .build();

tracing_subscriber::registry()
    .with(sentinel_client::tracing_layer::SentinelLayer::new(sentinel))
    .with(/* your existing layers */)
    .init();

// All tracing::info!(...) calls now flow to Sentinel
```

To tag events with Paradigm symbols, add a `symbol` field:

```rust
tracing::info!(symbol = "#garden-session", "Session started");
```

Without a `symbol` field, the module path is auto-converted: `garden::session::handler` becomes `#session-handler`.

---

## a-badgermole (Rust, raw println!)

Needs both tracing and the Sentinel layer.

### Step 1: Add dependencies

```toml
# Cargo.toml
[dependencies]
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["fmt"] }
sentinel-client = { version = "0.2", features = ["tracing"] }
```

### Step 2: Initialize tracing + Sentinel

```rust
use tracing_subscriber::prelude::*;

let sentinel = sentinel_client::client("a-badgermole")
    .environment("development")
    .build();

tracing_subscriber::registry()
    .with(tracing_subscriber::fmt::layer()) // console output (replaces println!)
    .with(sentinel_client::tracing_layer::SentinelLayer::new(sentinel))
    .init();
```

### Step 3: Replace println! with tracing macros

```rust
// Before
println!("Processing request: {}", id);

// After
tracing::info!(symbol = "#request-handler", id = %id, "Processing request");
```

---

## a-pretend (TypeScript, raw console.log)

Needs both the Paradigm logger and the Sentinel transport.

### Step 1: Install packages

```bash
npm install @a-company/paradigm-logger @a-company/sentinel
```

### Step 2: Create a logger instance

```typescript
// src/logger.ts
import { ParadigmLogger } from '@a-company/paradigm-logger';
import { enableSentinel } from '@a-company/sentinel/transport';

export const log = new ParadigmLogger();

enableSentinel(log, { service: 'a-pretend', environment: 'development' });
```

### Step 3: Replace console.log with logger calls

```typescript
// Before
console.log('User logged in:', userId);

// After
import { log } from './logger';
log.component('#auth').info('User logged in', { userId });
```

---

## leadsync-dash (TypeScript, browser)

Browser app — needs conditional setup since Sentinel server may not be reachable from all environments.

### Step 1: Install packages

```bash
npm install @a-company/paradigm-logger @a-company/sentinel
```

### Step 2: Conditional setup

```typescript
import { ParadigmLogger } from '@a-company/paradigm-logger';
import { enableSentinel } from '@a-company/sentinel/transport';

export const log = new ParadigmLogger({ format: 'pretty' });

// Only connect to Sentinel in development or if explicitly configured
const sentinelUrl = import.meta.env.VITE_SENTINEL_URL;
if (sentinelUrl) {
  enableSentinel(log, {
    service: 'leadsync-dash',
    url: sentinelUrl,
    environment: import.meta.env.MODE,
  });
}
```

The SentinelClient already handles browser environments:
- Uses `globalThis.fetch` (native in browsers)
- Flushes via `navigator.sendBeacon` on `beforeunload` so buffered logs aren't lost on page close
- Batches and retries automatically

### Step 3: Environment variable

```env
# .env.development
VITE_SENTINEL_URL=http://localhost:3838
```

Production: omit `VITE_SENTINEL_URL` to disable Sentinel, or point it at a hosted instance.
