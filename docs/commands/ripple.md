# paradigm ripple

Analyze the impact and dependencies of a symbol before making changes - your "blast radius" checker.

## Overview

Shows what would be affected if you modify a symbol, what it depends on, and which flows it's part of. Essential for safe refactoring and understanding change impact.

## What It Does

**Analyzes a symbol to show:**
- **Upstream dependencies** - What this symbol requires (gates, flows)
- **Downstream impact** - What would break if you change this (features, components, signals)
- **Flow membership** - Which flows include this symbol (step X of Y)
- **Direct relationships** - What it references and what references it
- **Impact level** - Low, Medium, High, or Critical

**Uses constellation data** - Reads `.paradigm/constellation.json` for relationship graph

## Why You Need It

**Before refactoring:**
- **Safety check** - Know what breaks before you break it
- **Scope understanding** - How big is this change really?
- **Test planning** - What needs testing after this change?

**For code review:**
- **Impact assessment** - Evaluate PR risk level
- **Dependency verification** - Confirm required changes were made

**For architecture:**
- **Coupling analysis** - Find tightly coupled symbols
- **Isolation verification** - Confirm proper boundaries

## When to Run It

### ✅ Run before:
- **Modifying a symbol** - Check impact first
- **Refactoring** - Understand blast radius
- **Removing features** - See what depends on it
- **Changing APIs** - Find all consumers

### 🔄 Use with:
- **Code reviews** - Assess PR impact
- **Planning** - Estimate refactoring scope
- **Debugging** - Trace dependencies

### ⏩ Fast operation:
- Runs in ~50-200ms
- Call liberally

## Usage

```bash
# Analyze a symbol
paradigm ripple #checkout
paradigm ripple #Button
paradigm ripple ^authenticated
paradigm ripple !login-success

# Custom depth (default 1)
paradigm ripple #feature --depth 2

# JSON output (for tooling)
paradigm ripple #feature --json

# Quiet mode (no console output, just JSON)
paradigm ripple #feature --quiet --json

# Target specific directory
paradigm ripple #feature ./src
```

## Output

```
🌊 Ripple Analysis for #checkout

Symbol Info
──────────────────────────────────────────────────
  Type:        feature
  Path:        src/features/checkout/index.tsx
  Description: Purchase completion flow

⬆️  Upstream (What this requires)
──────────────────────────────────────────────────
  Gates:    ^authenticated, ^payment-ready
  Flows:    $checkout-flow

⬇️  Downstream (What would be affected)
──────────────────────────────────────────────────
  Features:    #admin-dashboard
  Components:  (none)
  Signals:     !checkout-complete

🔄 Part of Flows
──────────────────────────────────────────────────
  $checkout-flow (step 3 of 4)

📊 Impact Summary
──────────────────────────────────────────────────
  Direct dependents: 2
  Impact level:      MEDIUM

  ⚠️  Changes to this symbol may affect the above dependents.
```

## Ripple Analysis Structure

