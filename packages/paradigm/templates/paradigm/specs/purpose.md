---
id: purpose
title: Purpose File Schema
version: 1.0.0
updated: 2026-02-02
tags: [purpose, schema, context, yaml]
canonical_for: [purpose-files, directory-context]
related:
  - ./symbols.md (symbol reference)
  - ./context.md (documentation indexing)
---

# Purpose File Schema

Purpose files (`.purpose`) define contextual metadata for directories. They tell AI agents what a directory contains, what features it implements, and how components relate to each other.

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

# Features (@ symbol) - User-facing capabilities
features:
  feature-name:
    description: What this feature does
    gates: [^gate1, ^gate2]           # Required portals
    flows: [$flow-name]               # Multi-step processes
    signals: [!signal1, !signal2]     # Events emitted
    components: [#Component1]         # Components used
    states: [%user.preference]        # State accessed
    tags: [keyword1, keyword2]        # Searchable tags

# Components (# symbol) - Reusable modules
components:
  ComponentName:
    description: What this component does
    used-by: [@feature1, @feature2]   # Features using this
    uses: [#OtherComponent]           # Dependencies
    tags: [ui, form, etc]

# Gates (^ symbol) - Authorization checkpoints
gates:
  gate-name:
    description: What access this controls
    locks: [lock-description]         # Requirements
    tags: [auth, admin, etc]

# Signals (! symbol) - Events and side effects
signals:
  signal-name:
    description: What triggers this event
    emitted-by: [@feature]            # Source
    category: [auth, analytics, etc]

# Flows ($ symbol) - Multi-step processes
flows:
  flow-name:
    description: What this process accomplishes
    steps: [step1, step2, step3]
    gates: [^required-gate]

# States (% symbol) - Application state
states:
  state.path:
    description: What this state represents
    type: boolean | string | number | object
    default: value
```

---

## Record vs Array Format

Both formats are valid for defining items:

### Record Format (Recommended)

```yaml
features:
  login:
    description: User authentication
    gates: [^authenticated]

  checkout:
    description: Purchase flow
    gates: [^authenticated, ^has-cart]
```

### Array Format

```yaml
features:
  - id: login
    description: User authentication
    gates: [^authenticated]

  - id: checkout
    description: Purchase flow
    gates: [^authenticated, ^has-cart]
```

---

## Symbol References

Reference other symbols using their prefixes:

| Symbol | Meaning | Example |
|--------|---------|---------|
| `@` | Feature | `@login`, `@checkout` |
| `#` | Component | `#Button`, `#Modal` |
| `^` | Gate | `^authenticated`, `^admin` |
| `!` | Signal | `!login-success`, `!error` |
| `$` | Flow | `$onboarding`, `$checkout-flow` |
| `%` | State | `%user.authenticated` |
| `?` | Idea | `?subscription-model` |
| `~` | Deprecated | `~legacy-api` |
| `&` | Integration | `&stripe`, `&analytics` |

---

## Minimal Example

```yaml
# src/features/auth/.purpose
description: Authentication and user session management

features:
  login:
    description: Email/password authentication
    gates: [^public]
    signals: [!login-success, !login-failed]

  logout:
    description: End user session
    gates: [^authenticated]
    signals: [!logout]

components:
  LoginForm:
    description: Login UI with validation
    used-by: [@login]
```

---

## Complete Example

```yaml
# src/features/checkout/.purpose
description: E-commerce checkout and payment processing

features:
  add-to-cart:
    description: Add product to shopping cart
    gates: [^authenticated]
    signals: [!cart-updated]
    components: [#CartButton, #ProductCard]
    states: [%cart.items]

  checkout:
    description: Complete purchase flow
    gates: [^authenticated, ^has-cart]
    flows: [$checkout-flow]
    signals: [!checkout-started, !checkout-completed, !payment-failed]
    tags: [payment, critical]

components:
  CartButton:
    description: Add to cart button with quantity selector
    used-by: [@add-to-cart]
    tags: [ui, interactive]

  CheckoutForm:
    description: Payment and shipping form
    used-by: [@checkout]
    uses: [#AddressForm, #PaymentForm]

flows:
  checkout-flow:
    description: Multi-step checkout process
    steps:
      - Review cart
      - Enter shipping
      - Enter payment
      - Confirm order
    gates: [^authenticated, ^has-cart]

signals:
  cart-updated:
    description: Cart contents changed
    emitted-by: [@add-to-cart]
    category: cart

  checkout-completed:
    description: Order successfully placed
    emitted-by: [@checkout]
    category: purchase

states:
  cart.items:
    description: Items currently in cart
    type: array
    default: []
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

---

## Best Practices

1. **Keep descriptions concise** - One sentence explaining purpose
2. **Use consistent naming** - kebab-case for IDs (`feature-name` not `featureName`)
3. **Reference related symbols** - Link features to gates, signals, components
4. **Add tags for searchability** - Help AI find relevant code
5. **Update when code changes** - Keep purpose files in sync with implementation
6. **Place at appropriate level** - Directory-level for shared context, feature-level for specifics

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
