# Paradigm Symbol System v2 Update Prompt

Use this prompt to have Claude update all paradigm-related files in a project to the v2 symbol format.

---

## Prompt for Claude

```
You are updating a project to use Paradigm Symbol System v2. This involves converting all .purpose files, portal.yaml, and related documentation to use the simplified 5-symbol system with tag-based classification.

## Symbol System v2

| Symbol | Name | Purpose | Example |
|--------|------|---------|---------|
| `#` | Component | Any documented code unit | `#PaymentService`, `#Button` |
| `$` | Flow | Multi-step process with sequence | `$checkout-flow` |
| `^` | Gate | Authorization/validation checkpoint | `^authenticated` |
| `!` | Signal | Event emitted for side effects | `!payment-completed` |
| `~` | Aspect | Rule/constraint with REQUIRED code anchor | `~audit-required` |

## Legacy Symbol Conversions

Convert these old symbols to #component with appropriate tags:

| Old Symbol | New Symbol | Tag |
|------------|------------|-----|
| `@feature` | `#feature` | `[feature]` |
| `&integration` | `#integration` | `[integration]` |
| `%state` | `#state` | `[state]` |
| `?idea` | `#idea` | `[idea]` |

## Tasks

1. **Find all .purpose files** in the project
2. **Convert each symbol** according to the mapping above
3. **Add tags field** to converted symbols
4. **Add anchors** to aspects (REQUIRED for ~aspects)
5. **Update portal.yaml** if it exists - CRITICAL: must match exact format below
6. **Create .paradigm/tags.yaml** if it doesn't exist
7. **Check for false positive sources** (see Pitfalls section)

## .purpose File v2 Format

```yaml
description: "What this directory/module does"

# Components (#) - the universal code unit
components:
  payment-service:
    description: Handles payment processing
    tags: [feature, integration, stripe]
    anchors:
      - src/services/payment.ts:1-150

# Flows ($) - multi-step processes
flows:
  checkout-flow:
    description: Complete purchase flow
    tags: [critical, revenue]
    gates: ["^authenticated", "^payment-authorized"]
    signals: ["!payment-completed", "!checkout-failed"]

# Gates (^) - authorization checkpoints (usually in portal.yaml, but can be here)
gates:
  authenticated:
    description: User must be logged in
    tags: [security]
    anchors:
      - src/middleware/auth.ts:25-45

# Signals (!) - events for side effects
signals:
  payment-completed:
    description: Emitted when payment succeeds
    tags: [audit, critical]
    payload:
      orderId: string
      amount: number

# Aspects (~) - rules with REQUIRED anchors
aspects:
  audit-required:
    description: All financial operations must log to audit trail
    tags: [compliance, security]
    anchors:                    # REQUIRED for aspects!
      - src/middleware/audit.ts:15-35
    applies-to:
      - "#*Service"
    enforcement: |
      Every matching component must use @auditable decorator

# Ideas - future work (optional section)
ideas:
  subscription-model:
    description: Future subscription billing
    tags: [idea, revenue]
```

## portal.yaml Format - CRITICAL

**This format is EXACT. Deviations will cause gates to not be parsed.**

```yaml
version: "1.0.0"

gates:
  admin-auth:                          # NO ^ prefix - parser adds it
    description: "Admin authentication"
    locks:                             # MUST be array format
      - id: check-admin                # Each lock needs id
        description: "User must be admin"
        keys:                          # Keys array with expressions
          - expression: "user.role === 'admin'"
        mode: all                      # 'all' or 'any', default: all
    prizes:                            # MUST be array of objects
      - id: admin-access               # Each prize needs id
        oneTime: false

  rate-limit:
    description: "API rate limiting"
    locks:
      - id: rate-check
        keys:
          - expression: "rateLimit.remaining > 0"
    prizes: []                         # Can be empty array, but must exist

flows:
  auth-flow:                           # NO $ prefix - parser adds it
    description: "Authentication flow"
    gates:                             # Use 'gates:', NOT 'sequence:'
      - rate-limit                     # Reference by ID (no ^ prefix)
      - admin-auth

settings:
  dev:
    visualizerPort: 42195
    watcherPort: 42196
    autoConnect: true
```

### portal.yaml Common Mistakes

| Wrong | Correct |
|-------|---------|
| `^admin-auth:` | `admin-auth:` (no ^ in key) |
| `locks: { check: ... }` | `locks: [{ id: check, ... }]` (array, not object) |
| `prizes: ["feature:x"]` | `prizes: [{ id: feature-x }]` (objects, not strings) |
| `sequence: [a, b]` | `gates: [a, b]` (gates, not sequence) |
| `requires: [...]` | `locks: [{ id: x, keys: [...] }]` (v2 format) |

## Tag Bank Format (.paradigm/tags.yaml)

