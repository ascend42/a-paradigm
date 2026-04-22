---
id: N-para-501-aspect-graph-internals
title: Aspect Graph Internals
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-501
  - six-sqlite-tables
  - recursive-ripple-uses
  - default-maxdepth-is
symbols: []
difficulty: beginner
estimatedMinutes: 6
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-501.json
---

## SQLite Schema

The aspect graph database at `.paradigm/aspect-graph.db` uses six core tables that model the full aspect ecosystem:

**`aspects`** — The primary table storing aspect metadata. Columns include `id` (the aspect symbol, e.g., `token-expiry-24h`), `description`, `value`, `category` (rule/decision/constraint/configuration/invariant), `severity` (low/medium/high/critical), and `content_hash` (SHA-256 of the combined anchor code for drift detection). Each row represents one aspect from a `.purpose` file.

**`anchors`** — Stores code anchor locations. Columns: `aspect_id` (foreign key to aspects), `file_path`, `start_line`, `end_line`, and `content_hash` (SHA-256 of the code at those lines). An aspect can have multiple anchors across different files.

**`edges`** — The graph edges connecting aspects to other symbols. Columns: `source` (the aspect), `target` (any symbol), `relation` (enforced-by, depends-on, contradicts, supersedes, related-to), `weight` (numeric confidence, default 1.0 for explicit edges), and `origin` (explicit, inferred, or learned). This table is what makes the aspect system a graph rather than a flat list.

**`lore_links`** — Connects aspects to lore entries. Columns: `aspect_id` and `lore_id`. These links are materialized from the `lore` field in aspect YAML definitions, and additional links are inferred when two aspects share lore references.

**`search_weights`** — The learning system's memory. Columns: `query` (the search string), `aspect_id` (the result), and `weight` (accumulated confidence). This table powers Tier 1 of the three-tier search — when a query matches a stored mapping with sufficient weight, the result is returned immediately without FTS5 or fuzzy matching.

**`heatmap`** — Tracks aspect access patterns. Columns: `aspect_id`, `access_type` (search, ripple, navigate, direct), `count`, and `last_accessed`. This data drives the `paradigm_aspect_heatmap` tool, revealing which aspects are most frequently referenced and how they are typically discovered.

## Recursive Ripple

The aspect graph enables recursive ripple analysis — when you call `paradigm_ripple` on a symbol that has aspect edges, the ripple follows those edges to discover indirect impacts. The algorithm uses weighted breadth-first search (BFS) with three configurable parameters:

- **maxDepth** — How many hops to traverse. Default is 5, maximum is 10. Each hop follows one edge in the graph. At depth 1, you see direct connections. At depth 5, you see connections five edges away.
- **minWeight** — The minimum cumulative weight to continue traversal. Default is 0.1. As the BFS traverses edges, it multiplies the current weight by each edge's weight (multiplicative decay). When the cumulative weight drops below minWeight, that branch is pruned.
- **Queue limit** — Maximum BFS queue size: 1000 nodes. This prevents runaway traversals in densely connected graphs. If the queue exceeds 1000 entries, the oldest entries are dropped.

The multiplicative decay is the key mechanism. An explicit edge with weight 1.0 passes full confidence to the next hop. An inferred edge with weight 0.5 halves the confidence. After two inferred edges, the weight is 0.25 — and after four, it drops to 0.0625, below the default minWeight threshold. This naturally limits traversal depth through low-confidence paths while allowing full traversal through high-confidence ones.

## Heatmap Tracking

Every time an aspect is accessed through any MCP tool, the heatmap table records the access. Four access types are tracked:

- **search** — The aspect was found via `paradigm_aspect_search`
- **ripple** — The aspect was encountered during `paradigm_ripple` traversal
- **navigate** — The aspect was discovered via `paradigm_navigate`
- **direct** — The aspect was accessed by ID via `paradigm_aspect_get`

The heatmap serves two purposes. First, it powers the `paradigm_aspect_heatmap` tool, which ranks aspects by access frequency and reveals usage patterns. Second, it provides data for project health analysis — aspects that are never accessed may be stale or poorly named, while aspects accessed frequently across multiple types are clearly central to the project.

## Materialization Pipeline

The aspect graph is rebuilt during `paradigm_reindex` through a five-step pipeline:

1. **openAspectGraph** — Opens (or creates) the SQLite database at `.paradigm/aspect-graph.db`. If the database exists, all tables are cleared for a fresh rebuild. This ensures the graph always reflects the current state of YAML files.

2. **materializeAspects** — Reads all `.purpose` files, extracts aspect definitions, and writes them to the `aspects`, `anchors`, and `edges` tables. For each anchor, the pipeline reads the actual source code at the specified line range and computes a SHA-256 content hash. Explicit edges from the YAML `edges` field are written with origin `explicit` and weight 1.0. Inferred edges from `applies-to` references are written with origin `inferred` and weight 0.5.

3. **materializeLoreLinks** — Reads the `lore` field from each aspect and creates entries in the `lore_links` table connecting aspects to their referenced lore entries.

4. **inferLoreEdges** — Scans the `lore_links` table for aspects that share lore references. When two aspects both reference the same lore entry, a learned edge is created between them with origin `learned` and a weight proportional to the number of shared references. This discovers implicit relationships that were not explicitly declared.

5. **closeAspectGraph** — Commits all changes, runs ANALYZE for query optimization, and closes the database connection.

Because the entire graph is rebuilt from YAML on every reindex, there is no migration or versioning concern. If the schema changes in a future Paradigm version, the next reindex simply creates the new schema.

## Category Inference

When an aspect definition omits the `category` field, the materialization pipeline attempts to infer it from the description using keyword matching:

- Descriptions containing "must", "always", "never", "required" suggest `rule`
- Descriptions containing "decided", "chosen", "selected", "opted" suggest `decision`
- Descriptions containing "limit", "maximum", "minimum", "cannot exceed" suggest `constraint`
- Descriptions containing "configured", "set to", "defaults to", "environment" suggest `configuration`
- Descriptions containing "always true", "never negative", "invariant", "guarantee" suggest `invariant`

Similarly, severity can be inferred from tags: aspects tagged `[critical]` or `[security]` default to `high` severity, aspects tagged `[compliance]` default to `critical`, and untagged aspects default to `medium`.

Inference is a fallback — explicit `category` and `severity` fields in YAML always take precedence.

## Weight Decay in Search Learning

The search learning system uses a reinforcement model. When `paradigm_aspect_confirm` is called with a query and aspect ID:

1. The selected result's weight for that query gets **+1.0** added to its current weight in the `search_weights` table. If no entry exists, one is created with weight 1.0.
2. All other aspects that were previously returned for the same query get their weights multiplied by **0.95** (a 5% decay). This applies only to aspects that have existing `search_weights` entries for this query — it does not penalize aspects that were never returned for this query.

This mechanism is self-correcting. If result A is consistently confirmed for a query, its weight grows (1.0, 2.0, 3.0, ...) while alternatives decay (1.0, 0.95, 0.9025, ...). After enough confirmations, the learned mapping becomes dominant and Tier 1 returns it instantly. But if the user later confirms a different result B for the same query, B starts climbing while A begins decaying — the system adapts to changing preferences without requiring manual intervention.
