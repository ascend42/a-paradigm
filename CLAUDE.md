# a-paradigm - Claude Context

> **Paradigm v2.0** | For Claude Code, Claude API, and Claude-native interfaces
>
> **Author:** Matt Canoy ([@ascend42](https://github.com/ascend42)) | **Repo:** [github.com/ascend42/a-paradigm](https://github.com/ascend42/a-paradigm) | **npm:** [@a-company/paradigm](https://www.npmjs.com/package/@a-company/paradigm) | **Plugin:** `paradigm` via Claude Code marketplace

## Project Overview

This project uses Paradigm for structured AI-assisted development.
All context, symbols, and specifications live in the .paradigm/ directory.


## Quick Orientation

```
.paradigm/config.yaml  → Project configuration
.paradigm/specs/       → Detailed specifications
.paradigm/docs/        → Commands, patterns, troubleshooting
.cursorrules           → IDE instructions (if using Cursor)
portal.yaml            → Security/auth definitions
.paradigm/lore/        → Project timeline and history
```

## Symbol System

Use these prefixes in documentation and commits:

| Symbol | Meaning | Example |
|--------|---------|---------|
| `#` | Component | `#checkout` |
| `$` | Flow | `$checkout-flow` |
| `^` | Gate | `^authenticated` |
| `!` | Signal | `!login-success` |
| `~` | Aspect | `~audit-required` |

## Conventions

- Use kebab-case for all symbol IDs (feature-name, not featureName)
- Document flows when logic spans 3+ components
- Reference related items using symbol prefixes (# $ ^ ! ~)
- Add descriptions to all components and gates
- Update .purpose files when changing feature behavior
- Keep gates minimal - one responsibility per gate
- Use signals for side effects, not direct state mutations
- **Logging:** Library code (packages/paradigm-mcp, packages/sentinel, etc.) — use Paradigm logger, never console.log
- **CLI output:** CLI commands (packages/paradigm/src/commands/) — use `cli-output.ts` helpers (`out()`, `success()`, `warn()`, `error()`, `dim()`, `header()`, `kv()`, `json()`) for user-facing output. Raw console.log is acceptable but helpers are preferred for consistency

## Commit Messages

Use v2 symbols in commits for history tracking:

### Format
```
type(#primary-symbol): short description

- Detail with #component references
- Gate changes: ^gate-name
- Signals emitted: !signal-name

Symbols: #symbol-a, #symbol-b, !signal-c
```

### Convention
- **Subject**: `type(#symbol): description` — primary symbol in parens
- **Body**: Reference affected symbols with prefixes (# $ ^ ! ~)
- **Trailer**: `Symbols: #a, #b, !c` — machine-readable list of ALL affected symbols
- The `Symbols:` trailer is parsed by the post-commit hook for automatic history capture

### Examples
```
feat(#payment-form): add Apple Pay support

- Add #apple-pay-button component
- Update $checkout-flow with new payment step
- Emit !payment-method-added signal
- Gate: ^authenticated required

Symbols: #payment-form, #apple-pay-button, $checkout-flow, !payment-method-added
```

## Agent Onboarding

**First session:** Call `paradigm_status` → read `.paradigm/config.yaml` → check `portal.yaml`

**Before each task:** `paradigm_ripple` for impact, `paradigm_gates_for_route` for new endpoints

**Resuming:** Call `paradigm_session_recover`

**Tool names:** Paradigm tools are documented as `paradigm_status`, `paradigm_ripple`, etc. When loaded as a Claude Code plugin, the same tools may appear as `plugin_paradigm_paradigm_status`, `plugin_paradigm_paradigm_ripple`, etc. Both names refer to the same tool — use whichever appears in your available tool list.

**Orchestration modes:** `paradigm_orchestrate_inline` supports two execution models. In Claude Code, agents launch as isolated Task tool contexts (true multi-agent — separate memory per agent). In Cursor and other IDEs without Task tool support, agents run sequentially in the same context (sequential roleplay). The active mode is configured via `orchestration.default_mode` in `agents.yaml` (defaults to `faceted`).

**Adoption contracts:** Agent permission scopes declared in `.agent` files are advisory text injected into agent prompts. They represent intent and guide agent behavior — they are not wired to Claude Code's tool permission system. A "denied" scope is a recommendation, not a hard block. If hard enforcement is required, pair adoption contracts with Claude Code tool permission controls.

## Before Implementing

0. Call `paradigm_protocol_search` — if a protocol matches, follow it
1. Complex task (3+ files)? → `paradigm_orchestrate_inline` mode="plan"
2. Affects symbols? → `paradigm_ripple`
3. Adds endpoints? → `paradigm_gates_for_route`

## Automatic Enforcement (Hooks)

The stop hook **BLOCKS** if source files were modified without .purpose updates.

| Hook | Behavior |
|------|----------|
| **Stop** | Blocks on: missing .purpose, missing portal.yaml gates, stale purposes |
| **Pre-commit** | Auto-rebuilds index — never blocks |
| **Post-write** | Advisory reminder for .purpose coverage |

**Symbol/aspect enforcement is agent-owned.** When the `compliance` archetype agent (Rune) is on the roster, he owns symbol/aspect enforcement; the framework surfaces metrics via `paradigm doctor` but does not block in his absence. Run `paradigm shift` to add Rune to the roster.

**If blocked:** Update .purpose files → update portal.yaml if needed → `paradigm_reindex` → finish

## Maintaining Paradigm Files

**You MUST update Paradigm files when making code changes:**

- Add feature → create `.purpose` in directory
- Add protected route → update `portal.yaml` with gates
- Add signal/event → add to `.purpose`
- Add multi-step flow → document as `$flow`
- Rename/delete symbol → update all references
- Record lore via `paradigm_lore_record` for sessions modifying 3+ files
- Use Paradigm logger (`log.component()`, `log.gate()`, etc.) for library code — never raw console.log
- Use `cli-output.ts` helpers for CLI command output (see `packages/paradigm/src/utils/cli-output.ts`)

**Auth requires portal.yaml** if your code has JWT, role checks, ownership checks, or protected endpoints.

## Framework-Bug Protocol

If an MCP tool gives unexpected output and you can identify the cause is in framework code (not project state), surface it via the framework-bug protocol — do NOT hand-edit project files to work around the bug.

**When to file:**
- An MCP write tool succeeds but the corresponding read tool reports the data as missing/wrong
- An MCP tool's behavior contradicts its documented contract
- You can name TWO code locations: a writer file:line and a reader file:line that demonstrate the divergence

**How to file (Option α, current):**
```
paradigm_task_create({
  blurb: "FRAMEWORK BUG: <one-line summary>. Writer at <file:line>; reader at <file:line>; symptom: <what user/agent sees>",
  priority: "high",
  tags: ["framework-bug", "<#affected-tool>", "<archetype-domain>"]
})
```

**Coming in v6.1:** soft-block primitive (`paradigm_propose_block` with `claimant: 'framework'`) will let agents surface framework bugs as soft-blocks that persist across sessions until upstream fixes. See `.paradigm/research/path-bug-and-agent-protocol-analysis.md` §3.

**Domain ownership** (per agent-owned enforcement, TD-2026-04-25-417):
- Compliance tool bugs (`paradigm_aspect_check`, `paradigm_drift_*`) → Rune triages
- Security tool bugs (`paradigm_portal_*`) → Aegis triages
- Learning tool bugs (`paradigm_notebook_*`) → Scholar/Loid co-triage
- Navigation tool bugs (`paradigm_status`, `paradigm_navigate`) → Cid triages
- Other → first archetype to surface owns triage

**Calibration gate:** without writer file:line + reader file:line evidence, downgrade the report to a plain task (no `framework-bug` tag). Same evidentiary bar a human bug report would clear.

## Agent-Owned Soft-Blocks (v6.1)

When you (an archetype agent — Rune, Aegis, Jinx, etc.) detect a condition the user should resolve before continuing, call `paradigm_propose_block`. The Stop hook reads `.paradigm/remediations/` and will refuse-with-override on your next run if `severity: guard`.

**When to call:**
- Coverage drop on a tracked aspect (Rune)
- Missing portal gate on a new endpoint (Aegis)
- Symbol drift you cannot auto-heal (Rune)
- Edge case the user agreed to handle but hasn't (Jinx)

**Do NOT call for:**
- Things you can fix yourself (do that instead)
- Things only the user can decide and that don't block correctness (use a wisdom note)
- Nag-loops on the same scope (cap at one active remediation per concern)

**Severity guidance:**
- `advise` — informational stderr line, no block. FYI-class findings.
- `auto-author` — same as advise at v6.1; signals you intend to author the fix.
- `guard` — hard block. Use sparingly. User must `paradigm override <id>` to proceed.

**Example invocation** — Rune detects #payment-form imports stripe but lacks an aspect:
```
paradigm_propose_block({
  claimant: 'compliance',
  severity: 'guard',
  reason: '#payment-form imports stripe → suggested ~payment-pii aspect',
  unblock_hint: 'Add ~payment-pii to packages/web/src/components/payment-form/.purpose, OR run `paradigm aspect stub-create rmd-<id>`'
})
```

The user can:
- `paradigm override <id>` — interactive escape hatch (clears the remediation, archives YAML, writes event)
- `PARADIGM_OVERRIDE=<id> <cmd>` — one-shot scripted escape (no archive, just session-scoped skip)
- Resolve the underlying issue and re-run

Override events written to `.paradigm/events/overrides.jsonl` for Loid's calibration pass — if you generate too many overrides, Loid will surface your block as noise. **Self-regulate.**

**Coming in v6.2:** JSONLogic predicates for `unblock_hint` (auto-clears when condition met), per-archetype override-cluster auto-coaching, durable scope opt-out via `paradigm_optout_register`. v6.1 ships plain-string hints + manual override only.

## On-Demand Guidance

Detailed guidance is available via MCP resources — load only what you need:

| Topic | Resource |
|-------|----------|
| Logging rules & directory mapping | `paradigm://guidance/logging` |
| Portal protocol & gate patterns | `paradigm://guidance/portal` |
| MCP workflow & token budgets | `paradigm://guidance/mcp-workflow` |
| Flow-first development | `paradigm://guidance/flows` |
| Multi-agent orchestration | `paradigm://guidance/orchestration` |
| Workspaces (multi-project) | `paradigm://guidance/workspaces` |
| University (multi-tenant content packs + sections) | `paradigm://guidance/university` |
| Confidence calibration | `paradigm://guidance/calibration` |
| Session checkpoints | `paradigm://guidance/checkpoints` |
| Navigation & task recipes | `paradigm://guidance/navigation` |
| Component types & hierarchy | `paradigm://guidance/component-types` |
| Troubleshooting | `paradigm://guidance/troubleshooting` |

**User-facing guides** (in `docs/guides/`):

| Guide | When to read |
|-------|--------------|
| [`quick-start.md`](./docs/guides/quick-start.md) | First-time install + setup |
| [`mcp-setup.md`](./docs/guides/mcp-setup.md) | MCP server configuration per IDE |
| [`agents.md`](./docs/guides/agents.md) | Roster, onboard, bench/activate, install agents |
| [`decisions.md`](./docs/guides/decisions.md) | `paradigm_decision_record` + the post-v6.0 decision store |
| [`v6-migration.md`](./docs/guides/v6-migration.md) | Upgrading from v5.x; the six breaking changes |
| [`university.md`](./docs/guides/university.md) | Multi-tenant content packs + PLSAT |
| [`sentinel-upgrade.md`](./docs/guides/sentinel-upgrade.md) | Sentinel incident-tracking upgrade |
| [`symphony-quickstart.md`](./docs/guides/symphony-quickstart.md) | Symphony multi-agent relay |

## Directory Structure

`.purpose` files exist in:
- `packages/*`
- `apps/*`

---

*See `.paradigm/specs/` for specifications. Run `paradigm sync` to regenerate.*