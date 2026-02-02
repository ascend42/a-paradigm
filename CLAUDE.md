# a-paradigm - Claude Context

> **Paradigm v1.0** | For Claude Code, Claude API, and Claude-native interfaces

## Quick Orientation

```
.paradigm/config.yaml  → Project configuration
.paradigm/specs/       → Detailed specifications (symbols, logger, etc.)
.paradigm/docs/        → Commands, patterns, troubleshooting
portal.yaml            → Security/auth definitions
```

## Symbol System

| Symbol | Meaning | Example |
|--------|---------|---------|
| `@` | Feature | `@checkout` |
| `#` | Component | `#Button` |
| `$` | Flow | `$checkout-flow` |
| `%` | State | `%user.authenticated` |
| `^` | Portal | `^auth-required` |
| `!` | Signal | `!login-success` |
| `?` | Idea | `?subscription-model` |
| `~` | Deprecated | `~legacy-api` |
| `&` | Integration | `&stripe` |

See `.paradigm/specs/symbols.md` for full specification.

## Before Making Changes

1. Check `.paradigm/config.yaml` for project configuration
2. Read the `.purpose` file in the directory you're modifying
3. Check `portal.yaml` if touching authentication
4. Check `.paradigm/docs/patterns.md` for coding patterns

## Paradigm Logging

Use the Paradigm logger instead of raw console.log/print:

```
log.feature('@login').info('Starting login', { email });
log.component('#database').debug('Query executed', { duration });
log.gate('^authenticated').warn('Access denied', { userId });
log.signal('!login-success').info('User authenticated');
```

Directory patterns map to symbols: `features/` → `@`, `components/` → `#`, `middleware/` → `^`, etc.

See `.paradigm/specs/logger.md` for full specification.

## AI Agent Systems

| System | Purpose | Spec |
|--------|---------|------|
| **Navigator** | Codebase exploration and context discovery | `.paradigm/specs/navigator.md` |
| **Wisdom** | Project patterns and learned knowledge | `.paradigm/specs/wisdom.md` |
| **History** | Session continuity and change tracking | `.paradigm/specs/history.md` |
| **Context** | Session monitoring and handoff triggers | `.paradigm/specs/context-tracking.md` |

## Context Monitoring Protocol

**Periodically check context usage** by calling `paradigm_context_check` (every 10-15 tool calls or when user asks).

**When recommendation is NOT "continue":**
1. Inform user: "Context usage is at ~X%. Recommend handoff soon."
2. Offer to prepare handoff summary
3. If urgent (>85%), prioritize completing current task then handoff

**To handoff:**
1. Call `paradigm_handoff_prepare` with summary and next steps
2. User runs: `paradigm team handoff --to <agent> --summary "..."`
3. New session accepts with: `paradigm team accept <id>`

## Conventions

- Use kebab-case for all symbol IDs
- Reference related items using symbol prefixes
- Update `.purpose` files when changing feature behavior
- Keep portals minimal - one responsibility per portal
- ALWAYS use Paradigm logger, NEVER raw console.log/print

## Commit Messages

Use symbols in commits:
```
feat(@feature): add new capability

- Add @feature-name view
- Create #component-name
- Emit !signal-name on success
```

---

*See `.paradigm/specs/` for detailed specifications.*
