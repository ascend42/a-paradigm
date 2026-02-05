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

## Portal Protocol (Authorization)

**Portal.yaml is REQUIRED when the project has protected routes.**

### When to Create portal.yaml

Create `portal.yaml` in project root when:
- Adding any endpoint that requires authentication
- Adding role-based access (admin, member, owner)
- Adding resource ownership checks (user can only edit their own data)

### Portal.yaml Structure

```yaml
version: "1.0"
gates:
  ^authenticated:
    description: User must be logged in
    check: req.user != null
  ^project-admin:
    description: User must be admin of the project
    check: project.admins.includes(req.user.id)
  ^comment-author:
    description: User must be the comment author
    check: comment.authorId === req.user.id

routes:
  "GET /api/projects/:id": [^authenticated, ^project-member]
  "PUT /api/projects/:id": [^authenticated, ^project-admin]
  "DELETE /api/comments/:id": [^authenticated, ^comment-author]
```

### When Adding New Endpoints

**ALWAYS update portal.yaml when adding routes:**

1. Call `paradigm_gates_for_route` to get suggestions
2. Add the route to portal.yaml with required gates
3. Implement the gate checks in your middleware/code
4. Test that unauthorized access returns 403

### Common Gate Patterns

| Pattern | Gate Name | Description |
|---------|-----------|-------------|
| Any logged-in user | `^authenticated` | Basic auth check |
| Resource membership | `^{resource}-member` | User is member of resource |
| Resource admin | `^{resource}-admin` | User is admin of resource |
| Resource owner | `^{resource}-owner` | User owns the resource |
| Author only | `^{resource}-author` | User created the resource |

## Context Discovery

**Before making changes:**

1. Check `.paradigm/config.yaml` for project configuration
2. Read the `.purpose` file in the directory you're modifying
3. Check `portal.yaml` for existing auth gates
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

## Multi-Agent Orchestration

Paradigm supports multi-agent orchestration via `paradigm team` commands:

### Commands

| Command | Description |
|---------|-------------|
| `paradigm team spawn <agent> --task "..."` | Spawn a single agent |
| `paradigm team orchestrate "task"` | AI orchestrator coordinates agents |
| `paradigm team orchestrate "task" --solo` | Single Claude mode (no splitting) |
| `paradigm team orchestrate "task" --compare` | A/B test solo vs faceted |
| `paradigm team providers` | Show available providers |
| `paradigm team providers --set X` | Set preferred provider |
| `paradigm team models` | View/configure agent model assignments |
| `paradigm team models --refresh` | Re-discover models from environment |

### Provider Cascade

Providers are tried in order until one is available:
1. `claude` - Anthropic API (requires ANTHROPIC_API_KEY)
2. `claude-code` - Claude Code Task tool (Max subscription)
3. `claude-cli` - Spawn claude CLI processes
4. `manual` - File-based handoffs (always available)

Configure via:
- Environment: `PARADIGM_AGENT_PROVIDER=claude-code`
- Config: `agent-provider: claude-code` in `.paradigm/config.yaml`
- CLI: `paradigm team providers --set claude-code`

### Facets (Agent Roles)

Each agent has role-specific configuration in `.paradigm/agents.yaml`:
- `defaultModel`: opus, sonnet, or haiku
- `context.include/exclude`: Files to load for that role
- `limits.maxTokens`: Budget per agent
- `protocol.relay`: How agent reports results

### Model Selection

Models are configured per agent based on task complexity:
- **architect/security**: `opus` (complex reasoning)
- **reviewer**: `sonnet` (balanced critique)
- **builder/tester**: `haiku` (fast, cost-effective)

Run `paradigm team models` to view/configure. In Cursor and interactive environments,
`paradigm team init` prompts for model selection from all available providers.

## MCP Workflow Protocol

**Query before modifying** - Use MCP tools for token-efficient, fresh data:

| Before doing this... | Call this tool |
|---------------------|----------------|
| Modifying a symbol | `paradigm_ripple` with the symbol |
| Understanding code | `paradigm_navigate` with explore intent |
| Checking dependencies | `paradigm_related` for connections |
| Getting oriented | `paradigm_status` for project overview |
| **Adding API endpoint** | `paradigm_gates_for_route` for auth gates |

**Benefits**: ~100 tokens per query vs ~2000 for reading files. Always fresh data from live index.

**Authorization workflow:**
1. Adding endpoint? → Call `paradigm_gates_for_route`
2. Get suggested gates → Add them to `portal.yaml`
3. Implement gate checks → Test 403 responses

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
| Add ANY protected route | Create/update `portal.yaml` with gates |
| Add ownership check | Add `^{resource}-owner` gate to `portal.yaml` |
| Add role-based access | Add `^{role}` gate to `portal.yaml` |
| Add signal/event | Add to emitting feature's `.purpose` |
| Add multi-step flow | Document as `$flow` in `.purpose` |
| Rename/delete symbol | Update all `.purpose` references |
| Learn antipattern | Add to `.paradigm/wisdom/antipatterns.yaml` |

**CRITICAL: Authorization requires portal.yaml**

If your code has ANY of these, `portal.yaml` MUST exist:
- JWT/session authentication
- Role checks (admin, member, etc.)
- Ownership checks (user can only edit own resources)
- Protected API endpoints

**Validation**: Run `paradigm doctor` to check for inconsistencies.

See `.paradigm/docs/ai-maintenance-protocol.md` for detailed guidance.

---

*See `.cursorrules` for IDE-specific instructions, `.paradigm/specs/` for detailed specifications.*