# Aspect Graph System — Architecture Plan (v3.5.0)

## Status: PLAN APPROVED — No code changes made yet

## Overview

Transform the ~ (aspect) symbol from a passive metadata annotation into the core knowledge layer of Paradigm: a SQLite-backed graph database of fine-grained code rules, decisions, and constraints with line-level precision, recursive traversal, fuzzy search with learning, lore integration, and auto-suggestion.

## Branch: TBD (likely APT-3 or aspect-graph)

## Design Principles

1. **YAML as source of truth, SQLite as query engine** — `.purpose` files remain human-friendly and git-tracked; `.paradigm/aspect-graph.db` is a derived build artifact (gitignored), rebuilt by `paradigm scan` / `paradigm_reindex`
2. **Fully backwards-compatible** — all new fields are optional; existing aspects work without modification
3. **Three-tier search** — learned mappings first (accurate), FTS5 second (broad), fuzzy third (fallback)
4. **Weight-based graph traversal** — multiplicative decay prunes irrelevant paths; bounded by maxDepth and minWeight
5. **Language-agnostic heuristics** — regex line scanning for auto-suggest, no AST dependency

## Data Model

### Extended Aspect YAML (in .purpose files)

```yaml
aspects:
  token-expiry-24h:
    description: JWT token expiry is set to 24 hours
    tags: [security, authentication]
    anchors:
      - src/auth/jwt.ts:47          # exact line
      - src/auth/refresh.ts:112-118 # line range
    applies-to:
      - "^authenticated"
      - "#auth-middleware"
    enforcement: |
      Token expiry MUST be 24h. See lore L-2026-01-15-002.
    # NEW v3.5 fields (all optional):
    value: "24 * 60 * 60 * 1000"
    category: configuration    # rule | decision | constraint | configuration | invariant
    severity: high             # low | medium | high | critical
    edges:
      - symbol: "^authenticated"
        relation: enforced-by  # enforced-by | depends-on | contradicts | supersedes | related-to
      - symbol: "~session-validity"
        relation: depends-on
    lore:
      - L-2026-01-15-002
```

### TypeScript Types

```typescript
export type AspectRelation = 'enforced-by' | 'depends-on' | 'contradicts' | 'supersedes' | 'related-to';
export type AspectSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AspectCategory = 'rule' | 'decision' | 'constraint' | 'configuration' | 'invariant';

export interface AspectEdge {
  source: string;
  target: string;
  relation: AspectRelation;
  weight?: number;          // 0.0-1.0, traversal priority
  origin: 'explicit' | 'inferred' | 'learned';
}

export interface ResolvedAnchor {
  path: string;
  startLine: number;
  endLine: number;
  content?: string;
  contentHash?: string;
  exists: boolean;
  drifted?: boolean;
}
```

### SQLite Schema (.paradigm/aspect-graph.db)

```sql
CREATE TABLE aspects (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  category TEXT DEFAULT 'rule',
  severity TEXT DEFAULT 'medium',
  value TEXT,
  enforcement TEXT,
  defined_in TEXT NOT NULL,
  tags TEXT,  -- JSON array
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE anchors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aspect_id TEXT NOT NULL REFERENCES aspects(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content_hash TEXT,
  last_verified TEXT,
  drifted INTEGER DEFAULT 0
);

CREATE TABLE edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  relation TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  origin TEXT DEFAULT 'explicit',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_edges_unique ON edges(source, target, relation);

CREATE TABLE lore_links (
  aspect_id TEXT NOT NULL REFERENCES aspects(id) ON DELETE CASCADE,
  lore_id TEXT NOT NULL,
  PRIMARY KEY (aspect_id, lore_id)
);

CREATE TABLE search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  results_returned TEXT NOT NULL,  -- JSON array of aspect IDs
  selected_result TEXT,
  timestamp TEXT NOT NULL
);

CREATE TABLE search_weights (
  query_normalized TEXT NOT NULL,
  aspect_id TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  hit_count INTEGER DEFAULT 1,
  last_hit TEXT NOT NULL,
  PRIMARY KEY (query_normalized, aspect_id)
);

CREATE TABLE heatmap (
  aspect_id TEXT NOT NULL,
  access_type TEXT NOT NULL,  -- search | ripple | navigate | direct
  count INTEGER DEFAULT 0,
  last_accessed TEXT NOT NULL,
  PRIMARY KEY (aspect_id, access_type)
);

CREATE VIRTUAL TABLE aspects_fts USING fts5(id, description, enforcement, tags, content='aspects', content_rowid='rowid');
```

