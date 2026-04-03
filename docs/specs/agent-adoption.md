# Agent Adoption Contracts & Scoped Permissions

> **Status:** Approved by team — awaiting implementation | **Priority:** P0 | **Target:** v5.34.0+
>
> Agents declare capabilities as scoped permissions. Users adopt agents with informed consent. `paradigm shift` guarantees all core files exist. Post-shift recommendations surface what needs attention. Updates use EULA-style scope diffs for quick approval.

## North Star

You run `paradigm shift` in a new Next.js project. Shift detects the project type, creates every core file, and presents your agent team in a batch summary: 8 core agents + 2 detected ecosystem agents (typescript, web). Each shows its role and default scopes. You hit Enter to accept all defaults. Shift writes the adoption records, creates smart-default agent profiles, and outputs 3 recommendations: edit `.purpose`, configure security deny-paths, verify with `paradigm doctor`.

Later, you install a marketplace agent from nevr.land: `paradigm agents install @taxco/tax-optimizer`. It shows its 4 scoped permissions (read:financial-data, tool:calculator, tool:web-search, read:bank-statements) with plain-English descriptions. You approve with `y`. The adoption is recorded.

A week later, the tax agent ships v1.3.0 with a new scope: `write:reports`. Your terminal shows the diff — 1 new scope, 3 unchanged. You approve in 2 seconds. The agent runs with updated permissions.

## Architecture

```
paradigm shift (first run)
    │
    ├── Step 1: Init (.paradigm/, config.yaml)
    ├── Step 2a: Detect project type
    ├── Step 2b: Suggest agent team
    ├── Step 2c: Agent adoption ceremony ◄── NEW
    │     ├── Batch summary: core agents + detected ecosystem agents
    │     ├── Show roles, scopes, defaults
    │     ├── User accepts (Enter) or reviews individually
    │     └── Write adoptions.yaml + roster.yaml
    ├── Step 2d: Create agent profiles ◄── ENHANCED
    │     ├── Smart defaults (role + project-type-specific focus/deny)
    │     └── Only for detected ecosystems, not all possible agents
    ├── Step 2e: Ensure guaranteed files ◄── NEW
    │     └── 31 files/dirs — skeletal YAML, empty JSONL
    ├── Step 3-5: Models, hooks, sync (existing)
    └── Step 6: Post-shift recommendations ◄── NEW
          └── Conditional, max 3-4 items, copy-paste commands

paradigm agents install @scope/agent (marketplace)
    │
    ├── Fetch manifest from nevr.land
    ├── Present adoption card (scopes, capabilities, pricing)
    ├── User approves scopes (y/n)
    └── Write to adoptions.yaml, create local .agent file

Agent update (v1 → v2)
    │
    ├── Detect scope diff (new / expanded / removed)
    ├── Show diff (only changed scopes)
    ├── Auto-approve if scopes unchanged
    └── User approves new scopes (y/n)
```

## Scoped Permissions Model

> **Advisory only.** Scoped permissions are text instructions injected into agent prompts. They guide agent behavior but are not wired to Claude Code's tool permission system. A "denied" scope is a recommendation, not a technical block. Pair with Claude Code tool permission controls if hard enforcement is required.

### Scope Categories

5 coarse categories. Agents declare which they need. Users approve the bundle.

| Category | Prefix | Description | Examples |
|----------|--------|-------------|---------|
| **Read** | `read:` | File/data read access | `read:source`, `read:config`, `read:financial-data` |
| **Write** | `write:` | File/data write access | `write:source`, `write:tests`, `write:reports` |
| **Tool** | `tool:` | MCP/CLI tool access | `tool:bash`, `tool:web-search`, `tool:calculator` |
| **Network** | `net:` | Network access | `net:api-calls`, `net:web-search` |
| **Execute** | `exec:` | Shell/process execution | `exec:tests`, `exec:build`, `exec:install-packages` |

### Scope Declaration in `.agent` Files

