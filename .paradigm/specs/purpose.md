---
id: purpose
title: Purpose File Schema
version: 2.0.0
updated: 2026-02-06
tags: [purpose, schema, context, yaml]
canonical_for: [purpose-files, directory-context]
related:
  - ./symbols-v2.md (symbol reference)
  - ./context.md (documentation indexing)
---

# Purpose File Schema (v2)

Purpose files (`.purpose`) define contextual metadata for directories. They tell AI agents what a directory contains, what symbols it defines, and how they relate to each other.

---

## File Location

Purpose files can be named:
- `.purpose` - Directory-level context (recommended)
- `*.purpose` - Named purpose file for specific context

Place `.purpose` files in:
- Feature directories (`src/features/auth/.purpose`)
- Component directories (`src/components/.purpose`)
- Any directory that benefits from AI context

---

## Basic Schema

```yaml
# Optional: description of the directory
description: What this directory contains and its role in the project

# Components (#) - Any documented code unit
# Use tags for classification: [feature], [integration], [state], [ui], etc.
symbols:
  #component-name:
    description: What this component does
    tags: [feature, critical]             # Classification tags
    gates: [^gate1, ^gate2]              # Required gates
    flows: [$flow-name]                  # Multi-step processes
    signals: ["!signal1", "!signal2"]    # Events emitted
    uses: [#OtherComponent]             # Dependencies
    used-by: [#parent-component]        # Dependents

  # Gates (^) - Authorization checkpoints
  ^gate-name:
    description: What access this controls
    locks: [lock-description]
    tags: [auth, admin]

  # Signals (!) - Events and side effects
  !signal-name:
    description: What triggers this event
    emitted-by: [#component]
    tags: [auth, analytics]

  # Flows ($) - Multi-step processes
  $flow-name:
    description: What this process accomplishes
    steps: [step1, step2, step3]
    gates: [^required-gate]

  # Aspects (~) - Cross-cutting rules with code anchors
  ~aspect-name:
    description: Rule enforced across components
    anchors:                             # REQUIRED for aspects
      - src/middleware/audit.ts:15-35
    applies-to: ["#*Service"]
    tags: [compliance, security]
```

---

## Record vs Array Format

Both formats are valid for defining symbols:

### Record Format (Recommended)

```yaml
symbols:
  #login:
    description: User authentication
    tags: [feature]
    gates: [^authenticated]

  #checkout:
    description: Purchase flow
    tags: [feature, critical]
    gates: [^authenticated, ^has-cart]
```

### Array Format

```yaml
symbols:
  - id: "#login"
    description: User authentication
    tags: [feature]
    gates: [^authenticated]

  - id: "#checkout"
    description: Purchase flow
    tags: [feature, critical]
    gates: [^authenticated, ^has-cart]
```

---

## Symbol References (v2)

Reference symbols using these 5 operational prefixes:

| Symbol | Name | Example | Purpose |
|--------|------|---------|---------|
| `#` | Component | `#login`, `#Button` | Any documented code unit |
| `$` | Flow | `$onboarding`, `$checkout-flow` | Multi-step process |
| `^` | Gate | `^authenticated`, `^admin` | Authorization checkpoint |
| `!` | Signal | `!login-success`, `!error` | Event or side effect |
| `~` | Aspect | `~audit-required` | Cross-cutting rule (requires anchors) |

Classification uses **tags** instead of symbol prefixes:

| Tag | Replaces | Example |
|-----|----------|---------|
| `[feature]` | old `@feature` | `#checkout` with `tags: [feature]` |
| `[integration]` | old `&integration` | `#stripe-client` with `tags: [integration, stripe]` |
| `[state]` | old `%state` | `#user-store` with `tags: [state]` |
| `[idea]` | old `?idea` | Any symbol with `tags: [idea]` |
| `[deprecated]` | old `~deprecated` | Any symbol with `tags: [deprecated]` |

---

## Minimal Example

```yaml
# src/features/auth/.purpose
description: Authentication and user session management

symbols:
  #login:
    description: Email/password authentication
    tags: [feature]
    gates: [^public]
    signals: ["!login-success", "!login-failed"]

  #logout:
    description: End user session
    tags: [feature]
    gates: [^authenticated]
    signals: ["!logout"]

  #LoginForm:
    description: Login UI with validation
    tags: [ui]
    used-by: [#login]
```

---

## Complete Example

```yaml
# src/features/checkout/.purpose
description: E-commerce checkout and payment processing

symbols:
  #add-to-cart:
    description: Add product to shopping cart
    tags: [feature]
    gates: [^authenticated]
    signals: ["!cart-updated"]
    uses: [#CartButton, #ProductCard]

  #checkout:
    description: Complete purchase flow
    tags: [feature, critical]
    gates: [^authenticated, ^has-cart]
    flows: [$checkout-flow]
    signals: ["!checkout-started", "!checkout-completed", "!payment-failed"]

  #CartButton:
    description: Add to cart button with quantity selector
    tags: [ui, interactive]
    used-by: [#add-to-cart]

  #CheckoutForm:
    description: Payment and shipping form
    tags: [ui]
    used-by: [#checkout]
    uses: [#AddressForm, #PaymentForm]

  $checkout-flow:
    description: Multi-step checkout process
    steps:
      - Review cart
      - Enter shipping
      - Enter payment
      - Confirm order
    gates: [^authenticated, ^has-cart]

  !cart-updated:
    description: Cart contents changed
    emitted-by: [#add-to-cart]
    tags: [cart]

  !checkout-completed:
    description: Order successfully placed
    emitted-by: [#checkout]
    tags: [purchase]

  #cart-store:
    description: Items currently in cart
    tags: [state]
```

---

## Validation

Validate purpose files with:

```bash
paradigm purpose validate
paradigm purpose validate ./src/features
```

Common validation errors:
- Missing description
- Invalid symbol references
- Circular dependencies
- Unknown symbol types
- Aspects missing required anchors

---

## Best Practices

1. **Keep descriptions concise** - One sentence explaining purpose
2. **Use consistent naming** - kebab-case for IDs (`feature-name` not `featureName`)
3. **Reference related symbols** - Link components to gates, signals, flows
4. **Use tags for classification** - `[feature]`, `[integration]`, `[state]`, `[ui]`, etc.
5. **Update when code changes** - Keep purpose files in sync with implementation
6. **Place at appropriate level** - Directory-level for shared context, feature-level for specifics
7. **Anchor all aspects** - `~` symbols must have `anchors` pointing to enforcement code

---

## CLI Commands

```bash
# Validate all purpose files
paradigm purpose validate

# Show aggregated context
paradigm purpose remember

# Lint with auto-fix
paradigm lint --fix

# Generate scan index from purpose files
paradigm index
```

---

## AI Agent Usage

AI agents should:
1. Read `.purpose` file before modifying a directory
2. Update `.purpose` when adding features or components
3. Follow symbol references to understand relationships
4. Use gates information for authorization requirements
5. Check signals when implementing event handling
