# Paradigm Symbol System v2 - Full Specification

> **Version 2.0** - Simplified, Anchor-First Symbols with Tag-Based Classification

This document is the canonical reference for Paradigm's Symbol System v2.

---

## Philosophy

The original Paradigm symbol system had 9 symbols (`@feature`, `#component`, `$flow`, `%state`, `^gate`, `!signal`, `?idea`, `~deprecated`, `&integration`). In practice:

1. **AI agents rarely used them** - The cognitive load of choosing between `@feature` vs `#component` vs `&integration` led to symbols being skipped entirely
2. **Classification symbols added noise** - `@feature` and `&integration` are classifications, not operational concepts
3. **Aspects had no enforcement** - Rules like "all payments require audit logging" were documentation without teeth

**Solution**: Reduce to 5 operational symbols + a tag bank for classification.

---

## Symbol Table v2

| Symbol | Name | Purpose | Example |
|--------|------|---------|---------|
| `#` | Component | Any documented code unit (function, class, module, service) | `#PaymentService` |
| `$` | Flow | Multi-step process with defined sequence | `$checkout-flow` |
| `^` | Gate | Authorization/validation checkpoint | `^authenticated` |
| `!` | Signal | Event emitted for side effects | `!payment-completed` |
| `~` | Aspect | Rule/constraint with required code anchor | `~audit-required` |

### What Changed from v1

| Old Symbol | New Approach |
|------------|--------------|
| `@feature` | Tag: `[feature]` on a `#component` |
| `&integration` | Tag: `[integration]` on a `#component` |
| `%state` | Tag: `[state]` on a `#component` |
| `?idea` | Tag: `[idea]` on any symbol |
| `~deprecated` (old) | Tag: `[deprecated]` on any symbol |

---

## Component (`#`)

The universal anchor point for documented code. A component is any code unit worth naming.

### Definition

```yaml
# In .purpose file
#PaymentService:
  description: Handles all payment processing
  tags: [feature, integration, stripe]
  anchors:
    - src/services/payment.ts:1-150
  references:
    - $checkout-flow
    - ^authenticated
  emits:
    - !payment-completed
    - !payment-failed
```

### What Qualifies as a Component

- Functions with business logic
- Classes/modules
- API endpoints
- React components
- Database models
- Configuration objects
- CLI commands

### Naming Convention

- PascalCase for classes/components: `#PaymentService`, `#UserProfile`
- kebab-case for functions/endpoints: `#process-payment`, `#get-user`

---

## Flow (`$`)

Multi-step processes with defined sequence. Flows connect components.

### Definition

```yaml
$checkout-flow:
  description: Complete purchase from cart to confirmation
  tags: [critical, revenue]
  steps:
    - ^authenticated       # Gate: must be logged in
    - #validate-cart       # Component: check inventory
    - #calculate-totals    # Component: tax, shipping
    - ^payment-authorized  # Gate: payment method valid
    - #process-payment     # Component: charge card
    - !payment-completed   # Signal: trigger fulfillment
    - #send-confirmation   # Component: email receipt
  on-failure:
    - !checkout-failed
    - #notify-support
```

### Flow Characteristics

- Has a defined start and end
- Steps execute in sequence (with possible branches)
- Gates can block progression
- Signals trigger side effects
- Failure paths are explicit

---

## Gate (`^`)

Authorization and validation checkpoints. Gates either pass or block.

### Definition

```yaml
^payment-authorized:
  description: Verify payment method is valid and has sufficient funds
  tags: [security, payment]
  anchors:
    - src/middleware/payment-auth.ts:25-45
  check: |
    user.paymentMethod != null &&
    user.paymentMethod.verified &&
    cart.total <= user.paymentMethod.limit
  blocks:
    - $checkout-flow
    - #process-refund
```

### Gate Patterns

| Pattern | Example | Use Case |
|---------|---------|----------|
| Identity | `^authenticated` | User is logged in |
| Role | `^admin` | User has admin role |
| Ownership | `^resource-owner` | User owns the resource |
| State | `^cart-not-empty` | Precondition met |
| External | `^payment-authorized` | Third-party validation |

