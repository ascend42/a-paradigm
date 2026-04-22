---
id: N-para-701-model-tier-resolution
title: 'Lesson 6: Model Tier Resolution'
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-701
  - three-capability-tiers
  - model-resolution-config-block
  - five-level-resolution-cascade
symbols: []
difficulty: beginner
estimatedMinutes: 5
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-701.json
---

## The Platform Portability Problem

Early Paradigm agent profiles specified `defaultModel: opus | sonnet | haiku` — Anthropic-specific model names hardcoded into each agent's configuration. This created four problems:

1. **Platform lock-in** — These model names do not exist in Cursor, Windsurf, Copilot, or other IDEs. An agent profile designed for Claude Code breaks everywhere else.
2. **Plan limitations** — Not every user has access to Opus. A developer on a Sonnet-only plan cannot use agents that request Opus without manual profile editing.
3. **Provider assumptions** — The model names assume Anthropic. Users who want to use GPT-4o, Gemini, or local models through Ollama have no path.
4. **Maintenance burden** — Model names were hardcoded in the orchestrator as `DEFAULT_MODELS`. Every time Anthropic ships a new model, someone has to update agent profiles.

## The Solution: Capability Tiers

Model tier resolution replaces specific model names with abstract **capability tiers** that describe what the agent needs, not which model to use:

| Tier | Capability | Use Cases |
|---|---|---|
| `tier-1` (reasoning) | Complex analysis, multi-step planning | Architect, security audit, system design |
| `tier-2` (balanced) | General coding, review, design | Reviewer, designer, most agent work |
| `tier-3` (fast) | Simple tasks, documentation, bulk ops | Builder, tester, documentor |

Agent profiles now specify `modelTier` instead of `defaultModel`:

```yaml
# Before (platform-locked)
defaultModel: opus

# After (platform-agnostic)
modelTier: tier-1
```

The orchestrator maps tier requests to available models through a resolution table in the project configuration.

## The model-resolution Config Block

The `model-resolution` block in `.paradigm/config.yaml` maps tiers to actual model identifiers:

```yaml
# .paradigm/config.yaml
model-resolution:
  tier-1: claude-opus-4-6        # Best reasoning available
  tier-2: claude-sonnet-4-6      # Balanced
  tier-3: claude-haiku-4-5       # Fast/cheap
```

This is the single configuration point where model choices live. Changing all agent models is a 3-line edit. Different environments ship different defaults:

```yaml
# Claude Code (full Anthropic access)
model-resolution:
  tier-1: claude-opus-4-6
  tier-2: claude-sonnet-4-6
  tier-3: claude-haiku-4-5

# Cursor (may not have Opus access)
model-resolution:
  tier-1: claude-sonnet-4-6
  tier-2: claude-sonnet-4-6
  tier-3: claude-haiku-4-5

# OpenAI-only environment
model-resolution:
  tier-1: gpt-4o
  tier-2: gpt-4o-mini
  tier-3: gpt-4o-mini

# Self-hosted / Ollama
model-resolution:
  tier-1: llama-3.1-70b
  tier-2: llama-3.1-8b
  tier-3: llama-3.1-8b

# Budget-conscious
model-resolution:
  tier-1: claude-sonnet-4-6
  tier-2: claude-sonnet-4-6
  tier-3: claude-sonnet-4-6
```

The budget-conscious configuration demonstrates the power of tiers: you can run the full 54-agent orchestration system with Sonnet for everything by mapping all three tiers to the same model. The agents still have different personalities, expertise, and behaviors — the model tier only affects the underlying LLM capability.

## Resolution Order

When the orchestrator needs a model for an agent, it resolves through a five-level cascade:

1. **Agent profile** — `modelTier` field (what the agent requests)
2. **Project config** — `.paradigm/config.yaml` `model-resolution` block (project override)
3. **Global config** — `~/.paradigm/config.yaml` `model-resolution` block (user preference)
4. **IDE detection** — Auto-detect available models from environment variables (`CLAUDE_CODE`, `CURSOR_SESSION`, `WINDSURF_SESSION`)
5. **Fallback** — Default to tier-2 (balanced) with the best available model

