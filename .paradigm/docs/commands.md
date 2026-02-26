# Paradigm CLI Commands

Complete reference for all Paradigm commands with examples and usage guidance.

## 📖 Detailed Command Guides

For comprehensive documentation with usage patterns, tips, and troubleshooting:

**Setup & Configuration:**
- [`paradigm init`](./commands/init.md) - Initialize Paradigm in your project
- [`paradigm sync`](./commands/sync.md) - Regenerate IDE instruction files
- [`paradigm mcp setup`](./commands/mcp-setup.md) - Configure MCP for AI clients

**AI Context Generation:**
- [`paradigm beacon`](./commands/beacon.md) - Generate quick-start orientation for AI
- [`paradigm constellation`](./commands/constellation.md) - Build complete symbol relationship graph
- [`paradigm index`](./commands/index.md) - Generate visual discovery index

**Analysis & Safety:**
- [`paradigm ripple`](./commands/ripple.md) - Analyze symbol impact before changes
- [`paradigm doctor`](./commands/doctor.md) - Run health checks on Paradigm setup

---

## Quick Reference

For quick syntax reference, see below. For detailed guides with examples and workflows, use the links above.

---

## paradigm init

**What it does:** Initialize Paradigm in a new project.

**When to use:**
- Starting a new project with Paradigm
- Adding Paradigm to an existing project

**Options:**
```
-f, --force     Overwrite existing .paradigm/ directory
--name <name>   Project name (defaults to directory name)
```

**Examples:**
```bash
# Initialize in current directory
paradigm init

# Initialize with custom name
paradigm init --name my-awesome-app

# Reinitialize (overwrites existing)
paradigm init --force
```

**What it creates:**
```
.paradigm/
├── config.yaml
├── specs/
├── docs/
└── prompts/
```

---

## paradigm sync

**What it does:** Generate IDE-specific instruction files from `.paradigm/` config.

**When to use:**
- After modifying `.paradigm/config.yaml`
- After updating specs in `.paradigm/specs/`
- When switching IDEs or onboarding team members
- After running `paradigm upgrade`

**Options:**
```
[ide]          Target IDE: cursor, copilot, windsurf (auto-detects if omitted)
--all          Sync all supported IDEs at once
-f, --force    Overwrite existing IDE files
```

**Examples:**
```bash
# Auto-detect IDE and sync
paradigm sync

# Sync for specific IDE
paradigm sync cursor
paradigm sync copilot
paradigm sync windsurf

# Sync all IDEs at once
paradigm sync --all
```

**Output files:**
| IDE | Output File |
|-----|-------------|
| Cursor | `.cursor/rules/*.mdc` (modern multi-file format) |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Windsurf | `.windsurfrules` |
| Claude | `CLAUDE.md` |

**Cursor orchestration rules:**

When syncing to Cursor, Paradigm generates `paradigm-orchestration.mdc` which instructs AI agents to use multi-agent orchestration for complex tasks. This file:
- Lists available agents from `agents.yaml`
- Defines when to use `paradigm_orchestrate_inline`
- Provides workflow guidance for spawning subagents

---

## paradigm index

**What it does:** Generate the probe index for visual discovery.

**When to use:**
- After adding or modifying `.purpose` files
- After updating `portal.yaml`
- Before using `paradigm probe` with images
- Periodically to keep index fresh

**Options:**
```
[path]              Target directory (defaults to current)
-o, --output <path> Custom output path for probe-index.json
-q, --quiet         Suppress output
```

**Examples:**
```bash
# Generate index for current project
paradigm index

# Generate for specific directory
paradigm index ./src

# Custom output location
paradigm index -o ./custom/probe-index.json
```

---

## paradigm upgrade

**What it does:** Add new features/specs to an existing `.paradigm/` setup.

**When to use:**
- When Paradigm releases new features
- To add missing specs to an older setup
- To migrate from legacy `.paradigm` file to `.paradigm/` directory
- To migrate from Horizon to Paradigm

**Options:**
```
[path]                  Target directory
--features <features>   Features to add: logger, probe, all
--all                   Apply all available upgrades
--from-horizon          Migrate from Horizon to Paradigm
--dry-run               Show what would change without making changes
-f, --force             Force re-upgrade even if already configured
```

