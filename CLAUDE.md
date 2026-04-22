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
| **Stop** | Blocks on: missing .purpose, missing portal.yaml gates, aspect drift, stale purposes |
| **Pre-commit** | Auto-rebuilds index — never blocks |
| **Post-write** | Advisory reminder for .purpose coverage |

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
| University (multi-tenant content packs) | `paradigm://guidance/university` |
| Confidence calibration | `paradigm://guidance/calibration` |
| Session checkpoints | `paradigm://guidance/checkpoints` |
| Navigation & task recipes | `paradigm://guidance/navigation` |
| Component types & hierarchy | `paradigm://guidance/component-types` |
| Troubleshooting | `paradigm://guidance/troubleshooting` |

## Directory Structure

`.purpose` files exist in:
- `packages/*`
- `apps/*`

---

*See `.paradigm/specs/` for specifications. Run `paradigm sync` to regenerate.*