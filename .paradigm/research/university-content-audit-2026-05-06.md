# University Content Audit — 2026-05-06

Auditor: automated content scan (Claude Code)
Scope: `packages/university/src/content/` — all paths, quizzes, notes, and PLSAT exam files

---

## PLSAT Summary

| Property | v2 | v3 |
|---|---|---|
| File | `Q-plsat-v2.yaml` | `Q-plsat-v3.yaml` |
| Questions (canonical) | 50 | 136 canonical entries (99 declared) |
| Variants | 0 | 54 additional variants across canonical slots |
| Pass threshold | 90% | 90% |
| Time limit | 2700 s (45 min) | 5400 s (90 min) |
| `totalSlots` declared | — | 133 |
| YAML parses cleanly | YES | **NO — FATAL PARSE ERROR** |

### PLSAT v3 Fatal Issue

`Q-plsat-v3.yaml` **fails YAML parsing** at line 2966, column 159. The server's `safeLoadYaml()` catches this silently and returns `null`, causing `GET /api/plsat/3` to respond with HTTP 500 `Failed to parse PLSAT exam`. **No student can currently sit the v3 exam.**

Root cause: choice C of question `plsat-131` contains an unquoted string that includes the substring `` `via: "label text"` `` — the colon-space sequence inside an unquoted YAML scalar is treated as a mapping value indicator.

Affected lines (2963–2966):
```yaml
choices:
  C: The `via` field on each link ... To add a label, add `via: "label text"` to ...
```

Fix: wrap choice C in single quotes, or use a block scalar (`|` / `>`).

---

## Content Integrity Issues

### 1. Missing quiz files for LP-para-451

`LP-para-451.yaml` references only the two quizzes that exist (`Q-para-451-when-to-invoke`, `Q-para-451-foundations`). The path YAML comment explicitly acknowledges six more mini-quizzes are deferred:

- `Q-para-451-identity-layers`
- `Q-para-451-archetypes-vs-instances`
- `Q-para-451-tiers`
- `Q-para-451-roster-management`
- `Q-para-451-orchestration-modes`
- `Q-para-451-partners`

These are intentionally deferred, NOT missing from path step references (the steps list only includes the two that exist). No broken references — the note is for tracking completeness debt. PARA 451 has 12 notes and only 2 quizzes; note-only lessons have no self-assessment.

### 2. All path-to-content references are intact

Cross-referencing all nine LP-para-*.yaml path files against the actual files on disk confirms: **no missing note files and no missing quiz files are referenced by active path steps**. Every `N-para-*` and `Q-para-*` ID in the steps arrays has a corresponding file.

---

## Quiz Data Issues

### 3. Two YAML parse errors in course quiz files

**`Q-para-701-arch-mcp-tools.yaml`** — parse error at line 26, column 299.  
Cause: unquoted answer choice string containing a colon-space, similar to the v3 PLSAT issue.

**`Q-para-701-arch-yaml-format.yaml`** — parse error at line 34, column 49.  
Cause: same pattern — unquoted YAML string with `` `id: frontEnd` `` inside a choice value.

Both are PARA 701 quizzes. Any UI component calling `yaml.load()` / `js-yaml` on these files will receive null or throw. These quizzes serve lessons `N-para-701-arch-mcp-tools` and `N-para-701-arch-yaml-format` in `LP-para-701`.

### 4. Two quiz files use wrong schema (options/integer instead of choices/A–E)

**`Q-para-401-notebooks-permissions.yaml`** and **`Q-para-501-review-compliance.yaml`** use `options: [...]` (array) with `correct: 0/1/2` (integer index) instead of the standard `choices: {A: ..., B: ..., C: ...}` with `correct: A/B/C/D/E` format used by all other quizzes.

The server type `PackQuizQuestion` declares `choices: Record<string, string>` and `correct: string`. These two files will not render correctly in the UI — choices will be empty (`{}`) and the correct field will be a non-matching integer string.

Affected questions:
- `Q-401-NP-002`, `Q-401-NP-003`, `Q-401-NP-004`, `Q-401-NP-005` (4 of 5 questions in the file — Q-401-NP-001 also uses integer correct)
- `Q-501-RC-001` through `Q-501-RC-005` (all 5 questions)

Note: these questions have valid content and explanations — only the schema needs converting.

### 5. v2 PLSAT — all 50 questions well-formed

`Q-plsat-v2.yaml` parses cleanly. All 50 questions have `explanation` fields. All `correct` keys (A–E) match a key in each question's `choices` map. No structural issues found.

### 6. v3 PLSAT — questions 001–130 well-formed (where parsed)

All questions read from `Q-plsat-v3.yaml` before the parse error at question `plsat-131` have valid structure: explanation present, correct key matches choices A–E, scenarios are complete. The file must be fixed before full structural validation of questions 131–133 can be confirmed.

---

## Stale Content (v5 vs v6 Drift)

### 7. `N-para-101-first-steps.md` references deprecated wisdom workflow

Lines 124–125 of `N-para-101-first-steps.md` instruct learners to:
```
Record team decisions in `.paradigm/wisdom/decisions.yaml`
Log antipatterns in `.paradigm/wisdom/antipatterns.yaml`
```

In v6.0 decisions moved to `.paradigm/decisions/TD-*.yaml` via `paradigm_decision_record`. The `wisdom/decisions.yaml` file no longer exists as the target storage path. This conflicts with what PARA 301 (N-para-301-decisions.md and Q-para-301-decisions.yaml) correctly teaches.

The note also lists `paradigm scan` as a recurring maintenance command (line 126, 132). `paradigm scan` still exists, but the primary reindex mechanism is now `paradigm_reindex` via MCP. Not a hard error, but a potential point of confusion.