**Examples:**
```bash
# See available upgrades
paradigm upgrade

# Add specific feature
paradigm upgrade --features logger
paradigm upgrade --features probe

# Apply all upgrades
paradigm upgrade --all

# Preview without changing
paradigm upgrade --all --dry-run

# Migrate from Horizon
paradigm upgrade --from-horizon
```

---

## paradigm doctor

**What it does:** Health check — validate your Paradigm setup.

**When to use:**
- Something isn't working as expected
- After cloning a project with Paradigm
- Periodically to ensure everything is in sync

**Examples:**
```bash
paradigm doctor
```

**Sample output:**
```
Checking Paradigm setup...

  .paradigm/config.yaml          ✓ OK
  .paradigm/specs/logger.md      ✓ OK
  .paradigm/specs/probe.md       ✓ OK
  .paradigm/specs/symbols.md     ✓ OK
  .paradigm/docs/commands.md     ✓ OK
  .cursorrules                   ⚠ STALE (run: paradigm sync)
  .paradigm/probe-index.json     ✓ OK (2 hours old)

1 issue found. Run suggested commands to fix.
```

---

## paradigm lint

**What it does:** Validate `.purpose` files for schema errors and optionally auto-populate coverage.

```bash
# Lint all .purpose files
paradigm lint

# Auto-fix common issues (markdown conversion, quote escaping)
paradigm lint --fix

# Strict mode — warnings also fail
paradigm lint --strict

# JSON output for CI
paradigm lint --json

# Discover undocumented source directories
paradigm lint --auto-populate

# Write draft .purpose files for undocumented directories
paradigm lint --auto-populate --fix
```

**Options:**
- `-f, --fix` — Auto-fix issues where possible
- `-s, --strict` — Treat warnings as errors
- `-q, --quiet` — Suppress output except errors
- `--json` — Output as JSON for CI integration
- `--auto-populate` — Scan source dirs for undocumented components and suggest `.purpose` entries. With `--fix`, writes draft files.

**Auto-populate details:**

The `--auto-populate` flag scans for source directories (src, lib, features, components, services, etc.) that lack `.purpose` files. For each undiscovered directory, it:
1. Lists the source files as potential `#component` entries
2. Generates a draft `.purpose` file with TODO descriptions
3. With `--fix`, writes the draft files to disk

---

## paradigm watch

**What it does:** Watch for changes and auto-sync.

**When to use:**
- During active development
- When frequently updating `.paradigm/` files
- For real-time sync while editing config

**Examples:**
```bash
paradigm watch
```

**What it watches:**
- `.paradigm/config.yaml` → re-syncs IDE files
- `.paradigm/specs/*.md` → re-syncs IDE files
- `**/.purpose` files → regenerates probe index
- `**/portal.yaml` files → regenerates probe index

---

## paradigm summary

**What it does:** Generate/update `.paradigm/project.md` with project stats.

**When to use:**
- To get an overview of your project's Paradigm usage
- Before sharing project status with team
- To track symbol growth over time

**Examples:**
```bash
paradigm summary
```

**What it generates:**
```markdown
# Project: my-app

## Symbol Counts
| Type | Count | Examples |
|------|-------|----------|
| #features | 12 | #login, #checkout |
| #components | 24 | #Button, #Modal |
| ^gates | 5 | ^authenticated |

## Health Status
- All specs present ✓
- IDE sync current ✓
- Probe index fresh ✓
```

---

## paradigm status

**What it does:** Quick project status and symbol counts.

**When to use:**
- Quick check of project state
- Seeing symbol distribution

**Examples:**
```bash
paradigm status
```

---

## paradigm visualize

**What it does:** Launch the Prism visualizer.

**When to use:**
- Exploring symbol relationships visually
- Understanding project architecture
- Presenting project structure to team

**Options:**
```
-p, --port <port>   Port to run on (default: 3000)
--no-open           Don't auto-open browser
```

**Examples:**
```bash
# Launch visualizer
paradigm visualize

# Custom port
paradigm visualize -p 8080
```

---

## paradigm purpose

**Purpose-related subcommands.**

### paradigm purpose validate

Validate `.purpose` files for schema compliance.

```bash
paradigm purpose validate
paradigm purpose validate ./src/features
```

### paradigm purpose remember

Aggregate and display purpose context.

```bash
paradigm purpose remember
paradigm purpose remember ./src/features/auth
```

---

## paradigm portal

**Portal-related subcommands for authorization gate management.**

### paradigm portal validate

Validate `portal.yaml` files for schema compliance.

