---
id: N-para-701-agent-notebooks
title: 'Lesson 3: Agent Notebooks'
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-701
  - notebook-entries-contain
  - notebookentry-schema-id
  - global-notebooks-paradigmnotebooks
symbols: []
difficulty: beginner
estimatedMinutes: 6
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-701.json
---

## What Notebooks Are

Agent notebooks are curated snippet libraries distilled from experience. Where expertise scores track *how well* an agent knows a symbol, and transferable patterns track *general principles* the agent has learned, notebooks contain *specific, reusable knowledge* — code patterns, configuration snippets, troubleshooting procedures, and domain-specific techniques.

A notebook entry for the security agent might contain a specific JWT validation middleware pattern for Express v5. A notebook entry for Mika (designer) might contain a font pairing recommendation with rationale. A notebook entry for Atlas (devops) might contain a zero-downtime migration pattern for Supabase.

Notebooks bridge the gap between abstract principles ("always validate JWTs") and concrete implementation ("here is the exact middleware code that handles edge cases in Express v5").

## The NotebookEntry Schema

Every notebook entry follows the `NotebookEntry` interface:

```typescript
interface NotebookEntry {
  id: string;              // e.g., "nb-auth-pattern-001"
  context: string;         // When to apply this snippet
  snippet: string;         // The reusable code/knowledge
  provenance: {            // Where this came from
    source: 'lore' | 'manual' | 'transfer';
    loreEntryId?: string;  // If promoted from lore
    originProject?: string;
    createdBy?: string;
  };
  appliedCount: number;    // Times applied in orchestration
  confidence: number;      // 0.0-1.0
  concepts: string[];      // Concept tags for retrieval
  tags: string[];          // Classification tags
  created: string;         // ISO date
  updated: string;         // ISO date
}
```

The `context` field describes *when* to apply the snippet — not what the snippet is, but the situation that calls for it. For example: "When setting up JWT validation middleware in an Express v5 application with async route handlers." This context is what the retrieval system matches against.

The `snippet` field contains the actual knowledge — code, configuration, a procedure, or a detailed explanation. It should be directly usable, not abstract guidance.

The `provenance` field tracks where the entry came from: `lore` (promoted from a lore entry), `manual` (written directly by a human or agent), or `transfer` (copied from another agent's notebook). This matters for trust: a lore-promoted entry with a link to the original session has higher credibility than a manually created one.

The `appliedCount` tracks how often this entry has been used in orchestration. Entries are sorted by `appliedCount` descending — frequently-applied entries surface first.

## Storage: Global vs Project

Notebooks live in two locations:

**Global notebooks** at `~/.paradigm/notebooks/{agent-id}/` travel with the agent across all projects. An entry about JWT validation patterns is useful regardless of which project the security agent joins. Global notebooks are stored in the user's home directory (ring 2), so they persist even if a project is deleted.

**Project notebooks** at `.paradigm/notebooks/{agent-id}/` contain knowledge specific to one project. An entry about the specific authentication architecture of project X should not bleed into project Y. Project notebooks are committed to the repository so they are shared with the team.

When loading entries, the system reads global first, then project. If the same entry ID exists in both locations, the **project version wins** (override pattern). This allows a project to customize an agent's global knowledge for its specific needs.

Each entry is stored as an individual YAML file named `nb-{concept}.yaml` (or more precisely, `{entry-id}.yaml`). The `nb-` prefix and `.yaml` extension are enforced by the `NOTEBOOK_PREFIX` and `NOTEBOOK_EXT` constants in the notebook loader.

## Bootstrapping: Canonical Sources vs Learning Loop

Notebook entries come from two pipelines:

**Canonical bootstrapping** — When an agent is first created, Loid (forge) or a human seeds its notebook with foundational entries. The security agent might be bootstrapped with entries for OWASP Top 10 patterns, JWT best practices, and RLS policy templates. This gives the agent useful knowledge on day one without needing to learn from experience.

**Learning loop promotion** — Over time, journal entries and lore entries that prove valuable are promoted into notebook entries. The `promoteFromLore()` function takes a lore entry ID, extracts the symbols and content, and creates a notebook entry with `provenance.source: 'lore'` and a link to the original entry. Sensei (trainer) drives this promotion — reviewing agent performance, identifying high-value learnings, and curating them into notebook entries.

The learning loop pipeline is more valuable over time because it captures *project-specific* and *team-specific* patterns that canonical sources cannot predict. A canonical JWT entry is generic. A learning-loop entry that captures "In this project, JWT refresh tokens use the sliding window pattern with 15-minute windows because the mobile app has intermittent connectivity" is specific and actionable.

## How buildProfileEnrichment() Uses Notebooks

During orchestration, `buildProfileEnrichment()` accepts an optional array of notebook entries. The orchestrator matches entries by concept against the task's relevant symbols and injects the **top 5 entries by concept match** into the agent's prompt:

```typescript
function buildProfileEnrichment(
  profile: AgentProfile,
  relevantSymbols: string[],
  notebookEntries?: Array<{ context: string; snippet: string; concepts: string[] }>,
  // ...
): string {
  // ...
  if (notebookEntries && notebookEntries.length > 0) {
    parts.push('## Relevant Notebook Entries');
    for (const nb of notebookEntries.slice(0, 5)) {
      parts.push(`### ${nb.context}`);
      parts.push(`Concepts: ${nb.concepts.join(', ')}`);
      parts.push('```');
      const snippet = nb.snippet.length > 300
        ? nb.snippet.slice(0, 300) + '...' : nb.snippet;
      parts.push(snippet);
      parts.push('```');
    }
  }
}
```

Notice the `slice(0, 5)` — only the top 5 entries are injected. This is a deliberate budget constraint. Notebook entries consume prompt tokens. Injecting 50 entries would blow the context budget. The top 5 are selected by relevance (concept match) and sorted by `appliedCount` (most-used first).

Snippets longer than 300 characters are truncated with `...`. This prevents a single large entry from consuming the entire notebook budget. If an entry's full snippet is needed, the agent can use `paradigm_notebook_search` to retrieve it.

## 10 High-Signal Entries > 100 Low-Signal Ones

The quality bar for notebook entries matters enormously. Consider the token economics: each entry consumes ~100-300 tokens in the prompt. Five entries consume ~500-1,500 tokens. If those entries are high-signal (directly relevant, battle-tested, frequently applied), they provide immense value — the agent starts the task with proven patterns instead of reinventing them.

If those entries are low-signal (vague, generic, rarely applied), they waste 500-1,500 tokens on noise that might actually mislead the agent. Worse, low-quality entries can actively degrade performance by injecting irrelevant patterns that the LLM tries to apply inappropriately.

The `appliedCount` sorting is the primary quality signal. An entry that has been applied 15 times across 8 sessions is empirically useful. An entry that was created once and never applied is speculative. The `confidence` score provides a secondary signal, especially for new entries that have not yet accumulated an applied count.

Sensei's role as curator is critical: reviewing entries, pruning low-value ones, merging duplicates, and updating stale patterns. A well-maintained notebook with 10 entries is vastly more valuable than an unmaintained one with 100.

## MCP Tools for Notebooks

- `paradigm_notebook_add` — Add a new entry. Requires `agentId`, `context`, `snippet`, `concepts`, and `scope` (global or project).
- `paradigm_notebook_search` — Search entries by query string across context, snippet, and concepts.
- `paradigm_notebook_list` — List all entries for an agent, optionally filtered by concepts or tags.
- `paradigm_notebook_promote` — Promote a lore entry into a notebook entry via `promoteFromLore()`.
