---
id: none-enforcement-rune-promotion-spec
title: "None Enforcement Preset + Rune Promotion State Machine"
status: approved
author: architect
created: 2026-05-02
version: 1.0
---

# None Enforcement Preset + Rune Promotion State Machine

## Context

Paradigm serves users who adopt it purely for agents (roster/orchestration), Sentinel (security), or Conductor
(overlay), without intending to use the symbol-tracking system. The current default enforcement level is
`minimal`, which still warns on `purpose-coverage` and `habits-blocking`. For these users, that creates
immediate friction — paradigm shift completes and they get compliance warnings on an existing codebase with
no .purpose files.

**Decision:** Add `none` as a fourth preset (all 13 checks `off`). Make it the new global default.
**Discovery:** Rune detects behavioral signals and proactively offers to enable symbol tracking once the user
demonstrates readiness.

---

## Part A — `none` Preset

### A-1: `packages/paradigm/src/core/enforcement/types.ts`

**Line 12** — extend the union:
```typescript
export type EnforcementLevel = 'strict' | 'balanced' | 'minimal' | 'none';
```

### A-2: `packages/paradigm/src/core/enforcement/presets.ts`

Add `NONE` constant after `MINIMAL` (before the `PRESETS` map):
```typescript
const NONE: Record<CheckId, CheckSeverity> = {
  'purpose-coverage':          'off',
  'purpose-exists':            'off',
  'portal-gates':              'off',
  'aspect-anchors':            'off',
  'purpose-freshness':         'off',
  'aspect-advisory':           'off',
  'lore-required':             'off',
  'habits-blocking':           'off',
  'purpose-required-patterns': 'off',
  'drift-detection':           'off',
  'portal-compliance':         'off',
  'graduation-tracking':       'off',
  'orchestration-required':    'off',
};
```

Update `PRESETS` map to include `none`:
```typescript
const PRESETS: Record<EnforcementLevel, Record<CheckId, CheckSeverity>> = {
  strict: STRICT,
  balanced: BALANCED,
  minimal: MINIMAL,
  none: NONE,
};
```

Update `isValidLevel` guard:
```typescript
export function isValidLevel(l: string): l is EnforcementLevel {
  return l === 'strict' || l === 'balanced' || l === 'minimal' || l === 'none';
}
```

### A-3: `packages/paradigm/src/core/enforcement/loader.ts`

**Line 21** — change default:
```typescript
const DEFAULT_LEVEL: EnforcementLevel = 'none';
```
Comment on the loader docstring: remove "default: 'balanced'" reference, update to "default: 'none'".

### A-4: `packages/paradigm/src/core/enforcement/writer.ts`

**Line 53** — `ensureEnforcement` seed:
```typescript
config.enforcement = { level: 'none', checks: {} };
```

**Line ~131** — `ensureEnforcementDefaults` (if present): change `'balanced'` seed to `'none'`.

### A-5: `packages/paradigm-mcp/src/tools/enforcement.ts`

Five targeted changes:

1. **Line 21** — extend local `EnforcementLevel` type:
   ```typescript
   type EnforcementLevel = 'strict' | 'balanced' | 'minimal' | 'none';
   ```

2. **Lines 46–95** — add `none` entry to `PRESETS` (all 13 checks `'off'`), matching the `NONE` constant above.

3. **Lines 127–128** — `resolveEffective` fallbacks:
   ```typescript
   const level = (config.enforcement?.level || 'none') as EnforcementLevel;
   const preset = PRESETS[level] || PRESETS.none;
   ```

4. **Lines 147–148** — `isValidLevel`:
   ```typescript
   function isValidLevel(l: string): l is EnforcementLevel {
     return l === 'strict' || l === 'balanced' || l === 'minimal' || l === 'none';
   }
   ```

5. **Line 173** — tool schema enum:
   ```typescript
   enum: ['strict', 'balanced', 'minimal', 'none'],
   ```

