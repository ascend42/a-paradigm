# Paradigm Aspect & Ripple Audit — Action Required

## Why This Matters

The Paradigm project itself went from **0 aspects in v1** to **11 in early v2** to **200+ aspects today** across every package. That growth wasn't cosmetic — it fundamentally changed how we catch problems before they ship.

### The Value of Anchored Aspects

**Without aspects**, cross-cutting rules live in developers' heads:
- "Oh, all API endpoints need rate limiting" — says who? Where's the code?
- "Financial operations must audit-log" — which ones? Who checks?
- "Token expiry is 24 hours" — where is that enforced? What happens if someone changes it?

**With anchored aspects**, these rules become queryable, enforceable, and drift-detectable:

```yaml
~rate-limit-sliding-window-60s:
  description: API endpoints enforce per-user rate limits using 60s sliding window
  anchors:
    - src/middleware/rate-limit.ts:12-45
  applies-to: ["#*-endpoint"]
```

Now when an agent runs `paradigm_ripple` on `#checkout-endpoint`, it sees that `~rate-limit-sliding-window-60s` applies — and it knows exactly which file enforces it and what the rule is. No guessing. No grepping. No asking someone who might have left the team.

### What 200+ Aspects Buys You

| Capability | Without Aspects | With 200+ Anchored Aspects |
|------------|----------------|----------------------------|
| **Ripple analysis** | "These 3 symbols depend on it" | "These 3 symbols depend on it, and `~audit-required` cascades through the flow" |
| **Drift detection** | Manual code review | `paradigm_aspect_drift` tells you which anchors moved or changed |
| **Onboarding** | Read 50 files to understand constraints | `paradigm_aspect_search "rate limit"` → exact file, exact lines |
| **Auto-suggestion** | Hope someone documents the magic number | `paradigm_aspect_suggest_scan` detects hardcoded values, env checks, feature flags |
| **Compliance** | "Did we check everything?" | Stop hook blocks you if aspects are unanchored |
| **Search** | Grep and pray | Three-tier fuzzy search with learning — gets smarter over time |

### Coverage by Domain (Paradigm's own numbers)

| Package | Aspects | What They Cover |
|---------|---------|-----------------|
| Sentinel | 58 | Schema versioning, confidence scoring, auth hierarchy, rate limits, batch sizing |
| Paradigm MCP | 54 | Caching, session tracking, dispatch, reindex, tool handler patterns |
| CLI Core | 21 | Orchestration budgets, provider cascade, agent model assignments |
| Portal | 18 | YAML schema rules, gate naming, lock modes, expression evaluation |
| Sentinel-RS | 8 | Rust batch defaults, tracing level mapping, async fire-and-forget |
| VS Code | 6 | Activation triggers, file watcher debounce, completion scopes |
| Logger | 5 | Level resolution, format detection, correlation tracking |
| University | 4 | PLSAT thresholds, shuffle algorithms, CORS |

**Every one of these has code anchors.** Every one can be searched, rippled, and drift-checked.

---

## What Changed (v1 → v2)

### Aspects (~) — Now Require Code Anchors

**Old (v1):** Aspects were optional metadata tags. `~deprecated` was just a label.

**New (v2):** Aspects are a **distinct symbol type** representing cross-cutting rules, constraints, and decisions. Every aspect **MUST have code anchors** — an aspect without anchors is invalid and will be flagged by the stop hook.

```yaml
# WRONG — v1 style, no anchors
~rate-limited:
  description: API endpoints are rate limited

# CORRECT — v2 style, with anchors
~rate-limited:
  description: API endpoints enforce per-user rate limits
  tags: [security, performance]
  anchors:                          # REQUIRED
    - src/middleware/rate-limit.ts:12-45
    - src/config/limits.ts:3-8
  applies-to:                       # What symbols this affects
    - "#*-endpoint"
    - "#*-route"
  enforcement: |                    # How to comply
    Every matching endpoint must use the rateLimiter middleware
    with configured limits from src/config/limits.ts.
```

### Anchor Formats

| Format | Example | Meaning |
|--------|---------|---------|
| Single line | `src/auth.ts:15` | Line 15 |
| Line range | `src/auth.ts:15-35` | Lines 15–35 |
| Multiple lines | `src/auth.ts:15,25,30` | Specific lines |
| Glob + range | `src/auth/*.ts:1-50` | All files, lines 1–50 |

### Full v2 Aspect Schema

```yaml
~aspect-id:
  description: String              # What this aspect enforces
  tags: [tag1, tag2]               # Classification
  anchors:                         # REQUIRED — line-level code references
    - src/file.ts:15-35
  applies-to:                      # Glob patterns for matching symbols
    - "#*Service"
    - "$*-payment-*"
  enforcement: |                   # Prose: how to comply
    Components matching applies-to must...
```

### Ripple Analysis Is Now Aspect-Aware

`paradigm_ripple` now surfaces cascaded aspects at each dependency node. When you ripple `#checkout`, you'll see that `$checkout-flow` carries `~audit-required` — meaning any change to `#checkout` must also satisfy the audit aspect.

### 7 MCP Tools for Aspects

| Tool | Use |
|------|-----|
| `paradigm_aspect_search` | Fuzzy search across all aspects |
| `paradigm_aspect_get` | Full detail: anchors, edges, enforcement |
| `paradigm_aspect_graph` | BFS subgraph traversal (N hops) |
| `paradigm_aspect_check` | Validate anchor coverage and compliance |
| `paradigm_aspect_drift` | Detect stale anchors via content hashing |
| `paradigm_aspect_suggest_scan` | Auto-detect undocumented aspects from code patterns |
| `paradigm_aspect_confirm` | Reinforce search learning |

---

## Audit Checklist

For every `.purpose` file in the project:

1. **Find all `~` aspects** — do they have `anchors`? If not, add them with line-level references to the actual enforcement code.

2. **Check anchor validity** — do the referenced files and line ranges still exist and contain the relevant code? Run `paradigm_aspect_drift` to detect stale anchors.

3. **Add `applies-to`** where applicable — if the aspect is a cross-cutting rule (rate limiting, audit logging, auth checks), declare which symbols it applies to using glob patterns.

4. **Add `enforcement`** — describe in prose how a developer/agent should comply with this aspect. This is what agents read when implementing changes.

5. **Remove unanchored aspects** — if an aspect has no backing code anywhere, it's either:
   - Missing anchors (add them), or
   - Not a real aspect (convert to a tag on the relevant `#component`)

6. **Run validation:**
   ```
   paradigm_aspect_check({ aspect: "~your-aspect" })
   paradigm doctor
   ```

## Quick Reference: v1 → v2 Conversions

| v1 Pattern | v2 Equivalent |
|------------|---------------|
| `~deprecated` (bare tag) | `[deprecated]` tag on the `#component` |
| `~rule` with no code | Add `anchors` pointing to enforcement code |
| Aspects in docs only | Must have `anchors` to real code or delete |
| `^portal` naming | `^gate` naming |

## Key Rule

> **No unanchored aspects.** Every `~` symbol must point to real code. If it doesn't have enforcement code, it's not an aspect — it's a tag.
