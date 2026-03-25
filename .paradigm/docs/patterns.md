# Paradigm Coding Patterns

Common patterns for working with Paradigm symbols and the logger.

---

## Component Pattern (Features)

Components with `[feature]` tag are user-facing operations. They should be logged at entry and exit.

```
// Component: #login-handler [feature]

function login(email, password):
    // 1. Log entry with start() for duration tracking
    tracker = log.component('#login-handler').start('Starting login', { email })

    try:
        // 2. Perform the operation
        user = authenticate(email, password)

        // 3. Emit success signal
        log.signal('!login-success').info('User authenticated', {
            userId: user.id
        })

        // 4. Log successful completion with duration
        tracker.success('Login completed', { userId: user.id })

        return user

    catch error:
        // 5. Emit failure signal
        log.signal('!login-failed').warn('Login failed', {
            email,
            error: error.message
        })

        // 6. Log failure with duration
        tracker.error('Login failed', { error: error.message })

        throw error
```

**Key points:**
- Use `log.component('#name').start()` at entry
- Emit `!success` and `!failed` signals
- Always call `tracker.success()` or `tracker.error()`

---

## Gate Pattern

Gates (`^`) are authorization checkpoints. Log before and after the check.

```
// Gate: ^authenticated

function requireAuth(request, next):
    // 1. Log gate check start
    log.gate('^authenticated').debug('Checking ^authenticated', {
        path: request.path,
        method: request.method
    })

    // 2. Perform authorization check
    user = getSessionUser(request)

    if not user:
        // 3. Log denial
        log.gate('^authenticated').warn('Access denied - no session', {
            path: request.path,
            ip: request.ip
        })
        return unauthorized("Authentication required")

    // 4. Log success
    log.gate('^authenticated').debug('Gate passed', {
        userId: user.id,
        path: request.path
    })

    // 5. Continue to next handler
    return next()
```

**Key points:**
- Log at `debug` level for routine checks
- Log at `warn` level for denials
- Include context (path, userId) for debugging

---

## Component Pattern

Components (`#`) are reusable infrastructure. Log operations and errors.

```
// Component: #database

class Database:
    function query(sql, params):
        // 1. Start duration tracking
        tracker = log.component('#database').start('Executing query')
        
        try:
            // 2. Perform operation
            result = this.connection.execute(sql, params)
            
            // 3. Log success with metrics
            tracker.success('Query completed', {
                rows: result.length,
                table: extractTable(sql)
            })
            
            return result
            
        catch error:
            // 4. Log failure
            tracker.error('Query failed', {
                error: error.message,
                sql: sql.substring(0, 100)  // Truncate for safety
            })
            throw error
    
    function connect():
        log.component('#database').info('Connecting to database', {
            host: this.config.host,
            database: this.config.database
        })
        
        // ... connection logic
        
        log.component('#database').info('Database connected')
```

**Key points:**
- Use duration tracking for async operations
- Log connection lifecycle events
- Include relevant metrics (rows, duration)

---

## State Component Pattern

State components (`#` with `[state]` tag) manage application state. Log changes with before/after values.

```
// Component: #user-store [state]

class AuthStore:
    authenticated = false
    user = null

    function login(token, userData):
        // 1. Log state change with context
        log.component('#user-store').info('Authenticating user', {
            from: this.authenticated,
            to: true,
            userId: userData.id
        })

        // 2. Update state
        this.authenticated = true
        this.user = userData
        this.token = token

        // 3. Emit signal
        log.signal('!login-success').info('User session established', {
            userId: userData.id
        })

    function logout():
        previousUser = this.user?.id

        log.component('#user-store').info('Logging out user', {
            from: this.authenticated,
            to: false,
            userId: previousUser
        })

        this.authenticated = false
        this.user = null
        this.token = null

        log.signal('!logout').info('User session ended', {
            userId: previousUser
        })
```

