# paradigm constellation

Generate a complete symbol relationship graph for deep AI analysis and impact understanding.

## Overview

Creates `.paradigm/constellation.json` - a machine-readable graph of all symbols and their relationships. The definitive map of your project's structure, dependencies, and connections.

## What It Does

**Builds a comprehensive graph with:**
- **Stars** - Every symbol (#components, ^gates, !signals, $flows, etc.)
- **Relationships** - What requires what, what references what
- **Categorized references** - Gates, signals, components, flows
- **Bidirectional tracking** - Both `references` and `referencedBy`
- **Orbits** - Flow sequences showing order of operations
- **Statistics** - Counts by symbol type

**Output format:**
```json
{
  "version": "1.0",
  "project": "my-app",
  "stars": {
    "#checkout": {
      "type": "feature",
      "path": "src/features/checkout/index.tsx",
      "gates": ["^authenticated", "^payment-ready"],
      "components": ["#Button", "#Form", "#PaymentWidget"],
      "signals": ["!checkout-started", "!payment-complete"],
      "references": ["^authenticated", "^payment-ready", "#Button"],
      "referencedBy": ["$checkout-flow"]
    }
  },
  "orbits": {
    "$checkout-flow": {
      "sequence": ["#cart", "#shipping", "#payment", "#confirmation"]
    }
  },
  "stats": { "components": 17, "gates": 2, "signals": 8, "flows": 3, "total": 30 }
}
```

## Why You Need It

**For AI agents:**
- **Impact analysis** - "What would break if I change this?"
- **Dependency understanding** - "What does this feature require?"
- **Flow comprehension** - "What's the sequence of this workflow?"
- **Deep exploration** - Programmatic navigation of codebase

**For developers:**
- **Architecture visualization** - See the big picture
- **Refactoring safety** - Know what depends on what
- **Code review** - Understand change ripple effects
- **Documentation** - Living architecture diagram

## When to Run It

### ✅ Run after:
- **`paradigm init`** - Generate initial constellation
- **Adding features** - New symbols and relationships
- **Refactoring** - Changed dependencies
- **Major structural changes** - Architecture shifts

### 🔄 Periodic:
- **With beacon** - Keep both fresh together
- **Weekly** - If actively developing
- **Before reviews** - Fresh graph for analysis

### ⏩ Performance:
- ~100-500ms for most projects
- Safe to run frequently

## Usage

```bash
# Generate constellation (default location)
paradigm constellation

# Custom output path
paradigm constellation --output ./docs/graph.json

# YAML format instead of JSON
paradigm constellation --format yaml

# Quiet mode
paradigm constellation --quiet

# Target specific directory
paradigm constellation ./src
```

## Output

```
✨ Building Constellation...

✔ Constellation built

Constellation Stats
────────────────────────────────────────
  # Components     17
  ^ Gates          2
  ! Signals        8
  $ Flows          3
────────────────────────────────────────
  Total stars:    34
  Total orbits:   3

  Output: .paradigm/constellation.json

Sample Star
────────────────────────────────────────
  #checkout
    gates: ^authenticated, ^payment-ready
    components: #Button, #Form, #PaymentWidget
    referencedBy: $checkout-flow
```

## Constellation Structure

### Stars (Symbols)

Each star represents a symbol with its relationships:

```json
{
  "#checkout": {
    "type": "component",
    "path": "src/features/checkout/index.tsx",
    "description": "Purchase completion flow",
    "tags": ["feature", "ecommerce", "critical"],

    // Categorized outgoing references
    "gates": ["^authenticated", "^payment-ready"],
    "components": ["#Button", "#Form", "#PaymentWidget"],
    "signals": ["!checkout-started", "!payment-complete"],
    "flows": ["$checkout-flow"],
    
    // All outgoing references
    "references": ["^authenticated", "#Button", "!checkout-started"],
    
    // What references THIS symbol
    "referencedBy": ["$checkout-flow", "#admin-dashboard"]
  }
}
```

### Orbits (Flows)

Flow sequences showing order:

```json
{
  "$checkout-flow": {
    "description": "Complete purchase journey",
    "sequence": ["#cart", "#shipping", "#payment", "#confirmation"]
  }
}
```

## Integration with Other Commands

**Standard workflow:**
```bash
# Generate both AI context files
paradigm beacon           # Quick orientation
paradigm constellation    # Detailed graph

# Use constellation for analysis
paradigm ripple #checkout  # Uses constellation data
```

**AI agent workflow:**
```
1. Read beacon.md for orientation
2. Query constellation.json for relationships
3. Use ripple for impact analysis
4. Read specific files based on findings
```

## Common Workflows

### Initial Setup
```bash
paradigm shift --quick
paradigm constellation
paradigm beacon
# Complete AI context ready
```

### Before Refactoring
```bash
# Get fresh graph
paradigm constellation

# Analyze impact
paradigm ripple #feature-to-change

# Review constellation to see all affected symbols
jq '.stars["#feature-to-change"].referencedBy' .paradigm/constellation.json
```

### Architecture Review
```bash
# Generate fresh constellation
paradigm constellation

# Export for visualization
cat .paradigm/constellation.json | jq '.stats'

# Check specific relationships
jq '.stars | to_entries | map(select(.value.gates | length > 0))' .paradigm/constellation.json
```

### Automated Analysis
```bash
# CI/CD integration
paradigm constellation --quiet

# Find components without gates (security check)
jq '.stars | to_entries | map(select(.value.gates | length == 0))' .paradigm/constellation.json
```

## Tips & Gotchas

**Pro tips:**
- Use with `jq` for powerful queries
- Combine with `ripple` for impact analysis
- YAML format is more readable for humans
- JSON format is better for tooling
- Commit constellation.json for team visibility
- File size ~50-500KB (efficient even for large projects)

**Watch out for:**
- Large projects (1000+ symbols) may take 1-2 seconds
- Relationships are only as good as your `.purpose` files
- Missing references mean incomplete graph
- Update after structural changes, not every file edit

## Querying Constellation

**Using `jq` (JSON query tool):**

```bash
# Get all components
jq '.stars | to_entries | map(select(.key | startswith("#")))' .paradigm/constellation.json

# Find what requires auth
jq '.stars | to_entries | map(select(.value.gates[]? == "^authenticated"))' .paradigm/constellation.json

# List all flows
jq '.orbits | keys' .paradigm/constellation.json

# Find orphan symbols (nothing references them)
jq '.stars | to_entries | map(select(.value.referencedBy | length == 0))' .paradigm/constellation.json

# Count references per symbol
jq '.stars | to_entries | map({key: .key, refs: (.value.references | length)})' .paradigm/constellation.json
```

## vs Beacon

**Constellation:**
- Machine-readable JSON
- Complete graph (all symbols)
- Full relationship data
- ~50-500KB
- For deep analysis

**Beacon:**
- Human-readable markdown
- Selected highlights
- Quick overview
- ~2-5KB
- For orientation

Use both: beacon first, constellation for details.

## Statistics

The `stats` object provides symbol counts:

```json
{
  "components": 17,
  "gates": 2,
  "signals": 8,
  "flows": 3,
  "aspects": 0,
  "total": 30
}
```

## Examples

**Example 1: Initial generation**
```bash
paradigm shift --quick
paradigm constellation
ls -lh .paradigm/constellation.json  # Check size
```

**Example 2: Find auth dependencies**
```bash
paradigm constellation
# What requires authentication?
jq '.stars | to_entries[] | select(.value.gates[]? == "^authenticated") | .key' .paradigm/constellation.json
```

**Example 3: Visualize flows**
```bash
paradigm constellation --format yaml
# Easier to read flows in YAML
cat .paradigm/constellation.yaml
```

**Example 4: CI analysis**
```bash
# Check for security issues
paradigm constellation --quiet
jq '.stars | to_entries[] | select(.value.gates | length == 0) | {component: .key, path: .value.path}' .paradigm/constellation.json
# Alert if components lack gates
```

## Performance

**Speed:**
- Small projects (<50 symbols): ~100ms
- Medium projects (50-200): ~200-400ms  
- Large projects (200-1000): ~500ms-1s
- Very large (1000+): ~1-2s

**File size:**
- Typical: 50-200KB
- Large projects: 500KB-1MB
- Efficiently structured

## Troubleshooting

**Problem: "Empty constellation"**
- Solution: Ensure `.purpose` files exist with symbols
- Check: `paradigm status` for symbol counts

**Problem: "Missing relationships"**
- Solution: Add references in `.purpose` files
- Format: `references: ["#other", "#component"]`

**Problem: "Constellation outdated"**
- Solution: Run `paradigm constellation` after changes

**Problem: "File too large"**
- Solution: Normal for large projects, JSON is efficient
- Can use YAML if needed for readability

**Problem: "Can't query effectively"**
- Solution: Install `jq` - `brew install jq` (Mac) or equivalent

## Advanced: Custom Analysis Scripts

```bash
#!/bin/bash
# find-isolated-components.sh
# Find components with no incoming references

paradigm constellation --quiet

jq -r '.stars | to_entries[] |
  select(.key | startswith("#")) | select(.value.referencedBy | length == 0) |
  "\(.key) - \(.value.description)"' .paradigm/constellation.json
```

## See Also

- [`paradigm beacon`](./beacon.md) - Quick orientation file
- [`paradigm ripple`](./ripple.md) - Impact analysis using constellation
- [`paradigm status`](./status.md) - Symbol counts and health
- [Symbols spec](../specs/symbols.md) - Symbol system reference
- [Purpose Files guide](../guides/purpose-files.md) - Defining symbols