```typescript
function resolveModel(tier: ModelTier, config: ParadigmConfig): string {
  return config.modelResolution?.[tier] ?? DEFAULTS[tier];
}
```

The cascade ensures that agent preferences are respected when possible, project-level overrides take precedence over global preferences, and there is always a working fallback even if nothing is configured.

## Environment Detection

The system auto-detects the IDE environment to set sensible defaults:

```typescript
function detectEnvironment(): ModelResolution {
  if (process.env.CLAUDE_CODE) {
    return {
      'tier-1': 'claude-opus-4-6',
      'tier-2': 'claude-sonnet-4-6',
      'tier-3': 'claude-haiku-4-5'
    };
  }
  if (process.env.CURSOR_SESSION) {
    return {
      'tier-1': 'claude-sonnet-4-6',
      'tier-2': 'claude-sonnet-4-6',
      'tier-3': 'claude-haiku-4-5'
    };
  }
  // Fallback: everything is tier-2
  return {
    'tier-1': 'claude-sonnet-4-6',
    'tier-2': 'claude-sonnet-4-6',
    'tier-3': 'claude-sonnet-4-6'
  };
}
```

Claude Code users get the full tier spread (Opus/Sonnet/Haiku). Cursor users get Sonnet for tier-1 because Opus may not be available in Cursor's model selection. Unknown environments get Sonnet for everything as a safe fallback.

## Default Tier Assignments

The orchestrator assigns default tiers to standard agent roles:

```typescript
const DEFAULT_TIERS: Record<string, ModelTier> = {
  architect: 'tier-1',    // Complex planning and design
  security: 'tier-1',     // Critical analysis, cannot miss vulnerabilities
  reviewer: 'tier-2',     // Balanced evaluation
  builder: 'tier-3',      // Fast implementation
  tester: 'tier-3',       // Fast test writing
  documentor: 'tier-3',   // Fast file maintenance
};
```

Architect and security get tier-1 because their work requires deep reasoning (system design, vulnerability analysis). Builder, tester, and documentor get tier-3 because their work is more mechanical (implement this spec, write this test, update this .purpose file). Reviewer gets tier-2 as a balanced middle ground.

These defaults can be overridden per-agent in the `.agent` file (`modelTier: tier-2`) or per-project in config.yaml.

## Cost Estimation

The orchestrator uses tier cost multipliers for budget estimation:

```typescript
const TIER_COST_MULTIPLIER = {
  'tier-1': 3.0,    // ~$15/MTok for Opus
  'tier-2': 1.0,    // ~$3/MTok for Sonnet (baseline)
  'tier-3': 0.25,   // ~$0.80/MTok for Haiku
};
```

The orchestration plan output includes cost estimates: "Estimated cost: $0.12 (tier-1: architect, tier-2: reviewer, tier-3: builder+documentor)". This transparency lets the human approve or modify the plan before execution.

## Backward Compatibility

The migration path preserves existing profiles:

```yaml
# Agent profile with both fields (transitional)
defaultModel: opus      # Old field (deprecated, still read)
modelTier: tier-1       # New field (preferred)
```

The resolution logic checks `modelTier` first. If only `defaultModel` exists, it maps: `opus` to `tier-1`, `sonnet` to `tier-2`, `haiku` to `tier-3`. This ensures existing agent profiles continue working without modification.

## What This Enables

Model tier resolution unlocks five capabilities:

- **Budget control** — Map all tiers to Sonnet and run the full orchestration at Sonnet cost.
- **Platform portability** — Same agents work in Claude Code, Cursor, Windsurf, and Copilot.
- **Provider flexibility** — Swap to OpenAI, Gemini, or local models by changing 3 lines in config.
- **Graceful degradation** — If the tier-1 model is unavailable, fall back to tier-2 automatically.
- **Team consistency** — The entire team shares one `model-resolution` config block, not per-agent model names.
