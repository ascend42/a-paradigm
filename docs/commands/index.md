# paradigm index

Generate a visual discovery index that maps UI elements to code symbols for screenshot-based analysis.

## Overview

Creates `.paradigm/scan-index.json` (also called `probe-index.json`) - a machine-readable index enabling AI agents to analyze screenshots/mockups and map visual elements directly to code.

## What It Does

**Scans your codebase for:**
- Components with visual tags (#Button, #Modal, #Card)
- Features and their UI surfaces (#checkout, #dashboard)
- Flows and their visual steps ($checkout-flow)
- Gates that control UI access (^authenticated)

**Generates:**
```json
{
  "$meta": { "version": "1.0.0", "project": "my-app" },
  "components": {
    "Button": {
      "symbol": "#Button",
      "path": "src/components/Button.tsx",
      "visualTags": ["button", "action", "primary"],
      "description": "Primary action button"
    }
  },
  "features": { /* #features with UI paths */ },
  "flows": { /* $flows with visual steps */ },
  "symbolMap": { /* quick symbol → path lookup */ }
}
```

## Why You Need It

**Primary use case: Visual Discovery**
- Attach a screenshot to AI agent
- Say "paradigm probe"
- AI maps UI elements → code symbols
- Get instant: "That button is `#PrimaryButton` at `src/components/Button.tsx`"

**Secondary benefits:**
- Fast codebase orientation for AI agents
- Visual-to-code bridging for design handoff
- Screenshot-based debugging ("where's this error rendered?")
- Architecture visualization support

## When to Run It

### ✅ Run after:
- **`paradigm init`** - Generate initial index
- **Adding features/components** - Keep mappings fresh
- **Before screenshot analysis** - Ensure index is current
- **UI refactoring** - Update visual mappings

### 🔄 Periodic:
- **Weekly** - If actively using screenshot analysis
- **After major UI changes** - New components, redesigns
- **When index is stale** - `paradigm doctor` warns at 24+ hours

### ⚠️ Optional if:
- You never use screenshots with AI
- You don't do visual discovery
- Your project is API-only (no UI)

## Usage

```bash
# Generate index in default location
paradigm index

# Specify output path
paradigm index -o ./custom/scan-index.json

# Index specific directory
paradigm index ./src

# Watch mode (regenerate on changes)
paradigm index --watch

# Quiet mode (no output)
paradigm index --quiet
```

## Output

```
🔭 Generating Paradigm Scan Index

✔ Aggregated 42 symbols from .purpose files
✔ Mapped 15 components with visual tags
✔ Indexed 8 features with UI surfaces
✔ Tracked 3 flows with visual steps

Scan Index Generated
────────────────────────────────────────
  Components:  15
  Features:    8
  Flows:       3
  Gates:       2
  Total:       28

  Output: .paradigm/scan-index.json
```

## Integration with Other Commands

**Visual discovery workflow:**
```bash
# 1. Generate/update index
paradigm index

# 2. Take screenshot, then in AI:
# "paradigm probe - analyze this UI"

# 3. AI uses scan-index.json to map elements
```

**Maintenance workflow:**
```bash
# Keep everything fresh
paradigm index
paradigm beacon
paradigm constellation
```

## Common Workflows

### Initial Setup
```bash
# After project init
paradigm init --quick
paradigm index  # Generate initial scan index
```

### Before Design Review
```bash
# Fresh index for mockup comparison
paradigm index
# Attach mockups: "paradigm probe design"
```

### Debug UI Issues
```bash
# Update index, then screenshot error
paradigm index
# Attach screenshot: "paradigm probe error"
```

### Periodic Refresh
```bash
# Weekly maintenance
paradigm index && paradigm beacon && paradigm constellation
```

## Tips & Gotchas

**Pro tips:**
- Run before any screenshot-based AI analysis
- Use `--watch` during active UI development
- Index file is ~50-500KB (small, safe to commit)
- Visual tags come from `.purpose` file `visualTags` field
- Add custom tags to components for better matching

**Watch out for:**
- Index gets stale after UI changes
- `paradigm doctor` warns if >24 hours old
- Large projects may take 1-2 seconds to index
- Custom screen definitions need `.paradigm/config.yaml` setup

## Visual Tags

Add visual tags to improve matching:

```yaml
# .purpose file
components:
  Button:
    symbol: "#Button"
    description: "Primary action button"
    visualTags:
      - button
      - action
      - primary
      - cta
```

**Common visual tags:**
- UI elements: button, input, modal, card, menu
- Patterns: form, list, grid, table
- Actions: submit, cancel, delete, edit
- States: loading, error, success, disabled

## Probe Commands

Once index is generated:

| Command | Use Case |
|---------|----------|
| `paradigm probe` | Map any UI screenshot to code |
| `paradigm probe ui` | Running app screenshot |
| `paradigm probe design` | Mockup/design file analysis |
| `paradigm probe error` | Error screenshot debugging |
| `paradigm probe flow` | Flow diagram matching |
| `paradigm probe diff` | Compare two screenshots |

## File Locations

**Modern projects:**
```
.paradigm/scan-index.json  ✅
```

**Legacy projects:**
```
.paradigm-scan-index.json  ⚠️ (migrate with `paradigm upgrade`)
```

## Index Structure

```json
{
  "$meta": {
    "version": "1.0.0",
    "project": "my-app",
    "generatedAt": "2026-02-04T12:00:00Z"
  },
  
  "components": {
    "Button": {
      "symbol": "#Button",
      "path": "src/components/Button.tsx",
      "visualTags": ["button", "action"],
      "description": "Primary action button"
    }
  },
  
  "features": {
    "checkout": {
      "symbol": "#checkout",
      "path": "src/features/checkout/",
      "screens": ["cart", "shipping", "payment"],
      "description": "Purchase completion"
    }
  },
  
  "flows": {
    "checkout-flow": {
      "symbol": "$checkout-flow",
      "steps": ["cart", "shipping", "payment", "confirm"]
    }
  },
  
  "symbolMap": {
    "#checkout": { "category": "features", "id": "checkout" },
    "#Button": { "category": "components", "id": "Button" }
  }
}
```

## Examples

**Example 1: New project setup**
```bash
paradigm init --quick
paradigm index
# Index ready for visual discovery
```

**Example 2: Screenshot debugging**
```bash
# Update index
paradigm index

# In AI chat with error screenshot:
# "paradigm probe error - where is this rendered?"
# AI: "Error shown by #ErrorBoundary in src/components/ErrorBoundary.tsx"
```

**Example 3: Design handoff**
```bash
# Fresh index
paradigm index

# Attach mockup in AI chat:
# "paradigm probe design - what's missing?"
# AI: "Mockup shows 'Save Draft' button, but #SaveButton doesn't exist"
```

**Example 4: Watch during development**
```bash
# Terminal 1: Watch mode
paradigm index --watch

# Terminal 2: Dev server
npm run dev

# Index auto-updates as you add components
```

## Performance

**Speed:**
- Small projects (<100 components): ~100ms
- Medium projects (100-500): ~200-500ms
- Large projects (500+): ~1-2s

**Index size:**
- Typical: 50-200KB
- Large projects: 500KB-1MB

Safe to commit and regenerate frequently.

## Troubleshooting

**Problem: "Empty scan index generated"**
- Solution: Ensure `.purpose` files exist with components/features
- Check: `paradigm status` to see symbol counts

**Problem: "Visual tags not showing up"**
- Solution: Add `visualTags` array to symbols in `.purpose` files

**Problem: "Index file not found"**
- Solution: Run `paradigm index`, check output path

**Problem: "Probe not finding components"**
- Solution: Regenerate index, add more specific visual tags

**Problem: "`paradigm doctor` says index is stale"**
- Solution: Run `paradigm index` (stale = >24 hours old)

## Watch Mode

```bash
# Auto-regenerate on file changes
paradigm index --watch

# Watches:
# - .purpose files
# - .paradigm/config.yaml
# - Component files (if configured)
```

Useful during active UI development.

## See Also

- [Probe Protocol spec](../specs/probe.md) - Visual discovery details
- [`paradigm beacon`](./beacon.md) - AI orientation file
- [`paradigm status`](./status.md) - Check symbol counts
- [`paradigm doctor`](./doctor.md) - Verify index freshness
- [Symbol System spec](../specs/symbols.md) - Understanding symbols
