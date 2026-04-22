---
id: N-para-601-attention-scoring
title: Attention & Scoring
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-601
  - agentattention-has-four
  - four-scoring-dimensions
  - score-is-max-based
symbols: []
difficulty: beginner
estimatedMinutes: 5
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-601.json
---

## AgentAttention Patterns

Every agent in the ambient system has an attention configuration — a set of patterns that define what the agent notices. Think of it as a personalized filter: events that match the agent's attention patterns are potentially relevant; events that do not match are noise.

The `AgentAttention` interface has five fields:

```typescript
interface AgentAttention {
  symbols?: string[];       // Symbol patterns (e.g., ["^*", "#*-middleware"])
  paths?: string[];         // File path patterns (e.g., ["auth/**", "middleware/**"])
  concepts?: string[];      // Semantic triggers (e.g., ["JWT", "RBAC", "injection"])
  signals?: AttentionSignal[]; // Event type triggers (e.g., [{ type: "gate-added" }])
  threshold?: number;       // Confidence threshold (default 0.6)
}
```

**Symbols** use glob patterns to match against the `symbols` array on events. A security agent watching `["^*", "#*-auth", "#*-middleware"]` will match any gate symbol and any component whose name ends in `-auth` or `-middleware`.

**Paths** use glob patterns to match against the `path` field on events. A builder watching `["src/**", "lib/**", "packages/**"]` matches any source file change.

**Concepts** are semantic keywords matched against the event's `context`, `keywords`, and `type` fields (all lowercased). A tester watching `["test", "coverage", "assertion"]` will match events mentioning those terms.

**Signals** match against the event's `type` field. A security agent with `signals: [{ type: 'gate-added' }, { type: 'route-created' }]` will match whenever a new gate or route appears in the stream.

## Four Scoring Dimensions

When an event enters the stream, each agent scores it against their attention patterns across four dimensions:

**symbolMatch (0.0-1.0):** For each pattern in the agent's `symbols` array, check if any symbol in the event matches (using glob). If any match is found, `symbolMatch = 1.0`. If no agent symbols are defined or no event symbols exist, `symbolMatch = 0.0`.

**pathMatch (0.0-1.0):** For each pattern in the agent's `paths` array, check if the event's `path` matches. If any match is found, `pathMatch = 1.0`. Binary: either a path matches or it does not.

**conceptMatch (0.0-1.0):** The event's `context`, `keywords`, and `type` are joined into a lowercased text. Each concept in the agent's `concepts` array is checked for inclusion. The score is `matched / total_concepts`. If the agent watches 5 concepts and 3 appear in the event text, `conceptMatch = 0.6`.

**signalMatch (0.0-1.0):** For each signal in the agent's `signals` array, check if the event's `type` matches. If any match, `signalMatch = 1.0`. Binary.

## Max-Based Score

The overall score is the **maximum** of the four dimensions:

```typescript
const score = Math.max(symbolMatch, pathMatch, conceptMatch, signalMatch);
```

This is a deliberate design choice. Using max (rather than average or weighted sum) means a single strong match is enough to trigger attention. A security agent does not need to match on all four dimensions — if the event mentions a gate symbol (`symbolMatch = 1.0`), that alone is sufficient even if the file path, concepts, and signals do not match.

The alternative (averaging) would dilute strong signals: a perfect symbol match (1.0) with no other matches would average to 0.25, likely falling below the threshold. Max scoring ensures that domain-specific expertise in any single dimension is respected.

## Threshold-Based Self-Nomination

After scoring, the agent checks its threshold:

```typescript
const threshold = attention.threshold ?? 0.6;
const shouldNominate = score >= threshold;
```

If the score meets or exceeds the threshold, the agent should self-nominate a contribution. If not, the agent stays quiet, and the `quietReason` field records why: `'below-threshold'`.

The default threshold is 0.6, but different agent roles have different defaults based on their domain:

| Role | Default Threshold | Rationale |
|---|---|---|
| architect | 0.5 | Broad awareness — should notice most structural changes |
| builder | 0.7 | Focused — only speaks when directly relevant to implementation |
| reviewer | 0.6 | Balanced — watches code quality and patterns |
| tester | 0.5 | Broad — testing intersects all areas |
| security | 0.4 | Most sensitive — should speak up early and often |

A lower threshold means the agent speaks up more often (more false positives, fewer missed issues). A higher threshold means the agent speaks up less often (fewer false positives, more missed issues). Security uses 0.4 because the cost of missing a security issue far outweighs the cost of a false alarm.

## scoreEventForAgent

The `scoreEventForAgent` function ties everything together:

```typescript
function scoreEventForAgent(
  event: StreamEvent,
  agentId: string,
  attention: AgentAttention
): AttentionScore
```

It returns an `AttentionScore` with five fields:
- `agentId` — Which agent evaluated this event
- `score` — Overall relevance (0.0-1.0)
- `breakdown` — The four dimension scores (`symbolMatch`, `pathMatch`, `conceptMatch`, `signalMatch`)
- `shouldNominate` — Whether the score exceeds the agent's threshold
- `quietReason` — Why the agent stayed quiet (if it did)

The breakdown is valuable for debugging attention patterns. If an agent is not speaking up when expected, the breakdown shows which dimension scored low. If `symbolMatch = 0.0` but the event clearly involves the agent's domain, the agent's symbol patterns may need expanding.

## DEFAULT_ATTENTION for Standard Roles

Paradigm provides default attention configurations for five standard roles:

**Architect** — Watches all flows (`$*`) and components (`#*`), concepts like `architecture`, `design`, `pattern`, `refactor`. Threshold 0.5.

**Builder** — Watches source paths (`src/**`, `lib/**`, `packages/**`). Threshold 0.7.

**Reviewer** — Watches concepts like `code quality`, `bug`, `smell`, `convention`. Threshold 0.6.

**Tester** — Watches test paths (`**/*.test.*`, `**/*.spec.*`), concepts like `test`, `coverage`, `assertion`, and `error-encountered` signals. Threshold 0.5.

**Security** — Watches gate symbols (`^*`), auth components (`#*-auth`, `#*-middleware`), auth paths (`auth/**`, `middleware/**`, `guards/**`), concepts like `permission`, `JWT`, `session`, `RBAC`, `XSS`, `injection`, and signals `gate-added` and `route-created`. Threshold 0.4.

These defaults are overridable in the agent's `.agent` file via the `attention` field. A security agent working on a project with no web routes might raise its threshold to 0.6 and remove the path patterns.