---

## Signal (`!`)

Events emitted for side effects. Signals decouple producers from consumers.

### Definition

```yaml
!payment-completed:
  description: Emitted when payment successfully processes
  tags: [critical, audit]
  anchors:
    - src/services/payment.ts:89
  payload:
    orderId: string
    amount: number
    currency: string
    timestamp: ISO8601
  triggers:
    - #send-receipt
    - #update-inventory
    - #notify-fulfillment
    - #log-audit-trail
```

### Signal Naming

- Past tense for completed actions: `!payment-completed`, `!user-registered`
- Present tense for ongoing: `!processing-started`
- Noun for state changes: `!low-inventory`, `!rate-limit-exceeded`

---

## Aspect (`~`)

**Rules and constraints with REQUIRED code anchors.** Aspects are the enforcement mechanism for cross-cutting concerns.

### Definition

```yaml
~audit-required:
  description: All financial operations must log to audit trail
  tags: [compliance, security]
  anchors:  # REQUIRED - must point to actual enforcement code
    - src/middleware/audit.ts:15-35
    - src/decorators/auditable.ts:1-20
  applies-to:
    - "#*Service"        # All services
    - "$*-payment-*"     # All payment flows
    - "^payment-*"       # All payment gates
  enforcement: |
    Every component matching applies-to patterns must:
    1. Import the @auditable decorator
    2. Wrap operations in audit context
    3. Log before/after state for mutations
  examples:
    correct: |
      @auditable('payment')
      async processPayment(order: Order) {
        // Implementation
      }
    incorrect: |
      async processPayment(order: Order) {
        // Missing audit decorator!
      }
```

### Anchor Requirement

**Aspects MUST have anchors.** An aspect without code backing it is just documentation that will be ignored.

```yaml
# INVALID - no anchors
~secure-passwords:
  description: Passwords must be hashed with bcrypt
  applies-to: ["#*Auth*"]

# VALID - has enforcement code
~secure-passwords:
  description: Passwords must be hashed with bcrypt
  anchors:
    - src/utils/password.ts:10-25      # The hashing function
    - src/middleware/auth.ts:45-60     # The validation check
  applies-to: ["#*Auth*"]
```

### Anchor Format

Line-based references for precision:

```
file.ts:15          # Single line
file.ts:15-20       # Line range
file.ts:15,25,30    # Multiple lines
src/auth/*.ts:1-50  # Glob with range (all files, lines 1-50)
```

### Common Aspect Patterns

| Aspect | Purpose | Typical Anchors |
|--------|---------|-----------------|
| `~audit-required` | Compliance logging | Middleware, decorators |
| `~rate-limited` | API protection | Rate limiter config |
| `~cached` | Performance | Cache wrapper functions |
| `~validated` | Input safety | Validation schemas |
| `~encrypted` | Data protection | Encryption utilities |
| `~idempotent` | Retry safety | Idempotency key handlers |

---

## Tag Bank System

Tags replace classification symbols. They live in `.paradigm/tags.yaml`.

### Structure

```yaml
# .paradigm/tags.yaml
version: "1.0"

# Core tags - universal vocabulary
core:
  feature:
    description: User-facing functionality
    color: "#4CAF50"
    applies-to: ["#"]

  integration:
    description: External service connection
    color: "#2196F3"
    applies-to: ["#"]

  state:
    description: Manages application state
    color: "#9C27B0"
    applies-to: ["#"]

  critical:
    description: Failure causes major business impact
    color: "#F44336"
    applies-to: ["#", "$", "^"]

  deprecated:
    description: Scheduled for removal
    color: "#9E9E9E"
    applies-to: ["#", "$", "^", "!", "~"]

  idea:
    description: Proposed, not yet implemented
    color: "#FF9800"
    applies-to: ["#", "$"]

  security:
    description: Security-sensitive code
    color: "#E91E63"
    applies-to: ["#", "^", "~"]

  compliance:
    description: Regulatory requirement
    color: "#795548"
    applies-to: ["~", "^"]

# Project tags - domain-specific vocabulary
project:
  stripe:
    description: Stripe payment integration
    color: "#635BFF"
    applies-to: ["#"]

  postgres:
    description: PostgreSQL database operations
    color: "#336791"
    applies-to: ["#"]

  revenue:
    description: Affects company revenue
    color: "#4CAF50"
    applies-to: ["$", "#"]

# Suggested tags - AI can propose, human approves
suggested: []
```

