---
id: N-para-101-paradigm-logger
title: The Paradigm Logger
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-101
  - structured-logging-ties
  - log-entries-should
  - four-log-levels
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-101.json
---

## Structured Logging with Symbols

Raw `console.log` calls are the bane of production debugging. They have no structure, no categorization, and no connection to the system architecture. Paradigm replaces them with a **structured logger** that ties every log line to a symbol. When you see a log entry from `#payment-service`, you know exactly which component produced it. When you see a warning from `^authenticated`, you know a gate check failed.

The Paradigm logger uses a two-step chaining API: first you specify the symbol type and name, then you call a log level method.

## The Logger API

There are five logger methods, one for each symbol type:

```typescript
// Components — any code unit
log.component('#payment-service').info('Payment processed', { amount: 4999 });
log.component('#user-store').debug('Cache hit', { userId: 'u_123' });

// Gates — authorization checks
log.gate('^authenticated').warn('Access denied — no session', { path: '/api/admin' });
log.gate('^project-admin').info('Gate passed', { userId: 'u_456' });

// Signals — events
log.signal('!payment-completed').info('Payment signal emitted', { orderId: 'ord_789' });
log.signal('!login-failed').warn('Failed login attempt', { email: 'user@example.com' });

// Flows — multi-step processes
log.flow('$checkout-flow').debug('Step 2/4: billing calculated', { total: 5999 });
log.flow('$onboarding').info('Flow completed', { userId: 'u_123' });

// Aspects — cross-cutting concerns
log.aspect('~audit-required').debug('Audit entry recorded', { operation: 'delete-user' });
log.aspect('~rate-limited').warn('Rate limit approaching', { remaining: 5 });
```

## Log Levels

Each symbol method returns an object with four log level methods:

| Level | Use When |
|-------|----------|
| `debug` | Development-only details, verbose tracing |
| `info` | Normal operations — a process completed, a step succeeded |
| `warn` | Something unexpected but recoverable — a gate denial, a rate limit approaching |
| `error` | Something failed — a payment declined, a database connection lost |

Choose the level based on operational severity, not on how important the code is. A critical payment service logging a successful charge uses `.info()`, not `.error()`.

## Symbol-to-Directory Mapping

Paradigm defines a convention for which logger method to use based on which directory the code lives in:

| Directory Pattern | Logger Method |
|-------------------|---------------|
| `features/`, `routes/`, `api/`, `services/`, `lib/`, `components/` | `log.component()` |
| `middleware/`, `auth/`, `guards/`, `policies/` | `log.gate()` |
| `events/`, `handlers/`, `listeners/`, `hooks/` | `log.signal()` |
| `flows/`, `sagas/`, `workflows/`, `pipelines/` | `log.flow()` |
| `aspects/`, `rules/` | `log.aspect()` |

This is a convention, not enforcement. If a service in `lib/` emits a signal, it can call `log.signal()`. But when in doubt, follow the directory mapping.

## Why Not console.log?

Structured logging with symbols gives you:

1. **Filterability** — In production, you can filter logs by symbol type (`gate`), symbol name (`^authenticated`), or log level (`warn`). Raw console.log gives you none of this.
2. **Traceability** — Every log line connects back to the Paradigm symbol map. You can trace a log entry to its `.purpose` definition, see what flows involve it, and check what gates protect it.
3. **Consistency** — AI agents generating code will use the correct logger if the convention exists. Without it, each agent invents its own logging pattern.
4. **Incident correlation** — Paradigm Sentinel (the incident tracking system) matches log patterns to symbols, enabling automatic triage based on which components are failing.