### Symbol Info
Basic information about the analyzed symbol:
- Type (#feature, #component, etc.)
- File path
- Description from `.purpose`
- Tags (if any)

### Upstream Dependencies
What this symbol needs to function:
- **Gates** (^) - Authorization requirements
- **Flows** ($) - Process dependencies

### Downstream Impact
What depends on this symbol:
- **Features** (#) - Features that use this
- **Components** (#) - Components that depend on this
- **Signals** (!) - Events that this triggers/consumes

### Flow Membership
Which workflows include this:
- Flow name
- Position in sequence (step N of M)

### Impact Level

| Level | Dependents | Recommendation |
|-------|------------|----------------|
| **Low** | 0-1 | Safe to modify freely |
| **Medium** | 2-5 | Review dependents before changes |
| **High** | 6-10 | Plan carefully, test thoroughly |
| **Critical** | 10+ | Major impact, coordinate with team |

## Integration with Other Commands

**Standard workflow:**
```bash
# 1. Check impact before changes
paradigm ripple #feature

# 2. Make changes

# 3. Verify affected symbols
paradigm ripple #affected-feature

# 4. Update constellation
paradigm constellation
```

**With MCP tools:**
```
AI: [Calls paradigm_ripple before modifying]
AI: "I see #checkout has 3 dependents. Proceeding carefully."
AI: [Makes changes]
AI: [Tests affected dependents]
```

## Common Workflows

### Pre-Refactoring Check
```bash
# Before changing a component
paradigm ripple #Button

# Output shows 15 features depend on it
# Decision: Create #ButtonV2, migrate gradually
```

### Safe Deletion
```bash
# Want to remove a feature
paradigm ripple #old-feature

# If 0 dependents: Safe to remove
# If >0 dependents: Must update/migrate first
```

### Code Review
```bash
# PR changes #checkout
paradigm ripple #checkout

# Verify PR also updates:
# - #admin-dashboard (dependent)
# - Tests for both features
```

### Architecture Analysis
```bash
# Find highly coupled features
for feature in $(paradigm status --json | jq -r '.features[]'); do
  paradigm ripple "$feature" --json | jq -r "{feature: \"$feature\", deps: .requiredBy | length}"
done | sort -t: -k2 -nr
```

## Tips & Gotchas

**Pro tips:**
- **Call before every modification** - Make it a habit
- **JSON output for scripts** - Automate impact checks
- **Use with constellation** - Ripple reads from it
- **Check both ways** - Ripple symbol AND its dependents
- **Depth=1 is usually enough** - Deep analysis rarely needed

**Watch out for:**
- Ripple reads constellation.json - keep it fresh
- Symbol must exist - check spelling
- No transitive dependencies shown (depth=1)
- Impact level is a guide, not absolute

## JSON Output Format

```json
{
  "symbol": "#checkout",
  "type": "feature",
  "path": "src/features/checkout/index.tsx",
  "description": "Purchase completion",
  
  "requires": ["^authenticated", "^payment-ready"],
  "requiredBy": ["#admin-dashboard", "$checkout-flow"],
  
  "downstream": {
    "features": ["#admin-dashboard"],
    "components": [],
    "signals": ["!checkout-complete"]
  },
  
  "upstream": {
    "gates": ["^authenticated", "^payment-ready"],
    "flows": ["$checkout-flow"]
  },
  
  "partOfFlows": [
    {"flow": "$checkout-flow", "position": 3, "total": 4}
  ],
  
  "testPath": "src/features/checkout/**/*.test.{ts,tsx}",
  "testCommand": "npm test -- --testPathPattern=\"src/features/checkout\""
}
```

## Examples

**Example 1: Before modifying a component**
```bash
paradigm ripple #Button

# Output: Used by 12 features
# Action: Ensure backward compatibility
```

**Example 2: Safe feature removal**
```bash
paradigm ripple #experimental-feature

# Output: 0 dependents
# Action: Safe to delete
```

**Example 3: Refactoring gate**
```bash
paradigm ripple ^authenticated

# Output: 15 features require this
# Action: Plan migration path for all 15
```

**Example 4: Automated PR check**
```bash
#!/bin/bash
# check-pr-impact.sh

for symbol in $(git diff main... | grep -o '#[a-z-]*' | sort -u); do
  echo "Checking impact of $symbol..."
  paradigm ripple "$symbol" --json | jq '{symbol: .symbol, dependents: (.requiredBy | length)}'
done
```

## Advanced Usage

### Find Isolated Symbols
```bash
# Find symbols with no dependents (safe to remove)
paradigm constellation --quiet
jq '.stars | to_entries[] | select(.value.referencedBy | length == 0) | .key' .paradigm/constellation.json | while read symbol; do
  paradigm ripple "$symbol" --json
done
```

### Impact Matrix
```bash
# Create impact matrix for all features
for feature in #login #checkout #dashboard; do
  count=$(paradigm ripple "$feature" --json | jq '.requiredBy | length')
  echo "$feature: $count dependents"
done
```

## Performance

**Speed:**
- Simple symbol: ~50ms
- Complex (many deps): ~100-200ms
- Very large projects: ~200-500ms

Always fast enough for interactive use.

## Troubleshooting

**Problem: "Symbol not found"**
- Solution: Check symbol name, run `paradigm status` to see all symbols
- Ensure constellation.json exists: `paradigm constellation`

**Problem: "Empty ripple analysis"**
- Solution: Symbol exists but has no relationships
- Check `.purpose` files for references

**Problem: "Outdated dependencies shown"**
- Solution: Regenerate constellation: `paradigm constellation`

**Problem: "Wrong impact level"**
- Solution: Impact levels are estimates, review actual dependents

## See Also

- [`paradigm constellation`](./constellation.md) - Full dependency graph
- [`paradigm status`](./status.md) - List all symbols
- [`paradigm related`](./related.md) - Similar analysis tool
- [Symbols spec](../specs/symbols.md) - Symbol system reference
- [Refactoring guide](../guides/refactoring.md) - Safe refactoring workflows
