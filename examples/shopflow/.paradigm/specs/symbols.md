# Horizon Symbol System

The symbol system creates a **shared language** between code, developers, and AI agents. Each symbol prefix identifies a specific type of element in the codebase.

## Symbol Reference

| Symbol | Name | Owner | Description |
|--------|------|-------|-------------|
| `@` | Feature | Purpose | User-facing capabilities and functionality |
| `#` | Component | Purpose | Reusable code units, UI components, modules |
| `$` | Flow | Shared | Multi-step processes or user journeys |
| `%` | State | Purpose | Global or user state conditions |
| `~` | Aspect | Purpose | Cross-cutting concerns, nested properties |
| `^` | Gate | Gate | Access control points, authorization rules |
| `!` | Signal | Gate | Events, errors, and side effects |
| `?` | Idea | Dream | Free-form exploration, future possibilities |

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

**In code:**
```
// At feature entry
log.feature('@login').info('Starting @login', { email });

// At feature exit
log.signal('!login-success').info('User authenticated', { userId });
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

**In code:**
```
log.component('#database').debug('Query executed', { table, duration });
log.component('#api-client').warn('Request failed, retrying', { attempt });
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

**In code:**
```
log.flow('$checkout-flow').info('Step completed', { step: 'shipping', next: 'payment' });
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

**In code:**
```
log.state('%user.authenticated').info('State changed', { from: false, to: true });
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

### `^` Gates

Use for **authorization and access control** — checkpoints that allow or deny access.

```
^authenticated         - Must be logged in
^admin-only           - Must be admin
^premium-required     - Must have premium subscription
^rate-limited         - Subject to rate limiting
^verified-email       - Must have verified email
```

**Where:** Middleware, guards, authorization logic.

**In code:**
```
log.gate('^authenticated').debug('Checking gate');
log.gate('^authenticated').warn('Access denied', { userId, resource });
log.gate('^authenticated').debug('Gate passed', { userId });
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

**In code:**
```
log.signal('!login-success').info('User authenticated', { userId });
log.signal('!payment-failed').error('Payment declined', { reason });
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

**Where:** Dream files, planning documents, ideation.

#### Compound Ideas (`?@`, `?#`, `?!`, etc.)

Ideas can specify what type of symbol they're exploring by using a compound prefix:

```
?@subscription-model      - Idea for a feature
?#dark-mode-toggle        - Idea for a component
?$express-checkout        - Idea for a flow
?%user-preferences        - Idea for state
?~performance-optimization - Idea for an aspect
?^premium-access          - Idea for a gate
?!payment-webhook         - Idea for a signal
```

**Why use compound ideas?**
- **Categorization**: Makes it clear what type of symbol the idea relates to
- **Discoverability**: In the Dreamscape visualizer, compound ideas connect to their target symbol type
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

Symbols can reference each other in documentation and code:

```yaml
# In .purpose file
features:
  checkout:
    description: Complete purchase flow
    gates: [^authenticated, ^has-items]
    signals: ["!checkout-complete", "!payment-failed"]
    flow: $checkout-flow
    components: [#CheckoutForm, #PaymentProcessor]
```

This creates a traceable web of relationships that AI agents can follow.
