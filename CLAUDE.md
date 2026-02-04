# a-paradigm - Claude Context

> **Paradigm v1.0** | For Claude Code, Claude API, and Claude-native interfaces

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
```

## Agent Onboarding

**First Session:**
1. Call `paradigm_status` for project overview
2. Read `.paradigm/config.yaml` for conventions
3. Check if `portal.yaml` exists (for auth gates)

**Before Each Task:**
1. `paradigm_wisdom_context` for symbols you'll modify
2. `paradigm_ripple` to check impact
3. `paradigm_history_fragility` for stability warnings

## Symbol System

Use these prefixes in documentation and commits:

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

## First Actions for New Sessions

1. **Orient:** Call `paradigm_status` to see project overview and available symbols
2. **Verify:** Check `.paradigm/config.yaml` for discipline and conventions
3. **Locate:** Use `paradigm_navigate` with "context" intent for your task
4. **Review:** Read the nearest `.purpose` file before making changes
5. **Check:** Call `paradigm_gates_for_route` before adding API endpoints

## Context Discovery

**Before making changes:**

1. Check `.paradigm/config.yaml` for project configuration
2. Read the `.purpose` file in the directory you're modifying
3. Check `portal.yaml` if touching authentication
4. Check `.paradigm/docs/patterns.md` for coding patterns

## Paradigm Navigation

Before exploring this codebase:

1. Read `.paradigm/navigator.yaml` for structure map
2. Query by symbol - lookup paths directly
3. Respect skip patterns (node_modules, dist, etc.)

### Exploration Protocol

**INSTEAD OF:** Broad exploration (expensive token usage)

**DO THIS:**
1. Read `.paradigm/navigator.yaml` for structure map
2. Find relevant symbol → go to path
3. Read only needed files

### Task Recipes

**Adding a feature:**
1. Check `navigator.yaml` → `structure.features.paths`
2. Read existing feature as template
3. Create in same location

**Modifying a component:**
1. Look up symbol in `navigator.yaml` → `symbols`
2. Go directly to the path
3. Check `paradigm_ripple` for impact

**Using MCP Tools:**
- `paradigm_navigate({ intent: "find", target: "@checkout" })` - locate symbol
- `paradigm_navigate({ intent: "explore", target: "auth" })` - browse area
- `paradigm_navigate({ intent: "context", task: "add login" })` - task context

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

## MCP Workflow Protocol

**Query before modifying** - Use MCP tools for token-efficient, fresh data:

| Before doing this... | Call this tool |
|---------------------|----------------|
| Modifying a symbol | `paradigm_ripple` with the symbol |
| Understanding code | `paradigm_navigate` with explore intent |
| Checking dependencies | `paradigm_related` for connections |
| Getting oriented | `paradigm_status` for project overview |

**Benefits**: ~100 tokens per query vs ~2000 for reading files. Always fresh data from live index.

## Token Budget Reference

| Operation | Typical Tokens | Use When |
|-----------|---------------|----------|
| `paradigm_status` | ~100 | Starting a session |
| `paradigm_search` | ~150 | Looking for symbols |
| `paradigm_navigate` | ~200 | Finding code locations |
| `paradigm_ripple` | ~300 | Before modifying symbols |
| `paradigm_gates_for_route` | ~150 | Adding API endpoints |
| File read (small) | ~500 | Need exact code |
| File read (large) | ~2000+ | Avoid if possible |
| Full .purpose + config | ~1500 | Initial orientation |

**Tip**: Prefer MCP queries over file reads. Check `paradigm_session_stats` for actual usage.

### When to Use MCP vs File Reads

| Need | Use MCP | Use File Read |
|------|---------|---------------|
| Find symbol | `paradigm_navigate` | Never |
| Check impact | `paradigm_ripple` | Never |
| Read implementation | MCP first | Then specific file |
| Write code | N/A | Existing patterns |
| Check team wisdom | `paradigm_wisdom_context` | Never |

**Rule**: MCP for discovery, files for implementation.

## MCP Resources (On-Demand Content)

Reference content is served via MCP resources instead of being stored locally:

| Resource | URI | Content |
|----------|-----|---------|
| Prompts | `paradigm://prompts` | Task templates (add-feature, refactor, etc.) |
| Commands | `paradigm://docs/commands` | CLI command reference |
| Queries | `paradigm://docs/queries` | jq query examples |
| Disciplines | `paradigm://specs/disciplines` | Symbol mappings by domain |
| Scan | `paradigm://specs/scan` | Visual discovery protocol |

