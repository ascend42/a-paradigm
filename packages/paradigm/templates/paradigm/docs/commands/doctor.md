# paradigm doctor

Run health checks on your Paradigm setup to verify everything is configured correctly.

## Overview

Validates your Paradigm installation, checks for missing files, verifies configuration, and suggests fixes for any issues found.

## What It Does

**Checks:**
- ✅ `.paradigm/` directory structure
- ✅ `config.yaml` validity (parseable YAML)
- ✅ Specification files (logger.md, symbols.md, probe.md)
- ✅ Documentation directories (docs/, prompts/)
- ✅ Scan index freshness (<24 hours)
- ✅ IDE instruction files
- ✅ Context files (.premise, .purpose)

**Reports:**
- ✓ OK - File exists and valid
- ⚠ Warning - File exists but has issues
- ✗ Error - Critical problem
- ○ Missing - File not found

**Suggests fixes:**
- `paradigm init --force` - Regenerate structure
- `paradigm index` - Update scan index
- `paradigm sync` - Regenerate IDE files
- `paradigm upgrade --all` - Update to latest version

## Why You Need It

**Verify setup:**
- After `paradigm init` - Confirm everything created
- After updates - Ensure compatibility
- Before onboarding - Validate team setup

**Troubleshooting:**
- MCP not working - Check basic setup
- IDE instructions not loading - Verify files exist
- Unknown errors - Start with doctor

**Maintenance:**
- Periodic health checks
- CI/CD validation
- Pre-deployment verification

## When to Run It

### ✅ Run after:
- **`paradigm init`** - Verify setup succeeded
- **`paradigm upgrade`** - Confirm upgrade worked
- **Problems** - First troubleshooting step
- **Team onboarding** - Validate new setup

### 🔄 Periodic:
- **Weekly** - During active development
- **Before releases** - Deployment checklist
- **After major changes** - Structure validation

### ⏩ Fast operation:
- Runs in ~50-200ms
- No side effects

## Usage

```bash
# Run health checks
paradigm doctor

# No arguments needed
```

## Output

```
🩺 Paradigm Doctor

Checking Paradigm setup...

  ✓ .paradigm/                     Directory exists
  ✓ .paradigm/config.yaml          Valid YAML
  ✓ .paradigm/specs/logger.md      Present
  ✓ .paradigm/specs/symbols.md     Present
  ✓ .paradigm/specs/probe.md       Present
  ✓ .paradigm/docs/                Directory exists
  ✓ .paradigm/prompts/             Directory exists
  ○ .paradigm/scan-index.json      Not generated
    └─ Fix: paradigm index
  ✓ .cursor/rules                  Present (cursor)
  ✓ .premise                       Present
  ✓ .purpose                       Present

1 missing found.

Run the suggested commands to fix issues.
```

## Check Details

### Directory Structure
```
✓ .paradigm/                 Core directory exists
✓ .paradigm/docs/            Documentation present
✓ .paradigm/prompts/         Task templates present
```

### Configuration
```
✓ .paradigm/config.yaml      Valid YAML, parseable
  or
✗ .paradigm/config.yaml      Invalid YAML: [error details]
    └─ Fix: Check YAML syntax
```

### Specifications
```
✓ .paradigm/specs/logger.md    Present
✓ .paradigm/specs/symbols.md   Present
✓ .paradigm/specs/probe.md     Present
  or
○ .paradigm/specs/scan.md       Spec file not found
    └─ Fix: paradigm upgrade --all
```

### Scan Index
```
✓ .paradigm/scan-index.json    Fresh (2 hours old)
  or
⚠ .paradigm/scan-index.json    Stale (48 hours old)
    └─ Fix: paradigm index
  or
○ .paradigm/scan-index.json    Not generated
    └─ Fix: paradigm index
```

### IDE Files
```
✓ .cursor/rules                Present (cursor)
  or
○ CLAUDE.md                    Not generated for claude
    └─ Fix: paradigm sync
```

### Context Files
```
✓ .premise                     Present
✓ .purpose                     Present
  or
⚠ .purpose                     Root .purpose not found
    └─ Fix: paradigm init
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All checks passed |
| 1 | Errors or warnings found |

## Integration with Other Commands

**Standard verification:**
```bash
# After setup
paradigm init --quick
paradigm doctor  # Verify

# After updates
paradigm upgrade --all
paradigm doctor  # Confirm
```

**Troubleshooting workflow:**
```bash
# Something's wrong
paradigm doctor  # Check setup

# Follow fix suggestions
paradigm index  # If scan-index stale
paradigm sync   # If IDE files missing