## Search Engine

### Three-Tier Architecture

1. **Tier 1 — Learned mappings**: Query `search_weights` by normalized query, order by weight DESC
2. **Tier 2 — FTS5 full-text**: Match against `aspects_fts` virtual table
3. **Tier 3 — Fuzzy fallback**: Levenshtein matching via existing `fuzzy-match.ts`

### Query Normalization

- Lowercase
- Remove stop words (the, a, an, is, how, does, what, why, when)
- Sort remaining tokens alphabetically
- Join with space

"how does pricing work" → "pricing work"

### Learning Loop

1. Agent calls `paradigm_aspect_search({ query: "..." })`
2. System returns ranked results from tiers 1-3
3. Agent selects a result (calls `paradigm_aspect_confirm`)
4. System logs to `search_log`, upserts `search_weights` (weight += 1.0)
5. Decay: all other weights for same normalized query *= 0.95

## Recursive Ripple

Weighted BFS through the aspect graph:

- Follows edges in both directions
- Also follows existing symbol-index references (backwards compat, weight 0.8)
- Visited set prevents loops
- maxDepth (default 5, max 10) caps traversal
- minWeight (default 0.1) prunes low-relevance paths
- Hard queue limit of 1000 entries
- Output sorted by weight descending

Output includes: full graph path, cascaded aspects at each node, lore summaries, exact file:line anchors.

## Auto-Suggestion Heuristics

Regex line scanning (language-agnostic):

| Pattern | Detection |
|---------|-----------|
| Magic numbers | Numeric literal not 0, 1, -1 in non-test code |
| Hardcoded strings | String literals that look like config/URLs |
| Conditional branches | `if` with comparison to specific values |
| Rate limits | `limit`, `max`, `throttle` with numbers |
| Time values | Duration-like expressions (e.g., `24 * 60 * 60`) |
| Environment checks | `process.env.NODE_ENV === "production"` |
| Feature flags | Boolean checks on config values |
| Regex patterns | Complex regex encoding business rules |

Returns suggestions with line number, proposed name, category, confidence level.

## MCP Tools

### New Tools (7)

| Tool | Description | ~Tokens |
|------|-------------|---------|
| `paradigm_aspect_search` | Fuzzy search with learning | ~200 |
| `paradigm_aspect_get` | Full details: anchors, code, lore, edges | ~250 |
| `paradigm_aspect_graph` | Subgraph neighborhood (N hops) | ~300 |
| `paradigm_aspect_heatmap` | Most-accessed aspects | ~150 |
| `paradigm_aspect_suggest_scan` | Auto-detect undocumented aspects | ~200 |
| `paradigm_aspect_drift` | Check anchor staleness | ~150 |
| `paradigm_aspect_confirm` | Learning feedback for search | ~50 |

### Modified Tools

| Tool | Change |
|------|--------|
| `paradigm_ripple` | Recursive graph traversal; cascaded aspects + lore in output |
| `paradigm_search` | Delegate aspect queries to `aspect_search` |
| `paradigm_related` | Include aspect graph edges |
| `paradigm_reindex` | Rebuild aspect-graph.db |
| `paradigm_aspect_check` | Enhanced with drift detection + graph connectivity |

## CLI Commands

### New

| Command | Description |
|---------|-------------|
| `paradigm aspect search <query>` | Terminal aspect search |
| `paradigm aspect get <symbol>` | Full aspect detail |
| `paradigm aspect graph <symbol>` | ASCII graph visualization |
| `paradigm aspect heatmap` | Most-accessed aspects |
| `paradigm aspect suggest <file>` | Auto-suggest for a file |
| `paradigm aspect drift` | Check all anchors for drift |

### Modified

| Command | Change |
|---------|--------|
| `paradigm scan` | Also builds aspect-graph.db |
| `paradigm doctor` | Checks drifted anchors, orphaned aspects, missing FTS5 |
| `paradigm ripple` | Uses recursive graph traversal |

## Migration