6. **Lines 205, 216, 223, 279** — update `activeLevel` fallbacks, `presetLevels` array, and error string to include `'none'`:
   - `|| 'minimal'` → `|| 'none'` (two occurrences)
   - `presetLevels: ['strict', 'balanced', 'minimal']` → `presetLevels: ['strict', 'balanced', 'minimal', 'none']`
   - error string: `"Must be one of: strict, balanced, minimal"` → `"Must be one of: strict, balanced, minimal, none"`

### A-6: `packages/paradigm/src/commands/shift.ts`

In the success block (around lines 665–675) where the current enforcement level is surfaced to the user,
update `'balanced'` reference to `'none'` if present. Add awareness line:
```typescript
out(chalk.dim('  Enforcement: none — symbol tracking available when you\'re ready. Rune will guide you.'));
```

---

## Part B — Rune Promotion State Machine

### B-1: New file `packages/paradigm-mcp/src/utils/rune-promotion.ts`

```typescript
/**
 * Rune Promotion State Machine
 *
 * Detects behavioral signals that suggest a user is ready for symbol tracking,
 * and surfaces a single non-blocking invitation to enable enforcement.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export type PromotionState = 'pending' | 'snoozed' | 'opted-in' | 'never';
export type PromotionResponse = 'minimal' | 'balanced' | 'snooze' | 'never';
export type PromotionSignal =
  | 'symbol-syntax'        // Tier A: user references #component, $flow, ^gate, !signal, ~aspect syntax
  | 'dependency-question'  // Tier A: user asks about package/module dependencies
  | 'auth-question'        // Tier A: user asks about authentication or protected routes
  | 'feature-named'        // Tier B: user names a discrete feature ("the checkout feature")
  | 'purpose-mentioned'    // Tier B: user mentions a .purpose file or purpose-driven concept
  | 'multi-file-session';  // Tier B: session has touched 3+ source files

// Tier A signals fire the promotion ask on first occurrence.
// Tier B signals fire the promotion ask after 2+ distinct signals in a session.
const TIER_A: Set<PromotionSignal> = new Set([
  'symbol-syntax',
  'dependency-question',
  'auth-question',
]);

export interface RunePromotionConfig {
  state: PromotionState;
  snoozed_until: string | null;
  snooze_count: number;
  opted_in_level: string | null;
}

const DEFAULT_CONFIG: RunePromotionConfig = {
  state: 'pending',
  snoozed_until: null,
  snooze_count: 0,
  opted_in_level: null,
};

function configPath(rootDir: string): string {
  return path.join(rootDir, '.paradigm', 'config.yaml');
}

export function getRunePromotionState(rootDir: string): RunePromotionConfig {
  const p = configPath(rootDir);
  if (!fs.existsSync(p)) return { ...DEFAULT_CONFIG };
  try {
    const raw = yaml.load(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    const rune = raw?.rune as Record<string, unknown> | undefined;
    const promo = rune?.promotion as Partial<RunePromotionConfig> | undefined;
    return {
      state: (promo?.state as PromotionState) ?? 'pending',
      snoozed_until: (promo?.snoozed_until as string | null) ?? null,
      snooze_count: (promo?.snooze_count as number) ?? 0,
      opted_in_level: (promo?.opted_in_level as string | null) ?? null,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function recordPromotion(rootDir: string, response: PromotionResponse): void {
  const p = configPath(rootDir);
  if (!fs.existsSync(p)) return;
  const raw = yaml.load(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') return;

  const rune = (raw.rune as Record<string, unknown> | undefined) ?? {};
  const promo = (rune.promotion as Record<string, unknown> | undefined) ?? {};

  if (response === 'snooze') {
    // Snooze for 7 days
    const until = new Date();
    until.setDate(until.getDate() + 7);
    promo.state = 'snoozed';
    promo.snoozed_until = until.toISOString().slice(0, 10);
    promo.snooze_count = ((promo.snooze_count as number) ?? 0) + 1;
  } else if (response === 'never') {
    promo.state = 'never';
    promo.snoozed_until = null;
  } else {
    // 'minimal' | 'balanced'
    promo.state = 'opted-in';
    promo.opted_in_level = response;
    promo.snoozed_until = null;
  }

  rune.promotion = promo;
  raw.rune = rune;
  fs.writeFileSync(p, yaml.dump(raw, { lineWidth: -1, noRefs: true, sortKeys: false }), 'utf8');
}

export function shouldPromote(rootDir: string, signals: PromotionSignal[]): boolean {
  const cfg = getRunePromotionState(rootDir);
  if (cfg.state === 'opted-in' || cfg.state === 'never') return false;
  if (cfg.state === 'snoozed' && cfg.snoozed_until) {
    const until = new Date(cfg.snoozed_until);
    if (new Date() < until) return false;
    // Snooze expired — fall through to check signals
  }

  const tierAHit = signals.some(s => TIER_A.has(s));
  if (tierAHit) return true;

  const tierBCount = signals.filter(s => !TIER_A.has(s)).length;
  return tierBCount >= 2;
}

export function buildAskText(): string {
  return [
    '## Symbol Tracking Available',
    '',
    'Paradigm\'s symbol system (#components, $flows, ^gates, !signals, ~aspects) helps document and enforce',
    'architecture across sessions. Enforcement is currently set to **none** — all checks are off.',
    '',
    'Would you like to enable symbol tracking?',
    '',
    '**Options:**',
    '- `minimal` — warnings only, no blocking. Good starting point.',
    '- `balanced` — blocks on missing purpose files, warns on everything else.',
    '- `snooze` — ask me again in 7 days.',
    '- `never` — don\'t ask again.',
    '',
    'Call `paradigm_compliance_promote` with your choice, or just tell me which you prefer.',
  ].join('\n');
}
```

