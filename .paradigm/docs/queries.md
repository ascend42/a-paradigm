# Constellation Queries

Query the symbol graph with jq for precise, on-demand data retrieval.

---

## Prerequisites

Make sure constellation exists:

```bash
paradigm constellation
```

This creates `.paradigm/constellation.json`.

---

## Basic Queries

### List All Symbols

```bash
jq '.stars | keys' .paradigm/constellation.json
```

### Get Symbol Count

```bash
jq '.stats' .paradigm/constellation.json
```

### Get a Specific Symbol

```bash
jq '.stars["#checkout"]' .paradigm/constellation.json
```

---

## Filter by Type

### All Components (#)

```bash
jq '[.stars | to_entries[] | select(.value.type == "component") | .key]' .paradigm/constellation.json
```

### All Gates (^)

```bash
jq '[.stars | to_entries[] | select(.value.type == "gate") | .key]' .paradigm/constellation.json
```

### All Signals (!)

```bash
jq '[.stars | to_entries[] | select(.value.type == "signal") | .key]' .paradigm/constellation.json
```

---

## Relationship Queries

### What Requires a Specific Gate

```bash
# Find all symbols that require ^authenticated
jq '[.stars | to_entries[] | select(.value.gates[]? == "^authenticated") | .key]' .paradigm/constellation.json
```

### What a Symbol References

```bash
# Get all references from #checkout
jq '.stars["#checkout"].references' .paradigm/constellation.json
```

### What References a Symbol

```bash
# Get everything that references #checkout
jq '.stars["#checkout"].referencedBy' .paradigm/constellation.json
```

### Get Symbol's Gates

```bash
jq '.stars["#checkout"].gates' .paradigm/constellation.json
```

### Get Symbol's Components

```bash
jq '.stars["#checkout"].components' .paradigm/constellation.json
```

---

## Flow Queries

### List All Flows

```bash
jq '.orbits | keys' .paradigm/constellation.json
```

### Get Flow Sequence

```bash
jq '.orbits["$checkout-flow"].sequence' .paradigm/constellation.json
```

### Find Symbols in a Flow

```bash
jq '.orbits["$checkout-flow"].sequence[]' .paradigm/constellation.json
```

---

## Path Queries

### Find Symbols in a Directory

```bash
# Symbols defined in src/features/auth/
jq '[.stars | to_entries[] | select(.value.path | startswith("src/features/auth")) | .key]' .paradigm/constellation.json
```

### Get Symbol's Location

```bash
jq '.stars["#checkout"].path' .paradigm/constellation.json
```

---

## Combined Queries

### Components with Multiple Gate Dependencies

```bash
jq '[.stars | to_entries[] | select(.value.type == "component") | select((.value.gates // []) | length > 1) | {symbol: .key, gates: .value.gates}]' .paradigm/constellation.json
```

### High-Impact Symbols (Referenced by Many)

```bash
jq '[.stars | to_entries[] | select((.value.referencedBy // []) | length > 3) | {symbol: .key, dependents: (.value.referencedBy | length)}] | sort_by(.dependents) | reverse' .paradigm/constellation.json
```

### Symbols Without Descriptions

```bash
jq '[.stars | to_entries[] | select(.value.description == null) | .key]' .paradigm/constellation.json
```

---

## Quick Reference

| What you need | jq query |
|--------------|----------|
| All symbols | `.stars \| keys` |
| Specific symbol | `.stars["#name"]` |
| All components | `[.stars \| to_entries[] \| select(.value.type == "component") \| .key]` |
| What requires X | `[.stars \| to_entries[] \| select(.value.gates[]? == "^X") \| .key]` |
| References from X | `.stars["#X"].references` |
| References to X | `.stars["#X"].referencedBy` |
| All flows | `.orbits \| keys` |
| Flow sequence | `.orbits["$flow"].sequence` |

---

## Tips

1. **Pipe to less for long output:**
   ```bash
   jq '.stars | keys' .paradigm/constellation.json | less
   ```

2. **Compact output (no pretty-print):**
   ```bash
   jq -c '.stars["#checkout"]' .paradigm/constellation.json
   ```

3. **Raw strings (no quotes):**
   ```bash
   jq -r '.stars["#checkout"].path' .paradigm/constellation.json
   ```

4. **Count results:**
   ```bash
   jq '[.stars | to_entries[] | select(.value.type == "feature")] | length' .paradigm/constellation.json
   ```

---

*For more complex queries, consider using `paradigm ripple #symbol --json` which provides pre-computed impact analysis.*