```bash
paradigm portal validate
paradigm portal validate ./portal.yaml
```

### paradigm portal check

Check portal compliance - validate that gates defined in `portal.yaml` are actually used in the codebase, and find gate references that aren't defined.

```bash
# Run compliance check
paradigm portal check

# Output as JSON
paradigm portal check --json
```

**What it checks:**
- Gates declared in `portal.yaml` but never referenced in code
- Gate references in code that aren't declared in `portal.yaml`
- Uses language-agnostic grep patterns (works with any framework)

**Sample output:**
```
Portal Compliance Check
=======================

Status: warnings

Declared but unused (2):
  ^premium-user
  ^beta-tester

Used but undeclared (1):
  ^task-owner

Suggestions:
  - Remove unused gates or implement them in code
  - Add ^task-owner to portal.yaml with description
```

### paradigm portal list

List all gates defined in `portal.yaml`.

```bash
paradigm portal list
```

### paradigm portal export

Export portal configuration in json, csv, or markdown format.

```bash
# JSON (default)
paradigm portal export

# CSV for spreadsheets
paradigm portal export --format csv

# Markdown for documentation
paradigm portal export --format markdown --output docs/portal.md
```

**Options:**
- `-f, --format <format>` — Output format: `json` (default), `csv`, `markdown`
- `-o, --output <path>` — Write output to file instead of stdout
- `-c, --config <path>` — Path to portal.yaml (default: `./portal.yaml`)

---

## paradigm premise

**Premise-related subcommands.**

### paradigm premise aggregate

Aggregate all sources into symbol index.

```bash
paradigm premise aggregate
```

### paradigm premise snapshot

Create a timeline snapshot.

```bash
paradigm premise snapshot "v1.0 release"
paradigm premise snapshot "pre-refactor" -d "Before auth rewrite"
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logger output level | `debug` (dev), `info` (prod) |
| `PARADIGM_SYMBOLS` | Symbol filter (comma-separated) | all |

---

## Tips

1. **Start with `paradigm doctor`** when troubleshooting
2. **Run `paradigm sync` after any config change**
3. **Use `paradigm watch` during development**
4. **Keep probe index fresh** with regular `paradigm index` runs
5. **Check `.paradigm/specs/`** before asking "how do I..."
6. **Read `.index.yaml` first** when navigating documentation
7. **Use `paradigm team handoff`** when approaching context limits

---

## paradigm team

**Multi-agent orchestration and context handoffs.**

### paradigm team init

Initialize team configuration with default agents.

```bash
paradigm team init
paradigm team init --force
paradigm team init --configure-models  # Force model selection prompts
paradigm team init --no-configure-models  # Skip model prompts
```

### paradigm team models

Configure or view agent model assignments. Discovers available models based on environment (Cursor, Claude Code, API providers).

```bash
# View current configuration and available models
paradigm team models

# Refresh model cache (re-discover from environment)
paradigm team models --refresh

# Output as JSON
paradigm team models --json
```

**Environment Detection:**
- **Cursor**: Shows all available models (Claude, GPT-4, Gemini, Grok, Llama, Mistral, etc.)
- **Claude Code**: Fixed models (opus, sonnet, haiku)
- **API Keys**: Discovers models from configured providers (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
- **Fallback**: Basic Claude models

### paradigm team agents suggest

Suggest which agents should handle a task based on triggers defined in `agents.yaml`.

```bash
# Analyze a task and get agent suggestions
paradigm team agents suggest "Add user authentication with JWT"

# Output as JSON
paradigm team agents suggest "Build #checkout with Stripe integration" --json
```

**What it returns:**
- Agent suggestions ranked by confidence (high/medium/low)
- Matched triggers (keywords and symbols)
- Suggested workflow order (architect → builder → tester, etc.)
- MCP orchestration hint

**Example output:**
```
Suggested agents for this task:

  Task: "Add user authentication with JWT"

  ★ security (high)
    Matched keywords: auth, security. You audit for security issues...
    Matched: keyword:auth, keyword:security

  ◆ architect (medium)
    Matched keywords: add. You design system architecture...
    Matched: keyword:add

  Suggested workflow:
    architect → security → builder

  Or use MCP orchestration:
    paradigm_orchestrate_inline({ task: "Add user authentication...", mode: "plan" })
