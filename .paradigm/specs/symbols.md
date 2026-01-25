# Paradigm Symbol System

> Paradigm v1.0 - Language & Discipline Agnostic

The symbol system creates a **shared language** between code, developers, and AI agents. Each symbol prefix identifies a specific type of element in the codebase.

**Paradigm is universal.** The symbols mean the same thing whether you're building a web app, training an ML model, writing firmware, or deploying infrastructure. See `specs/disciplines.md` for discipline-specific interpretations.

## Symbol Reference

| Symbol | Name | Owner | Description |
|--------|------|-------|-------------|
| `@` | Feature | Purpose | User-facing capabilities and functionality |
| `#` | Component | Purpose | Reusable code units, UI components, modules |
| `$` | Flow | Shared | Multi-step processes or user journeys |
| `%` | State | Purpose | Global or user state conditions |
| `^` | Portal | Portal | Access control points, authorization rules |
| `!` | Signal | Portal | Events, errors, and side effects |
| `?` | Idea | Premise | Free-form exploration, future possibilities |
| `~` | Deprecated | Shared | Features/components marked for removal |
| `&` | Integration | Shared | External services and third-party connections |

---

## When to Use Each Symbol

### `@` Features

Use for **user-facing operations** — things a user can do or experience.

```
@login          - User authentication
@checkout       - Purchase completion
@search         - Content search
@profile-edit   - Profile modification
@message-send   - Sending messages
```

**Where:** Entry points, API routes, user actions, feature directories.

**In code (pseudocode):**
```
// At feature entry
log.feature('@login').info('Starting @login', { email })

// At feature exit  
log.signal('!login-success').info('User authenticated', { user_id })
```

---

### `#` Components

Use for **infrastructure and reusable modules** — building blocks of features.

```
#Button         - UI button component
#Modal          - Dialog component
#api-client     - HTTP client wrapper
#database       - Database connection
#redis-cache    - Caching layer
```

**Where:** Component directories, utility libraries, shared modules.

**In code (pseudocode):**
```
log.component('#database').debug('Query executed', { table, duration })
log.component('#cache').warn('Cache miss, fetching from source', { key })
```

---

### `$` Flows

Use for **multi-step processes** — user journeys that span multiple components.

```
$checkout-flow     - Cart → Shipping → Payment → Confirmation
$onboarding        - Signup → Verify → Profile → Tutorial
$password-reset    - Request → Email → Verify → Reset
```

**Where:** Flow definitions, saga files, orchestration logic.

**In code (pseudocode):**
```
log.flow('$checkout-flow').info('Step completed', { step: 'shipping', next: 'payment' })
```

---

### `%` State

Use for **application state** — reactive data that drives UI and behavior.

```
%user.authenticated    - Is user logged in?
%user.role             - User's access level
%cart.items            - Items in shopping cart
%cart.total            - Cart total price
%app.loading           - Global loading state
```

**Where:** State stores, reducers, context providers.

**In code (pseudocode):**
```
log.state('%user.authenticated').info('State changed', { from: false, to: true })
```

---

### `~` Aspects

Use for **cross-cutting concerns** — properties or behaviors that attach to other symbols.

```
@login~validation      - Validation rules for login
@login~rate-limit      - Rate limiting for login
#Button~disabled       - Disabled state of button
#Modal~animation       - Animation behavior
```

**Where:** Aspect-oriented code, decorators, mixins.

---

### `^` Portals

Use for **authorization and access control** — checkpoints that allow or deny access.

```
^authenticated         - Must be logged in
^admin-only           - Must be admin
^premium-required     - Must have premium subscription
^rate-limited         - Subject to rate limiting
^verified-email       - Must have verified email
```

**Where:** Middleware, guards, authorization logic.

**In code (pseudocode):**
```
log.portal('^authenticated').debug('Checking portal')
log.portal('^authenticated').warn('Access denied', { user_id, resource })
log.portal('^authenticated').debug('Portal passed', { user_id })
```

---

### `!` Signals

Use for **events and side effects** — things that happen as a result of actions.

```
!login-success        - User successfully logged in
!login-failed         - Login attempt failed
!payment-processed    - Payment completed
!email-sent           - Email was sent
!rate-limit-exceeded  - Too many requests
```

**Where:** Event emitters, side effect handlers, notification systems.

**In code (pseudocode):**
```
log.signal('!login-success').info('User authenticated', { user_id })
log.signal('!payment-failed').error('Payment declined', { reason })
```

---

### `?` Ideas

Use for **exploration and future possibilities** — not yet implemented.

```
?ai-recommendations   - AI-powered suggestions
?subscription-model   - Possible subscription feature
?dark-mode           - Dark theme support
?mobile-app          - Native mobile version
```

**Where:** Premise files, planning documents, ideation.

---

### `~` Deprecated

Use for **features or components marked for removal** — still exists but should not be used.

```
~legacy-api          - Old API being phased out
~v1-auth             - Previous auth system
~old-dashboard       - Dashboard being replaced
```

**Where:** Code comments, changelog, migration notes.

**In code:**
```
// ~legacy-api: Use @new-api instead. Removal planned for v2.0.
```

---

### `&` Integrations

Use for **external services and third-party connections** — dependencies outside your codebase.

```
&stripe              - Payment processing
&supabase            - Database and auth
&resend              - Email delivery
&google-calendar     - Calendar integration
&aws-s3              - File storage
```

**Where:** Integration modules, API wrappers, configuration.

**In code (pseudocode):**
```
log.integration('&stripe').info('Payment processed', { amount })
log.integration('&postgres').error('Query failed', { error })
```

---

#### Compound Ideas (`?@`, `?#`, `?!`, etc.)

Ideas can specify what type of symbol they're exploring by using a compound prefix:

```
?@subscription-model      - Idea for a feature
?#dark-mode-toggle        - Idea for a component
?$express-checkout        - Idea for a flow
?%user-preferences        - Idea for state
?~performance-optimization - Idea for an aspect
?^premium-access          - Idea for a portal
?!payment-webhook         - Idea for a signal
```

**Why use compound ideas?**
- **Categorization**: Makes it clear what type of symbol the idea relates to
- **Discoverability**: In the Prism visualizer, compound ideas connect to their target symbol type
- **Planning**: Helps organize ideas by what they would become if implemented

**Simple vs Compound:**
- `?subscription-model` - General idea, no specific type
- `?@subscription-model` - Idea specifically for a feature

---

## Symbol Naming Conventions

1. **Use kebab-case**: `@user-login` not `@userLogin`
2. **Be specific**: `@checkout-payment` not `@pay`
3. **Use dots for hierarchy**: `%user.authenticated`, `%cart.items`
4. **Use tilde for aspects**: `@login~validation`
5. **Match file structure**: Features in `features/` use `@`, components in `components/` use `#`

---

## Cross-Referencing

Symbols can reference each other in documentation:

```yaml
# In .purpose file (any project type)
features:
  process-order:
    description: Complete order processing
    portals: [^authenticated, ^valid-order]
    signals: [!order-complete, !order-failed]
    flow: $order-processing
    components: [#validator, #processor]
    integrations: [&stripe, &inventory-api]
```

This creates a traceable web of relationships that AI agents can follow.

## Discipline-Specific Examples

See `specs/disciplines.md` for how symbols map to:
- Web Development
- Backend Services
- Machine Learning
- Mobile Development
- Game Development
- Embedded/IoT
- Infrastructure/DevOps