# Verify fix
paradigm doctor
```

## Common Workflows

### After Initial Setup
```bash
paradigm init --quick
paradigm doctor
# Expect: All checks pass
```

### Fixing Issues
```bash
paradigm doctor
# Output shows 3 issues

# Apply fixes
paradigm index
paradigm sync
paradigm upgrade --all

# Verify
paradigm doctor
# Expect: All checks pass
```

### CI/CD Health Check
```bash
#!/bin/bash
# ci-health-check.sh

paradigm doctor
if [ $? -ne 0 ]; then
  echo "❌ Paradigm health check failed"
  exit 1
fi

echo "✅ Paradigm healthy"
```

### Pre-Deployment
```bash
# Check before deploying
paradigm doctor
paradigm status
paradigm constellation

# All green? Deploy.
```

## Tips & Gotchas

**Pro tips:**
- Run after any setup command
- First step in troubleshooting
- Add to CI/CD pipelines
- Fast, no side effects - run liberally
- Follow suggested fixes in order

**Watch out for:**
- Legacy `.paradigm` file (not directory) - needs migration
- Stale scan index - regenerate with `paradigm index`
- Missing specs after upgrade - run `paradigm upgrade --all`
- IDE files for wrong IDE - run `paradigm sync [ide]`

## Issue Categories

### ✓ OK (Green)
Everything working correctly. No action needed.

### ⚠ Warning (Yellow)
Non-critical issues:
- Stale scan index (>24 hours)
- Legacy file format
- Optional files missing

Action: Follow suggestions when convenient.

### ✗ Error (Red)
Critical problems:
- Invalid YAML syntax
- Corrupted configuration
- Missing required files

Action: Fix immediately.

### ○ Missing (Gray)
Files not generated yet:
- Scan index not created
- IDE files not synced
- Optional features not initialized

Action: Run suggested command.

## Examples

**Example 1: Fresh setup verification**
```bash
paradigm init --quick
paradigm doctor

# Expected: All checks pass
```

**Example 2: After team clone**
```bash
git clone repo
cd repo
npm install
paradigm doctor

# May show: scan-index missing (optional)
# Action: paradigm index (if needed)
```

**Example 3: Fixing stale index**
```bash
paradigm doctor
# Output: ⚠ scan-index.json Stale (48 hours old)

paradigm index
paradigm doctor
# Output: ✓ scan-index.json Fresh (0 hours old)
```

**Example 4: Migration check**
```bash
paradigm doctor
# Output: ⚠ Legacy .paradigm file found

paradigm upgrade --all
paradigm doctor
# Output: ✓ All checks pass
```

## Issue Resolution

### "No .paradigm/ directory found"
```bash
paradigm init
```

### "Invalid YAML in config.yaml"
```bash
# Check syntax
cat .paradigm/config.yaml | yaml-lint

# Or regenerate
paradigm init --force
```

### "Scan index stale"
```bash
paradigm index
```

### "IDE files missing"
```bash
paradigm sync
# or for specific IDE
paradigm sync cursor
```

### "Spec files missing"
```bash
paradigm upgrade --all
```

### "Legacy .paradigm file"
```bash
paradigm upgrade --all
```

## What Doctor Doesn't Check

**Not checked:**
- `.purpose` file contents (use `paradigm lint`)
- `portal.yaml` validity (use `paradigm portal validate`)
- Symbol references (use `paradigm status`)
- Code quality
- Git state

**Use other tools:**
- `paradigm lint` - Purpose file validation
- `paradigm portal validate` - Portal syntax
- `paradigm status` - Symbol health

## Performance

- **Speed:** 50-200ms
- **No side effects** - Read-only checks
- **Safe** - Can run anytime

## Troubleshooting

**Problem: "Doctor says all OK but MCP not working"**
- Solution: Run `paradigm mcp status`, not covered by doctor

**Problem: "Doctor passes but IDE not loading rules"**
- Solution: Restart IDE, check IDE-specific config

**Problem: "False positives about missing files"**
- Solution: Some files are optional (scan-index, portal.yaml)

**Problem: "Doctor hangs"**
- Solution: Check for filesystem permissions issues

## See Also

- [`paradigm init`](./init.md) - Initialize Paradigm
- [`paradigm sync`](./sync.md) - Regenerate IDE files
- [`paradigm index`](./index.md) - Update scan index
- [`paradigm upgrade`](./upgrade.md) - Update Paradigm version
- [`paradigm lint`](./lint.md) - Validate purpose files
- [`paradigm mcp status`](./mcp-setup.md#checking-mcp-status) - Check MCP config
