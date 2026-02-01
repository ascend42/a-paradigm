# Paradigm CLI Commands

Complete reference for all Paradigm commands with examples and usage guidance.

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
| IDE | Output |
|-----|--------|
| Cursor | `.cursor/rules/*.mdc` (multiple files) |
| GitHub Copilot | `.github/instructions/*.instructions.md` + `.github/copilot-instructions.md` |
| Windsurf | `.windsurfrules` |

### Modern Cursor Format

Cursor now uses the `.cursor/rules/*.mdc` format with YAML frontmatter:

```
.cursor/rules/
  paradigm-core.mdc          # alwaysApply: true
  paradigm-symbols.mdc       # alwaysApply: true
  paradigm-logging.mdc       # globs: **/*.{ts,tsx}
  paradigm-purpose.mdc       # globs: **/.purpose
  paradigm-portal.mdc        # globs: **/portal.yaml
  paradigm-conventions.mdc   # globs: **/*.{ts,tsx}
  paradigm-commands.mdc      # manual selection
```

Each `.mdc` file has frontmatter controlling when it loads:
- `alwaysApply: true` - Loads for every conversation
- `globs: pattern` - Only loads when matching files are open
- No options - Manual selection in Cursor's rule picker

### Modern Copilot Format

Copilot now uses `.github/instructions/*.instructions.md` with `applyTo` frontmatter:

```
.github/
  copilot-instructions.md              # Always applies (core instructions)
  instructions/
    paradigm-symbols.instructions.md   # applyTo: "**/*.ts,**/*.tsx"
    paradigm-logging.instructions.md   # applyTo: "**/*.ts,**/*.tsx"
    paradigm-purpose.instructions.md   # applyTo: "**/.purpose"
    paradigm-portal.instructions.md    # applyTo: "**/portal.yaml"
    paradigm-conventions.instructions.md # applyTo: "**/*.ts,**/*.tsx"
    paradigm-commands.instructions.md  # No frontmatter (reference only)
```

Each `.instructions.md` file has frontmatter controlling when it loads:
- `applyTo: "glob,patterns"` - Only applies when matching files are referenced
- No frontmatter - Available for manual reference

Both modern formats are more efficient because instructions only load when relevant files are open.

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
| @features | 12 | @login, @checkout |
| #components | 24 | #Button, #Modal |
| ^portals | 5 | ^authenticated |

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
-p, --port <port>   Port to run on (default: 42197)
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

**Portal-related subcommands.**

### paradigm portal validate

Validate `portal.yaml` files.

```bash
paradigm portal validate
paradigm portal validate ./portal.yaml
```

### paradigm portal watch

Launch the Portal Viewer - a real-time visualization dashboard for portal activations.

**Options:**
```
[path]              Target directory (defaults to current)
-p, --port <port>   WebSocket port for SDK connections (default: 42196)
-u, --ui-port <port> HTTP port for UI (default: 42195)
-c, --config <path> Path to portal.yaml config
--no-open           Don't auto-open browser
```

**Examples:**
```bash
# Launch viewer with defaults
paradigm portal watch

# Custom ports
paradigm portal watch --port 7001 --ui-port 7000

# Specify config location
paradigm portal watch -c ./config/portal.yaml
```

**Features:**
- **Constellation View**: Interactive star map where portals "light up" on activation
- **Checklist Mode**: Auto-ticking gates for QA testing
- **Event Timeline**: Scrolling log with entity filtering
- **Session Recording**: Capture and export test runs
- **Flow Visualization**: Track progress through gate sequences

**Ports (Marathon-inspired):**
| Port | Purpose |
|------|---------|
| 42195 | Portal Viewer UI (marathon: 42.195km) |
| 42196 | Portal Viewer WebSocket |

### paradigm portal report

Generate a report from a recorded session file.

**Options:**
```
<session>           Path to session JSON file (required)
-f, --format <fmt>  Output format: json, markdown, slack, discord (default: markdown)
-o, --output <path> Output file path (prints to stdout if omitted)
```

**Examples:**
```bash
# Generate markdown report
paradigm portal report ./session.json

# Export as JSON
paradigm portal report ./session.json --format json -o report.json

# Format for Slack
paradigm portal report ./session.json --format slack
```

### paradigm portal test

Test portals and generate test files.

```bash
paradigm portal test
paradigm portal test --generate
paradigm portal test --portal ^checkout
```

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

## Agent Efficiency Commands

Commands designed to make AI agents faster and more context-aware.

### paradigm beacon

**What it does:** Generate a quick-start orientation file for AI agents.

**When to use:**
- First thing an AI agent should read
- After major project changes
- When onboarding new AI sessions

**Options:**
```
[path]           Target directory (defaults to current)
-r, --refresh    Regenerate even if beacon exists
-o, --output     Custom output path
-q, --quiet      Suppress output
```

