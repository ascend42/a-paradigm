# Paradigm Symbol System v2 Update Prompt

Use this prompt to have Claude update all paradigm-related files in a project to the v2 symbol format.

---

## Prompt for Claude

```
You are updating a project to use Paradigm Symbol System v2. This involves converting all .purpose files, portal.yaml, and related documentation to use the simplified 5-symbol system with tag-based classification.

## Symbol System v2

| Symbol | Name | Purpose | Example |
|--------|------|---------|---------|
| `#` | Component | Any documented code unit | `#PaymentService`, `#Button` |
| `$` | Flow | Multi-step process with sequence | `$checkout-flow` |
| `^` | Gate | Authorization/validation checkpoint | `^authenticated` |
| `!` | Signal | Event emitted for side effects | `!payment-completed` |
| `~` | Aspect | Rule/constraint with REQUIRED code anchor | `~audit-required` |

## Legacy Symbol Conversions

Convert these old symbols to #component with appropriate tags:

| Old Symbol | New Symbol | Tag |
|------------|------------|-----|
| `@feature` | `#feature` | `[feature]` |
| `&integration` | `#integration` | `[integration]` |
| `%state` | `#state` | `[state]` |
| `?idea` | `#idea` | `[idea]` |

## Tasks

1. **Find all .purpose files** in the project
2. **Convert each symbol** according to the mapping above
3. **Add tags field** to converted symbols
4. **Add anchors** to aspects (REQUIRED for ~aspects)
5. **Update portal.yaml** if it exists (gates stay as ^)
6. **Create .paradigm/tags.yaml** if it doesn't exist

## .purpose File v2 Format

```yaml
# Components (#) - the universal code unit
#PaymentService:
  description: Handles payment processing
  tags: [feature, integration, stripe]  # Classification via tags
  anchors:                               # Line-based code references
    - src/services/payment.ts:1-150
  components:                            # References other components
    - "#StripeClient"
  emits:                                 # Signals this component emits
    - "!payment-completed"
    - "!payment-failed"

# Flows ($) - multi-step processes
$checkout-flow:
  description: Complete purchase flow
  tags: [critical, revenue]
  steps:
    - "^authenticated"        # Gate check
    - "#validate-cart"        # Component
    - "^payment-authorized"   # Gate check
    - "#process-payment"      # Component
    - "!payment-completed"    # Signal emitted
  on-failure:
    - "!checkout-failed"

# Gates (^) - authorization checkpoints
^authenticated:
  description: User must be logged in
  tags: [security]
  anchors:
    - src/middleware/auth.ts:25-45
  check: req.user != null

# Signals (!) - events for side effects
!payment-completed:
  description: Emitted when payment succeeds
  tags: [audit, critical]
  anchors:
    - src/services/payment.ts:89
  payload:
    orderId: string
    amount: number
  triggers:
    - "#send-receipt"
    - "#update-inventory"

# Aspects (~) - rules with REQUIRED anchors
~audit-required:
  description: All financial operations must log to audit trail
  tags: [compliance, security]
  anchors:                    # REQUIRED for aspects!
    - src/middleware/audit.ts:15-35
    - src/decorators/auditable.ts:1-20
  applies-to:
    - "#*Service"
    - "$*-payment-*"
  enforcement: |
    Every component matching applies-to must use @auditable decorator
```

## Tag Bank Format (.paradigm/tags.yaml)

```yaml
version: "1.0"

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
  audit:
    description: Requires audit logging
    color: "#607D8B"
    applies-to: ["!", "~"]
  ui:
    description: User interface component
    color: "#00BCD4"
    applies-to: ["#"]
  api:
    description: API endpoint or service
    color: "#FF5722"
    applies-to: ["#"]

project: {}

suggested: []
```

## Anchor Format

Line-based references for precision:
- `file.ts:15` - Single line
- `file.ts:15-20` - Line range
- `file.ts:15,25,30` - Multiple specific lines
- `src/auth/*.ts:1-50` - Glob with range

## Conversion Examples

### Before (v1):
```yaml
@checkout:
  description: Shopping cart checkout feature

&stripe:
  description: Stripe payment integration

%cart:
  description: Shopping cart state

?subscription:
  description: Future subscription model
```

### After (v2):
```yaml
#checkout:
  description: Shopping cart checkout feature
  tags: [feature, revenue, critical]
  anchors:
    - src/features/checkout/index.ts:1-200

#stripe-integration:
  description: Stripe payment integration
  tags: [integration, stripe]
  anchors:
    - src/services/stripe.ts:1-150

#cart-state:
  description: Shopping cart state
  tags: [state]
  anchors:
    - src/store/cart.ts:1-100

#subscription-model:
  description: Future subscription model
  tags: [idea]
  # No anchors needed for ideas
```

## Checklist

For each .purpose file:
- [ ] Convert @ symbols to # with [feature] tag
- [ ] Convert & symbols to # with [integration] tag
- [ ] Convert % symbols to # with [state] tag
- [ ] Convert ? symbols to # with [idea] tag
- [ ] Add anchors to all ~ aspects (REQUIRED)
- [ ] Add tags field to all symbols
- [ ] Update any symbol references in other files

For the project:
- [ ] Create .paradigm/tags.yaml if missing
- [ ] Update CLAUDE.md symbol table if present
- [ ] Update portal.yaml routes (gates stay as ^)

## Important Rules

1. **Aspects MUST have anchors** - An aspect without code backing is invalid
2. **Use tags for classification** - Not symbol prefixes
3. **Keep gates as ^** - No change needed
4. **Keep signals as !** - No change needed
5. **Keep flows as $** - No change needed
6. **Convert @, &, %, ? to #** - With appropriate tags

Now scan the project for .purpose files and update them to v2 format.
```

---

## Usage

Copy the prompt above and paste it into a new Claude session, then ask Claude to:

1. "Scan this project for all .purpose files"
2. "Update each file to v2 format"
3. "Create .paradigm/tags.yaml if needed"
4. "Show me the changes before committing"

Or simply say: "Update this project to Paradigm v2" after pasting the prompt.
