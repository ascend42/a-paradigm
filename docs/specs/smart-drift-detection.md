# Smart Drift Detection — Spec

> Upgrade `paradigm_aspect_drift` from a brittle hash-and-pray tripwire to a git-aware, content-normalizing, self-healing anchor system.

## Problem

Today's drift detection (`aspect-graph.ts:653-720`) is purely positional:

1. Read exact lines `[startLine, endLine]` from disk
2. SHA-256 the raw content
3. Compare against stored hash
4. Binary result: match or drift

This breaks on routine edits:

| Scenario | What Happens | Should Happen |
|----------|-------------|---------------|
| Add a blank line above the anchor | Hash changes → false drift | Recognize code shifted, update anchor |
| Reformat with prettier | Hash changes → false drift | Normalize whitespace, no drift |
| Rename a variable inside the anchor | Hash changes → real drift | Report as real drift (semantic change) |
| Move function to a different file | File missing → drift | Track the move, update anchor path |
| Add 50 lines above in same file | Reads wrong lines entirely | Shift anchor lines by +50 |

**Result:** On any active codebase, drift reports are noisy enough that teams ignore them — defeating the purpose.

---

## Design: Three-Layer Detection

Each layer is independent and progressively more expensive. Short-circuit on the first confident result.

```
┌─────────────────────────────────────┐
│  Layer 1: Normalized Hash Match     │  ~1ms per anchor
│  Strip whitespace, normalize, hash  │
│  → match = clean, no further work   │
├─────────────────────────────────────┤
│  Layer 2: Git-Aware Line Mapping    │  ~5ms per anchor
│  git diff → compute line shifts     │
│  Re-read at adjusted lines → hash   │
├─────────────────────────────────────┤
│  Layer 3: Content Fingerprint Search│  ~20ms per anchor
│  Sliding window search in file      │
│  Levenshtein on normalized content  │
│  → relocate or confirm real drift   │
└─────────────────────────────────────┘
```

### Layer 1: Normalized Hash Match

**Goal:** Eliminate false drift from formatting changes.

Before hashing, normalize the content:

```typescript
function normalizeForHash(content: string): string {
  return content
    .split('\n')
    .map(line => line.trimEnd())       // trailing whitespace
    .filter(line => line.trim() !== '') // blank lines
    .map(line => line.replace(/\s+/g, ' ')) // collapse internal whitespace
    .join('\n');
}
```

Store **two hashes** per anchor:
- `content_hash` — exact hash (current behavior, for precise detection)
- `normalized_hash` — normalized hash (for format-tolerant comparison)

**Decision matrix:**

| Exact Match | Normalized Match | Verdict |
|-------------|-----------------|---------|
| Yes | Yes | Clean |
| No | Yes | Format drift (cosmetic) — auto-update exact hash |
| No | No | Proceed to Layer 2 |

**Schema change:**

```sql
ALTER TABLE anchors ADD COLUMN normalized_hash TEXT;
```

### Layer 2: Git-Aware Line Mapping

**Goal:** Handle line shifts from edits elsewhere in the file.

Use `git diff` to compute how lines in the anchor's file have shifted since the last materialization.

```typescript
interface LineMapping {
  originalStart: number;
  originalEnd: number;
  currentStart: number;
  currentEnd: number;
  confidence: 'exact' | 'heuristic';
}
```

**Algorithm:**

1. Store the commit hash at materialization time:
   ```sql
   ALTER TABLE anchors ADD COLUMN materialized_at_commit TEXT;
   ```

2. On drift check, compute the line shift:
   ```bash
   git diff <materialized_commit>..HEAD -- <file_path>
   ```

3. Parse the unified diff hunks to build a line-number translation table:
   ```
   @@ -12,8 +12,13 @@    →  lines 12-19 became 12-24 (5 lines added)
   @@ -30,4 +35,4 @@    →  lines 30-33 shifted to 35-38
   ```

4. Translate the stored anchor range through the mapping:
   - If anchor was `15-35` and 5 lines were inserted at line 10, new range is `20-40`
   - Read content at `20-40`, hash it, compare against stored hash

5. If the translated content matches → **auto-heal**: update the anchor's line numbers in the DB and in the `.purpose` file.

**Edge cases:**
- Anchor range overlaps a diff hunk (lines were modified *within* the anchor) → skip to Layer 3
- File was renamed → `git diff --follow` or `git log --follow --diff-filter=R` to detect renames
- No git history (new file, shallow clone) → skip to Layer 3

**Implementation:**

