---
id: N-para-201-symbol-naming
title: Symbol Naming Conventions
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-201
  - all-symbol-ids
  - components-noun-role-payment-service
  - gates-resource-role-or
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-201.json
---

## Consistency Is the Goal

Naming conventions exist so that anyone — human or AI — can predict what a symbol is called without looking it up. If your payment service is sometimes `#PaymentService`, sometimes `#payment-service`, and sometimes `#paymentSvc`, agents waste tokens searching and developers waste time guessing. Paradigm defines clear naming rules for each symbol type.

## The Base Rule: kebab-case for IDs

All symbol IDs in `.purpose` files use **kebab-case**:

```yaml
# Correct
#payment-service:
#user-profile:
#cart-item-list:

# Incorrect
#PaymentService:      # PascalCase is for display, not IDs
#payment_service:     # No underscores
#paymentService:      # No camelCase
```

This applies to all five symbol types: `#component-name`, `$flow-name`, `^gate-name`, `!signal-name`, `~aspect-name`.

## Component Naming (`#`)

Components follow the base kebab-case rule, with one exception: **class-like components** can use PascalCase in display names and code references while keeping kebab-case in the `.purpose` ID:

```yaml
components:
  #payment-service:                    # kebab-case ID
    description: PaymentService class   # PascalCase in description is fine
    file: PaymentService.ts             # PascalCase file names are fine
```

Naming patterns for components:
- **Services**: `#noun-service` — `#payment-service`, `#email-service`, `#auth-service`
- **Handlers**: `#noun-handler` — `#login-handler`, `#webhook-handler`
- **Stores/State**: `#noun-store` — `#user-store`, `#cart-store`
- **Utilities**: `#noun-utils` or `#verb-helper` — `#date-utils`, `#format-helper`

## Flow Naming (`$`)

Flows describe processes, so they use **noun-flow** or **verb-noun-flow** patterns:

```yaml
# Good
$checkout-flow
$user-onboarding
$password-reset-flow
$daily-report-generation

# Bad
$doCheckout          # Avoid imperative verb-only names
$flow1               # Non-descriptive
$theProcessOfCheckingOut  # Too verbose
```

The `-flow` suffix is optional but recommended for clarity. `$checkout-flow` is more immediately recognizable as a flow than `$checkout` (which could be confused with a component).

## Gate Naming (`^`)

Gates use a **resource-role** or **condition** pattern:

```yaml
# Resource-role pattern
^authenticated              # Base auth
^project-admin              # Admin of a project
^project-member             # Member of a project
^comment-author             # Author of a comment
^team-owner                 # Owner of a team

# Condition pattern
^email-verified             # Email has been verified
^payment-method-exists      # User has a payment method
^subscription-active        # Subscription is not expired
```

Avoid vague names like `^check1` or `^gate-a`. The name should describe what the gate verifies.

## Signal Naming (`!`)

Signals represent events that have already happened, so they use **past-tense** naming:

```yaml
# Good — past tense describes what happened
!payment-completed
!user-created
!login-failed
!order-shipped
!cache-invalidated

# Bad — present tense or imperative
!process-payment         # Sounds like a command, not an event
!creating-user           # Progressive tense is ambiguous
!login                   # Too vague — login succeeded or failed?
```

Past tense makes the intent clear: the signal fires *after* something happened. `!payment-completed` means the payment is done; listeners can react to the completed event.

## Aspect Naming (`~`)

Aspects describe rules or qualities, using **adjective** or **past-participle** patterns:

```yaml
# Good
~audit-required
~rate-limited
~cached
~encrypted-at-rest
~idempotent

# Bad
~doAudit              # Imperative — sounds like an action
~auditStuff           # Vague and informal
~Aspect1              # Non-descriptive
```

Aspect names should read naturally in a sentence: "This service is ~rate-limited" or "This endpoint is ~audit-required."

## Summary Table

| Symbol | Pattern | Examples |
|--------|---------|----------|
| `#` | `noun-role` | `#payment-service`, `#login-handler` |
| `$` | `noun-flow` | `$checkout-flow`, `$onboarding` |
| `^` | `resource-role` or `condition` | `^project-admin`, `^email-verified` |
| `!` | `past-tense-event` | `!payment-completed`, `!login-failed` |
| `~` | `adjective` / `past-participle` | `~rate-limited`, `~audit-required` |
