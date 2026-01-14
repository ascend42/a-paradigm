# Horizon CLI Commands

Complete reference for all Horizon commands with examples and usage guidance.

---

## horizon init

**What it does:** Initialize Horizon in a new project.

**When to use:**
- Starting a new project with Horizon
- Adding Horizon to an existing project

**Options:**
```
-f, --force     Overwrite existing .horizon/ directory
--name <name>   Project name (defaults to directory name)
```

**Examples:**
```bash
# Initialize in current directory
horizon init

# Initialize with custom name
horizon init --name my-awesome-app

# Reinitialize (overwrites existing)
horizon init --force
```

**What it creates:**
```
.horizon/
├── config.yaml
├── specs/
├── docs/
└── prompts/
```

---

## horizon sync

**What it does:** Generate IDE-specific instruction files from `.horizon/` config.

**When to use:**
- After modifying `.horizon/config.yaml`
- After updating specs in `.horizon/specs/`
- When switching IDEs or onboarding team members
- After running `horizon upgrade`

**Options:**
```
[ide]          Target IDE: cursor, copilot, windsurf (auto-detects if omitted)
--all          Sync all supported IDEs at once
-f, --force    Overwrite existing IDE files
```

**Examples:**
```bash
# Auto-detect IDE and sync
horizon sync

# Sync for specific IDE
horizon sync cursor
horizon sync copilot
horizon sync windsurf

# Sync all IDEs at once
horizon sync --all
```

**Output files:**
| IDE | Output File |
|-----|-------------|
| Cursor | `.cursorrules` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Windsurf | `.windsurfrules` |

---

## horizon index

**What it does:** Generate the scan index for visual discovery.

**When to use:**
- After adding or modifying `.purpose` files
- After updating `gate.yaml`
- Before using `horizon scan` with images
- Periodically to keep index fresh

**Options:**
```
[path]              Target directory (defaults to current)
-o, --output <path> Custom output path for scan-index.json
-q, --quiet         Suppress output
```

**Examples:**
```bash
# Generate index for current project
horizon index

# Generate for specific directory
horizon index ./src

# Custom output location
horizon index -o ./custom/scan-index.json
```

---

## horizon upgrade

**What it does:** Add new features/specs to an existing `.horizon/` setup.

**When to use:**
- When Horizon releases new features
- To add missing specs to an older setup
- To migrate from legacy `.horizon` file to `.horizon/` directory

**Options:**
```
[path]                  Target directory
--features <features>   Features to add: logger, scan, all
--all                   Apply all available upgrades
--dry-run               Show what would change without making changes
-f, --force             Force re-upgrade even if already configured
```

**Examples:**
```bash
# See available upgrades
horizon upgrade

# Add specific feature
horizon upgrade --features logger
horizon upgrade --features scan

# Apply all upgrades
horizon upgrade --all

# Preview without changing
horizon upgrade --all --dry-run
```

---

## horizon doctor

**What it does:** Health check — validate your Horizon setup.

**When to use:**
- Something isn't working as expected
- After cloning a project with Horizon
- Periodically to ensure everything is in sync

**Examples:**
```bash
horizon doctor
```

**Sample output:**
```
Checking Horizon setup...

  .horizon/config.yaml          ✓ OK
  .horizon/specs/logger.md      ✓ OK
  .horizon/specs/scan.md        ✓ OK
  .horizon/specs/symbols.md     ✓ OK
  .horizon/docs/commands.md     ✓ OK
  .cursorrules                  ⚠ STALE (run: horizon sync)
  .horizon/scan-index.json      ✓ OK (2 hours old)

1 issue found. Run suggested commands to fix.
```

---

## horizon watch

**What it does:** Watch for changes and auto-sync.

**When to use:**
- During active development
- When frequently updating `.horizon/` files
- For real-time sync while editing config

**Examples:**
```bash
horizon watch
```

**What it watches:**
- `.horizon/config.yaml` → re-syncs IDE files
- `.horizon/specs/*.md` → re-syncs IDE files
- `**/.purpose` files → regenerates scan index
- `**/gate.yaml` files → regenerates scan index

---

## horizon summary

**What it does:** Generate/update `.horizon/project.md` with project stats.

**When to use:**
- To get an overview of your project's Horizon usage
- Before sharing project status with team
- To track symbol growth over time

**Examples:**
```bash
horizon summary
```

**What it generates:**
```markdown
# Project: my-app

## Symbol Counts
| Type | Count | Examples |
|------|-------|----------|
| @features | 12 | @login, @checkout |
| #components | 24 | #Button, #Modal |
| ^gates | 5 | ^authenticated |

## Health Status
- All specs present ✓
- IDE sync current ✓
- Scan index fresh ✓
```

---

## horizon status

**What it does:** Quick project status and symbol counts.

**When to use:**
- Quick check of project state
- Seeing symbol distribution

**Examples:**
```bash
horizon status
```

---

## horizon visualize

**What it does:** Launch the Dreamscape visualizer.

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
horizon visualize

# Custom port
horizon visualize -p 8080
```

---

## horizon purpose

**Purpose-related subcommands.**

### horizon purpose validate

Validate `.purpose` files for schema compliance.

```bash
horizon purpose validate
horizon purpose validate ./src/features
```

### horizon purpose remember

Aggregate and display purpose context.

```bash
horizon purpose remember
horizon purpose remember ./src/features/auth
```

---

## horizon gate

**Gate-related subcommands.**

### horizon gate validate

Validate `gate.yaml` files.

```bash
horizon gate validate
horizon gate validate ./gate.yaml
```

---

## horizon dream

**Dream-related subcommands.**

### horizon dream aggregate

Aggregate all sources into symbol index.

```bash
horizon dream aggregate
```

### horizon dream snapshot

Create a timeline snapshot.

```bash
horizon dream snapshot "v1.0 release"
horizon dream snapshot "pre-refactor" -d "Before auth rewrite"
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logger output level | `debug` (dev), `info` (prod) |
| `HORIZON_SYMBOLS` | Symbol filter (comma-separated) | all |

---

## Tips

1. **Start with `horizon doctor`** when troubleshooting
2. **Run `horizon sync` after any config change**
3. **Use `horizon watch` during development**
4. **Keep scan index fresh** with regular `horizon index` runs
5. **Check `.horizon/specs/`** before asking "how do I..."
