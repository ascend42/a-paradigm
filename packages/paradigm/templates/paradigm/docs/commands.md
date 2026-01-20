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
| IDE | Output File |
|-----|-------------|
| Cursor | `.cursorrules` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Windsurf | `.windsurfrules` |

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

**Portal-related subcommands.**

### paradigm portal validate

Validate `portal.yaml` files.

```bash
paradigm portal validate
paradigm portal validate ./portal.yaml
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