```

### paradigm team status

Show current team status.

```bash
paradigm team
paradigm team status
paradigm team status --json
```

### paradigm team handoff

Hand off work to another agent (or for context continuity).

```bash
# Hand off to specific agent
paradigm team handoff --to builder --summary "Auth spec complete"

# Context continuity (hand off to same role in new session)
paradigm team handoff --to architect --summary "Continuing auth work"
```

### paradigm team accept

Accept a pending handoff.

```bash
paradigm team accept h001
paradigm team accept h001 --note "Starting implementation"
```

### paradigm team check

Check for conflicts and team health.

```bash
paradigm team check
```

### paradigm team history

Show team activity history.

```bash
paradigm team history
paradigm team history --limit 20
```

### paradigm team reset

Reset team state for fresh start.

```bash
paradigm team reset
paradigm team reset --force
```

### Context Continuity

When approaching context limits, use `paradigm team handoff` to preserve state:

1. Run `paradigm team handoff --to <agent> --summary "Context checkpoint"`
2. Start new chat
3. New session runs `paradigm team status` to see pending handoff
4. Accept with `paradigm team accept <id>`

---

## Documentation Index System

Hierarchical documentation indexing for efficient AI navigation.

### Structure

```
docs/
├── .index.yaml      # Directory index
├── DESIGN.md        # Indexed document
└── guides/
    └── .index.yaml  # Subdirectory index
```

### AI Navigation

1. Read `.index.yaml` first
2. Use section line ranges for targeted reading
3. Check dependencies before changing files
4. Update index when editing documents

See `.paradigm/specs/context.md` for full specification.

---

## paradigm wisdom

**Team wisdom — preferences, antipatterns, decisions, expertise.**

### paradigm wisdom show

Show wisdom overview or for a specific symbol.

```bash
# Overview
paradigm wisdom

# For a symbol
paradigm wisdom show #checkout
paradigm wisdom show #checkout --json
```

### paradigm wisdom init

Initialize the wisdom directory with templates.

```bash
paradigm wisdom init
paradigm wisdom init --force
```

### paradigm wisdom add-antipattern

Add a new antipattern (what NOT to do).

```bash
paradigm wisdom add-antipattern \
  --id "api-001" \
  --symbols "#api,#api-client" \
  --description "Do NOT use axios interceptors for auth" \
  --reason "Causes race conditions with token refresh" \
  --alternative "Use wrapper function with explicit token handling"
```

### paradigm wisdom decide

Create a new decision record (ADR).

```bash
paradigm wisdom decide \
  --id "001" \
  --title "Authentication Approach" \
  --symbols "^authenticated,#login" \
  --context "Need to choose auth method" \
  --decision "Use JWT with refresh tokens" \
  --status accepted
```

### paradigm wisdom expert

Find experts for a symbol or area.

```bash
# By symbol
paradigm wisdom expert #checkout

# By area
paradigm wisdom expert --area payments
```

---

## paradigm history

**Implementation history — tracking changes, validation, fragility.**

### paradigm history show

Show history overview or for a specific symbol.

```bash
# Overview
paradigm history

# For a symbol
paradigm history show #checkout
paradigm history show #checkout --limit 20 --json
```

### paradigm history init

Initialize the history directory.

```bash
paradigm history init
paradigm history init --force
```

### paradigm history fragile

Show fragile symbols that need extra care when modifying.

```bash
paradigm history fragile
paradigm history fragile --json
```

### paradigm history reindex

Regenerate the index from the log.

```bash
paradigm history reindex
```

### paradigm history record

Record an implementation event.

```bash
paradigm history record \
  --type implement \
  --symbols "#checkout" \
  --description "Added Apple Pay support" \
  --intent feature \
  --commit abc123
```

### paradigm history validate

Record a validation result.

```bash
paradigm history validate \
  --result pass \
  --ref h0045 \
  --passed 15 \
  --failed 0