```typescript
async function computeLineShift(
  rootDir: string,
  filePath: string,
  fromCommit: string,
  originalStart: number,
  originalEnd: number,
): Promise<LineMapping | null> {
  // 1. Run git diff with line-number context
  const diff = execSync(
    `git diff ${fromCommit}..HEAD --unified=0 -- "${filePath}"`,
    { cwd: rootDir, encoding: 'utf8' }
  );

  // 2. Parse @@ hunks into offset accumulator
  //    Each hunk: @@ -oldStart,oldCount +newStart,newCount @@
  //    Track cumulative line offset as we pass each hunk
  const hunks = parseUnifiedDiffHunks(diff);
  let offset = 0;
  let overlapsAnchor = false;

  for (const hunk of hunks) {
    // If this hunk is entirely before the anchor, accumulate offset
    if (hunk.oldStart + hunk.oldCount <= originalStart) {
      offset += (hunk.newCount - hunk.oldCount);
      continue;
    }
    // If this hunk overlaps the anchor range, we can't just shift
    if (hunk.oldStart < originalEnd) {
      overlapsAnchor = true;
      break;
    }
    // Hunk is after the anchor — no more offsets to accumulate
    break;
  }

  if (overlapsAnchor) return null; // Can't map — content was modified in-place

  return {
    originalStart,
    originalEnd,
    currentStart: originalStart + offset,
    currentEnd: originalEnd + offset,
    confidence: 'exact',
  };
}
```

### Layer 3: Content Fingerprint Search

**Goal:** Relocate anchors when git mapping fails or isn't available.

When Layers 1 and 2 fail, search the file for the original content using fuzzy matching.

**Algorithm:**

1. Retrieve the **original normalized content** (stored at materialization time):
   ```sql
   ALTER TABLE anchors ADD COLUMN original_content TEXT;  -- normalized snapshot
   ```

2. Generate a **fingerprint** — the first and last non-empty lines plus a structural signature:
   ```typescript
   interface ContentFingerprint {
     firstLine: string;        // normalized first meaningful line
     lastLine: string;         // normalized last meaningful line
     lineCount: number;        // expected range size
     structuralHash: string;   // hash of line-start tokens (function, if, class, return, etc.)
   }
   ```

3. **Sliding window search** across the file:
   - Window size = original line count ± 20%
   - For each window position, compute Levenshtein similarity against the normalized original
   - Track the best match above a 0.7 threshold

4. **Scoring:**

   | Signal | Weight | What It Catches |
   |--------|--------|-----------------|
   | First/last line exact match | 0.4 | Function signature + closing brace didn't change |
   | Structural hash match | 0.3 | Same control flow structure (if/else/return pattern) |
   | Levenshtein similarity ≥ 0.8 | 0.2 | Minor variable renames, comment changes |
   | Line count within ±20% | 0.1 | Code wasn't significantly expanded or collapsed |

