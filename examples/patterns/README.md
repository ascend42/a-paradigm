# Optional Paradigm Patterns

This directory contains **optional** architectural patterns that can be adopted when needed. These patterns are **not included in new projects** to keep the `.paradigm/` directory lean.

## Why Optional?

These patterns are sophisticated approaches for specific use cases. They're not core to Paradigm itself, but represent proven solutions for common product challenges:

- **Not everyone needs them** - FTUX systems, sandbox modes, etc. are product-specific
- **Token efficiency** - Keeping them out of `.paradigm/` saves ~40K tokens per project
- **Reference when needed** - Teams can copy relevant sections when implementing

## Available Patterns

### FTUX Component System (`ftux-component-system.md`)
**Size:** 25KB | **Use case:** Onboarding flows, feature discovery, guided experiences

A standardized approach for targeting components in guided user experiences. Create onboarding flows without modifying application code.

**When to use:**
- Building product tours or onboarding
- Feature discovery for new users
- Contextual help systems

### Sandbox Mode (`sandbox-mode.md`)
**Size:** 28KB | **Use case:** Freemium "try before you buy" experiences

Let unauthenticated users explore the full UI, make local in-memory changes, and experience value before subscribing. Convert naturally when they try to save.

**When to use:**
- Freemium SaaS products
- "Try without signing up" experiences
- Reducing friction in conversion funnels

### Portal-Driven E2E Testing (`portal-e2e-testing.md`)
**Size:** 23KB | **Use case:** Automated authorization testing

Tests derived from your `portal.yaml` authorization topology. Console logs become automated tests that verify what actually happens vs. what should happen.

**When to use:**
- Complex authorization topologies
- Need automated security testing
- Want self-documenting auth flows

### Portal Validation (`portal-validation.md`)
**Size:** 12KB | **Use case:** Runtime authorization verification

Extended validation patterns for portal.yaml, including runtime checks, detailed logging, and topology analysis.

**When to use:**
- Need detailed authorization debugging
- Complex role-based access control
- Want runtime portal verification

## How to Use These Patterns

### 1. Read the Pattern
Browse the pattern document to understand the approach and decide if it fits your needs.

### 2. Copy Relevant Sections
Don't copy everything - extract what you need:

```bash
# Example: Copy sandbox mode types to your project
cat examples/patterns/sandbox-mode.md | grep -A 20 "TypeScript Types"
```

### 3. Adapt to Your Project
These are templates and ideas, not rigid implementations. Modify to fit your stack, architecture, and requirements.

### 4. Reference in Purpose Files
If you implement a pattern, reference it in your `.purpose` files:

```yaml
# features/sandbox/.purpose
feature: sandbox
description: "Freemium sandbox mode for unauthenticated users"
references:
  - pattern: sandbox-mode
    docs: https://github.com/a-company/paradigm/examples/patterns/sandbox-mode.md
```

## Token Cost Comparison

**If included in every project:**
- Size: +88KB per project
- Tokens: +22,000 per project
- Cost: +$0.17 per AI session

**As optional reference:**
- Size in project: 0KB
- Loaded only when needed
- Cost: $0 unless referenced

## Philosophy

Paradigm believes in **lean defaults, powerful options**:
- Core `.paradigm/` stays small and focused
- Optional patterns available when needed
- Teams choose their own complexity level

---

**Want to contribute a pattern?** See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines on submitting new patterns.