**Key points:**
- Include `from` and `to` values
- Pair state changes with signals
- Log at `info` level for visibility

---

## Flow Pattern

Flows (`$`) are multi-step processes. Log step transitions.

```
// Flow: $checkout-flow
// Steps: cart → shipping → payment → confirmation

class CheckoutFlow:
    currentStep = 'cart'
    
    function startFlow(cartId):
        log.flow('$checkout-flow').info('Flow started', {
            cartId,
            step: 'cart'
        })
        this.currentStep = 'cart'
    
    function nextStep():
        steps = ['cart', 'shipping', 'payment', 'confirmation']
        currentIndex = steps.indexOf(this.currentStep)
        
        if currentIndex < steps.length - 1:
            previousStep = this.currentStep
            this.currentStep = steps[currentIndex + 1]
            
            log.flow('$checkout-flow').info('Step completed', {
                from: previousStep,
                to: this.currentStep,
                progress: `${currentIndex + 1}/${steps.length}`
            })
    
    function completeFlow(orderId):
        log.flow('$checkout-flow').info('Flow completed', {
            orderId,
            totalSteps: 4
        })
        log.signal('!checkout-complete').info('Order placed', { orderId })
```

**Key points:**
- Log flow start and completion
- Log step transitions with from/to
- Include progress indicators

---

## Signal Pattern

Signals (`!`) are events. Use them consistently for important occurrences.

```
// Signals for authentication
log.signal('!login-success').info('User logged in', { userId })
log.signal('!login-failed').warn('Login attempt failed', { email, reason })
log.signal('!logout').info('User logged out', { userId })
log.signal('!session-expired').warn('Session expired', { userId })

// Signals for payments
log.signal('!payment-success').info('Payment processed', { orderId, amount })
log.signal('!payment-failed').error('Payment declined', { orderId, reason })
log.signal('!refund-issued').info('Refund processed', { orderId, amount })

// Signals for system events
log.signal('!rate-limit-exceeded').warn('Rate limit hit', { ip, endpoint })
log.signal('!cache-miss').debug('Cache miss', { key })
log.signal('!email-sent').info('Email dispatched', { to, template })
```

**Key points:**
- Use consistent naming: `!noun-verb` or `!noun-state`
- Choose appropriate level (info/warn/error)
- Include relevant context

---

## Error Handling Pattern

Consistent error handling with Paradigm logging:

```
function riskyOperation():
    tracker = log.component('#risky-op').start('Starting operation')
    
    try:
        // Happy path
        result = doSomethingRisky()
        tracker.success('Operation completed', { result })
        return result
        
    catch KnownError as error:
        // Expected error - warn level
        log.signal('!known-error').warn('Expected error occurred', {
            type: error.type,
            message: error.message
        })
        tracker.error('Operation failed (known)', { error: error.type })
        return fallbackValue
        
    catch error:
        // Unexpected error - error level
        log.signal('!unexpected-error').error('Unexpected error', {
            message: error.message,
            stack: error.stack
        })
        tracker.error('Operation failed (unexpected)', { 
            error: error.message 
        })
        throw error
```

---

## Middleware Pattern

Logging in request middleware:

```
function loggingMiddleware(request, next):
    correlationId = request.headers['x-correlation-id'] or generateId()
    
    return withCorrelation(correlationId, async () => {
        tracker = log.component('#' + request.path).start('Request started', {
            method: request.method,
            path: request.path
        })
        
        try:
            response = await next()
            
            tracker.success('Request completed', {
                status: response.status
            })
            
            return response
            
        catch error:
            tracker.error('Request failed', {
                error: error.message
            })
            throw error
    })
```

---

## Testing Pattern

When testing, you may want to suppress or capture logs:

```
// In tests, set LOG_LEVEL=error to reduce noise
// Or mock the logger to capture calls

beforeEach:
    originalLogLevel = process.env.LOG_LEVEL
    process.env.LOG_LEVEL = 'error'

afterEach:
    process.env.LOG_LEVEL = originalLogLevel
```