- All new fields optional — existing .purpose files work unchanged
- `paradigm scan` auto-builds the graph from existing aspects
- Edges inferred from `applies-to` references (origin: 'inferred', weight: 0.5)
- Category inferred from description keywords (must/require → rule, set to/configured → configuration, etc.)
- Severity inferred from tags (security → high, critical → critical, default → medium)
- Lore links inferred from symbol overlap in lore entries

## File Plan

### Sub-phase 0: Types

| File | Package |
|------|---------|
| `packages/premise/core/src/types.ts` — add AspectEdge, AspectRelation, etc. | premise-core |
| `packages/paradigm-mcp/src/types/aspect-graph.ts` — graph DB types | paradigm-mcp |

### Sub-phase 1: Core Engine

| File | Package |
|------|---------|
| `packages/paradigm-mcp/src/utils/aspect-graph.ts` — SQLite graph engine | paradigm-mcp |
| `packages/paradigm-mcp/src/utils/aspect-search.ts` — three-tier search | paradigm-mcp |
| `packages/paradigm-mcp/src/utils/aspect-lore-bridge.ts` — lore linking | paradigm-mcp |
| `packages/paradigm-mcp/src/utils/aspect-suggest.ts` — heuristic scanner | paradigm-mcp |
| `packages/purpose/core/src/aggregator.ts` — parse new v3.5 fields | purpose-core |
| `packages/premise/core/src/aggregator.ts` — pass through new fields | premise-core |

### Sub-phase 2: Integration

| File | Package |
|------|---------|
| `packages/paradigm-mcp/src/tools/aspect-graph.ts` — 7 new tool handlers | paradigm-mcp |
| `packages/paradigm-mcp/src/tools/index.ts` — register + modify ripple/search | paradigm-mcp |
| `packages/paradigm-mcp/src/tools/reindex.ts` — add materialization | paradigm-mcp |
| `packages/paradigm/src/commands/aspect.ts` — new CLI commands | paradigm |
| `packages/paradigm/src/commands/doctor.ts` — graph health checks | paradigm |

## Implementation Phases

```
Phase 1 (types + engine) → Phase 2 (materialization) ──┬──→ Phase 3 (MCP tools) ──┬──→ Phase 5 (tests) → Phase 6 (release)
                                                        └──→ Phase 4 (CLI + suggest) ┘
```

### Phase 1: Foundation
- New types in premise-core and paradigm-mcp
- aspect-graph.ts engine: open/create/materialize/query
- aspect-search.ts: normalization + three-tier search
- aspect-lore-bridge.ts: lore linking

### Phase 2: Materialization Integration
- Modified extractAspects in purpose-core for v3.5 fields
- Modified aggregator in premise-core
- Modified reindex.ts to build aspect-graph.db
- Modified scan command

### Phase 3: MCP Tools (parallel with Phase 4)
- 7 new tool handlers in aspect-graph.ts
- Registration in index.ts
- Modified paradigm_ripple (recursive traversal)
- Modified paradigm_search (delegate aspect queries)

### Phase 4: CLI + Auto-Suggest (parallel with Phase 3)
- aspect-suggest.ts heuristic engine
- aspect.ts CLI commands
- Doctor enhancements

### Phase 5: Tests + Polish
- Unit tests for engine, search, suggest, tools
- .purpose file updates
- CLAUDE.md documentation updates
- aspect-graph.db added to .gitignore template

### Phase 6: Version Bump + Release
- paradigm 3.5.0, paradigm-mcp 3.5.0, plugin 3.5
- CHANGELOG entries

## Version Bumps

| Package | From | To |
|---------|------|----|
| `@a-company/paradigm` | 3.4.0 | 3.5.0 |
| `@a-company/paradigm-mcp` | 3.4.0 | 3.5.0 |
| Plugin | 3.4.0 | 3.5.0 |

## Risks

| Risk | Mitigation |
|------|------------|
| SQLite dep size (~5MB) | Already used by Sentinel; shared dep |
| Graph traversal perf | Bounded by maxDepth + minWeight pruning + queue limit |
| Anchor drift | Content hash comparison; doctor warns; drift tool |
| Learning data pollution | Weight decay (0.95x) self-corrects; admin reset available |
| FTS5 availability | Runtime check; fall back to LIKE queries |
| DB corruption | Derived artifact — delete and re-scan |
