# Horizon Scan Protocol

The Horizon Scan protocol enables **visual discovery** — AI agents can analyze screenshots or mockups and map visual elements to code using the Horizon symbol system.

---

## How It Works

1. User attaches an image (screenshot, mockup, diagram)
2. User says "horizon scan" (or a variant)
3. AI analyzes the image and identifies visual elements
4. AI cross-references with `.horizon/scan-index.json`
5. AI returns structured mapping of UI → code

---

## Triggering a Scan

| Command | Use Case |
|---------|----------|
| `horizon scan` | Default — map any image to code |
| `horizon scan ui` | Screenshot of running app |
| `horizon scan design` | Mockup or design file — gap analysis |
| `horizon scan error` | Error screenshot — find handlers |
| `horizon scan arch` | Architecture diagram — map to features |
| `horizon scan flow` | Flow diagram — match to `$flow` definitions |
| `horizon scan diff` | Two images — show what changed |

---

## Scan Index

The scan index at `.horizon/scan-index.json` contains:

```json
{
  "$meta": {
    "version": "1.0.0",
    "project": "my-app",
    "generatedAt": "2026-01-14T00:00:00Z"
  },
  "components": {
    "Button": {
      "symbol": "#Button",
      "path": "src/components/Button.tsx",
      "visualTags": ["button", "action"],
      "description": "Primary action button"
    }
  },
  "features": {
    "checkout": {
      "symbol": "@checkout",
      "path": "src/features/checkout/",
      "description": "Purchase completion flow"
    }
  },
  "flows": {
    "checkout-flow": {
      "symbol": "$checkout-flow",
      "steps": ["cart", "shipping", "payment", "confirmation"]
    }
  },
  "state": {
    "cart": {
      "symbol": "%cart",
      "slices": ["items", "total", "discount"]
    }
  },
  "gates": {
    "auth-required": {
      "symbol": "^auth-required",
      "description": "User must be logged in"
    }
  },
  "symbolMap": {
    "@checkout": { "category": "features", "id": "checkout" },
    "#Button": { "category": "components", "id": "Button" }
  }
}
```

Generate or update with:
```bash
horizon index
```

---

## Scan Result Format

When responding to a scan request, format results as:

```markdown
## 🔭 Horizon Scan Results

### Components
| Element | Symbol | Path | Confidence |
|---------|--------|------|------------|
| Primary Button | `#Button` | `src/components/Button.tsx` | ●●●● |
| Price Display | `#PriceDisplay` | `src/components/PriceDisplay.tsx` | ●●●○ |

### Features
- **`@checkout`** — Handles the checkout process shown in the image

### Flows
- **`$checkout-flow`** — Steps: cart → shipping → **payment** ← (current) → confirmation

### State
- `%cart.items` — Powers the item list
- `%cart.total` — Drives the price display

### Gates
- `^auth-required` — User must be logged in to access this screen

### ⚠️ Uncovered Elements
- The "Apply Coupon" input doesn't have a mapped component
- Consider creating `#CouponInput` component
```

---

## Confidence Levels

| Level | Display | Meaning |
|-------|---------|---------|
| High | ●●●● | Visual element clearly matches component name/tags |
| Medium | ●●●○ | Likely match based on context |
| Low | ●●○○ | Possible match, needs verification |
| Tentative | ●○○○ | Best guess, may be incorrect |

---

## Visual Tags

Components can have visual tags to improve matching:

| Tag | Elements |
|-----|----------|
| `button` | Buttons, clickable actions |
| `form` | Forms, input groups |
| `input` | Text inputs, selects, checkboxes |
| `card` | Card containers |
| `list` | Lists, tables, grids of items |
| `modal` | Dialogs, overlays, drawers |
| `nav` | Navigation elements |
| `header` | Header sections |
| `footer` | Footer sections |
| `sidebar` | Side navigation |
| `hero` | Hero sections |
| `chart` | Data visualizations |
| `avatar` | User avatars |
| `badge` | Badges, tags, pills |
| `menu` | Menus, dropdowns |
| `tab` | Tab navigation |
| `toast` | Notifications, alerts |
| `spinner` | Loading indicators |
| `skeleton` | Loading placeholders |

---

## After Scanning

Once results are returned, users can:

1. **Reference specific items**: "I want to modify `#CheckoutButton`"
2. **Ask about flows**: "Walk me through `$checkout-flow`"
3. **Check gates**: "What permissions does `^premium-checkout` require?"
4. **Explore state**: "What components use `%cart.items`?"
5. **Fill gaps**: "Create a `#CouponInput` component for the uncovered element"

---

## Keeping Index Fresh

```bash
# Regenerate scan index
horizon index

# Watch for changes and auto-update
horizon watch
```

The index should be regenerated when:
- Adding new `.purpose` files
- Modifying `gate.yaml`
- Adding new components or features
