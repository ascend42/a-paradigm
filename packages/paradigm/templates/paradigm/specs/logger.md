# Paradigm Logger Specification

The Paradigm Logger creates a **shared language between code, developers, and AI agents** using Paradigm's symbol system. It replaces raw `console.log`/`print` statements with structured, filterable, symbol-typed logs.

---

## Core Principle

**NEVER use raw logging. ALWAYS use the Paradigm logger.**

```
// BAD - Raw logging
console.log('User logged in', userId);
print(f"Query took {duration}ms")

// GOOD - Paradigm logger
log.feature('@login').info('User logged in', { userId });
log.component('#database').debug('Query executed', { duration });
```

---

## API Design (Language-Agnostic)

### Logger Object

```
log.feature('@symbol')    → SymbolLogger   // For @features
log.component('#symbol')  → SymbolLogger   // For #components
log.portal('^symbol')     → SymbolLogger   // For ^portals
log.signal('!symbol')     → SymbolLogger   // For !signals
log.state('%symbol')      → SymbolLogger   // For %state
log.flow('$symbol')       → SymbolLogger   // For $flows
log.raw('?symbol')        → SymbolLogger   // For any symbol
```

### SymbolLogger Methods

```
.debug(message, data?)    // Verbose debugging info
.info(message, data?)     // General information
.warn(message, data?)     // Warning conditions
.error(message, data?)    // Error conditions
.start(message, data?)    → DurationTracker  // Start timed operation
```

### DurationTracker Methods

```
.success(message, data?)  // Operation succeeded (logs duration)
.error(message, data?)    // Operation failed (logs duration)
.end(level, message, data?)  // Custom level completion
```

---

## Log Levels

| Level | Priority | When to Use |
|-------|----------|-------------|
| `debug` | 0 | Internal state, cache hits, queries — verbose dev info |
| `info` | 1 | Feature entry/exit, successful operations |
| `warn` | 2 | Denied access, retries, recoverable issues |
| `error` | 3 | Exceptions, unrecoverable failures |

**Default:** `debug` in development, `info` in production.

---

## Symbol Usage by Location

| Directory Pattern | Symbol | Log Method |
|-------------------|--------|------------|
| `features/`, `routes/`, `api/` | `@` | `log.feature()` |
| `components/`, `lib/`, `utils/` | `#` | `log.component()` |
| `middleware/`, `auth/`, `guards/` | `^` | `log.portal()` |
| `stores/`, `state/`, `reducers/` | `%` | `log.state()` |
| `events/`, `handlers/`, `listeners/` | `!` | `log.signal()` |
| `flows/`, `sagas/`, `workflows/` | `$` | `log.flow()` |

---

## Common Patterns

### Feature Entry/Exit

```
function login(email, password):
    tracker = log.feature('@login').start('Starting @login', { email })
    
    try:
        user = authenticate(email, password)
        log.signal('!login-success').info('User authenticated', { userId: user.id })
        tracker.success('@login completed', { userId: user.id })
        return user
    catch error:
        log.signal('!login-failed').warn('Login failed', { email, error })
        tracker.error('@login failed', { error })
        throw error
```

### Portal Checks

For simple portal logging:

```
function requireAuth(request):
    log.portal('^authenticated').debug('Checking ^authenticated')
    
    user = getUser(request)
    if not user:
        log.portal('^authenticated').warn('Access denied', { path: request.path })
        return unauthorized()
    
    log.portal('^authenticated').debug('Portal passed', { userId: user.id })
    return next()
```

> **Note:** For authorization flows that need AI validation, use the **Portal Validator** instead.
> See [Portal Validation Specification](./portal-validation.md) for structured decision logging.

### Component Operations

```
function query(sql, params):
    tracker = log.component('#database').start('Executing query')
    
    try:
        result = db.execute(sql, params)
        tracker.success('Query completed', { rows: result.length })
        return result
    catch error:
        tracker.error('Query failed', { error })
        throw error
```

### State Changes

```
function setAuthenticated(value):
    log.state('%user.authenticated').info('State changing', { 
        from: state.authenticated, 
        to: value 
    })
    state.authenticated = value
```

---

## Filtering

### By Log Level

```bash
# Environment variable
LOG_LEVEL=debug    # Show all
LOG_LEVEL=info     # Show info, warn, error
LOG_LEVEL=warn     # Show warn, error
LOG_LEVEL=error    # Show errors only
```

### By Symbol Type

```bash
# Environment variable (comma-separated)
PARADIGM_SYMBOLS=!          # Signals only — high-level overview
PARADIGM_SYMBOLS=@,^,!      # Features, portals, signals — auth debugging
PARADIGM_SYMBOLS=#          # Components only — infrastructure debugging
```

### Common Filter Recipes

| Use Case | Level | Symbols | What You See |
|----------|-------|---------|--------------|
| High-level overview | info | `!` | Just events/signals |
| Auth debugging | debug | `@,^,!` | Features, portals, signals |
| Infrastructure | debug | `#,!` | Components and signals |
| Minimal | warn | (all) | Warnings and errors only |

---

## Output Formats

### Development (Pretty)

```
16:42:15.123 @login INFO  Starting @login {"email":"user@example.com"}
16:42:15.456 #database DEBUG Query executed {"table":"users","duration":"45ms"}
16:42:15.789 !login-success INFO User authenticated {"userId":"abc123"}
```

### Production (JSON)

```json
{"timestamp":"2026-01-14T00:42:15.123Z","level":"info","symbol":"@login","symbolType":"feature","message":"Starting @login","email":"user@example.com"}
```

---

## Correlation IDs

Track requests across multiple log statements:

```
correlationId = createCorrelationId()

withCorrelation(correlationId, () => {
    log.feature('@checkout').info('Starting checkout')
    log.component('#payment').info('Processing payment')
    log.signal('!checkout-complete').info('Order placed')
    // All logs include the same correlationId
})
```

---

## Implementation Checklist

When implementing the Paradigm logger in a new language:

- [ ] Symbol-typed methods: `log.feature()`, `log.component()`, etc.
- [ ] Log levels: debug, info, warn, error
- [ ] Duration tracking: `.start()` → `.success()` / `.error()`
- [ ] Structured data parameter on all methods
- [ ] Level filtering via environment variable
- [ ] Symbol filtering via environment variable
- [ ] Pretty format for development
- [ ] JSON format for production
- [ ] Correlation ID support
- [ ] Timestamp in output

---

## Portal Validation

For authorization decisions that need to be validated by AI agents, use the **Portal Validator** alongside the standard logger. The Portal Validator emits structured decision logs:

```
┌─────────────────────────────────────────────────────────
│ 🚪 PORTAL CHECK: ^subscription-required
│ ├─ Requires: active subscription, trial not exceeded
│ ├─ Context: { userId: "abc123", plan: "growth" }
│ ├─ Decision: ✅ ALLOW
│ └─ Reason: Subscription valid - growth plan active
└─────────────────────────────────────────────────────────
```

Use cases:
- **`log.portal()`** - General portal-related logging and debugging
- **`portal.check()`** - Authorization decisions that need validation

See [Portal Validation Specification](./portal-validation.md) for full details.

---

## Reference Implementations

See working implementations in:
- **TypeScript (Browser):** Pattern with CSS console styling
- **TypeScript (Node.js):** Pattern with ANSI codes + AsyncLocalStorage
- **Python:** Pattern with logging module
- **Go:** Pattern with structured logging
- **Rust:** Pattern with tracing crate