```yaml
# In .agent profile
scopes:
  version: "1.0.0"
  approved: "2026-03-31"       # ISO date of last user approval

  permissions:
    - id: read:source
      description: Read source code files
    - id: write:source
      description: Modify source code files
    - id: tool:bash
      description: Execute shell commands
    - id: exec:tests
      description: Run test suites

  dangerous:                    # Require runtime confirmation
    - exec:install-packages
    - write:config
```

### Scope Diff on Updates

When an agent version bumps and scopes change:

```
  Updating builder v1.0.0 → v1.1.0...

  Scope changes:
  ─────────────────────────────────────────────────
    [kept]  read:source             Read source code files
    [kept]  write:source            Modify source code files
  + [new]   write:migrations        Write database migrations
  + [new]   exec:install-packages   Install npm/pip packages

  Accept new scopes? (y/n): _
```

**Auto-approve rule:** If `scopes.version` changes but all scope IDs are the same (only descriptions updated), auto-approve silently. Only NEW or REMOVED scope IDs require user approval.

### Approval States

| State | Behavior |
|-------|----------|
| `approved` | Agent runs with declared scopes. `scopes.approved` has a date. |
| `pending` | Scopes changed, not yet approved. Agent runs with PREVIOUS approved scopes. |
| `denied` | User explicitly denied. Agent remains on previous version's scopes. |

### Non-Interactive Environments

When no TTY is available (CI, background agents):
- Pending scope changes written to `.paradigm/.pending-scope-reviews`
- Agent runs with previous approved scopes (never blocked)
- User reviews on next interactive session via `paradigm agent review`

## Adoption Records

### `.paradigm/adoptions.yaml`

Single source of truth for all adopted agents — core and marketplace.

```yaml
version: "1.0"
adopted-at: "2026-03-31T14:00:00Z"
project-type: web-app

agents:
  # Core agents — batch adopted during paradigm shift
  architect:
    adopted: "2026-03-31T14:00:00Z"
    source: core
    defaults-accepted: true

  security:
    adopted: "2026-03-31T14:00:00Z"
    source: core
    defaults-accepted: false
    overrides:
      vulnerability-threshold: high

  # Ecosystem agents — auto-detected by shift
  typescript:
    adopted: "2026-03-31T14:00:00Z"
    source: ecosystem
    detected-from: ["package.json", "tsconfig.json"]
    defaults-accepted: true

  # Marketplace agents — individually adopted
  "@taxco/tax-optimizer":
    adopted: "2026-04-01T09:00:00Z"
    source: marketplace
    version: "1.3.0"
    defaults-accepted: true
    scopes-approved: "2026-04-01T09:00:00Z"
```

### Relationship to `roster.yaml`

`adoptions.yaml` is the authoritative record. `roster.yaml` is derived from it — an agent with an adoption record is on the roster. During migration, existing `roster.yaml` entries generate adoption records with `defaults-accepted: true`.

## Agent Configurable Behaviors

### Declaration in `.agent` Files

Each agent declares its configurable behaviors with types, defaults, and descriptions:

```yaml
configurable:
  write-university-notes:
    type: boolean
    default: false
    description: Write knowledge notes to .paradigm/university/

  review-depth:
    type: enum
    values: [quick, standard, thorough]
    default: standard
    description: How deeply to review code changes

  auto-reindex:
    type: boolean
    default: true
    description: Automatically rebuild index after updates
```

### User Overrides

Users override defaults in `adoptions.yaml` under the `overrides` key. Only deviations from defaults are stored.

### Runtime Injection

`buildProfileEnrichment()` reads the agent's effective configuration (declared defaults + user overrides) and injects a `## Project Preferences` section into the agent's orchestration prompt. Only non-default values are injected to save tokens.

## Shift Guaranteed Files

After `paradigm shift` completes, ALL of these files/directories MUST exist. Creation is idempotent — re-running shift never overwrites existing content.

### Core Structure

