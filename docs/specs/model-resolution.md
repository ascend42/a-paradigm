# Model Resolution Spec

## Problem

Agent profiles specify `defaultModel: opus | sonnet | haiku` — but these are Anthropic-specific names that:
1. Don't exist in Cursor, Windsurf, Copilot, or other IDEs
2. May not be available on the user's plan (opus is expensive)
3. Assume a single provider (what about GPT-4o, Gemini, local models?)
4. Are hardcoded in orchestration.ts as `DEFAULT_MODELS`

## Solution: Capability Tiers

Replace model names with abstract **capability tiers** that describe what the agent needs, not which model to use.

### Tier Definitions

```
tier-1 (reasoning)   — Complex analysis, architecture, security audit, multi-step planning
tier-2 (balanced)    — General coding, review, design, most agent work
tier-3 (fast)        — Simple tasks, documentation, formatting, bulk operations
```

### Agent Profile Change

```yaml
# Before (broken across platforms)
defaultModel: opus

# After (platform-agnostic)
modelTier: tier-1
```

### Platform Resolution

Each IDE/platform maps tiers to available models via a resolution table:

```yaml
# .paradigm/config.yaml or environment-specific config
model-resolution:
  tier-1: claude-opus-4-6        # Best reasoning available
  tier-2: claude-sonnet-4-6      # Balanced
  tier-3: claude-haiku-4-5       # Fast/cheap
```

Different environments ship different defaults:

```yaml
# Claude Code (has full Anthropic access)
model-resolution:
  tier-1: claude-opus-4-6
  tier-2: claude-sonnet-4-6
  tier-3: claude-haiku-4-5

# Cursor (may have limited model access)
model-resolution:
  tier-1: claude-sonnet-4-6     # Opus may not be available
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
  tier-1: claude-sonnet-4-6     # Use sonnet for everything
  tier-2: claude-sonnet-4-6
  tier-3: claude-sonnet-4-6
```

### Resolution Order

When the orchestrator needs a model for an agent:

1. **Agent profile** `modelTier` (what the agent requests)
2. **Project config** `.paradigm/config.yaml` → `model-resolution` (project override)
3. **Global config** `~/.paradigm/config.yaml` → `model-resolution` (user preference)
4. **IDE detection** Auto-detect available models from the environment
5. **Fallback** Default to tier-2 (balanced) with the best available model

### Orchestrator Changes

```typescript
// Before
const DEFAULT_MODELS: Record<string, 'opus' | 'sonnet' | 'haiku'> = {
  architect: 'opus',
  security: 'opus',
  builder: 'haiku',
};

// After
const DEFAULT_TIERS: Record<string, ModelTier> = {
  architect: 'tier-1',
  security: 'tier-1',
  reviewer: 'tier-2',
  builder: 'tier-3',
  tester: 'tier-3',
  documentor: 'tier-3',
};

type ModelTier = 'tier-1' | 'tier-2' | 'tier-3';

function resolveModel(tier: ModelTier, config: ParadigmConfig): string {
  // 1. Check project config
  // 2. Check global config
  // 3. Check environment (detect IDE)
  // 4. Fallback to defaults
  return config.modelResolution?.[tier] ?? DEFAULTS[tier];
}
```

### Agent Profile Schema Change

```yaml
# .agent file
# Old field (deprecated, backward compatible)
defaultModel: opus

# New field (preferred)
modelTier: tier-1

# Resolution: if modelTier exists, use it. If only defaultModel, map it:
#   opus → tier-1, sonnet → tier-2, haiku → tier-3
```

### Team Init Change

During `paradigm shift` → team init, instead of asking "Which model for architect?":

```
Configure Model Tiers

  Your environment: Claude Code (Anthropic API)
  Available models: Opus, Sonnet, Haiku

  Tier 1 (reasoning — architect, security):
  ❯ Claude Opus (recommended)
    Claude Sonnet
    Claude Haiku

  Tier 2 (balanced — reviewer, designer, most agents):
  ❯ Claude Sonnet (recommended)
    Claude Opus
    Claude Haiku

  Tier 3 (fast — builder, tester, documentor):
  ❯ Claude Haiku (recommended)
    Claude Sonnet
```

This asks 3 questions instead of N (one per agent). The tiers persist in config, all agents resolve from them.

### IDE Adapter Detection

```typescript
function detectEnvironment(): ModelResolution {
  if (process.env.CLAUDE_CODE) {
    return { 'tier-1': 'claude-opus-4-6', 'tier-2': 'claude-sonnet-4-6', 'tier-3': 'claude-haiku-4-5' };
  }
  if (process.env.CURSOR_SESSION) {
    // Cursor may not expose opus — default tier-1 to sonnet
    return { 'tier-1': 'claude-sonnet-4-6', 'tier-2': 'claude-sonnet-4-6', 'tier-3': 'claude-haiku-4-5' };
  }
  if (process.env.WINDSURF_SESSION) {
    return { 'tier-1': 'claude-sonnet-4-6', 'tier-2': 'claude-sonnet-4-6', 'tier-3': 'claude-haiku-4-5' };
  }
  // Fallback: everything is tier-2
  return { 'tier-1': 'claude-sonnet-4-6', 'tier-2': 'claude-sonnet-4-6', 'tier-3': 'claude-sonnet-4-6' };
}
```

### Migration

1. Read existing `defaultModel` fields in agent profiles
2. Map: `opus` → `tier-1`, `sonnet` → `tier-2`, `haiku` → `tier-3`
3. Write `modelTier` field, keep `defaultModel` for backward compat
4. Orchestrator checks `modelTier` first, falls back to `defaultModel` mapping

### What This Enables

- **Budget control**: user sets all tiers to sonnet → runs the full orchestration at sonnet cost
- **Platform portability**: same agents work in Claude Code, Cursor, Windsurf, Copilot
- **Provider flexibility**: swap to OpenAI, Gemini, or local models by changing 3 lines in config
- **Graceful degradation**: if tier-1 model isn't available, fall back to tier-2 automatically
- **Team consistency**: entire team shares one model-resolution config, not per-agent model names

### Cost Estimation Update

Token estimates in the orchestrator should factor in tier:

```typescript
const TIER_COST_MULTIPLIER = {
  'tier-1': 3.0,   // ~$15/MTok for opus
  'tier-2': 1.0,   // ~$3/MTok for sonnet (baseline)
  'tier-3': 0.25,  // ~$0.80/MTok for haiku
};
```

The orchestrator plan output shows: "Estimated cost: $0.12 (tier-1: architect, tier-2: reviewer, tier-3: builder+documentor)"