```

---

## paradigm hooks

**Git hooks for automatic history capture.**

### paradigm hooks install

Install git hooks for automatic history capture. Validates bash syntax before writing hooks.

```bash
paradigm hooks install
paradigm hooks install --force
paradigm hooks install --post-commit  # Only post-commit hook
paradigm hooks install --dry-run      # Preview what would be installed
```

**Options:**
```
-f, --force     Overwrite existing hooks
--post-commit   Only install post-commit hook
--dry-run       Show what would be installed without making changes
```

**Dry-run output** shows:
- Git hooks that would be written (with paths)
- Claude Code hooks that would be added to settings.json
- Cursor hooks that would be added to .cursor/hooks/

### paradigm hooks uninstall

Remove paradigm git hooks.

```bash
paradigm hooks uninstall
paradigm hooks uninstall --dry-run    # Preview what would be removed
```

**Options:**
```
--dry-run       Show what would be removed without making changes
```

### paradigm hooks status

Check git hooks status.

```bash
paradigm hooks status
```

**What hooks do:**
- `post-commit`: Records implementation entries from commits
- `pre-push`: Reindexes history before pushing

---

## MCP Server

**Paradigm MCP server for AI clients.**

### paradigm mcp setup

Configure MCP server for AI clients.

```bash
paradigm mcp setup
paradigm mcp setup --client cursor
paradigm mcp setup --client claude-desktop
```

### paradigm mcp status

Show MCP configuration status.

```bash
paradigm mcp status
```

---

## Enhanced Sync Options

Additional options for `paradigm sync`:

```bash
# Generate with MCP config
paradigm sync claude --mcp

# Skip MCP config
paradigm sync cursor --no-mcp

# Generate nested CLAUDE.md files
paradigm sync claude --nested
```

---

## Navigator

**AI exploration optimization — pre-indexed project structure.**

The Navigator is auto-generated by `paradigm scan` to help AI tools explore efficiently.

### What It Generates

```
.paradigm/
  navigator.yaml      # Structure index
```

### navigator.yaml Contents

- **structure**: Maps code categories to directory locations
- **key_files**: Important files (config, entry points, types)
- **skip_patterns**: Patterns to avoid during exploration
- **symbols**: Direct symbol-to-path mapping

### MCP Tool: paradigm_navigate

Query the navigator for targeted exploration:

```bash
# Find a symbol
paradigm_navigate({ intent: "find", target: "#checkout" })

# Explore an area
paradigm_navigate({ intent: "explore", target: "authentication" })

