---
id: N-para-501-aspect-graph-advanced
title: The Aspect Graph at Scale
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-501
  - 8-built-in-detectors
  - custom-detectors-defined
  - bfs-traversal-with
symbols: []
difficulty: beginner
estimatedMinutes: 8
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-501.json
---

## Beyond the Basics

PARA 201 introduced the Aspect Graph's internals — the SQLite schema, materialization pipeline, and recursive ripple. This lesson takes you deeper: building custom detectors, advanced graph queries, drift detection in CI/CD, search learning optimization, and governing aspects at enterprise scale.

## Building Custom Aspect Detection Patterns

Paradigm ships with 8 built-in detectors that `paradigm_aspect_suggest_scan` uses to find undocumented aspects in source code:

1. **Magic numbers** — Numeric literals that aren't 0 or 1 (e.g., `timeout: 30000`, `maxRetries: 3`)
2. **Hardcoded strings** — String literals used in conditionals or assignments that smell like configuration (e.g., `'production'`, `'us-east-1'`)
3. **Rate limits** — Patterns like `rateLimit(100)`, `throttle(1000)`, or variable names containing `limit`, `throttle`, `quota`
4. **Time values** — Durations, timeouts, TTLs, and expiry values (e.g., `86400`, `24 * 60 * 60`)
5. **Environment checks** — `process.env`, `std::env`, `os.environ` patterns that branch on environment variables
6. **Feature flags** — Conditional logic gated on feature names (e.g., `isEnabled('new-checkout')`, `featureFlags.get()`)
7. **Regex patterns** — Regular expressions used for validation (e.g., email patterns, URL matchers)
8. **Assertion guards** — Invariant checks using `assert`, `invariant()`, `expect()` that enforce guarantees

To extend the detection system, you define custom detectors in `.paradigm/aspect-detectors.yaml`:

```yaml
detectors:
  - id: compliance-annotation
    name: Compliance Annotations
    description: Detects SOC2/GDPR compliance annotations in code
    patterns:
      - regex: "@(SOC2|GDPR|PCI|HIPAA)"
        languages: [typescript, javascript, java]
      - regex: "#\[compliance\("
        languages: [rust]
    suggestedCategory: rule
    suggestedSeverity: critical
    suggestedTags: [compliance, security]

  - id: retry-policy
    name: Retry Policies
    description: Detects retry/backoff configurations
    patterns:
      - regex: "(retryPolicy|backoff|maxAttempts|retryCount)"
        languages: [typescript, javascript, python]
    suggestedCategory: configuration
    suggestedSeverity: medium
```

Custom detectors are loaded alongside the built-in 8 during `paradigm_aspect_suggest_scan`. They follow the same interface: match source code patterns, suggest a category and severity, and let the user decide whether to formalize the finding as a `~aspect`.

## Graph Querying Strategies

The aspect graph supports three primary querying patterns, each suited to different use cases:

### BFS Traversal (Neighborhood Analysis)

`paradigm_aspect_graph` uses breadth-first search to explore the neighborhood of a symbol. The `hops` parameter controls how far to traverse:

- **1 hop** — Direct connections only. Use this when you need to know what a single aspect directly relates to. Fast, focused, minimal noise.
- **2 hops** — Friends-of-friends. Reveals indirect relationships: "this aspect relates to that aspect, which relates to that component." The sweet spot for most queries.
- **3+ hops** — Extended neighborhood. Useful for understanding how distant parts of the codebase connect through aspects. Gets noisy in dense graphs.

The multiplicative weight decay means that each hop reduces confidence. An explicit edge (weight 1.0) followed by an inferred edge (weight 0.5) produces a path weight of 0.5. Two inferred edges produce 0.25. The `minWeight` threshold (default 0.1) prunes low-confidence paths automatically.

### Heatmap-Driven Exploration

`paradigm_aspect_heatmap` ranks aspects by access frequency. This is not about what aspects ARE important — it is about what aspects are USED most. The distinction matters:

- An aspect accessed 50 times via search but never via ripple might have a discoverability problem — people search for it because it is hard to find through the graph.
- An aspect accessed primarily via ripple has good graph connectivity — it naturally surfaces during impact analysis.
- An aspect with zero access across all types may be stale, poorly named, or irrelevant.

Heatmap data is the starting point for governance reviews. Aspects that nobody accesses should be evaluated for removal or renaming.

### Edge-Filtered Queries

When calling `paradigm_aspect_graph`, you can filter by edge relation to narrow results:

- `enforced-by` — Find all aspects that enforce a given component. Useful when changing a component to know what rules apply.
- `depends-on` — Find dependency chains. If `~token-expiry-24h` depends-on `~jwt-signing-rs256`, changing JWT signing affects token expiry.
- `contradicts` — Find conflicting aspects. Two aspects that contradict each other signal an architectural tension that needs resolution.
- `supersedes` — Find deprecated-but-still-referenced aspects. The superseding aspect should be the authoritative one.
- `related-to` — The weakest relation. Useful for discovery but not for impact analysis.

## Drift Detection in CI/CD

