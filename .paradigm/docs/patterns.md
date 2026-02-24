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

---

## Multi-Agent Handoff Pattern

When a task spans multiple agent specializations, use orchestrated handoffs:

```
1. Planning Agent (architect)
   - Call paradigm_orchestrate_inline({ task: "...", mode: "plan" })
   - Get agent assignments, estimated cost, and execution stages
   - Review and approve the plan

2. Execution Agents (builder, security, tester)
   - Each agent receives a scoped prompt via paradigm_agent_prompt
   - Agent calls paradigm_session_checkpoint at phase transitions
   - Agent calls paradigm_pm_postflight when done

3. Handoff Between Agents
   - Outgoing agent: paradigm_handoff_prepare({ summary, nextSteps })
   - Incoming agent: paradigm_session_recover()
   - Each agent inherits previous breadcrumbs automatically
```

**Key points:**
- Always use `paradigm_orchestrate_inline` for tasks affecting 3+ files
- Agents with `canRunParallel: true` can be launched simultaneously
- Use `paradigm_context_check` to know when to hand off

---

## Lore Recording Pattern

Record project history after significant work sessions:

```
// After completing a significant task (3+ files modified):

1. Summarize what was done
   - What changed and why
   - Key decisions made
   - Symbols touched

2. Record the lore entry
   paradigm_lore_record({
     type: "agent-session",
     title: "Add payment processing with Stripe",
     summary: "Implemented #stripe-integration with ^authenticated gate...",
     symbols_touched: ["#stripe-integration", "^authenticated", "$checkout-flow"],
     tags: ["feature", "payments"]
   })

3. For architectural decisions, use type: "decision"
   paradigm_lore_record({
     type: "decision",
     title: "Chose Redis for session storage",
     summary: "Evaluated Redis vs Memcached. Redis selected for...",
     symbols_touched: ["#session-store"],
     tags: ["architecture", "infrastructure"]
   })
```

**Key points:**
- Record after sessions with 3+ file modifications (enforced by habits)
- Use `paradigm_lore_timeline` at session start for orientation
- Include all affected symbols in `symbols_touched`

---

## Habit Compliance Pattern

Ensure behavioral compliance at each workflow stage:

```
// BEFORE implementing (preflight):
paradigm_habits_check({ trigger: "preflight", symbolsTouched: [...] })
// → Verifies: ripple called, wisdom checked, context recovered

// AFTER implementing (postflight):
paradigm_habits_check({ trigger: "postflight",
  symbolsTouched: [...],
  filesModified: [...]
})
// → Verifies: .purpose updated, gates declared, flows documented

// BEFORE ending session (on-stop):
paradigm_habits_check({ trigger: "on-stop",
  symbolsTouched: [...],
  filesModified: [...]
})
// → Verifies: lore recorded, index rebuilt, checkpoint saved
```

**Key points:**
- Habits have severity levels: `info`, `warn`, `error`, `blocking`
- Blocking habits prevent session completion until resolved
- Use `paradigm_practice_context` for proactive warnings before modifying symbols
- Check `paradigm_habits_status` to review compliance trends

---

## Flow-First Development Pattern

Define flows BEFORE implementing features that span multiple steps:

```
1. DEFINE the flow
   - Add to .paradigm/flows.yaml:
     $user-registration:
       name: User Registration Flow
       trigger: "POST /api/auth/register"
       steps:
         - type: gate
           symbol: ^rate-limited
         - type: action
           symbol: #validate-input
         - type: action
           symbol: #create-user
         - type: signal
           symbol: "!user-registered"
       successSignal: "!user-registered"

2. VALIDATE the flow
   paradigm_flow_validate({ flowId: "$user-registration" })

3. VISUALIZE the flow
   paradigm flow diagram $user-registration

4. IMPLEMENT each step
   - Gates → middleware/auth checks
   - Actions → business logic
   - Signals → event handlers

5. VALIDATE with implementation check
   paradigm_flow_validate({
     flowId: "$user-registration",
     checkImplementation: true
   })
```

**Key points:**
- Define flows when logic spans 3+ components
- Each step becomes a clear implementation target
- Use `paradigm flow diagram` to generate Mermaid visualizations
- Validate both before and after implementing

*Part of Paradigm v2.0*
