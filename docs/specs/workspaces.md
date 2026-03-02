# Paradigm Workspaces — Spec

> Cross-project symbol awareness for multi-repo setups.

## Problem

Paradigm is single-project scoped. Each repo has its own `.paradigm/`, symbols, and portal.yaml. When two or more repos are intertwined (frontend + backend, microservices, shared libs), agents working in one repo are blind to the other. Ripple stops at the repo boundary. Search can't find cross-project consumers. Personas can't walk through both.

## Solution

A `.paradigm-workspace` file placed in a shared parent directory. Each member project's `.paradigm/config.yaml` declares its workspace membership. Tools gain optional cross-project awareness.

## Workspace File

**File:** `.paradigm-workspace` (custom extension, placed in any parent directory)

```yaml
version: "1.0"
name: deus
members:
  - name: backend
    path: ./deus-backend
    role: api
    exports:
      - "^*"          # all gates
      - "#*-api"      # components ending in -api
      - "!*"          # all signals
      - "$*"          # all flows
  - name: frontend
    path: ./deus-frontend
    role: client
    exports:
      - "#*"          # all components
      - "!*"          # all signals
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `version` | yes | Workspace format version (`"1.0"`) |
| `name` | yes | Workspace name (used in cross-project symbol prefixing) |
| `members` | yes | Array of member projects |
| `members[].name` | yes | Short name for the project (used as namespace prefix) |
| `members[].path` | yes | Relative path from workspace file to project root |
| `members[].role` | no | Hint for tooling: `api`, `client`, `shared`, `service`, `lib` |
| `members[].exports` | no | Glob patterns for symbols visible to other members. Default: all symbols exported. |

## Project Config Link

Each member project opts in by adding a `workspace` field to `.paradigm/config.yaml`:

```yaml
version: "2.0"
project: deus-backend
discipline: api
workspace: ../../.paradigm-workspace    # relative path to workspace file
```

If `workspace` is absent, the project operates in single-project mode (current behavior, no change).

## Workspace Discovery

When a tool starts, it checks for workspace membership:

1. Read `.paradigm/config.yaml` — does `workspace` field exist?
2. If yes, resolve the path and load `.paradigm-workspace`
3. Load each sibling member's `.paradigm/` index (read-only)
4. Merge sibling symbols into a secondary index with namespace prefixes

If the workspace file doesn't exist at the declared path, warn and continue in single-project mode.

## Symbol Namespacing

Cross-project symbols are prefixed with the member name:

| Local (in deus-backend) | Cross-project (seen from deus-frontend) |
|---|---|
| `#user-api` | `backend/#user-api` |
| `^authenticated` | `backend/^authenticated` |
| `$checkout-flow` | `backend/$checkout-flow` |

Within your own project, symbols remain unprefixed. The namespace prefix only appears when referencing symbols from sibling projects.

### Referencing Cross-Project Symbols

In `.purpose` files, reference sibling symbols with the namespace prefix:

```yaml
components:
  #checkout-page:
    description: Checkout UI
    consumes:
      - backend/#cart-api
      - backend/#payment-api
    gates:
      - backend/^authenticated
    flows:
      - backend/$checkout-flow
```

## Tool Behavior Changes

### `paradigm_search`

- **Current:** Searches local index only.
- **With workspace:** Searches local index first, then sibling indices. Results include `project` field.

```
paradigm_search({ query: "user", includeWorkspace: true })

→ Results:
  - #user-service (this project)
  - frontend/#user-profile (deus-frontend)
  - frontend/#user-settings (deus-frontend)
```

`includeWorkspace` defaults to `false` for speed. Explicit opt-in per query.

### `paradigm_ripple`

- **Current:** Analyzes dependencies within local project only.
- **With workspace:** After local ripple, scans sibling `.purpose` files for references to the symbol. Cross-project impacts shown in a separate `workspace` section.

```
paradigm_ripple({ symbol: "#user-api", includeWorkspace: true })

→ Local impact:
  - #auth-middleware (direct)
  - $login-flow (via step)

→ Workspace impact:
  - frontend/#login-page consumes backend/#user-api
  - frontend/#profile-page consumes backend/#user-api
```