---

## Drift Detection and Auto-Heal

Drift detection ensures that `~aspect` code anchors (file:line references in `.purpose` files) remain accurate as code evolves. It runs automatically in the stop hook and is available via `paradigm_aspect_drift` (MCP) or `paradigm drift` (CLI).

### What Drift Detection Checks

Every `~aspect` can have code anchors pointing to specific file and line ranges. Drift detection reads those anchors from `.paradigm/aspect-graph.db` and verifies the referenced code has not moved or changed.

### Three-Layer Resolution

**Layer 1a: Exact hash match** — The SHA-256 hash of the code at the anchor's line range is compared to the stored `content_hash`. If they match, the anchor is **clean**.

**Layer 1b: Normalized hash match** — Strips trailing whitespace, collapses runs of whitespace, and removes blank lines before hashing. If the normalized hash matches, the change is **cosmetic** (formatting only). The exact hash is silently updated.

**Layer 2: Git-aware line mapping** — When hashes do not match, Paradigm runs `git diff <materialized_commit>..HEAD --unified=0` to compute how hunks above the anchor shifted its line numbers. If the content at the shifted location matches the original hash (exact or normalized), the anchor is **shifted** and auto-healed: line numbers in both the DB and the `.purpose` file are updated.

**Layer 3: Content fingerprint search** — When git line mapping fails (e.g., the code was refactored, not just shifted), Paradigm uses n-gram fingerprinting to search the file for the original content. This produces a confidence score between 0.0 and 1.0.

### Confidence Thresholds

The thresholds that govern auto-heal behavior are configurable in `.paradigm/config.yaml` under the `drift` section:

```yaml
drift:
  auto-heal-threshold: 0.85   # Score >= this: auto-relocate the anchor
  suggest-threshold: 0.7      # Score >= this but < auto-heal: suggest relocation (manual review)
  check-on-stop: true         # Run drift check in stop hook
  normalize-whitespace: true  # Treat whitespace-only changes as cosmetic
```

| Confidence Score | Behavior |
|-----------------|----------|
| >= `auto-heal-threshold` (default 0.85) | Automatic relocation. DB and `.purpose` file updated. Recorded in `anchor_history` table. |
| >= `suggest-threshold` (default 0.7) and < `auto-heal-threshold` | Suggested relocation. Reported as drift but not applied. Requires manual review. |
| < `suggest-threshold` (default 0.7) | Real drift. The anchor is marked `drifted = 1` in the DB. Manual intervention required. |

Cross-file relocations (content found in a different file) are never auto-applied regardless of score; they are always suggestions.

### When Manual Intervention Is Required

- **Modified** status: The code at the anchor location genuinely changed and could not be found elsewhere. Review the aspect to confirm it still applies and update the anchor.
- **Missing** status: The anchor's file was deleted. Remove the stale aspect or re-point it.
- **Low-confidence relocation** (0.7-0.85): Paradigm found a candidate but is not confident enough to auto-apply. Verify the suggestion and update manually.
- **Cross-file suggestion**: Content was found in a different file. Verify the move was intentional and update the anchor path.

### Resolving Drift Violations

1. Run `paradigm_aspect_drift` to see current drift status
2. For each **modified** anchor, read the current code and update the anchor in `.purpose`
3. For each **missing** anchor, remove the aspect or point it at the new location
4. Run `paradigm scan` to re-materialize the aspect graph with updated hashes
5. The stop hook will pass once all anchors are clean or auto-healed

### Wiring Config to Code (Follow-Up)

The threshold values are currently hardcoded in `aspect-graph.ts` (line 914-915) and `aspect-fingerprint.ts`. The `drift` config section in `config.yaml` defines the intended values. Wiring the config loader to pass these values into `checkDrift()` and `contentSearch()` is a follow-up task. Until then, changing the config values documents intent but the runtime uses 0.85/0.7.
