# ShopFlow Example Project

A realistic e-commerce platform example demonstrating all Paradigm features.

## Structure

```
shopflow/
├── .paradigm           # AI guidelines & symbol system (for .cursorrules)
├── .cursorrules        # Generated Cursor AI integration
├── .premise            # Project overview & idea board
├── .purpose            # Root project context
├── portal.yaml         # Authorization topology
├── auth/
│   └── .purpose        # Authentication module context
├── payments/
│   └── .purpose        # Payment processing context
├── features/
│   └── .purpose        # Shopping features context
├── components/
│   └── .purpose        # UI component library context
└── guards/
    └── AuthGuard.example.ts  # Portal Validator usage example
```

## Key Files

| File | Purpose |
|------|---------|
| `.paradigm` | AI guidelines, symbol definitions, states, conventions |
| `.cursorrules` | Cursor AI integration (generated from `.paradigm`) |
| `.premise` | High-level project overview with ideas and areas |
| `.purpose` | Feature/component definitions with references |
| `portal.yaml` | Authorization gates, locks, and keys |
| `guards/*.ts` | Portal Validator examples for route guards |

## Symbol Reference

This project demonstrates all Paradigm symbol types:

| Symbol | Type | Examples in ShopFlow |
|--------|------|---------------------|
| `@` | Feature | `@checkout-flow`, `@user-login`, `@cart-management` |
| `#` | Component | `#ProductCard`, `#CartDrawer`, `#AuthProvider` |
| `$` | Flow | `$checkout-to-confirmation` |
| `%` | State | `%auth-state`, `%toast-state` |
| `~` | Aspect | `~search-performance`, `~mobile-ux` |
| `^` | Portal | `^auth-required`, `^premium-checkout`, `^admin-panel` |
| `!` | Signal | `!payment-failed`, `!login-failed` |
| `?` | Idea | `?subscription-model`, `?ai-recommendations` |

## Testing with Paradigm CLI

```bash
# From the a-paradigm root
cd examples/shopflow

# Validate all purpose files
npx paradigm purpose validate

# Validate portal configuration
npx paradigm portal validate

# Aggregate and view in Prism
npx paradigm visualize
```

## Portal Validation for AI Agents

The `guards/` directory contains examples of using the **Portal Validator** - a system that enables AI agents to validate authorization flows by reading structured console output.

### How It Works

When a portal check runs, it emits a boxed console output:

```
┌─────────────────────────────────────────────────────────
│ 🚪 PORTAL CHECK: ^premium-checkout
│ ├─ Requires: active subscription, plan is pro or enterprise
│ ├─ Context: { userId: "123", plan: "free", status: "active" }
│ ├─ Decision: ❌ DENY
│ └─ Reason: Free plan does not include premium checkout
└─────────────────────────────────────────────────────────
```

### Usage in Route Guards

```typescript
import { portal } from '@a-company/portal-sdk';

function checkAuth(user: User | null, path: string) {
  const gate = portal.check('^authenticated')
    .requires('valid user session')
    .context({ path, hasUser: !!user });

  if (!user) {
    gate.deny('No active session');
    return { allowed: false, redirect: '/login' };
  }

  gate.allow('User authenticated');
  return { allowed: true };
}
```

### AI Validation

AI agents can validate portals by:
1. Navigating to protected routes
2. Reading console output for `🚪 PORTAL CHECK:` blocks
3. Verifying decisions match expected behavior

See [Portal Validation Spec](../../packages/paradigm/templates/paradigm/specs/portal-validation.md) for full details.

## Cross-References

The files demonstrate rich interconnections:

- `@checkout-flow` references `@cart-management`, `@payment-processing`, and `^auth-required`
- `#ProductCard` is referenced by `@product-browse` and `#ProductGrid`
- `^auth-required` gate protects `@checkout-flow` and `@wishlist`
- `!payment-failed` signal is linked to `@payment-processing`
- `$checkout-to-confirmation` flow connects multiple features

## Ideas Board

The `.premise` file includes exploration ideas:

- `?subscription-model` - Recurring purchases
- `?ai-recommendations` - ML-powered suggestions  
- `?social-shopping` - Social wishlist sharing

These appear as dashed nodes in Prism.