**Usage**: Read resources with `paradigm://prompts/{name}` (e.g., `paradigm://prompts/add-feature`).

**Session Tracking**: Call `paradigm_session_stats` to see token usage and cost breakdown.

## Directory Structure

`.purpose` files exist in:
- `src/*`
- `lib/*`
- `packages/*`

## Paradigm Logging

**IMPORTANT:** Use the Paradigm logger instead of raw console.log/print.

```
// Use this pattern:
log.feature('@login').info('Starting login', { email });
log.component('#database').debug('Query executed', { duration });
log.gate('^authenticated').warn('Access denied', { userId });
log.signal('!login-success').info('User authenticated');
```

### Symbol Mapping by Directory

| Directory | Symbol | Logger Method |
|-----------|--------|---------------|
| `features/**` | `@` | `log.feature()` |
| `routes/**` | `@` | `log.feature()` |
| `api/**` | `@` | `log.feature()` |
| `endpoints/**` | `@` | `log.feature()` |
| `commands/**` | `@` | `log.feature()` |
| `models/**` | `@` | `log.feature()` |
| `components/**` | `#` | `log.component()` |
| `lib/**` | `#` | `log.component()` |
| `utils/**` | `#` | `log.component()` |
| `services/**` | `#` | `log.component()` |
| `core/**` | `#` | `log.component()` |
| `drivers/**` | `#` | `log.component()` |
| `systems/**` | `#` | `log.component()` |
| `middleware/**` | `^` | `log.gate()` |
| `auth/**` | `^` | `log.gate()` |
| `guards/**` | `^` | `log.gate()` |
| `policies/**` | `^` | `log.gate()` |
| `stores/**` | `%` | `log.state()` |
| `state/**` | `%` | `log.state()` |
| `reducers/**` | `%` | `log.state()` |
| `config/**` | `%` | `log.state()` |
| `events/**` | `!` | `log.signal()` |
| `handlers/**` | `!` | `log.signal()` |
| `listeners/**` | `!` | `log.signal()` |
| `hooks/**` | `!` | `log.signal()` |
| `flows/**` | `$` | `log.flow()` |
| `sagas/**` | `$` | `log.flow()` |
| `workflows/**` | `$` | `log.flow()` |
| `pipelines/**` | `$` | `log.flow()` |
| `integrations/**` | `&` | `log.integration()` |
| `external/**` | `&` | `log.integration()` |
| `vendors/**` | `&` | `log.integration()` |

See `.paradigm/specs/logger.md` for full specification.

## Conventions

- Use kebab-case for all symbol IDs (feature-name, not featureName)
- Document flows when logic spans 3+ components
- Reference related items using symbol prefixes (@ # $ % ~ ^ ! ?)
- Add descriptions to all features and portals
- Update .purpose files when changing feature behavior
- Keep portals minimal - one responsibility per portal
- Use signals for side effects, not direct state mutations
- ALWAYS use Paradigm logger, NEVER raw console.log/print

## When to Update Paradigm Files

- When adding a feature, create/update the nearest .purpose file
- When adding authorization, update portal.yaml
- When exploring ideas, use ?symbol prefix
- Always update references when renaming symbols

## Commit Messages

Use symbols in commits:
```
feat(@feature): add new capability

- Add @feature-name view
- Create #component-name
- Emit !signal-name on success
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Symbol not found" | Run `paradigm scan` to rebuild index |
| "Navigator not found" | Run `paradigm scan` to generate navigator.yaml |
| Empty search results | Check that .purpose files define symbols |
| High context usage | Call `paradigm_handoff_prepare` |
| Gate suggestions missing | Check that portal.yaml exists and defines gates |

## Maintaining Paradigm Files

**After completing code changes, update Paradigm files if needed:**

| Change Type | Action Required |
|-------------|-----------------|
| Add feature | Create `.purpose` in feature directory |
| Add route with auth | Update `portal.yaml` with gates |
| Add signal/event | Add to emitting feature's `.purpose` |
| Add multi-step flow | Document as `$flow` in `.purpose` |
| Rename/delete symbol | Update all `.purpose` references |
| Learn antipattern | Add to `.paradigm/wisdom/antipatterns.yaml` |

**Validation**: Run `paradigm doctor` to check for inconsistencies.

See `.paradigm/docs/ai-maintenance-protocol.md` for detailed guidance.

---

*See `.cursorrules` for IDE-specific instructions, `.paradigm/specs/` for detailed specifications.*