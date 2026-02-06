# Paradigm Coding Patterns

Common patterns for working with Paradigm v2 symbols and the logger.

---

## Component Pattern (Features)

Components (`#`) with `[feature]` tag are user-facing operations. Log at entry and exit.

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

## Component Pattern (Infrastructure)

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

## Component Pattern (State)

Components with `[state]` tag represent application state. Log changes with before/after values.

```
// Component: #auth-store [state]

class AuthStore:
    authenticated = false
    user = null

    function login(token, userData):
        // 1. Log state change with context
        log.component('#auth-store').info('Authenticating user', {
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

        log.component('#auth-store').info('Logging out user', {
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

## Aspect Pattern

Aspects (`~`) are cross-cutting rules with required code anchors.

```
// Aspect: ~audit-required
// Anchored to: src/middleware/audit.ts:15-35

function auditMiddleware(request, next):
    log.aspect('~audit-required').debug('Auditing operation', {
        path: request.path,
        method: request.method,
        userId: request.user?.id
    })

    response = next()

    log.aspect('~audit-required').info('Operation audited', {
        path: request.path,
        status: response.status,
        userId: request.user?.id
    })

    return response
```

**Key points:**
- Aspects MUST have code anchors in .purpose files
- Use `log.aspect('~name')` for aspect logging
- Log at appropriate levels (debug for routine, info for important)

---

## Error Handling Pattern

Consistent error handling with Paradigm logging:

```
function riskyOperation():
    tracker = log.component('#risky-handler').start('Starting operation')

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
        tracker = log.component('#request-handler').start('Request started', {
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

## v2 Logger Method Reference

| Symbol | Logger Method | Use For |
|--------|--------------|---------|
| `#` | `log.component()` | All code units (features, services, utils, state) |
| `^` | `log.gate()` | Authorization checkpoints |
| `!` | `log.signal()` | Events and side effects |
| `$` | `log.flow()` | Multi-step processes |
| `~` | `log.aspect()` | Cross-cutting rules |

*Part of Paradigm v2.0*