| Path | Default Content |
|------|----------------|
| `.paradigm/config.yaml` | Project config (existing) |
| `.paradigm/agents.yaml` | Agent manifest (existing) |
| `.paradigm/roster.yaml` | Active roster (existing) |
| `.paradigm/adoptions.yaml` | Adoption records (NEW) |
| `.paradigm/team-state.yaml` | Team state (existing) |
| `.paradigm/fixtures.yaml` | Test fixtures (existing) |
| `.paradigm/navigator.yaml` | Navigation index (existing) |
| `.paradigm/flows.yaml` | Flow definitions — skeletal |
| `.paradigm/tags.yaml` | Tag index — skeletal |
| `.paradigm/habits.yaml` | Habits index — skeletal |
| `.paradigm/graduation.yaml` | Graduation tracking — skeletal |
| `portal.yaml` | Security gates (existing) |
| `.purpose` | Root purpose (existing) |
| `.premise` | Project premise (existing) |

### Event Streams

| Path | Default Content |
|------|----------------|
| `.paradigm/events/stream.jsonl` | Empty file |
| `.paradigm/events/nominations.jsonl` | Empty file |
| `.paradigm/events/debates.jsonl` | Empty file |
| `.paradigm/events/notebook-refs.jsonl` | Empty file |
| `.paradigm/events/session-log.jsonl` | Empty file |

### History & Knowledge

| Path | Default Content |
|------|----------------|
| `.paradigm/history/index.yaml` | Skeletal `{ version: "1.0", entries: [] }` |
| `.paradigm/history/log.jsonl` | Empty file |
| `.paradigm/lore/timeline.yaml` | Skeletal `{ version: "1.0", entries: [] }` |
| `.paradigm/wisdom/antipatterns.yaml` | Skeletal `{ version: "1.0", antipatterns: [] }` |
| `.paradigm/personas/index.yaml` | Skeletal `{ version: "1.0", personas: {} }` |
| `.paradigm/protocols/index.yaml` | Skeletal `{ version: "1.0", protocols: [] }` |
| `.paradigm/notebooks/` | Empty directory |

### University

| Path | Default Content |
|------|----------------|
| `.paradigm/university/config.yaml` | University config (existing) |
| `.paradigm/university/index.yaml` | Skeletal index |
| `.paradigm/university/content/notes/` | Empty directory |
| `.paradigm/university/content/policies/` | Empty directory |
| `.paradigm/university/content/quizzes/` | Empty directory |
| `.paradigm/university/content/paths/` | Empty directory |

### IDE & Hooks

| Path | Default Content |
|------|----------------|
| `CLAUDE.md` | Generated (existing) |
| `AGENTS.md` | Generated (existing) |
| `.cursor/rules/` | IDE rules (existing) |
| `.claude/hooks/` | Hook scripts (existing) |

### Agent Profiles

Created for rostered agents only. **Detected ecosystems only** — do not speculatively create profiles for undetected languages.

Each profile is pre-filled with:
- Role-appropriate defaults from `DEFAULT_PERSONALITIES`
- Project-type-specific focus paths and deny patterns
- Detected ecosystem attention triggers

## Post-Shift Recommendations

Replaces the current hardcoded "Next steps" text. Conditional — only shows what is actually relevant.

### Recommendation Checks

| Check | Condition | Output |
|-------|-----------|--------|
| Empty `.purpose` | Root has default/template content | "Edit `.purpose` to define your project's features" |
| No sub-`.purpose` | No `.purpose` in subdirectories | "Add `.purpose` files to feature directories" |
| Empty `portal.yaml` | Gates and routes both empty | "Define auth gates in `portal.yaml` if your project has auth" |
| Agents unconfigured | Only defaults, no customization | "Review agent roles: `paradigm agent list`" |
| Pending scope reviews | `.pending-scope-reviews` exists | "Review agent scopes: `paradigm agent review`" |
| Model tiers default | Auto-detected defaults only | "Fine-tune model tiers: `paradigm team models`" |
| Workspace available | Parent has workspace, not joined | "Join workspace: `paradigm shift --workspace <name>`" |
| No lore | No lore entries | Informational: "Lore records automatically as you work" |
| No notebooks | Notebooks dir empty | Informational: "Agent notebooks build over time" |

