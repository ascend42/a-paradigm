# Paradigm Framework: Next Upgrades Prompt

## Context

This prompt builds on completed work from the LeadSync Dashboard project. Use this to continue developing Paradigm toward becoming Claude's leading AI context framework.

---

## Completed Milestones ✓

### MCP Integration (DONE)
- `paradigm-mcp` package built and working
- Tools: `paradigm_status`, `paradigm_search`, `paradigm_ripple`, `paradigm_related`, `paradigm_gates_for_route`
- Tested in both Claude Desktop and Cursor
- **Note:** Cursor requires manual toggle to enable MCP servers in Settings → Tools

### Symbol Indexing (DONE)
- `paradigm index` now correctly populates flows, states, gates, signals
- `scan-index.json` has full symbol coverage
- `paradigm status` shows accurate counts

### Signal Schema (DONE)
- `.purpose` files support `signals:` section with YAML structure
- Categories: auth, lead, conversion, sdk, integration, error
- Fields: id, description, category, emits, related

---

## Next Priority: Developer Experience

### 1. `paradigm lint` Command

**Goal:** Catch `.purpose` schema errors before they break indexing

**Current Problem:**
```
paradigm status
# Shows: Schema error at features: Expected object, received array
# File: supabase/functions/facebook-leadgen-webhook/.purpose
```

**Requirements:**
- Validate all `.purpose` files against schema
- Report errors with file paths and line numbers
- Suggest fixes (e.g., "features should be object, got array")
- Exit code 1 on errors (for CI integration)

**Output Format:**
```
paradigm lint

Checking 133 .purpose files...

✗ supabase/functions/facebook-leadgen-webhook/.purpose
  Line 5: features must be object, got array
  Suggestion: Convert to object format { feature-name: { description: "..." } }

✗ src/pages/Dashboard/.purpose  
  Line 12: Unknown symbol type 'aspect' in signals section
  Suggestion: Use 'signals:' for ! symbols, 'aspects:' for ~ symbols

✓ 131 files valid
✗ 2 files with errors

Run 'paradigm lint --fix' to auto-fix where possible.
```

**Implementation Notes:**
- Use the existing schema validation from `paradigm index`
- Add `--fix` flag for auto-corrections where safe
- Add `--strict` flag to fail on warnings too

---

### 2. `paradigm migrate` Command

**Goal:** Upgrade `.purpose` files to latest schema version

**Use Case:** When schema evolves (e.g., adding signals section), help users migrate

**Requirements:**
- Detect schema version from file content
- Generate migration plan before executing
- Support `--dry-run` to preview changes
- Create backups before modifying

**Example:**
```
paradigm migrate

Detected 47 files needing migration to schema v2:
  - Adding 'signals' section structure
  - Converting markdown features to YAML object

Preview changes? [Y/n] y

src/pages/Dashboard/.purpose:
  - features: (markdown block) → features: { dashboard: { ... } }
  + signals:
  +   lead-updated:
  +     description: "Lead data modified"
  +     category: lead

Proceed with migration? [Y/n] y
✓ Migrated 47 files
✓ Backups saved to .paradigm/backups/2026-02-01/
```

---

### 3. VS Code / Cursor Extension

**Goal:** IDE support for Paradigm symbols

**Core Features:**

1. **Symbol Autocomplete**
   - Type `@` → shows all features
   - Type `#` → shows all components
   - Type `^` → shows all gates
   - Fuzzy search within each type

2. **Go to Definition**
   - Cmd+Click on `@lead-management` → jumps to `.purpose` file
   - Shows definition preview on hover

3. **Symbol Highlighting**
   - Different colors for `@` `#` `$` `%` `^` `!` `~` `?`
   - Works in comments, markdown, YAML

4. **Diagnostics**
   - Red squiggles for undefined symbols
   - Yellow for deprecated symbols (`~`)
   - Info for ideas (`?`)

5. **Quick Actions**
   - "Create .purpose file" for new directories
   - "Add to index" for unindexed symbols
   - "View related symbols" context menu

**Implementation Approach:**
- Build as VS Code extension (works in Cursor too)
- Use Language Server Protocol for cross-IDE support
- Read from `scan-index.json` for symbol data
- Watch for file changes to update

---

### 4. GitHub Action for CI

**Goal:** Validate Paradigm structure in PRs

**Workflow Example:**
```yaml
name: Paradigm Validation
on: [pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: paradigm-framework/action@v1
        with:
          commands: |
            paradigm lint --strict
            paradigm index
            paradigm status
```

**PR Comment Output:**
```
## Paradigm Validation ✓

| Check | Status |
|-------|--------|
| Schema validation | ✓ 133 files valid |
| Index generation | ✓ 379 symbols indexed |
| New symbols | +2 features, +1 signal |
| Deprecated symbols | 0 |

### New Symbols Added
- `@sdk-analytics` - SDK usage analytics dashboard
- `@sdk-health-check` - SDK endpoint health monitoring  
- `!sdk-rate-limited` - SDK request rate limit exceeded
```

---

## Priority: Distribution

### 5. npm Package Structure

**Goal:** `npx paradigm init` works out of the box