### Tag Properties

| Property | Required | Description |
|----------|----------|-------------|
| `description` | Yes | What the tag means (for AI context) |
| `color` | No | Hex color for UI display |
| `applies-to` | No | Symbol types this tag is valid for |
| `aliases` | No | Alternative names (for AI matching) |

### Tag Descriptions for AI Context

The `description` field is critical. It tells AI agents when to apply a tag:

```yaml
project:
  pii:
    description: |
      Contains Personally Identifiable Information.
      Apply to any component that handles: names, emails, addresses,
      phone numbers, SSNs, financial data, health records.
      Components with this tag require ~encrypted aspect.
    applies-to: ["#"]
    requires-aspect: ["~encrypted"]
```

### Suggested Tags Flow

1. AI agent encounters undocumented code
2. AI proposes tag in `suggested` section
3. Human reviews in Sentinel UI
4. Human approves → moves to `project` section
5. Human rejects → removed from `suggested`

```yaml
suggested:
  - tag: webhook-handler
    proposed-by: claude
    proposed-at: 2024-01-15T10:30:00Z
    reason: "Found 5 components handling incoming webhooks"
    applies-to: ["#"]
    example-symbols:
      - "#stripe-webhook"
      - "#github-webhook"
```

---

## MCP Tools

### `paradigm_tags()`

List, search, and manage tags.

```typescript
// List all tags
paradigm_tags({ action: "list" })

// Search tags
paradigm_tags({ action: "search", query: "payment" })

// Get tag details
paradigm_tags({ action: "get", tag: "stripe" })

// Add project tag (human only via CLI/UI)
paradigm_tags({
  action: "add",
  tag: "redis",
  description: "Redis cache operations",
  color: "#DC382D",
  appliesTo: ["#"]
})
```

### `paradigm_tags_suggest()`

AI proposes a new tag for human review.

```typescript
paradigm_tags_suggest({
  tag: "rate-limited-endpoint",
  description: "API endpoints with rate limiting applied",
  reason: "Found 8 endpoints using the rateLimiter middleware",
  appliesTo: ["#"],
  exampleSymbols: ["#api-login", "#api-register", "#api-forgot-password"]
})
```

### `paradigm_aspect_check()`

Verify aspects are properly anchored and enforced.

```typescript
// Check if aspect has valid anchors
paradigm_aspect_check({ aspect: "~audit-required" })

// Returns:
{
  valid: true,
  anchors: [
    { path: "src/middleware/audit.ts:15-35", exists: true, lines: 21 },
    { path: "src/decorators/auditable.ts:1-20", exists: true, lines: 20 }
  ],
  coverage: {
    appliesTo: ["#*Service", "$*-payment-*"],
    matchingSymbols: 12,
    symbolsWithAspect: 10,
    missing: ["#LegacyPaymentService", "#TestService"]
  }
}
```

---

## .purpose File Format v2

### Basic Structure

```yaml
# src/features/checkout/.purpose
version: "2.0"

description: |
  Checkout feature handling cart review, shipping, and payment.

# Components (all code units use # prefix)
#checkout:
  description: Main checkout feature
  tags: [feature, critical, revenue]
  anchors:
    - src/features/checkout/index.ts:1-200
  gates: [^authenticated]
  flows: [$checkout-flow]
  signals: [!checkout-started, !checkout-completed]

#CartReview:
  description: Cart review component
  components: [#CartItem, #PriceSummary]

# Flows
$checkout-flow:
  description: Complete purchase flow
  tags: [critical]
  steps:
    - "#CartReview"
    - "^authenticated"
    - "#ShippingForm"
    - "#PaymentForm"
    - "!checkout-completed"

# Signals
!checkout-completed:
  description: Emitted when checkout succeeds
  payload:
    orderId: string
    total: number

# Aspects
~audit-required:
  description: All checkout operations logged
  tags: [compliance]
  anchors:
    - src/features/checkout/middleware/audit.ts:1-30
  applies-to: ["#checkout"]
```

### Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | No | Format version ("2.0") |
| `description` | string | No | Module description |
| `#<name>` | object | No | Component definition |
| `$<name>` | object | No | Flow definition |
| `^<name>` | object | No | Gate definition |
| `!<name>` | object | No | Signal definition |
| `~<name>` | object | No | Aspect definition (requires anchors) |

### Component Fields

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | What the component does |
| `tags` | string[] | Classification tags |
| `anchors` | string[] | Code references (file:lines) |
| `gates` | string[] | Required gates |
| `flows` | string[] | Related flows |
| `signals` | string[] | Emitted signals |
| `components` | string[] | Child components |
| `aspects` | string[] | Applied aspects |

### Flow Fields

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | What the flow does |
| `tags` | string[] | Classification tags |
| `steps` | string[] | Ordered steps (symbols) |
| `on-failure` | string[] | Failure handling |

### Aspect Fields

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | What the aspect enforces |
| `tags` | string[] | Classification tags |
| `anchors` | string[] | **REQUIRED** Code references |
| `applies-to` | string[] | Pattern matches for symbols |
| `enforcement` | string | How to comply |
| `examples` | object | Correct/incorrect examples |

---

## Migration from v1 to v2

### CLI Command

```bash
# Dry run - show what would change
paradigm migrate v2 --dry-run

# Execute migration
paradigm migrate v2

# Add anchors to aspects interactively
paradigm migrate v2 --anchors
```

### Automatic Conversions

| v1 Symbol | v2 Conversion |
|-----------|---------------|
| `@feature` | `#feature` + `tags: [feature]` |
| `&stripe` | `#stripe` + `tags: [integration]` |
| `%userState` | `#userState` + `tags: [state]` |
| `?newIdea` | `#newIdea` + `tags: [idea]` |
| `~deprecated` | Stays `~` but deprecated is now a tag |

### Manual Steps

1. **Add anchors to aspects**: All `~` symbols need code anchors
2. **Review tags**: Approve AI-suggested tags or create project tags
3. **Verify flows**: Ensure `$flow` steps use correct symbol prefixes

---

## Verification

### Symbol Parsing

```bash
# Test new parser recognizes only v2 symbols
echo "#component $flow ^gate !signal ~aspect" | paradigm parse
# Should output 5 symbols

echo "@feature &integration %state" | paradigm parse
# Should output 0 symbols (old prefixes not recognized)
```

### Tag Bank API

```bash
curl http://localhost:3838/api/tags
# Returns { core: {...}, project: {...}, suggested: [...] }

curl -X POST http://localhost:3838/api/tags/suggest \
  -d '{"tag": "webhook", "reason": "Found 5 handlers"}'
# Adds to suggested list
```

### Aspect Validation

```bash
paradigm aspect check ~audit-required
# Returns anchor status and coverage report
```

---

## Success Metrics

1. **Adoption**: AI agents actually use symbols (measure via git history)
2. **Coverage**: >80% of code has symbol documentation
3. **Aspect enforcement**: 0 unanchored aspects in production
4. **Tag hygiene**: <10 suggested tags pending at any time

---

## Open Questions

1. **Should flows (`$`) require anchors?** Currently optional, but could enforce entry/exit anchors.

2. **Tag inheritance?** If `#PaymentService` has `[critical]`, do its signals get `[critical]`?

3. **Aspect violation handling?** When violations found:
   - Just report (current)
   - Block commits (strict mode)
   - Auto-create issues

4. **Tag namespacing?** For monorepos: `[payments:stripe]` or just `[stripe]`?