### Output Format

```
  Recommendations
  ─────────────────────────────────────────────────
  1. Edit .purpose            Define your project's features and components
  2. Configure agents         paradigm agent list — review roles and scopes
  3. Verify health            paradigm doctor --verify

  3 items need attention. 31 files ready.
```

- Max 3-4 numbered action items
- Informational items shown as gray text, not numbered
- Each item: short label + copy-paste command or one-line rationale

## Adoption Ceremony UX

### Core Agents (via `paradigm shift`)

Batch summary. One prompt. Opt-out model.

```
  Agent Adoption
  ─────────────────────────────────────────────────
  Detected: SaaS web app (Next.js + Supabase)

  Core team (8):
    architect (Apex)      System design, specifications
    builder (Kit)         Implementation, tests
    reviewer (Judge)      Code quality, compliance
    security (Aegis)      Auth flows, vulnerability scanning
    advocate (Loid)       User perspective, UX quality
    jinx (Jinx)           Stress testing, edge cases
    documentor (Scribe)   .purpose, portal.yaml maintenance
    compliance (Rune)     Symbol compliance enforcement

  Ecosystem (2 detected):
    typescript (TS)       TypeScript/Node.js patterns
    web (Web)             Browser APIs, SEO, PWA

  All using default scopes.
  [Enter] accept all  |  [r] review individually  |  [c] customize
```

### Marketplace Agents (via `paradigm agents install`)

Individual adoption card. Full scope list.

```
  Installing @taxco/tax-optimizer v1.3.0...
  ─────────────────────────────────────────────────

  "Expert tax optimization for US businesses"
  by @taxco | ★ 4.8 (142 reviews) | 2,340 installs

  Scopes requested:
    read:financial-data     Read financial records
    read:bank-statements    Read bank statement files
    tool:calculator         Use calculation tools
    tool:web-search         Search web for tax codes

  Configurable:
    jurisdiction      [US]           (US, UK, EU, CA, AU)
    fiscal-year-end   [12-31]        MM-DD format
    accounting-method [accrual]      (accrual, cash)

  Accept? (y/n): _
```

## PAN v1.0 — Paradigm Agent Norm

The standard for all agents, including Neverland marketplace agents.

| # | Requirement | Level |
|---|-------------|-------|
| PAN-1 | **Declare Behaviors** — agents MUST include `configurable` with types, descriptions, defaults | MUST |
| PAN-2 | **Declare Scopes** — agents MUST include `scopes` with categorized permissions | MUST |
| PAN-3 | **Respect Project Overrides** — agents MUST apply user overrides from adoptions.yaml | MUST |
| PAN-4 | **Fallback Gracefully** — missing preferences use declared defaults, never error | MUST |
| PAN-5 | **No Undeclared Side Effects** — configurable actions require explicit enablement | MUST |
| PAN-6 | **Surface Configuration** — support `paradigm agent show <id> --prefs` for visibility | SHOULD |
| PAN-7 | **Report Applied Preferences** — one-line summary in orchestration output | SHOULD |

Neverland validates PAN-1 and PAN-2 at publish time. Agents without declared behaviors and scopes cannot be published to the marketplace.

## Documentor + University Resolution

The original question that spawned this design:

- **Documentor does NOT write university content.** It flags stale content only (mechanical, haiku-appropriate).
- **University note creation** is gated by the `write-university-notes` configurable behavior (default: `false`).
- When enabled, Educator agent (tier-2, already on roster) handles content creation — not Documentor.
- Users enable via adoption overrides: `overrides: { write-university-notes: true }` on the educator agent.

## CLI Commands

### New Commands

