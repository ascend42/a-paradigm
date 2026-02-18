# a-paradigm - Claude Context

> **Paradigm v2.0** | For Claude Code, Claude API, and Claude-native interfaces

## Project Overview

This project uses Paradigm v2 for structured AI-assisted development.
All context, symbols, and specifications live in the .paradigm/ directory.

v2 uses 5 operational symbols (#, $, ^, !, ~) plus a tag bank for classification.


## Quick Orientation

```
.paradigm/config.yaml  → Project configuration
.paradigm/specs/       → Detailed specifications
.paradigm/docs/        → Commands, patterns, troubleshooting
.cursorrules           → IDE instructions (if using Cursor)
portal.yaml            → Security/auth definitions
```

## Terminal Syntax

This project runs on **macOS**. Use appropriate syntax:

| Operation | Unix Syntax |
|-----------|-------------|
| Chain commands | `cmd1 && cmd2` (stop on error) or `cmd1 ; cmd2` (always continue) |
| Path separator | `/` (forward slash) |
| Environment vars | `$VAR` or `${VAR}` |
| Null device | `/dev/null` |
| List files | `ls` |
| Remove files | `rm` |

**IMPORTANT:** Do NOT use Windows-style commands like `dir`, `del`, or `%VAR%`.

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
| `#` | Component | `#PaymentService` |
| `$` | Flow | `$checkout-flow` |
| `^` | Gate | `^authenticated` |
| `!` | Signal | `!login-success` |
| `~` | Aspect | `~audit-required` |

## First Actions for New Sessions

**Resuming a session:** Call `paradigm_session_recover` for previous session context.

1. **Orient:** Call `paradigm_status` to see project overview and available symbols
2. **Verify:** Check `.paradigm/config.yaml` for discipline and conventions
3. **Locate:** Use `paradigm_navigate` with "context" intent for your task
4. **Review:** Read the nearest `.purpose` file before making changes
5. **Check:** Call `paradigm_gates_for_route` before adding API endpoints

## Before Implementing (Every Task)

1. **Is this task complex?** (3+ files, security + implementation, multiple features)
   → Call `paradigm_orchestrate_inline` with mode="plan" BEFORE writing code
2. **Does it affect existing symbols?** → Call `paradigm_ripple`
3. **Does it add API endpoints?** → Call `paradigm_gates_for_route`

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
- `paradigm_navigate({ intent: "find", target: "#checkout" })` - locate symbol
- `paradigm_navigate({ intent: "explore", target: "auth" })` - browse area
- `paradigm_navigate({ intent: "context", task: "add login" })` - task context

### PM Governance (Before/After Tasks)

| When | Tool | Purpose |
|------|------|---------|
| Starting any task | `paradigm_pm_preflight` | Get compliance plan, affected symbols, required checks |
| Finishing any task | `paradigm_pm_postflight` | Check for violations: missing .purpose, missing gates |

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

## Session Checkpoints

**Auto-recovery**: Recovery data is automatically surfaced on your first Paradigm tool call — no action needed to receive it.

Save checkpoints when transitioning between workflow phases to enable crash recovery:

| Phase | Trigger | What to Capture |
|-------|---------|-----------------|
| `planning` | After reading requirements / before coding | Plan, approach, key decisions |
| `implementing` | After starting code changes | Modified files, symbols touched, decisions made |
| `validating` | After implementation, before tests/review | All modified files, test plan |
| `complete` | Task finished | Summary, final file list |

### Usage

```
paradigm_session_checkpoint({
  phase: "implementing",
  context: "Adding JWT auth middleware to /api/projects routes",
  modifiedFiles: ["src/middleware/auth.ts", "src/routes/projects.ts"],
  symbolsTouched: ["^authenticated", "#project-routes"],
  decisions: ["Using RS256 for JWT signing", "Storing refresh tokens in httpOnly cookies"]
})
```

Keep it lightweight: `phase` + `context` are required, everything else is optional.

## MCP Workflow Protocol

**Query before modifying** - Use MCP tools for token-efficient, fresh data:

| Before doing this... | Call this tool |
|---------------------|----------------|
| Modifying a symbol | `paradigm_ripple` with the symbol |
| Understanding code | `paradigm_navigate` with explore intent |
| Checking dependencies | `paradigm_related` for connections |
| Getting oriented | `paradigm_status` for project overview |
| **Adding API endpoint** | `paradigm_gates_for_route` for auth gates |
| **Validating changes** | `paradigm_flows_affected` for flow impact |
| **Getting test data** | `paradigm_test_fixtures` for fixtures |
| **Building a feature (3+ files)** | `paradigm_orchestrate_inline` mode="plan" |
| **Task involves security + code** | `paradigm_orchestrate_inline` mode="plan" |
| **Finishing work session** | `paradigm_reindex` to rebuild static index |

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
log.component('#login-handler').info('Starting login', { email });
log.component('#database').debug('Query executed', { duration });
log.gate('^authenticated').warn('Access denied', { userId });
log.signal('!login-success').info('User authenticated');
```

### Symbol Mapping by Directory

| Directory | Symbol | Logger Method |
|-----------|--------|---------------|
| `features/**` | `#` | `log.component()` |
| `routes/**` | `#` | `log.component()` |
| `api/**` | `#` | `log.component()` |
| `endpoints/**` | `#` | `log.component()` |
| `commands/**` | `#` | `log.component()` |
| `models/**` | `#` | `log.component()` |
| `components/**` | `#` | `log.component()` |
| `lib/**` | `#` | `log.component()` |
| `utils/**` | `#` | `log.component()` |
| `services/**` | `#` | `log.component()` |
| `core/**` | `#` | `log.component()` |
| `drivers/**` | `#` | `log.component()` |
| `systems/**` | `#` | `log.component()` |
| `integrations/**` | `#` | `log.component()` |
| `external/**` | `#` | `log.component()` |
| `vendors/**` | `#` | `log.component()` |
| `stores/**` | `#` | `log.component()` |
| `state/**` | `#` | `log.component()` |
| `reducers/**` | `#` | `log.component()` |
| `config/**` | `#` | `log.component()` |
| `middleware/**` | `^` | `log.gate()` |
| `auth/**` | `^` | `log.gate()` |
| `guards/**` | `^` | `log.gate()` |
| `policies/**` | `^` | `log.gate()` |
| `events/**` | `!` | `log.signal()` |
| `handlers/**` | `!` | `log.signal()` |
| `listeners/**` | `!` | `log.signal()` |
| `hooks/**` | `!` | `log.signal()` |
| `flows/**` | `$` | `log.flow()` |
| `sagas/**` | `$` | `log.flow()` |
| `workflows/**` | `$` | `log.flow()` |
| `pipelines/**` | `$` | `log.flow()` |
| `aspects/**` | `~` | `log.aspect()` |
| `rules/**` | `~` | `log.aspect()` |
| `constraints/**` | `~` | `log.aspect()` |

See `.paradigm/specs/logger.md` for full specification.

## Conventions

- Use kebab-case for symbol IDs (#feature-name, not #featureName)
- Use PascalCase for class-like components (#PaymentService, #UserProfile)
- Document flows when logic spans 3+ components
- Reference related items using symbol prefixes (# $ ^ ! ~) and tags
- Add descriptions to all components and gates
- Update .purpose files when changing behavior
- Keep gates minimal - one responsibility per gate
- Use signals for side effects, not direct mutations
- Aspects (~) MUST have code anchors - no unanchored aspects
- ALWAYS use Paradigm logger, NEVER raw console.log/print

## When to Update Paradigm Files

- When adding a feature, create/update .purpose with #name and tags: [feature]
- When adding authorization, update portal.yaml with ^gate
- When adding cross-cutting rules, create ~aspect with required anchors
- When exploring ideas, add [idea] tag to the symbol
- Always update references when renaming symbols

## Multi-Agent Orchestration

Paradigm supports multi-agent orchestration via `paradigm team` commands:

### Commands

| Command | Description |
|---------|-------------|
| `paradigm team spawn <agent> --task "..."` | Spawn a single agent |
| `paradigm team orchestrate "task"` | AI orchestrator coordinates agents |
| `paradigm team orchestrate "task" --solo` | Single Claude mode (no splitting) |
| `paradigm team orchestrate "task" --compare` | A/B test solo vs faceted |
| `paradigm team agents suggest "task"` | Suggest agents based on task triggers |
| `paradigm team providers` | Show available providers |
| `paradigm team providers --set X` | Set preferred provider |
| `paradigm team models` | View/configure agent model assignments |
| `paradigm team models --refresh` | Re-discover models from environment |

### Agent Suggestions

Before orchestrating, you can preview which agents will be involved:

```bash
paradigm team agents suggest "Add user authentication with JWT"
```

Or via MCP (returns `suggestedAgents` in plan mode):
```
paradigm_orchestrate_inline({ task: "...", mode: "plan" })
```

## Flow-First Development

**Define flows BEFORE implementing features that span multiple steps.**

### When to Define Flows

Create a flow ($symbol) when your feature:
- Has multiple authorization gates
- Spans multiple components or services
- Emits events that trigger other actions
- Needs clear documentation of the "happy path"

### Flow Definition

Define flows in `.paradigm/flows.yaml`:

```yaml
version: "1.0"
flows:
  $task-creation:
    name: Task Creation Flow
    trigger: "POST /api/tasks"
    steps:
      - type: gate
        symbol: ^authenticated
      - type: gate
        symbol: ^project-member
      - type: action
        symbol: "#create-task"
      - type: signal
        symbol: "!task-created"
    successSignal: "!task-created"
```

### Flow-First Protocol

1. **Define the flow first** - What gates, actions, and signals?
2. **Validate** - Call `paradigm_flow_validate` to check completeness
3. **Implement** - Each step becomes a clear implementation target

## Flow Validation

**Validate flows before and after implementing:**

```
# Validate specific flow
paradigm_flow_validate({ flowId: "$task-creation" })

# Validate all flows
paradigm_flow_validate({})

# Deep check (verify implementation exists)
paradigm_flow_validate({ checkImplementation: true })
```

**After modifying symbols, check affected flows:**

```
# Check what flows are affected by #tasks
paradigm_flows_affected({ symbol: "#tasks" })
```

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

## Automatic Enforcement (Claude Code Hooks)

This project uses Claude Code hooks for paradigm compliance. These are installed
automatically via `paradigm shift` or `paradigm hooks install`.

| Hook | Type | Behavior |
|------|------|----------|
| **Stop hook** | Stop | **BLOCKS** you from finishing if source files were modified without .purpose updates |
| **Pre-commit hook** | PreToolUse (Bash) | Auto-rebuilds index before `git commit` — never blocks |
| **Post-write hook** | PostToolUse (Edit/Write) | Advisory reminder when editing files without .purpose coverage |

**If the Stop hook blocks you:**
1. Update the nearest `.purpose` file for each modified code area
2. Update `portal.yaml` if you added routes or gates
3. Call `paradigm_reindex` to rebuild the static index
4. Then finish your session

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Symbol not found" | Run `paradigm scan` to rebuild index |
| "Navigator not found" | Run `paradigm scan` to generate navigator.yaml |
| Empty search results | Check that .purpose files define symbols |
| High context usage | Call `paradigm_handoff_prepare` |
| Gate suggestions missing | Check that portal.yaml exists and defines gates |
| "Flow index not found" | Run `paradigm scan` and add flows to .purpose files |
| "Fixtures not found" | Create `.paradigm/fixtures.yaml` with test data |

## Maintaining Paradigm Files

**You MUST update Paradigm files when making code changes. The Stop hook will block you if you don't:**

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