**Package Structure:**
```
paradigm/
├── package.json
├── bin/
│   └── paradigm.js          # CLI entry point
├── src/
│   ├── commands/
│   │   ├── init.ts
│   │   ├── index.ts
│   │   ├── status.ts
│   │   ├── lint.ts
│   │   ├── migrate.ts
│   │   └── validate.ts
│   ├── schema/
│   │   ├── purpose.schema.json
│   │   └── portal.schema.json
│   └── utils/
│       ├── scanner.ts
│       └── logger.ts
├── templates/
│   ├── react/
│   ├── nextjs/
│   └── express/
└── docs/
    └── (generated site)
```

**CLI Commands:**
```
paradigm init [--template react|nextjs|express]
paradigm index
paradigm status
paradigm lint [--fix] [--strict]
paradigm migrate [--dry-run]
paradigm validate <file>
paradigm search <query>
paradigm mcp setup [--client cursor|claude|vscode]
```

---

### 6. Documentation Site

**Goal:** paradigm.dev with clear docs

**Structure:**
```
/                       # Hero + value prop
/docs/quickstart        # 5 min to first .purpose
/docs/symbols           # Symbol reference (@#$%^!~?)
/docs/portal-yaml       # Authorization modeling
/docs/health-yaml       # Feature health tracking
/docs/mcp               # MCP integration guide
/docs/migration         # From CLAUDE.md/Cursor Rules
/examples               # Real-world examples
/metrics                # Case studies with data
```

**Key Pages:**

**Quick Start (5 minutes):**
1. `npx paradigm init`
2. Create first `.purpose` file
3. Run `paradigm status`
4. See symbols in your IDE

**Migration from CLAUDE.md:**
```markdown
## Before (CLAUDE.md)
This project uses React. We have subscription tiers.
Check auth before protected routes.

## After (Paradigm)
portal.yaml defines ^subscription-required gate
.purpose files declare @features with requirements
paradigm status shows 379 indexed symbols
```

---

## Implementation Sequence

### Phase 1: CLI Polish (This Sprint)
1. [ ] `paradigm lint` command
2. [ ] `paradigm migrate` command  
3. [ ] Improve error messages across all commands
4. [ ] Add `--help` documentation to all commands

### Phase 2: IDE Integration (Next Sprint)
5. [ ] VS Code extension MVP (autocomplete + go-to-def)
6. [ ] Publish to VS Code Marketplace
7. [ ] Test in Cursor, confirm compatibility

### Phase 3: Distribution (Following Sprint)
8. [ ] Clean up package for npm publish
9. [ ] Create project templates (react, nextjs, express)
10. [ ] Build documentation site
11. [ ] GitHub Action for CI

### Phase 4: Ecosystem (Ongoing)
12. [ ] JetBrains plugin
13. [ ] Neovim integration
14. [ ] Community templates and examples

---

## Technical Decisions Needed

### Schema Versioning
How should `.purpose` files indicate schema version?
```yaml
# Option A: Explicit version
paradigm_version: "2.0"
features:
  ...

# Option B: Infer from content structure
# No version field, detect based on format

# Option C: Project-level version in .paradigm/config.yaml
```

**Recommendation:** Option C - project-level config keeps individual files clean

### Symbol Namespace Collisions
What happens if two `.purpose` files define same symbol?
```yaml
# src/pages/Dashboard/.purpose
features:
  dashboard: { ... }

# src/components/Dashboard/.purpose  
features:
  dashboard: { ... }  # Collision!
```

**Options:**
1. First-wins (order-dependent, bad)
2. Error on collision (strict)
3. Namespace by path: `@pages/dashboard` vs `@components/dashboard`
4. Merge with warning

**Recommendation:** Option 2 for features/gates, Option 4 for components

### MCP Resource URIs
Standardize URI format for MCP resources:
```
paradigm://leadsync-dash/symbol/@lead-management
paradigm://leadsync-dash/gate/^authenticated
paradigm://leadsync-dash/flow/$checkout-flow
```

Or project-agnostic:
```
paradigm://symbol/@lead-management
paradigm://gate/^authenticated
```

**Recommendation:** Project-agnostic for single-project, namespaced for multi-project MCP servers

---

## Success Criteria

| Milestone | Metric |
|-----------|--------|
| CLI Polish | `paradigm lint` catches 100% of schema errors |
| IDE Extension | 50+ installs in first month |
| npm Package | `npx paradigm init` works in <30 seconds |
| Documentation | Quick start completable in 5 minutes |
| GitHub Action | 0 false positives in CI validation |

---

## Reference Files

From LeadSync Dashboard (reference implementation):
- `.paradigm/scan-index.json` - 379 indexed symbols
- `portal.yaml` - 11 portals with routes and outcomes
- `.paradigm/health.yaml` - Feature status tracking
- `docs/ai-context-comparison-research.md` - Competitive analysis
- `docs/paradigm-leadership-roadmap-prompt.md` - Strategic vision

---

## Your Task

Pick a priority area and implement:

1. **CLI commands** (`lint`, `migrate`) - Immediate usability improvement
2. **VS Code extension** - Biggest DX win for adoption
3. **npm package cleanup** - Required for public distribution
4. **Documentation** - Required for onboarding

Start with what provides the most immediate value for the next person trying to adopt Paradigm.

---

*Prompt created: February 1, 2026*
*Status: MCP working, symbol indexing complete, ready for DX improvements*