**Examples:**
```bash
# Generate beacon
paradigm beacon

# Refresh existing beacon
paradigm beacon --refresh
```

**Output:** `.paradigm/beacon.md` containing:
- Symbol map (features, portals, relationships)
- Key file landmarks
- Available pathways (prompts)
- Symbol quick reference

---

### paradigm constellation

**What it does:** Generate a machine-readable symbol relationship graph.

**When to use:**
- Before making changes that might have ripple effects
- When AI needs to query symbol relationships programmatically
- For impact analysis and dependency tracking

**Options:**
```
[path]                  Target directory (defaults to current)
-f, --format <format>   Output format: json or yaml (default: json)
-o, --output <path>     Custom output path
-q, --quiet             Suppress output
```

**Examples:**
```bash
# Generate constellation
paradigm constellation

# Generate as YAML
paradigm constellation --format yaml
```

**Output:** `.paradigm/constellation.json` containing:
- `stars`: All symbols with their relationships
- `orbits`: Flow sequences
- `stats`: Symbol counts by type

---

### paradigm ripple

**What it does:** Show change impact analysis for a symbol.

**When to use:**
- Before modifying a symbol
- Understanding what depends on something
- Planning refactoring

**Options:**
```
<symbol>         Symbol to analyze (e.g., @checkout, ^authenticated)
[path]           Target directory (defaults to current)
-d, --depth      Analysis depth (default: 1)
--json           Output as JSON
-q, --quiet      Suppress output
```

**Examples:**
```bash
# Analyze a feature
paradigm ripple @checkout

# Analyze a portal
paradigm ripple ^authenticated

# Get JSON output
paradigm ripple @checkout --json
```

**Output:**
- Upstream: What the symbol requires
- Downstream: What would be affected by changes
- Flow membership: Which flows include this symbol
- Test suggestions: How to test after changes

---

### paradigm thread

**What it does:** Manage session continuity between AI agent sessions.

**When to use:**
- Recording what was done in a session
- Leaving notes for the next agent
- Tracking unfinished tasks

**Subcommands:**

```bash
# Show current thread
paradigm thread
paradigm thread show

# Save activity to trail
paradigm thread save "Added email validation to @signup"

# Add unfinished task
paradigm thread todo "Write unit tests for email validation"

# Add note for next agent
paradigm thread note "User prefers Zod over manual validation"

# Clear the thread
paradigm thread clear
```

**Output:** `.paradigm/thread.md` containing:
- Trail: What was done
- Loose ends: Unfinished tasks
- Breadcrumbs: Notes for next agent

---

### paradigm echo

**What it does:** Look up error codes to find related symbols.

**When to use:**
- Debugging errors
- Understanding what symbol an error relates to
- Finding resolution hints

**Subcommands:**

```bash
# Look up an error code
paradigm echo AUTH_REQUIRED
paradigm echo lookup AUTH_REQUIRED

# Initialize echoes.yaml template
paradigm echo init

# List all error mappings
paradigm echo list
```

**Configuration:** `.paradigm/echoes.yaml`

```yaml
errors:
  AUTH_REQUIRED:
    symbol: "^authenticated"
    location: "src/middleware/auth.ts"
    ripple:
      - "@checkout"
      - "@profile"
    resolution: "Ensure user token is passed in request headers"
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logger output level | `debug` (dev), `info` (prod) |
| `PARADIGM_SYMBOLS` | Symbol filter (comma-separated) | all |
| `PORTAL_VALIDATION` | Enable portal validation logging | `true` (dev) |
| `PORTAL_TEST_MODE` | Emit JSON lines for parsing | `false` |

---

## Tips

1. **Start with `paradigm doctor`** when troubleshooting
2. **Run `paradigm sync` after any config change**
3. **Use `paradigm watch` during development**
4. **Keep probe index fresh** with regular `paradigm index` runs
5. **Check `.paradigm/specs/`** before asking "how do I..."
6. **Read `.index.yaml` first** when navigating documentation
7. **Use Phoenix Protocol** when approaching context limits

---

## Phoenix Protocol

The Phoenix Protocol enables AI context continuity across conversation boundaries.

### When It Triggers

- AI estimates ~80% context capacity used
- User mentions context is getting long
- Before suggesting "continue in new chat"

### What Happens

1. AI writes `.context/phoenix.yaml` with:
   - Completed tasks
   - In-progress work
   - Pending tasks
   - Critical memories
   - Files touched
   - Warnings/gotchas

2. AI notifies user

3. User starts new chat

4. New AI reads ashes and continues

### Files

| File | Purpose |
|------|---------|
| `.context/phoenix.yaml` | Active handoff file |
| `.context/phoenix.yaml.risen` | Consumed file (audit trail) |
| `.context/README.md` | Protocol documentation |

See `.paradigm/specs/phoenix.md` for full specification.

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