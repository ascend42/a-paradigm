---
id: N-para-451-partners-primitive
title: The Partners Primitive — Scholar + Sheila as the Canonical Pair
type: note
author: paradigm
created: '2026-04-26'
updated: '2026-04-26'
tags:
  - course
  - para-451
  - partners
  - v6.0.3
  - scholar-sheila
  - intermediate
symbols: []
difficulty: intermediate
estimatedMinutes: 8
prerequisites:
  - N-para-451-roster-reference
category: paradigm-core
origin: authored
source: agents-course-phase-a-design.md
---

> **About this entry.** This entry is itself a Scholar+Sheila collaboration: Scholar produced the source material from `packages/paradigm-mcp/src/types/agents.ts` and the agent profiles in `~/.paradigm/agents/`; Sheila shaped it into pedagogical form. We are teaching the partners primitive *by being one*. That is intentional — the canonical example of a partnership is the partnership that wrote the canonical example.

## Why partners exists

Some agents do meaningfully better when paired with another agent. **Scholar** produces source material — gathered citations, surfaced files, raw research notes. **Sheila** shapes that source material into learning experiences — sequenced quizzes, paths, pedagogical framing. Either one alone would work; the two together are how PARA 451 gets authored at all.

The framework needed a structural way to express this. Before v6.0.3, "these two agents work as a unit" was a convention you could read in their narrative profiles, but nothing in the schema reflected it — so tooling, the planned nevr.land marketplace, and the future pair-notebook surface had nowhere to hang. The **partners primitive**, shipped at v6.0.3, fixes that. It is a small, declarative addition to `AgentProfile` that says: "this agent has these specific partners, and here is what kind of relationship each one is."

## The schema (the actual field shape)

Defined in `packages/paradigm-mcp/src/types/agents.ts`:

```ts
export interface PartnerRef {
  id: string;
  relation?: string;                              // free-form label
  share_notebooks?: 'off' | 'read' | 'read-write';
}
```

In an `.agent` profile or in `agents.yaml`:

```yaml
partners:
  - id: educator
    relation: research-pair
    share_notebooks: read-write
```

Three fields, two of them optional. **`id`** is the partner agent's id (machine-stable handle). **`relation`** is a free-form label — `research-pair`, `mentor`, `lead`, `qa-pair` are all reasonable. **`share_notebooks`** is the notebook-sharing posture, with three legal values today (`off`, `read`, `read-write`).

## Scholar + Sheila as the canonical example

Both halves of the reciprocal declaration:

```yaml
# In ~/.paradigm/agents/scholar.agent
partners:
  - id: educator
    relation: research-pair
    share_notebooks: read-write

# In ~/.paradigm/agents/educator.agent
partners:
  - id: scholar
    relation: research-pair
    share_notebooks: read-write
```

Each agent declares the other. The `relation` matches on both sides (`research-pair`). The `share_notebooks` posture matches too. This is what a fully reciprocal pair looks like, and it is referenced explicitly in project memory (`feedback_specialized_agent_responsibilities.md`) as the canonical example of the "split strategy / split ops, pair via schema" pattern that Paradigm prefers over merging two roles into one mega-agent.

## Reciprocal versus pending

Pairings come in two shapes:

- **Reciprocal:** A lists B *and* B lists A. The CLI shows a checkmark. Both agents agree on the partnership; tooling and (eventually) the pair notebook surface treat it as a first-class unit.
- **Pending:** A lists B but B does not list A. The CLI shows a yellow warning. This is **legal** — it can be intentional (a mentor / lead pattern where the junior declares the senior but not vice versa) or accidental (typo in one of the two profiles). The framework does not assume one or the other; it surfaces the asymmetry and lets you decide.

You can verify any pairing's status with `paradigm agent get <id>` and looking at the Partners block.

## The pair notebook namespace (reserved at v6.0.3)

The path `.paradigm/notebooks/_pairs/{a-b}/` is **reserved** for pair notebooks. The directory naming is alphabetical regardless of which agent declared the partnership first — so the Scholar / Sheila pair notebook would live at `.paradigm/notebooks/_pairs/educator-scholar/` (because `educator` sorts before `scholar`).

At v6.0.3, this namespace is **claimed but unwritten**. No pair-notebook entries exist yet. Reserving the path now means that when pair-learning ships, every existing partnership declaration becomes meaningful immediately without a migration.

## What `share_notebooks` does today

At v6.0.3, the `share_notebooks` field is **declarative only** — the schema accepts it, the registry contracts model it, but no runtime enforcement reads it yet. Declaring `share_notebooks: read-write` on a partnership today is **forward-compat-safe** but produces no observable change in agent behaviour at v6.0.3.

> **Coming in v6.1:** `share_notebooks` becomes runtime-enforced. `read` will let the partner consult the agent's notebook during their own runs; `read-write` will additionally let the partner write entries into the pair notebook namespace. The default value is also expected to shift at v6.1 (currently tracked as TD-2026-04-25-704). Declarations made today will not need rewriting once enforcement ships. See `agent-owned-enforcement-plan.md`.

## Marketplace primitives (contracts only)

A handful of related types in `packages/paradigm/src/commands/agent/registry-types.ts` model partnership for the planned nevr.land registry: `PartnerBundle` (a unit installable as a pair), `ReciprocalInstallMeta` (metadata that travels with a bundle), and `PartnerCoverage` (which partner declarations are reciprocal at install time). These are **defined but unwired** — the marketplace consumer arrives later. They are mentioned here so you know the partners primitive is designed to extend cleanly into the marketplace, not just to live inside one project.

## Try this

Run `paradigm agent get scholar`. Look for the **Partners** block — you should see `educator` listed with `relation: research-pair`. Now run `paradigm agent get educator`. The Partners block should list `scholar` symmetrically, and the CLI should mark the pair as reciprocal (a checkmark). If either side is missing or the relation differs, the pair will show as pending — that is the asymmetry signal the primitive exists to surface.

## Up next

The next entry — **N-para-451-orchestration-modes** — covers how the framework actually runs the team at runtime: faceted multi-agent execution in Claude Code versus sequential roleplay in IDEs without Task tool support.