# Get context for a task
paradigm_navigate({ intent: "context", task: "add Apple Pay" })
```

### Exploration Protocol

1. Read `.paradigm/navigator.yaml` for structure map
2. Query by symbol → go directly to path
3. Respect skip patterns

See `.paradigm/specs/navigator.md` for full specification.

---

## Context Tracking (MCP)

**Session-aware context monitoring for handoff recommendations.**

### MCP Tool: paradigm_context_check

Check if context handoff is recommended:

```bash
# Via MCP tool call
paradigm_context_check({ contextWindowSize: 200000 })
```

**Returns:**
- `recommendation`: continue | consider-handoff | handoff-recommended | handoff-urgent
- `usagePercent`: Estimated context usage percentage
- `action`: Suggested next action

### MCP Tool: paradigm_handoff_prepare

Prepare a handoff summary:

```bash
paradigm_handoff_prepare({
  summary: "Completed auth refactor",
  nextSteps: ["Add tests", "Update docs"],
  agent: "builder"
})
```

### MCP Tool: paradigm_session_stats

Get current session statistics:

```bash
paradigm_session_stats({})
```

### MCP Tool: paradigm_session_recover

Load previous session breadcrumbs at the start of a new session:

```bash
paradigm_session_recover({})
```

Returns recent tool call breadcrumbs, symbols modified, and files explored from the previous session. Useful for picking up where you left off.

### Recommendation Thresholds

| Usage | Recommendation |
|-------|----------------|
| < 50% | Continue working |
| 50-70% | Consider handoff at good stopping point |
| 70-85% | Handoff recommended soon |
| > 85% | Handoff urgently needed |

See `.paradigm/specs/context-tracking.md` for full specification.

---

## Task Management (MCP)

**Persistent work items that survive context windows.** Tasks are stored in `.paradigm/tasks/entries/{YYYY-MM-DD}/T-*.yaml` and surfaced automatically on session recovery.

### MCP Tool: paradigm_task_create

Create a new task:

```bash
paradigm_task_create({
  blurb: "Add rate limiting to /api/projects",
  priority: "high",
  tags: ["#api-routes", "security"],
  related_lore: ["L-2026-02-25-003"]
})
```

**Parameters:**
- `blurb` (required) — One-line task description
- `priority` — `high`, `medium` (default), or `low`
- `tags` — Symbols (#component), freeform labels
- `related_lore` — Linked lore entry IDs

**Returns:** Created task ID (e.g., `T-2026-02-26-001`) and full task object.

### MCP Tool: paradigm_task_list

List/filter tasks:

```bash
paradigm_task_list({ status: "open", priority: "high", tag: "#api-routes" })
```

**Parameters:**
- `status` — `open` (default), `done`, `shelved`, or `all`
- `priority` — Filter by `high`, `medium`, or `low`
- `tag` — Filter by tag (symbol or freeform)
- `limit` — Maximum results (default: 20)

**Returns:** Task list sorted by priority then date.

### MCP Tool: paradigm_task_update

Update any task fields:

```bash
paradigm_task_update({
  id: "T-2026-02-26-001",
  priority: "medium",
  tags: ["#api-routes", "security", "done-review"]
})
```

**Parameters:**
- `id` (required) — Task ID
- `blurb`, `priority`, `status`, `tags`, `related_lore`, `related_assessments` — Fields to update

### MCP Tool: paradigm_task_done

Mark a task as done (shorthand):

```bash
paradigm_task_done({ id: "T-2026-02-26-001" })
```

### MCP Tool: paradigm_task_shelve

Shelve a task for later (shorthand):

```bash
paradigm_task_shelve({ id: "T-2026-02-26-001" })
```

---

## Assessment Loops (MCP)

**Synthesized insights organized into arcs.** Assessments sit above lore in the three-layer model: Commits (raw facts) → Lore (session events) → Assessments (synthesized insight). Stored in `.paradigm/assessments/arcs/{arc-id}/`.

### MCP Tool: paradigm_assessment_record

Add a reflection entry to an arc (creates the arc if new):

```bash
paradigm_assessment_record({
  arc_id: "arc-auth-hardening",
  arc_name: "Auth Hardening",
  title: "JWT refresh token rotation complete",
  summary: "Implemented RS256 token rotation with httpOnly cookies",
  body: "Full reflection text...",
  type: "milestone",
  symbols: ["#auth-middleware", "^authenticated"],
  linked_commits: ["a1b2c3d"],
  linked_tasks: ["T-2026-02-25-001"]
})
```

**Parameters:**
- `arc_id` (required) — Arc ID (e.g., `arc-telemetry`). Auto-creates if new.
- `arc_name` — Human-readable name (required when creating a new arc)
- `arc_description` — Arc description (used when creating a new arc)
- `title` (required), `summary` (required) — Entry title and summary
- `body` — Full reflection text
- `type` — `retro` (default), `insight`, `decision`, or `milestone`
- `symbols`, `tags` — Classification
- `linked_lore`, `linked_tasks`, `linked_commits` — Cross-references

**Returns:** Entry ID (e.g., `A-2026-02-26-001`) — globally unique across all arcs.

### MCP Tool: paradigm_assessment_list

List arcs or entries within an arc:

```bash
# List all active arcs
paradigm_assessment_list({ status: "active" })

# List entries in a specific arc
paradigm_assessment_list({ arc_id: "arc-auth-hardening" })
```

**Parameters:**
- `arc_id` — If provided, lists entries in this arc. Otherwise lists all arcs.
- `status` — Filter arcs: `active` (default), `complete`, `archived`, or `all`
- `limit` — Maximum results (default: 20)

### MCP Tool: paradigm_assessment_get

Get full detail for an entry or arc:

```bash
# Get an entry
paradigm_assessment_get({ id: "A-2026-02-26-001" })

# Get an arc with its entries
paradigm_assessment_get({ id: "arc-auth-hardening" })
```

**Parameters:**
- `id` (required) — Entry ID (`A-*`) or arc ID (`arc-*`)

### MCP Tool: paradigm_assessment_search

Cross-arc search by symbol, tag, type, or date range:

```bash
paradigm_assessment_search({
  symbol: "#auth-middleware",
  type: "decision",
  dateFrom: "2026-02-01",
  limit: 10
})
```

**Parameters:**
- `symbol`, `tag`, `type`, `dateFrom`, `dateTo`, `limit`

### MCP Tool: paradigm_assessment_arc_create

Explicitly create an arc without adding an entry:

```bash
paradigm_assessment_arc_create({
  id: "arc-performance",
  name: "Performance Optimization",
  description: "Tracking all perf-related decisions and benchmarks",
  tags: ["performance"]
})
```

### MCP Tool: paradigm_assessment_arc_close

Mark an arc as complete or archived:

```bash
paradigm_assessment_arc_close({ arc_id: "arc-auth-hardening", status: "complete" })