### `paradigm_navigate`

- **Current:** Navigates local project.
- **With workspace:** `context` intent can surface sibling symbols relevant to the task.

### `paradigm_gates_for_route`

- **Current:** Reads local portal.yaml.
- **With workspace:** Can surface backend gates when frontend is adding a page that calls a protected route.

### `paradigm_persona_run`

- **Current:** Validates journey steps against local Sentinel events.
- **With workspace:** Journey steps can reference actions in sibling projects. Sentinel events from both projects can be correlated by `run_id`.

### Tools unchanged

- `paradigm_status` — remains project-scoped
- `paradigm_reindex` — rebuilds local index only
- `paradigm_wisdom_*` — already global via `~/.paradigm/`
- `paradigm_lore_*` — project-scoped (each project has its own lore)
- `paradigm_session_*` — project-scoped

## Sibling Index Loading

When workspace is active, sibling projects are loaded as **read-only lightweight indices**:

1. Read sibling's `.paradigm/scan-index.json` (the static index, not live aggregation)
2. Filter symbols through the sibling's `exports` patterns
3. Prefix symbols with `{member-name}/`
4. Cache in memory with TTL matching `limits.toolCacheTtlMs`

This means:
- **No live aggregation** of sibling projects (too expensive)
- Siblings must have run `paradigm_reindex` at least once to have a `scan-index.json`
- Stale sibling data is possible — the workspace approach is eventually consistent, not live

## Workspace Reindex

A new tool `paradigm_workspace_reindex` can rebuild all member indices:

```
paradigm_workspace_reindex()

→ Reindexing deus-backend... done (142 symbols)
→ Reindexing deus-frontend... done (89 symbols)
→ Workspace index ready (231 symbols total)
```

This calls `paradigm_reindex` in each member directory sequentially.

## CLI Support

```bash
# Create a workspace (interactive — asks for members)
paradigm workspace init

# Show workspace status
paradigm workspace status

# Reindex all members
paradigm workspace reindex

# Search across workspace
paradigm search "user" --workspace
```

## Export Filtering

The `exports` field on each member controls what symbols are visible to siblings. This prevents internal implementation details from leaking:

```yaml
members:
  - name: backend
    path: ./deus-backend
    exports:
      - "^*"          # all gates (frontend needs to know auth requirements)
      - "#*-api"      # only API-facing components (not internal services)
      - "!*"          # all signals (frontend may listen to events)
      - "$checkout-*" # only checkout-related flows
```

If `exports` is omitted, all symbols are exported (open by default).

Pattern syntax:
- `#*` — all components
- `#*-api` — components ending in `-api`
- `^authenticated` — specific gate
- `$checkout-*` — flows starting with `checkout-`

## Implementation Phases

### Phase 1: File format + discovery
- Define `.paradigm-workspace` schema
- Add `workspace` field to config.yaml parser
- Workspace discovery logic (find file, validate, load members)
- No tool changes yet — just loading

### Phase 2: Cross-project search + ripple
- Load sibling `scan-index.json` files as read-only indices
- `paradigm_search` with `includeWorkspace` option
- `paradigm_ripple` with `includeWorkspace` option
- Symbol namespacing with `{member}/` prefix

### Phase 3: Navigation + portal awareness
- `paradigm_navigate` context intent includes sibling symbols
- `paradigm_gates_for_route` can surface sibling gates
- Cross-project `consumes` references in `.purpose` files

### Phase 4: Persona + Sentinel integration
- Persona journeys can reference cross-project actions
- Sentinel event correlation across workspace members
- `paradigm_workspace_reindex` tool

### Phase 5: CLI commands
- `paradigm workspace init`
- `paradigm workspace status`
- `paradigm workspace reindex`

## Compatibility

- **Existing projects:** No change. If `workspace` field is absent from config, everything works as today.
- **Single-project repos:** Never affected. Workspace is fully opt-in.
- **Global store:** Already partitions by project hash. No changes needed.
- **Version:** This is a minor feature addition to `@a-company/paradigm-mcp`. No major version bump required since it's additive and backward compatible.