### 8. `N-para-201-disciplines.md` uses `paradigm init` (compatible but note-worthy)

Lines 29 and 162–165 of `N-para-201-disciplines.md` reference `paradigm init` with flags like `--stack nextjs`. The canonical setup command since v2 is `paradigm shift`. The `init` alias still works in v6 (and the v3 PLSAT includes questions about `paradigm init`), but the note should clarify that `paradigm shift` is the primary command and `init` is an alias.

This is low-severity — `paradigm init` is a valid documented alias, and the PLSAT v3 questions (plsat-097 through plsat-099) explicitly test knowledge of `paradigm init`. Content is internally consistent for v3 PLSAT preparation.

### 9. `N-para-301-decisions.md` — correctly updated for v6

Table at line 74 correctly shows the v5→v6 migration (`.paradigm/wisdom/decisions.yaml` vs `.paradigm/decisions/TD-*.yaml`). The quiz `Q-para-301-decisions.yaml` is also correct — answer C is `paradigm_decision_record` not the deprecated wisdom API. No issues here.

### 10. Notes reference `paradigm_wisdom_record` without v6 caveat

`N-para-401-mcp-tools-overview.md` line 41 notes the v6 restriction: `paradigm_wisdom_record` no longer accepts `type: 'decision'`. This is documented correctly. The PLSAT v2 question plsat-033 also includes the parenthetical `(Note: paradigm_wisdom_record no longer accepts type: 'decision' in v6.0)`. No incorrect advice found.

---

## Content Gaps for PLSAT Success

### Gap 1: PLSAT v3 sections 601 and 701 are not covered by any course

PLSAT v3 questions cover sections `para-601` (Ambient/learning loop) and `para-701` (Agent mastery/arch.yaml). While LP-para-601 and LP-para-701 exist with complete notes and quizzes, a student taking only PARA 001–501 would be unprepared for v3 questions on:
- `paradigm_arch_status`, `paradigm_arch_diagram`, Atlas agent behavior (plsat-128 through plsat-133)
- Symphony The Score messaging protocol (plsat-103 through plsat-107)
- Aspect graph materialization pipeline (plsat-081 through plsat-086)
- Auto-lore drafting mechanics (plsat-067, plsat-074)

**Recommendation:** The v3 exam description should explicitly recommend completing PARA 601 and PARA 701 before attempting, or the exam should filter by declared prerequisite courses.

### Gap 2: PARA 451 has no mastery quiz

`LP-para-451.yaml` (Agents Foundations) covers 12 lessons with notes but delivers only 2 quizzes. The deferred mini-quizzes (identity-layers, archetypes-vs-instances, tiers, roster-management, orchestration-modes, partners) leave 6 of the 12 conceptual areas with no self-assessment. Students preparing for v3 PLSAT questions on agents (plsat-101–104, plsat-128–130) may lack reinforcement on tier taxonomy and orchestration modes.

### Gap 3: Enforcement levels — `none` as default not covered in v2 PLSAT

PLSAT v2 (50 questions) has no questions about enforcement levels or the `none` default introduced in v6.3.0. PLSAT v3 also has no enforcement-level questions (confirmed across all 133 canonical slots). The notes `N-para-301-enforcement-levels.md` and `N-para-301-rune-promotion.md` are both updated (updated: 2026-05-04) and accurate. Students studying these notes are well-prepared for enforcement concepts, but the absence of PLSAT questions means this topic will not appear on the exam.

### Gap 4: PARA 451 missing `N-para-451-mastery-review`

`LP-para-451.yaml` comments state the `N-para-451-mastery-review` note is deferred. This note exists in the file listing, but is not referenced in any path step. It cannot serve as a capstone until added to the step list.

---

## Summary Table

| Issue | Severity | File(s) |
|---|---|---|
| v3 PLSAT YAML parse error — exam completely broken | CRITICAL | `Q-plsat-v3.yaml` line 2966 |
| `Q-para-701-arch-mcp-tools.yaml` YAML parse error | HIGH | `Q-para-701-arch-mcp-tools.yaml` line 26 |
| `Q-para-701-arch-yaml-format.yaml` YAML parse error | HIGH | `Q-para-701-arch-yaml-format.yaml` line 34 |
| `Q-para-401-notebooks-permissions.yaml` wrong schema | HIGH | all 5 questions — `options`/integer format |
| `Q-para-501-review-compliance.yaml` wrong schema | HIGH | all 5 questions — `options`/integer format |
| `N-para-101-first-steps.md` stale wisdom paths | MEDIUM | lines 124–125 |
| PLSAT v3 covers 601/701 not flagged as prerequisite | MEDIUM | `Q-plsat-v3.yaml` description |
| PARA 451 has no mini-quizzes (deferred) | LOW | `LP-para-451.yaml` (known debt) |
| `N-para-201-disciplines.md` uses `paradigm init` alias | LOW | lines 29, 162–165 |

---

## Fix Priority for PLSAT Readiness Today

1. **Fix `Q-plsat-v3.yaml` line 2966** — wrap choice C of plsat-131 in single quotes so the exam is servable. This is the only blocker for taking v3 today.
2. **Fix `Q-para-701-arch-mcp-tools.yaml` and `Q-para-701-arch-yaml-format.yaml`** — same unquoted colon pattern, breaks PARA 701 quizzes.
3. **Convert `Q-para-401-notebooks-permissions.yaml` and `Q-para-501-review-compliance.yaml`** to A–E choices schema.
4. **Update `N-para-101-first-steps.md`** to replace `wisdom/decisions.yaml` with `paradigm_decision_record` workflow.
5. If taking v3: complete PARA 601 and PARA 701 before attempting — those sections have live questions in v3 with no prerequisite warning.