| Command | Description |
|---------|-------------|
| `paradigm agent review [id]` | Review pending scope changes |
| `paradigm agent approve <id>` | Approve current scopes |
| `paradigm agent deny <id>` | Deny update, revert to previous scopes |
| `paradigm agent scopes <id>` | Show current approved scopes |
| `paradigm agent adopt <id>` | Manually adopt an agent post-shift |

### Modified Commands

| Command | Change |
|---------|--------|
| `paradigm shift` | Add adoption ceremony, guaranteed files, recommendations |
| `paradigm agent list` | Show adoption status and scope summary |
| `paradigm agent show <id>` | Show configurable behaviors and effective values |
| `paradigm agents install` | Add scope approval flow |

## Implementation Plan

### Sub-phase 0: Types & Constants

| File | Description |
|------|-------------|
| `packages/paradigm/src/commands/agent/scopes-types.ts` | `AgentScopes`, `ScopeDiff`, `AdoptionRecord`, `ShiftRecommendation` interfaces |
| `packages/paradigm/src/commands/shift-files.ts` | `GUARANTEED_FILES` manifest — all 31+ entries with default content |

### Sub-phase 1: Core Logic

| File | Description |
|------|-------------|
| `packages/paradigm/src/commands/shift-recommendations.ts` | `getRecommendations(cwd)` — conditional checks, sorted output |
| `packages/paradigm/src/commands/agent/scopes.ts` | `diffScopes()`, `formatScopeDiff()`, `approveScopes()`, `denyScopes()` |
| `packages/paradigm/src/commands/agent/adoption.ts` | `loadAdoptions()`, `saveAdoption()`, `renderAdoptionCard()`, `batchAdoptionSummary()` |

### Sub-phase 2: Integration

| File | Change |
|------|--------|
| `packages/paradigm/src/commands/shift.ts` | Guaranteed files step, adoption ceremony, recommendations engine |
| `packages/paradigm/src/commands/agent/index.ts` | Scope handling, new subcommands |
| `packages/paradigm/src/commands/agent/types.ts` | New option types |
| `packages/paradigm/src/index.ts` | Register `agent review`, `agent approve`, `agent deny`, `agent scopes`, `agent adopt` |
| `packages/paradigm-mcp/src/utils/agent-loader.ts` | `buildProfileEnrichment()` injects effective preferences |
| `packages/paradigm-mcp/src/types/agents.ts` | Add `scopes`, `configurable` to `AgentProfile` |

### Sub-phase 3: Agent Profiles

| File | Change |
|------|--------|
| `~/.paradigm/agents/*.agent` | Add `configurable` and `scopes` sections to all core agents |

### Sub-phase 4: Tests

| File | Description |
|------|-------------|
| `packages/paradigm/src/commands/shift-files.test.ts` | Guaranteed files manifest, idempotent creation |
| `packages/paradigm/src/commands/shift-recommendations.test.ts` | Each recommendation check against mock states |
| `packages/paradigm/src/commands/agent/scopes.test.ts` | Scope diffing, approval states, deny logic |
| `packages/paradigm/src/commands/agent/adoption.test.ts` | Adoption CRUD, batch summary, marketplace flow |

## Migration

For existing projects with `.paradigm/`:
1. Shift detects existing `roster.yaml` without `adoptions.yaml`
2. Generates adoption records from roster: each agent gets `defaults-accepted: true`, `adopted: <now>`
3. Existing `.agent` files without `scopes` derive scopes from `permissions` + `focus` fields, auto-approve
4. No user action required — migration is silent and non-breaking

## Open Considerations

1. **Three-layer identity model** (id/nickname/archetype) — consider landing in this release to avoid a second migration for Neverland. If scope is too large, accept the debt.
2. **Ecosystem agent auto-detection** — `paradigm shift` detects languages via `detectProjectType`. Extend to roster ecosystem agents automatically. Only create profiles for detected ecosystems.
3. **Conductor integration** — adoption records and scope status should be visible in Conductor's agent roster view.
