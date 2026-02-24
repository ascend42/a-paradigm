# Habits Specification

The habits system enforces behavioral discipline during AI-assisted development sessions by evaluating compliance at defined trigger points.

---

## Check Types

Each habit definition specifies a `check.type` that determines how compliance is evaluated.

### Core Check Types

| Check Type | What It Verifies | Parameters |
|---|---|---|
| `tool-called` | Specified MCP tools were invoked during the session | `tools: string[]` — any one tool suffices |
| `file-exists` | Files matching glob patterns exist | `patterns: string[]` — glob patterns |
| `file-modified` | Files matching patterns were modified | `patterns: string[]` — glob patterns |
| `lore-recorded` | A lore entry was created (for 3+ file sessions) | *(none)* |
| `symbols-registered` | New code is registered in .purpose files | `minSymbols?: number` |
| `gates-declared` | Routes have corresponding gates in portal.yaml | `requireRoutes?: boolean` |
| `tests-exist` | Test files exist for modified components | `patterns: string[]` — e.g. `["**/*.test.*"]` |
| `git-clean` | Git working tree is clean | *(none)* |

### Extended Check Types

| Check Type | What It Verifies | Parameters |
|---|---|---|
| `commit-message-format` | Commit messages match required patterns | `messagePatterns?: string[]` — regex patterns (default: conventional commit + Symbols: trailer) |
| `flow-coverage` | Multi-component changes have documented flows | `minSteps?: number` — minimum components to trigger (default: 3) |
| `context-checked` | Session context/recovery tools were called | `contextTools?: string[]` — tool names (default: paradigm_context_check, paradigm_session_recover, paradigm_session_checkpoint) |
| `aspect-anchored` | Touched aspects have valid code anchors | `checkAnchors?: boolean` |

---

## Triggers

| Trigger | When Evaluated | Typical Use |
|---|---|---|
| `preflight` | Before implementation starts | Discovery habits (ripple, navigate, wisdom) |
| `postflight` | After implementation completes | Verification habits (tests, purpose, flows) |
| `on-commit` | Before committing changes | Commit message format, git cleanliness |
| `on-stop` | Before session ends | Lore recording, postflight, verification |

---

## Severity Levels

| Severity | Behavior |
|---|---|
| `advisory` | Log a note, don't block |
| `warn` | Show a warning to the agent/user |
| `block` | Prevent session completion until resolved |

---

## Categories

| Category | Discipline | Example Habits |
|---|---|---|
| `discovery` | Exploring before acting | ripple-before-modify, check-fragility, context-session-awareness |
| `verification` | Validating after implementing | verify-before-done, postflight-compliance, aspect-anchors-valid |
| `testing` | Ensuring test coverage | test-new-components |
| `documentation` | Keeping metadata current | purpose-coverage, record-lore-for-significant, commit-message-symbols, flow-coverage |
| `collaboration` | Checking team knowledge | wisdom-before-implement |
| `security` | Validating gate compliance | gates-for-routes |

---

## Seed Habits

Paradigm ships with 14 built-in habits:

| ID | Category | Trigger | Severity |
|---|---|---|---|
| explore-before-implement | discovery | preflight | advisory |
| ripple-before-modify | discovery | preflight | advisory |
| check-fragility | discovery | preflight | advisory |
| wisdom-before-implement | collaboration | preflight | advisory |
| context-session-awareness | discovery | preflight | advisory |
| verify-before-done | verification | on-stop | warn |
| postflight-compliance | verification | on-stop | advisory |
| test-new-components | testing | postflight | advisory |
| purpose-coverage | documentation | postflight | warn |
| record-lore-for-significant | documentation | on-stop | warn |
| gates-for-routes | security | postflight | warn |
| commit-message-symbols | documentation | on-commit | advisory |
| flow-coverage-for-multi-component | documentation | postflight | advisory |
| aspect-anchors-valid | verification | postflight | advisory |

---

## Evaluation Context

The evaluator builds an `EvaluationContext` from session data:

```typescript
interface EvaluationContext {
  toolsCalled: string[];      // MCP tools invoked
  filesModified: string[];    // Files changed
  symbolsTouched: string[];   // Symbols affected
  loreRecorded: boolean;      // Whether lore was created
  hasPortalRoutes: boolean;   // portal.yaml has routes
  taskAddsRoutes: boolean;    // Task involves routes
  taskDescription?: string;   // Task summary
  gitClean?: boolean;         // Git working tree state
  commitMessage?: string;     // Last commit message
  hasFlowCoverage?: boolean;  // Flows exist for multi-component changes
  aspectAnchorsValid?: boolean; // Aspects have valid anchors
}
```

---

## Loading Order

Habits merge from three sources (later wins):

1. **Seed habits** — Built-in defaults (always present)
2. **Global habits** — `~/.paradigm/habits.yaml` (user-wide)
3. **Project habits** — `.paradigm/habits.yaml` (project-specific)

Overrides in project or global config can change `severity` and `enabled` for any seed habit without redefining it.

---

## Practice Tracking

Every evaluation produces a `PracticeEvent` with result: `followed`, `skipped`, or `partial`. These events accumulate into practice profiles showing compliance rates, category breakdowns, trends, and incident correlations.
