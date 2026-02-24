# MCP Tool Caching Strategy

Paradigm MCP tools use an in-memory cache to avoid redundant computation during short interaction windows.

---

## Architecture

### ToolCache

A shared `ToolCache` instance lives in `packages/paradigm-mcp/src/utils/tool-cache.ts`. It provides a simple key-value store with configurable TTL.

| Property | Default | Configurable Via |
|----------|---------|-----------------|
| TTL | 30 seconds | `limits.toolCacheTtlMs` in `.paradigm/config.yaml` |
| Storage | In-memory Map | N/A |
| Scope | Per MCP server process | N/A |

### Cached Tools

| Tool | Cache Key Pattern | Rationale |
|------|-------------------|-----------|
| `paradigm_search` | `search:{query}:{type}:{limit}:{fuzzy}` | Identical searches within 30s return same results |
| `paradigm_status` | `status` | Project status rarely changes mid-session |
| `paradigm_navigate` | `navigate:{intent}:{target}:{task}` | Navigation results stable between file changes |

### Non-Cached Tools

Write tools (`paradigm_purpose_add_*`, `paradigm_portal_add_*`, `paradigm_reindex`) are never cached. The `paradigm_reindex` handler explicitly clears the entire cache after rebuilding indexes.

---

## Cache Invalidation

| Event | Action |
|-------|--------|
| `paradigm_reindex` completes | `toolCache.clear()` --- full invalidation |
| TTL expires (30s default) | Automatic expiry on next access |
| MCP server restart | Cache is in-memory, so naturally cleared |

### Manual Invalidation

The cache does not currently expose manual invalidation to end users. If stale results are suspected, calling `paradigm_reindex` will clear the cache.

---

## Configuration

Add to `.paradigm/config.yaml`:

```yaml
limits:
  toolCacheTtlMs: 30000  # Default: 30 seconds
```

Setting `toolCacheTtlMs: 0` effectively disables caching (every call recomputes).

---

## Design Decisions

1. **30-second TTL chosen** because most agent interactions involve bursts of 5-10 tool calls within seconds, followed by implementation work. A 30s window captures the burst without serving stale data during active coding.

2. **In-memory only** --- no persistence across server restarts. The cache is a performance optimization, not a data store.

3. **Cache key includes all parameters** to prevent serving results for different queries. E.g., `search:payment:component:10:true` vs `search:payment::10:true`.

4. **Full invalidation on reindex** rather than selective invalidation, because reindexing changes the symbol graph that all cached tools depend on.