5. **Thresholds:**
   - Score ≥ 0.85 → **auto-relocate** (update anchor, log the change)
   - Score 0.7–0.85 → **suggest relocation** (return new lines as a suggestion, don't auto-apply)
   - Score < 0.7 → **real drift** (content genuinely changed, flag for human review)

**Cross-file search** (when file exists but content score < 0.7):

1. Check `git log --follow --diff-filter=R -- <file_path>` for renames
2. If renamed, repeat Layer 3 search in the new file
3. If not renamed but content is gone, search sibling files in the same directory (limit: 10 files) for the fingerprint
4. Cross-file matches always require human confirmation (never auto-apply)

---

## DriftResult v2

```typescript
export interface DriftResult {
  aspectId: string;
  path: string;
  startLine: number;
  endLine: number;

  // Core verdict
  status: 'clean' | 'cosmetic' | 'shifted' | 'relocated' | 'modified' | 'missing';
  confidence: number;  // 0.0 - 1.0

  // What was the file state?
  exists: boolean;

  // Layer that resolved the check
  resolvedBy: 'normalized-hash' | 'git-line-mapping' | 'content-search' | 'none';

  // For shifted/relocated anchors
  suggestedStart?: number;
  suggestedEnd?: number;
  suggestedPath?: string;  // only if cross-file relocation

  // For modified anchors (real drift)
  currentContent?: string;
  similarity?: number;  // Levenshtein score vs original

  // Auto-heal action taken (if any)
  autoHealed?: boolean;
}
```

**Status meanings:**

| Status | Meaning | Action |
|--------|---------|--------|
| `clean` | Content matches exactly | None |
| `cosmetic` | Only whitespace/formatting changed | Auto-update exact hash |
| `shifted` | Code moved within the file (same content) | Auto-update line numbers |
| `relocated` | Code moved to a different file | Suggest new path + lines |
| `modified` | Content genuinely changed | Flag for review |
| `missing` | File no longer exists | Flag for review |

---

## Auto-Healing

When drift is resolved with high confidence, the system can auto-update:

### What gets auto-healed (no confirmation needed):

| Status | Confidence | Action |
|--------|-----------|--------|
| `cosmetic` | any | Update `content_hash` in DB |
| `shifted` | `exact` from git | Update `start_line`/`end_line` in DB + `.purpose` file |
| `shifted` | ≥ 0.85 from search | Update lines in DB + `.purpose` file |

### What gets suggested (confirmation needed):

| Status | Confidence | Action |
|--------|-----------|--------|
| `shifted` | 0.7–0.85 | Return suggestion, don't apply |
| `relocated` | any | Return suggestion with new file path |
| `modified` | any | Flag only, never auto-heal |

### .purpose file rewriting

When auto-healing a line shift, update the `.purpose` file anchor in-place:

```yaml
# Before
anchors:
  - src/middleware/rate-limit.ts:15-35

# After (auto-healed: 5 lines inserted above)
anchors:
  - src/middleware/rate-limit.ts:20-40
```

Use a YAML-aware edit (find the anchor string, replace the line range) rather than a full rewrite to preserve formatting and comments.

---

## Schema Migration

Version the anchor table from v1 → v2:

```sql
-- New columns
ALTER TABLE anchors ADD COLUMN normalized_hash TEXT;
ALTER TABLE anchors ADD COLUMN materialized_at_commit TEXT;
ALTER TABLE anchors ADD COLUMN original_content TEXT;

-- New table for tracking auto-heal history
CREATE TABLE IF NOT EXISTS anchor_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anchor_id INTEGER NOT NULL REFERENCES anchors(id),
  action TEXT NOT NULL,          -- 'shifted' | 'cosmetic' | 'relocated'
  old_start INTEGER,
  old_end INTEGER,
  new_start INTEGER,
  new_end INTEGER,
  old_path TEXT,
  new_path TEXT,
  confidence REAL,
  commit_hash TEXT,              -- git HEAD at time of heal
  healed_at TEXT NOT NULL
);
```

On `paradigm_reindex` (materialization):
- Compute and store both `content_hash` and `normalized_hash`
- Store `original_content` (normalized, for Layer 3 search)
- Record current `git rev-parse HEAD` as `materialized_at_commit`

---

## Tool Interface Changes

### paradigm_aspect_drift (updated)

```typescript
{
  name: 'paradigm_aspect_drift',
  description: 'Check anchor integrity with smart re-anchoring. Detects line shifts, formatting changes, and code relocations. Auto-heals high-confidence shifts. ~200 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      aspectId: { type: 'string', description: 'Scope to a single aspect (optional)' },
      autoHeal: { type: 'boolean', description: 'Auto-update anchors for high-confidence shifts (default: true)' },
      deep: { type: 'boolean', description: 'Run all 3 layers even if Layer 1 passes (default: false)' },
    },
  },
}
```

### New tool: paradigm_aspect_anchor_fix

For applying suggested relocations that need confirmation:

```typescript
{
  name: 'paradigm_aspect_anchor_fix',
  description: 'Apply a suggested anchor relocation from drift detection. Updates both the DB and .purpose file. ~100 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      aspectId: { type: 'string', description: 'Aspect to fix' },
      anchorPath: { type: 'string', description: 'Current anchor file path' },
      newStart: { type: 'number', description: 'New start line' },
      newEnd: { type: 'number', description: 'New end line' },
      newPath: { type: 'string', description: 'New file path (for cross-file relocations)' },
    },
    required: ['aspectId', 'newStart', 'newEnd'],
  },
}
```

---

## Performance Budget

| Layer | Per Anchor | For 200 Anchors | Notes |
|-------|-----------|-----------------|-------|
| Layer 1 (normalize + hash) | ~1ms | ~200ms | Pure computation, no I/O beyond file read |
| Layer 2 (git diff) | ~5ms | ~1s | One `git diff` per unique file (deduplicate) |
| Layer 3 (content search) | ~20ms | ~4s (worst case) | Only runs on Layer 1+2 failures |
| **Total (typical)** | — | **~500ms** | Most anchors resolve at Layer 1 |
| **Total (worst case)** | — | **~5s** | Every anchor needs Layer 3 (unlikely) |

Optimization: batch `git diff` calls per file (one diff per file, not per anchor).

---

## Implementation Plan

### Phase 1: Normalized Hashing (low risk, high value)
- Add `normalizeForHash()` utility
- Add `normalized_hash` column to schema
- Compute both hashes during materialization
- Update `checkDrift` to check normalized hash as fallback
- **Eliminates:** formatter-induced false drift

### Phase 2: Git Line Mapping (medium risk, high value)
- Add `materialized_at_commit` column
- Record HEAD commit during materialization
- Implement `computeLineShift()` with unified diff parsing
- Add auto-heal for `shifted` status with exact confidence
- Update `.purpose` files in-place for shifted anchors
- **Eliminates:** false drift from edits elsewhere in the file

### Phase 3: Content Fingerprint Search (medium risk, medium value)
- Add `original_content` column
- Implement `ContentFingerprint` generation
- Implement sliding window search with Levenshtein scoring
- Add `anchor_history` table for audit trail
- Cross-file search via git rename detection
- **Eliminates:** false drift from refactors and file moves

### Phase 4: Tool & UX Updates
- Update `paradigm_aspect_drift` tool with new `autoHeal` and `deep` params
- Add `paradigm_aspect_anchor_fix` tool
- Update `DriftResult` type with v2 fields
- Update `paradigm doctor` to report auto-healed anchors
- Add `--dry-run` flag for drift check (show what would auto-heal without applying)

---

## Backwards Compatibility

- New columns are all nullable → existing DBs work without migration
- Old `content_hash` behavior is preserved as-is (Layer 1 exact match)
- `autoHeal` defaults to `true` but can be disabled
- `anchor_history` provides full audit trail of any auto-applied changes
- `.purpose` file edits use surgical string replacement, not full rewrites