Config shape written to `.paradigm/config.yaml` when `recordPromotion` is called (section added to existing
config, never overwrites other keys):
```yaml
rune:
  promotion:
    state: pending          # pending | snoozed | opted-in | never
    snoozed_until: null     # ISO date string or null
    snooze_count: 0
    opted_in_level: null    # 'minimal' | 'balanced' | null
```

### B-2: New MCP tool `paradigm_compliance_promote`

Add to `packages/paradigm-mcp/src/tools/enforcement.ts`.

**Tool definition** (add to the definitions array):
```typescript
{
  name: 'paradigm_compliance_promote',
  description: 'Record a user\'s response to Rune\'s enforcement-level promotion offer. Call this after presenting the symbol-tracking invitation. Response \'minimal\' or \'balanced\' enables enforcement at that level; \'snooze\' defers for 7 days; \'never\' suppresses the offer permanently.',
  inputSchema: {
    type: 'object',
    properties: {
      response: {
        type: 'string',
        enum: ['minimal', 'balanced', 'snooze', 'never'],
        description: 'User\'s chosen response to the promotion offer',
      },
    },
    required: ['response'],
  },
},
```

**Tool handler** (add to the tool handler dispatch):
```typescript
case 'paradigm_compliance_promote': {
  const response = (input.response as string) as PromotionResponse;
  const { recordPromotion } = await import('../utils/rune-promotion.js');
  recordPromotion(ctx.rootDir, response);

  if (response === 'minimal' || response === 'balanced') {
    // Also apply enforcement level change
    // (reuse existing setLevel logic)
    await applyEnforcementLevel(ctx, response);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          message: `Symbol tracking enabled at "${response}". Rune is now active.`,
          level: response,
        }),
      }],
    };
  }

  if (response === 'snooze') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          message: 'Got it — I\'ll ask again in 7 days.',
          state: 'snoozed',
        }),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ok: true,
        message: 'Understood. I won\'t bring this up again.',
        state: 'never',
      }),
    }],
  };
}
```

Note: `applyEnforcementLevel` is a helper that reads config.yaml, sets `enforcement.level`, and rewrites the
file — extract this from the existing `configure` handler to avoid duplication.