```yaml
version: "1.0"

core:
  feature:
    description: User-facing functionality
    color: "#4CAF50"
    applies-to: ["#"]
  integration:
    description: External service connection
    color: "#2196F3"
    applies-to: ["#"]
  state:
    description: Manages application state
    color: "#9C27B0"
    applies-to: ["#"]
  critical:
    description: Failure causes major business impact
    color: "#F44336"
    applies-to: ["#", "$", "^"]
  security:
    description: Security-sensitive code
    color: "#E91E63"
    applies-to: ["#", "^", "~"]
  idea:
    description: Proposed, not yet implemented
    color: "#FF9800"
    applies-to: ["#", "$"]

project: {}

suggested: []
```

## Pitfalls - False Positive Sources

**IMPORTANT:** These patterns in .purpose files will cause false symbol detection:

### 1. Prices in descriptions
```yaml
# BAD - $420 will be detected as a flow
rates: "Hourly booking ($420.69), Ad CPM ($0.42)"

# GOOD - escape or rephrase
rates: "Hourly booking (420.69 USD), Ad CPM (0.42 USD)"
```

### 2. Framework imports in usage examples (SvelteKit, Vite)
```yaml
# BAD - $lib will be detected as a flow
usage: |
  import { db } from '$lib/server/db';

# GOOD - use backticks or rephrase
usage: |
  import { db } from `$lib/server/db`;
  # Or just reference the file path instead
```

### 3. Shell variables
```yaml
# BAD - $HOME, $PATH will be detected
command: "export $HOME/bin"

# GOOD - escape
command: "export \\$HOME/bin"
```

### 4. Signals in x-paradigm extension sections
```yaml
# BAD - signals here won't be parsed by Sentinel
x-paradigm:
  signals:
    my-signal: ...

# GOOD - put signals in .purpose files under signals: key
signals:
  my-signal:
    description: ...
```

## Anchor Format

Line-based references for precision:
- `file.ts:15` - Single line
- `file.ts:15-20` - Line range
- `file.ts:15,25,30` - Multiple specific lines

## Checklist

### For each .purpose file:
- [ ] Convert @ symbols to # with [feature] tag
- [ ] Convert & symbols to # with [integration] tag
- [ ] Convert % symbols to # with [state] tag
- [ ] Convert ? symbols to # with [idea] tag
- [ ] Add anchors to all ~ aspects (REQUIRED)
- [ ] Add tags field to all symbols
- [ ] Check for false positive sources (prices, imports)
- [ ] Move signals from x-paradigm sections to signals: key

### For portal.yaml (if exists):
- [ ] Ensure version is "1.0.0"
- [ ] Gate keys have NO ^ prefix
- [ ] locks: is an ARRAY of objects with id, keys fields
- [ ] prizes: is an ARRAY of objects with id field (or empty [])
- [ ] flows: uses gates: not sequence:
- [ ] Flow gate references have NO ^ prefix

### For the project:
- [ ] Create .paradigm/tags.yaml if missing
- [ ] Update .premise file if it exists (sources.gate path)
- [ ] Update CLAUDE.md symbol table if present
- [ ] Remove any x-paradigm extension sections (move to proper locations)

## Debugging

After migration, run Sentinel with debug logging:
```bash
SENTINEL_LOG_LEVEL=debug npx sentinel
```

This will show:
- Which .purpose files are loaded
- Which portal.yaml files are loaded
- Each symbol extracted
- Any parsing errors

If symbols are missing, check the logs for:
- "Aggregation error" messages
- Missing files in "Loaded .purpose file" output
- Gate count in "Aggregation complete" output

## Important Rules

1. **Aspects MUST have anchors** - An aspect without code backing is invalid
2. **Use tags for classification** - Not symbol prefixes
3. **Keep gates as ^** - No change needed (but portal.yaml keys have no ^)
4. **Keep signals as !** - No change needed
5. **Keep flows as $** - No change needed
6. **Convert @, &, %, ? to #** - With appropriate tags
7. **portal.yaml format is strict** - Follow exactly or gates won't parse

Now scan the project for .purpose files and update them to v2 format.
```

---

## Usage

Copy the prompt above and paste it into a new Claude session, then ask Claude to:

1. "Scan this project for all .purpose files"
2. "Update each file to v2 format"
3. "Check and fix portal.yaml format"
4. "Create .paradigm/tags.yaml if needed"
5. "Show me the changes before committing"

Or simply say: "Update this project to Paradigm v2" after pasting the prompt.

## Verification

After migration, verify with Sentinel:

```bash
# In your project directory
SENTINEL_LOG_LEVEL=debug npx sentinel

# You should see:
# - All .purpose files loaded
# - portal.yaml loaded (if exists)
# - Correct symbol counts by type
# - No "Aggregation error" messages
```

If gates don't appear in Sentinel UI, check:
1. portal.yaml format matches exactly
2. No ^ prefix on gate keys
3. locks/prizes are arrays, not objects
