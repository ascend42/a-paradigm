# .purpose File Migration: v1.0.0 to v2.0.0

## What changed

v2.0.0 replaces the v1 symbol prefix system with the v2 symbol system:

| v1 Prefix | v2 Equivalent | Example |
|-----------|---------------|---------|
| `@feature` | `#component` with `tags: [feature]` | `@checkout` -> `#checkout` |
| `&integration` | `#component` with `tags: [integration]` | `&stripe` -> `#stripe` |
| `%state` | `#component` with `tags: [state]` | `%cart` -> `#cart` |
| `?idea` | `[idea]` tag | `?dark-mode` -> tag only |

The v2 symbol prefixes are:

| Symbol | Meaning |
|--------|---------|
| `#` | Component |
| `$` | Flow |
| `^` | Gate |
| `!` | Signal |
| `~` | Aspect |

## What v2.0.0 requires

- All symbols use `# $ ^ ! ~` prefixes (no `@ & % ?`)
- Gates must have `prizes: []` (even if empty)
- Aspects must have `anchors` pointing to source locations
- `version: 2.0.0` as the first YAML field

## How to check your version

```bash
grep "^version:" .purpose
```

To audit all files in a project:

```bash
find . -name ".purpose" -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.git/*" -exec grep -H "^version:" {} \;
```

## Quick migration

If your .purpose file already uses v2 symbols (`#`, `$`, `^`, `!`, `~`) but still says `version: 1.0.0`, update the version field:

```yaml
# Before
version: 1.0.0

# After
version: 2.0.0
```

If the file has no `version:` field at all, add it as the first line:

```yaml
version: 2.0.0
description: ...
```

## Migration log (2026-03-24)

Standardized all 57 source .purpose files to v2.0.0:

- **9 files**: bumped from `version: 1.0.0` to `version: 2.0.0`
- **1 file**: bumped from `version: 0.2.0` to `version: 2.0.0`
- **4 files**: replaced comment-style `# Version: 2.0` with proper `version: 2.0.0` YAML field
- **17 files**: added missing `version: 2.0.0` field
- **26 files**: already had `version: 2.0.0` (no change needed)
- **3 files**: skipped (build artifacts in `dist/` and `.next/`)