### B-3: Rune ROLE_PROMPTS update in `packages/paradigm-mcp/src/tools/orchestration.ts`

Append the following section to the end of `ROLE_PROMPTS.compliance` (after "## What You NEVER Do"):

```
## Promotion Protocol

When the user's messages contain any of the following signals AND enforcement is currently "none":
- They reference `#component`, `$flow`, `^gate`, `!signal`, or `~aspect` syntax
- They ask about dependencies between modules or packages
- They ask about authentication, authorization, or route protection
- The session has touched 3 or more source files
- They name a discrete feature ("the checkout feature", "the auth flow")

**Your Action:**
1. Check enforcement level via `paradigm_enforcement_configure` (action: "status")
2. If level is "none" AND `shouldPromote` conditions are met, present the invite text from `buildAskText()`
3. Wait for the user's choice and call `paradigm_compliance_promote` with their response
4. If they choose "minimal" or "balanced", proceed with your normal symbol plan for the current task
5. If they choose "snooze" or "never", continue the session without further mention

**Self-regulate:** Fire this promotion at most ONCE per session. Do not re-ask if already presented.
```

### B-4: Session guard in `packages/paradigm-mcp/src/tools/enforcement.ts`

Add module-level set to prevent promotion from firing twice in a session:
```typescript
// Module-level session guard — prevents Rune's promotion ask from firing twice per session
export const enforcementConfiguredThisSession = new Set<string>();
```

At the top of the `paradigm_enforcement_configure` handler:
```typescript
enforcementConfiguredThisSession.add(ctx.rootDir);
```

Rune's promotion logic (in orchestration.ts ROLE_PROMPTS) should check this guard by:
1. Calling `paradigm_enforcement_configure` action:"status" first — this add to the set
2. The first call serves as both status check AND session-guard registration

---

## Part C — Sub-phase Build Order for Builder

### Phase 0 — Types (no deps)
- `packages/paradigm/src/core/enforcement/types.ts`: add `'none'` to union

### Phase 1 — Core enforcement package (depends on Phase 0)
- `packages/paradigm/src/core/enforcement/presets.ts`: add NONE constant, update PRESETS + isValidLevel
- `packages/paradigm/src/core/enforcement/loader.ts`: change DEFAULT_LEVEL to `'none'`
- `packages/paradigm/src/core/enforcement/writer.ts`: change seed values to `'none'`

### Phase 2 — MCP enforcement (depends on Phase 0)
- `packages/paradigm-mcp/src/tools/enforcement.ts`: add `none` to type/PRESETS/guards/schema/fallbacks
- `packages/paradigm-mcp/src/utils/rune-promotion.ts`: create new file
- Add `paradigm_compliance_promote` tool to enforcement.ts

### Phase 3 — Orchestration + CLI (depends on Phase 2)
- `packages/paradigm-mcp/src/tools/orchestration.ts`: append Promotion Protocol to Rune role prompt
- `packages/paradigm/src/commands/shift.ts`: update success message + awareness line

---

## Acceptance Criteria

1. `paradigm_enforcement_configure` action:"status" returns `level: "none"` for a fresh project
2. `paradigm_enforcement_configure` action:"configure" with `level: "none"` succeeds
3. `paradigm_enforcement_configure` returns `presetLevels: ["strict", "balanced", "minimal", "none"]`
4. A fresh `paradigm shift` produces a config.yaml with `enforcement.level: none`
5. `paradigm_compliance_promote` with `response: "minimal"` writes both the promotion state AND the enforcement level change
6. `paradigm_compliance_promote` with `response: "snooze"` writes `state: snoozed` + future date in `snoozed_until`
7. `paradigm_compliance_promote` with `response: "never"` writes `state: never` and stops all future promotion offers
8. Existing projects with `level: minimal` in their config.yaml continue to work (no regression)
9. Stop hook does not fire for any check when `level: none`