Aspect drift occurs when the code at an anchor location changes without updating the aspect definition. The `paradigm_aspect_drift` tool detects this using SHA-256 content hashes.

During materialization, the pipeline computes a SHA-256 hash of the code at each anchor's line range and stores it in the `anchors.content_hash` column. When `paradigm_aspect_drift` runs later, it re-reads the code at those line ranges, computes a new hash, and compares. A mismatch means the code changed — the anchor is drifted.

For CI/CD integration, add drift detection as a pipeline step:

```yaml
# .github/workflows/paradigm.yml
steps:
  - name: Check aspect drift
    run: |
      paradigm scan --quiet
      paradigm doctor --strict --json | jq '.aspects.drifted'
      if [ $(paradigm doctor --json | jq '.aspects.drifted | length') -gt 0 ]; then
        echo "::error::Aspect anchors have drifted"
        exit 1
      fi
```

The `--strict` flag treats drifted anchors as errors rather than warnings. In a mature project, you want drift detection to block merges — it ensures that aspect documentation stays synchronized with code changes.

Drift detection is also available per-aspect via the MCP tool:

```
paradigm_aspect_drift({ aspectId: 'token-expiry-24h' })
```

This returns: the aspect ID, each anchor with its stored hash vs current hash, whether each anchor has drifted, and the specific lines that changed. Use this during code review to verify that refactors updated their aspect anchors.

## Search Learning Loop Optimization

The three-tier search system improves over time through the confirm-and-decay mechanism. Here is how to optimize it:

### Tier Priority

1. **Tier 1: Learned mappings** — Query-to-aspect weights in the `search_weights` table. If a query matches a stored mapping with weight >= 1.0, the result is returned immediately. This is instant because it is a simple key-value lookup.
2. **Tier 2: FTS5 full-text search** — SQLite's FTS5 engine searches aspect descriptions, values, and categories. Returns results ranked by BM25 relevance. Accurate but slower than Tier 1.
3. **Tier 3: Fuzzy matching** — Levenshtein distance-based matching with a configurable threshold. Catches typos and partial matches. Slowest but most forgiving.

### Warming the Learning System

A new project's search starts cold — no learned mappings exist. Every search falls through to Tier 2 or 3. To warm the system:

1. Run common queries for your project's domain (e.g., search for 'expiry', 'rate limit', 'auth')
2. Confirm the best result with `paradigm_aspect_confirm` for each query
3. After 3-5 confirmations per query, the learned weight exceeds the Tier 1 threshold

The decay mechanism (confirmed +1.0, others *0.95) means that a single confirmation is enough to create a Tier 1 entry. But multiple confirmations build a stronger mapping that resists displacement.

### Diagnosing Search Issues

When search returns unexpected results:

- Check `search_weights` table entries for the query — are stale mappings dominating?
- Verify aspect descriptions contain the keywords you are searching for (FTS5 searches descriptions)
- Check for typos in the query that might prevent Tier 2 matches but trigger Tier 3 fuzzy results
- Use `paradigm_aspect_heatmap` to see if the expected aspect is ever accessed — a zero-access aspect might have a discovery problem

## Aspect Governance at Scale

When a project exceeds 100 aspects, governance becomes critical. Without it, aspects accumulate as stale documentation, anchor drift goes undetected, and the graph becomes noisy rather than useful.

### The Governance Review Cycle

Run quarterly aspect reviews using this process:

1. **Heatmap analysis** — `paradigm_aspect_heatmap({ limit: 0 })` returns ALL aspects ranked by access. The bottom 20% are candidates for removal or consolidation.
2. **Drift audit** — `paradigm doctor --strict` catches all drifted anchors. Drifted aspects either need anchor updates or should be marked stale.
3. **Category distribution** — Check that aspect categories are balanced. A project with 80 rules and 2 decisions might be over-documenting constraints while missing strategic choices.
4. **Edge health** — Check for orphaned aspects (no edges to any other symbol). An aspect with zero edges is either standalone (legitimate but rare) or poorly connected.
5. **Search weight review** — Check the `search_weights` table for queries with multiple high-weight mappings, which indicate ambiguous terminology.

### Naming Conventions at Scale

With 100+ aspects, naming collisions and ambiguity become real problems. Establish conventions:

- **Category prefix** — Prefix aspects with their category: `~rule-no-console-log`, `~decision-use-redis`, `~constraint-max-upload-10mb`
- **Domain grouping** — Group related aspects by domain: `~auth-token-expiry`, `~auth-session-timeout`, `~auth-refresh-rotation`
- **Version suffix** — When aspects evolve: `~rate-limit-v2` supersedes `~rate-limit-v1` with an explicit `supersedes` edge

### Delegation and Ownership

For large teams, assign aspect ownership:

```yaml
~payment-idempotency:
  description: Payment operations must be idempotent
  owner: payments-team
  reviewers: [platform-team, security-team]
```

The `owner` field indicates who maintains the aspect, and `reviewers` lists teams that should be consulted when the aspect changes. This is purely metadata — Paradigm does not enforce it — but it guides humans and AI agents when modifications are needed.
