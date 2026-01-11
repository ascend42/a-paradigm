# ShopFlow Example Project

A realistic e-commerce platform example demonstrating all Horizon features.

## Structure

```
shopflow/
├── .horizon            # AI guidelines & symbol system (for .cursorrules)
├── .cursorrules        # Generated Cursor AI integration
├── .dream              # Project overview & idea board
├── .purpose            # Root project context
├── gate.yaml           # Authorization topology
├── auth/
│   └── .purpose        # Authentication module context
├── payments/
│   └── .purpose        # Payment processing context
├── features/
│   └── .purpose        # Shopping features context
└── components/
    └── .purpose        # UI component library context
```

## Key Files

| File | Purpose |
|------|---------|
| `.horizon` | AI guidelines, symbol definitions, states, conventions |
| `.cursorrules` | Cursor AI integration (generated from `.horizon`) |
| `.dream` | High-level project overview with ideas and areas |
| `.purpose` | Feature/component definitions with references |
| `gate.yaml` | Authorization gates, locks, and keys |

## Symbol Reference

This project demonstrates all Horizon symbol types:

| Symbol | Type | Examples in ShopFlow |
|--------|------|---------------------|
| `@` | Feature | `@checkout-flow`, `@user-login`, `@cart-management` |
| `#` | Component | `#ProductCard`, `#CartDrawer`, `#AuthProvider` |
| `$` | Flow | `$checkout-to-confirmation` |
| `%` | State | `%auth-state`, `%toast-state` |
| `~` | Aspect | `~search-performance`, `~mobile-ux` |
| `^` | Gate | `^auth-required`, `^premium-checkout`, `^admin-panel` |
| `!` | Signal | `!payment-failed`, `!login-failed` |
| `?` | Idea | `?subscription-model`, `?ai-recommendations` |

## Testing with Horizon CLI

```bash
# From the a-horizon root
cd examples/shopflow

# Validate all purpose files
npx horizon purpose validate

# Validate gate configuration
npx horizon gate validate

# Aggregate and view in Dreamscape
npx horizon visualize
```

## Cross-References

The files demonstrate rich interconnections:

- `@checkout-flow` references `@cart-management`, `@payment-processing`, and `^auth-required`
- `#ProductCard` is referenced by `@product-browse` and `#ProductGrid`
- `^auth-required` gate protects `@checkout-flow` and `@wishlist`
- `!payment-failed` signal is linked to `@payment-processing`
- `$checkout-to-confirmation` flow connects multiple features

## Ideas Board

The `.dream` file includes exploration ideas:

- `?subscription-model` - Recurring purchases
- `?ai-recommendations` - ML-powered suggestions  
- `?social-shopping` - Social wishlist sharing

These appear as dashed nodes in the Dreamscape.
