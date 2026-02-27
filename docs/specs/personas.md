# Personas — Spec

> Actor-driven journey testing, fully indexed, validated, and ripple-aware. Zero grepping.

## Overview

Personas are named test actors with defined attributes, journeys, and spawn chains. They sit on top of the existing symbol system — referencing `^gates`, `$flows`, `#components`, and `!signals` — turning Paradigm's auth topology and flow definitions into executable, verifiable test specifications.

```
Portal (who CAN)  +  Flows (HOW)  +  Personas (WHO DOES, IN WHAT ORDER)
       ↓                  ↓                        ↓
   ^gates            $step chains          journey + payloads + expects
       └──────────────────┴────────────────────────┘
                          ↓
              Validated, rippled, runnable tests
                          ↓
                   Sentinel results
```

---

## Storage

```
.paradigm/
  personas/
    index.yaml                    # Auto-generated persona index
    user-a.yaml                   # One file per persona
    user-b.yaml
    user-c.yaml
    chains/
      onboarding.yaml             # Named chain: ordered persona execution
```

**Gitignored:** No — personas are specs, not runtime data. They're committed.

---

## Persona Schema

```yaml
# .paradigm/personas/user-a.yaml
version: "1.0"
id: user-a
name: "Agency Owner (Annual Billing)"
description: "First user — creates org, bulk-imports clients, configures integrations"

# ── Actor traits ──────────────────────────────────────
traits:
  tier: agency
  billing: annual
  role: owner
  tags: [admin, billing, onboarding]

# ── Spawn config (if this persona is created by another) ──
trigger:
  type: root                      # root | invitation | signup | api
  # For non-root personas:
  # type: invitation
  # spawned_by: user-a            # persona ID
  # spawned_at: bulk-import       # step ID in parent journey
  # context:                      # data passed from parent
  #   client: "{{parent.response.client_name}}"
  #   role: admin

# ── Fixtures ──────────────────────────────────────────
fixtures:
  email: "owner@agency-test.com"
  password: "Test1234!"
  google_ads_key: "{{fixtures.google_ads_key}}"    # references .paradigm/fixtures.yaml

# ── Journey ───────────────────────────────────────────
journey:
  - id: signup
    description: "Create new agency account with annual billing"
    route: "POST /api/auth/signup"
    flow: $signup-flow
    gates: [^public]
    payload:
      email: "{{fixtures.email}}"
      password: "{{fixtures.password}}"
      plan: "agency-annual"
    expect:
      status: 201
      body:
        has: [id, token, org_id]
        match:
          plan: "agency-annual"
    produces:
      token: "{{response.token}}"
      org_id: "{{response.org_id}}"
      user_id: "{{response.id}}"

  - id: load-clients
    description: "Navigate to clients page — should be empty"
    route: "GET /api/orgs/{{produces.org_id}}/clients"
    flow: $clients-list
    gates: [^authenticated, ^org-member]
    headers:
      Authorization: "Bearer {{produces.token}}"
    expect:
      status: 200
      body:
        match:
          clients: []

  - id: bulk-import
    description: "Bulk import clients with invitations"
    route: "POST /api/orgs/{{produces.org_id}}/clients/bulk"
    flow: $bulk-import
    gates: [^authenticated, ^org-admin]
    headers:
      Authorization: "Bearer {{produces.token}}"
    payload:
      clients:
        - name: "Acme Corp"
          admins: ["admin@acme.com"]
        - name: "Beta Inc"
          admins: ["user-b@existing.com"]
          users: ["user-c@newuser.com"]
    expect:
      status: 200
      body:
        match:
          created: 2
          invitations_sent: 3
    produces:
      acme_id: "{{response.clients[0].id}}"
      beta_id: "{{response.clients[1].id}}"
    spawns:
      - persona: user-b
        via: invitation
        context:
          client_id: "{{response.clients[1].id}}"
          client_name: "Beta Inc"
          role: admin
          invitation_token: "{{response.invitations[1].token}}"
      - persona: user-c
        via: invitation
        context:
          client_id: "{{response.clients[1].id}}"
          client_name: "Beta Inc"
          role: user
          invitation_token: "{{response.invitations[2].token}}"

  - id: integrations-page
    description: "Load integrations page"
    route: "GET /api/orgs/{{produces.org_id}}/integrations"
    flow: $integrations-list
    gates: [^authenticated, ^org-admin]
    headers:
      Authorization: "Bearer {{produces.token}}"
    expect:
      status: 200
      body:
        match:
          integrations: []

  - id: add-google-ads
    description: "Connect Google Ads integration"
    route: "POST /api/orgs/{{produces.org_id}}/integrations"
    flow: $add-integration
    gates: [^authenticated, ^org-admin]
    headers:
      Authorization: "Bearer {{produces.token}}"
    payload:
      provider: "google-ads"
      api_key: "{{fixtures.google_ads_key}}"
    expect:
      status: 201
      body:
        has: [id, provider, status]
        match:
          provider: "google-ads"
          status: "active"
    signals:
      - "!integration-connected"
```

---

## Persona Index

Auto-generated by `paradigm scan` / `paradigm_reindex`. No grepping needed.

```yaml
# .paradigm/personas/index.yaml (auto-generated)
version: "1.0"
generated: "2026-02-26T12:00:00Z"

personas:
  user-a:
    name: "Agency Owner (Annual Billing)"
    trigger: root
    steps: 5
    gates: [^public, ^authenticated, ^org-member, ^org-admin]
    flows: [$signup-flow, $clients-list, $bulk-import, $integrations-list, $add-integration]
    routes:
      - "POST /api/auth/signup"
      - "GET /api/orgs/:id/clients"
      - "POST /api/orgs/:id/clients/bulk"
      - "GET /api/orgs/:id/integrations"
      - "POST /api/orgs/:id/integrations"
    spawns: [user-b, user-c]
    tags: [admin, billing, onboarding]

  user-b:
    name: "Invited Admin (Existing Account)"
    trigger: invitation
    spawned_by: user-a.bulk-import
    steps: 3
    gates: [^invitation-valid, ^account-exists, ^authenticated, ^client-admin]
    flows: [$invitation-accept]
    routes:
      - "POST /api/invitations/accept"
      - "GET /api/clients/:id/dashboard"
      - "PUT /api/clients/:id/settings"
    spawns: []
    tags: [invited, admin]

  user-c:
    name: "Invited User (New Account)"
    trigger: invitation
    spawned_by: user-a.bulk-import
    steps: 2
    gates: [^invitation-valid, ^authenticated, ^client-member]
    flows: [$invitation-accept, $account-creation]
    routes:
      - "POST /api/invitations/accept"
      - "GET /api/clients/:id/dashboard"
    spawns: []
    tags: [invited, user, new-account]

chains:
  onboarding:
    description: "Full onboarding chain: owner → invited admin → invited user"
    order: [user-a, user-b, user-c]
    total_steps: 10
    total_gates: 8

# Cross-reference: gate → personas that traverse it
gate_coverage:
  ^public: [user-a]
  ^authenticated: [user-a, user-b, user-c]
  ^org-member: [user-a]
  ^org-admin: [user-a]
  ^invitation-valid: [user-b, user-c]
  ^account-exists: [user-b]
  ^client-admin: [user-b]
  ^client-member: [user-c]

# Cross-reference: route → personas that hit it
route_coverage:
  "POST /api/auth/signup": [user-a]
  "GET /api/orgs/:id/clients": [user-a]
  "POST /api/orgs/:id/clients/bulk": [user-a]
  "POST /api/invitations/accept": [user-b, user-c]
  "GET /api/clients/:id/dashboard": [user-b, user-c]

# Routes in portal.yaml with NO persona coverage
uncovered_routes:
  - "DELETE /api/orgs/:id"
  - "PUT /api/users/:id/password"
  - "POST /api/billing/webhook"
```

---

## Chain Schema

Chains define execution order for persona spawn trees.

```yaml
# .paradigm/personas/chains/onboarding.yaml
version: "1.0"
id: onboarding
name: "Full Onboarding Chain"
description: "Owner creates org, invites admin and user, both accept and use the platform"

order:
  - persona: user-a
    wait_for: null                # root — starts first
  - persona: user-b
    wait_for: user-a.bulk-import  # waits for user-a's bulk-import step
  - persona: user-c
    wait_for: user-a.bulk-import  # same trigger, can run parallel with user-b

# Permutations: auto-generated variant runs
permutations:
  - id: monthly-billing
    description: "Same chain but owner uses monthly billing"
    overrides:
      user-a:
        traits: { billing: monthly }
        journey:
          signup:
            payload: { plan: "agency-monthly" }
            expect: { body: { match: { plan: "agency-monthly" } } }

  - id: expired-invitation
    description: "User C tries to accept with expired token"
    overrides:
      user-c:
        journey:
          accept-invitation:
            payload: { token: "expired-token-xxx" }
            expect: { status: 401 }
```

---

## Validation Rules

All validation runs on `paradigm_persona_validate` and during `paradigm doctor`.

### Schema Validation

| Field | Rule |
|-------|------|
| `id` | Required. Matches `/^[a-z][a-z0-9-]*$/`. Unique across all personas. |
| `name` | Required. Non-empty string. |
| `journey` | Required. At least one step. |
| `journey[].id` | Required. Unique within the persona. Matches `/^[a-z][a-z0-9-]*$/`. |
| `journey[].route` | Required. Matches `METHOD /path` format. |
| `journey[].gates` | Required. Non-empty array. |
| `journey[].expect` | Required. Must have `status`. |
| `trigger.type` | Required. One of: `root`, `invitation`, `signup`, `api`. |
| `trigger.spawned_by` | Required if type != `root`. Must reference existing `persona.step`. |

### Cross-Reference Validation

| Check | What It Validates |
|-------|-------------------|
| **Gates exist** | Every `^gate` in journey steps exists in `portal.yaml` |
| **Flows exist** | Every `$flow` references a defined flow in `.paradigm/flows.yaml` or `.purpose` |
| **Routes match portal** | Every `route` in journey steps exists in `portal.yaml` routes |
| **Gate alignment** | Gates listed in step match (or are subset of) gates defined for that route in `portal.yaml` |
| **Spawn targets exist** | Every `spawns[].persona` references an existing persona file |
| **Spawn chains are acyclic** | No circular spawn dependencies |
| **Produces consumed** | Every `{{produces.X}}` in later steps was produced by an earlier step |
| **Fixtures resolved** | Every `{{fixtures.X}}` exists in persona `fixtures` block or `.paradigm/fixtures.yaml` |
| **Context passed** | Every `{{parent.X}}` or `{{context.X}}` in spawned persona matches `spawns[].context` keys from parent |

### Coverage Validation

| Check | What It Reports |
|-------|-----------------|
| **Route coverage** | Routes in `portal.yaml` with no persona step hitting them |
| **Gate coverage** | Gates in `portal.yaml` with no persona traversing them |
| **Flow coverage** | Flows in `.paradigm/flows.yaml` with no persona exercising them |
| **Negative testing** | Gates that are only tested as "pass" — no persona tests the 403 case |

---

## Ripple Integration

### When Gates Change

```
paradigm_ripple({ symbol: "^org-admin" })

Response includes:
  personas_affected:
    - persona: user-a
      steps: [bulk-import, integrations-page, add-google-ads]
    - persona: user-b
      steps: []  # doesn't use ^org-admin
```

### When Flows Change

```
paradigm_ripple({ symbol: "$bulk-import" })

Response includes:
  personas_affected:
    - persona: user-a
      steps: [bulk-import]
      spawns_blocked: [user-b, user-c]  # downstream personas depend on this step
```

### When Routes Change

```
paradigm_ripple({ symbol: "POST /api/orgs/:id/clients/bulk" })

Response includes:
  personas_affected:
    - persona: user-a
      steps: [bulk-import]
```

The persona index pre-computes gate/flow/route → persona mappings so ripple lookups are O(1) — no scanning persona files at query time.

---

## MCP Tools (11 tools)

### CRUD

| Tool | Description | Tokens |
|------|-------------|--------|
| `paradigm_persona_create` | Create a persona with traits, trigger, fixtures, and journey steps | ~150 |
| `paradigm_persona_get` | Get full persona detail (journey, traits, spawn chain, validation status) | ~300 |
| `paradigm_persona_list` | List personas with filters (tag, trigger type, gate, flow) | ~200 |
| `paradigm_persona_update` | Update persona fields (traits, fixtures, journey steps) | ~150 |
| `paradigm_persona_delete` | Delete persona (warns if other personas spawn from it) | ~100 |

### Journey Management

| Tool | Description | Tokens |
|------|-------------|--------|
| `paradigm_persona_add_step` | Add a step to a persona's journey (validates gates, route, flow) | ~150 |
| `paradigm_persona_remove_step` | Remove a step (warns if it produces data consumed by later steps or spawns) | ~100 |

### Validation & Analysis

| Tool | Description | Tokens |
|------|-------------|--------|
| `paradigm_persona_validate` | Full validation: schema, cross-refs, coverage gaps. Returns structured report. | ~300 |
| `paradigm_persona_coverage` | Coverage report: which routes/gates/flows have persona coverage, which don't | ~250 |
| `paradigm_persona_affected` | Given a symbol (gate, flow, route, component), return affected personas + steps | ~200 |

### Execution

| Tool | Description | Tokens |
|------|-------------|--------|
| `paradigm_persona_run` | Execute a persona journey or chain against a running server. Returns step-by-step results with payloads and responses. Emits Sentinel events. | ~500 |

---

## MCP Tool Schemas

### paradigm_persona_create

```typescript
{
  name: 'paradigm_persona_create',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Persona ID (kebab-case)' },
      name: { type: 'string', description: 'Human-readable name' },
      description: { type: 'string' },
      traits: { type: 'object', description: 'Key-value actor attributes' },
      trigger: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['root', 'invitation', 'signup', 'api'] },
          spawned_by: { type: 'string', description: 'persona-id.step-id' },
          context: { type: 'object', description: 'Data passed from parent spawn' },
        },
        required: ['type'],
      },
      fixtures: { type: 'object', description: 'Test data for this persona' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['id', 'name', 'trigger'],
  },
}
```

### paradigm_persona_add_step

```typescript
{
  name: 'paradigm_persona_add_step',
  inputSchema: {
    type: 'object',
    properties: {
      persona_id: { type: 'string' },
      step: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Step ID (kebab-case, unique within persona)' },
          description: { type: 'string' },
          route: { type: 'string', description: 'METHOD /path (e.g. "POST /api/auth/signup")' },
          flow: { type: 'string', description: '$flow reference' },
          gates: { type: 'array', items: { type: 'string' }, description: '^gate references' },
          headers: { type: 'object' },
          payload: { type: 'object', description: 'Request body. Supports {{produces.X}} and {{fixtures.X}} interpolation.' },
          expect: {
            type: 'object',
            properties: {
              status: { type: 'number' },
              body: {
                type: 'object',
                properties: {
                  has: { type: 'array', items: { type: 'string' }, description: 'Keys that must exist' },
                  match: { type: 'object', description: 'Exact value matches' },
                },
              },
            },
            required: ['status'],
          },
          produces: { type: 'object', description: 'Values to extract from response for later steps' },
          spawns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                persona: { type: 'string' },
                via: { type: 'string' },
                context: { type: 'object' },
              },
              required: ['persona', 'via'],
            },
          },
          signals: { type: 'array', items: { type: 'string' }, description: '!signal references expected to fire' },
        },
        required: ['id', 'route', 'gates', 'expect'],
      },
      after: { type: 'string', description: 'Insert after this step ID. If omitted, appends to end.' },
    },
    required: ['persona_id', 'step'],
  },
}
```

### paradigm_persona_validate

```typescript
{
  name: 'paradigm_persona_validate',
  inputSchema: {
    type: 'object',
    properties: {
      persona_id: { type: 'string', description: 'Validate one persona. Omit for all.' },
      deep: { type: 'boolean', description: 'Include coverage analysis (default: false)' },
    },
  },
}
```

**Returns:**
```json
{
  "persona": "user-a",
  "valid": false,
  "errors": [
    { "type": "gate-not-found", "step": "bulk-import", "gate": "^org-admin", "detail": "Not defined in portal.yaml" },
    { "type": "produces-unused", "step": "signup", "key": "user_id", "detail": "Produced but never consumed" }
  ],
  "warnings": [
    { "type": "no-negative-test", "gate": "^org-admin", "detail": "Only tested as pass — no persona tests the 403 case" }
  ],
  "coverage": {
    "routes": { "covered": 5, "total": 12, "uncovered": ["DELETE /api/orgs/:id", "..."] },
    "gates": { "covered": 6, "total": 9, "uncovered": ["^billing-active", "..."] },
    "flows": { "covered": 4, "total": 7, "uncovered": ["$password-reset", "..."] }
  }
}
```

### paradigm_persona_run

```typescript
{
  name: 'paradigm_persona_run',
  inputSchema: {
    type: 'object',
    properties: {
      persona_id: { type: 'string', description: 'Run a single persona journey' },
      chain_id: { type: 'string', description: 'Run a named chain (overrides persona_id)' },
      base_url: { type: 'string', description: 'Server base URL (e.g. "http://localhost:3000")' },
      dry_run: { type: 'boolean', description: 'Validate and interpolate without making requests (default: false)' },
      stop_on_failure: { type: 'boolean', description: 'Stop chain on first failing step (default: true)' },
      permutation: { type: 'string', description: 'Permutation ID from chain definition' },
    },
    required: ['base_url'],
  },
}
```

**Returns:**
```json
{
  "persona": "user-a",
  "status": "failed",
  "steps": [
    {
      "id": "signup",
      "status": "pass",
      "route": "POST /api/auth/signup",
      "gates": ["^public"],
      "request": { "payload": { "email": "owner@agency-test.com", "plan": "agency-annual" } },
      "response": { "status": 201, "body": { "id": "usr_123", "token": "eyJ...", "org_id": "org_456" } },
      "produced": { "token": "eyJ...", "org_id": "org_456", "user_id": "usr_123" },
      "duration_ms": 142
    },
    {
      "id": "load-clients",
      "status": "pass",
      "route": "GET /api/orgs/org_456/clients",
      "gates": ["^authenticated", "^org-member"],
      "response": { "status": 200, "body": { "clients": [] } },
      "duration_ms": 45
    },
    {
      "id": "bulk-import",
      "status": "fail",
      "route": "POST /api/orgs/org_456/clients/bulk",
      "gates": ["^authenticated", "^org-admin"],
      "request": { "payload": { "clients": ["..."] } },
      "response": { "status": 403, "body": { "error": "Insufficient permissions" } },
      "expected_status": 200,
      "failure": "Status mismatch: expected 200, got 403",
      "gate_that_blocked": "^org-admin",
      "duration_ms": 23
    }
  ],
  "spawns_blocked": ["user-b", "user-c"],
  "summary": "2/5 passed. Failed at step 3 (bulk-import): ^org-admin gate returned 403."
}
```

---

## Sentinel Schema

Persona runs emit structured events to Sentinel:

```yaml
schema_id: paradigm-personas
event_types:
  persona.run.start:
    fields: [persona_id, chain_id, base_url, permutation]
  persona.step.start:
    fields: [persona_id, step_id, route, gates, payload_size]
  persona.step.pass:
    fields: [persona_id, step_id, route, status, duration_ms, produced_keys]
  persona.step.fail:
    fields: [persona_id, step_id, route, expected_status, actual_status, gate_that_blocked, failure_reason, response_body]
  persona.run.complete:
    fields: [persona_id, chain_id, total_steps, passed, failed, duration_ms, spawns_triggered, spawns_blocked]
  persona.coverage.report:
    fields: [routes_covered, routes_total, gates_covered, gates_total, uncovered_routes, uncovered_gates]
```

Agents query Sentinel for latest results:

```
paradigm_sentinel_events({ schema: "paradigm-personas", type: "persona.step.fail", limit: 10 })
→ Last 10 failing steps across all persona runs, with exact payloads and gate failures
```

---

## CLI Commands

```bash
# CRUD
paradigm persona list                          # List all personas
paradigm persona show <id>                     # Full detail
paradigm persona create <id> --name "..."      # Interactive creation
paradigm persona delete <id>                   # Delete (with confirmation)

# Validation
paradigm persona validate                      # Validate all personas
paradigm persona validate <id>                 # Validate one
paradigm persona coverage                      # Coverage report vs portal.yaml

# Execution
paradigm persona run <id> --base-url http://localhost:3000
paradigm persona run --chain onboarding --base-url http://localhost:3000
paradigm persona run <id> --dry-run             # Interpolate and validate, no requests
paradigm persona run --chain onboarding --permutation monthly-billing

# Analysis
paradigm persona affected ^org-admin           # Which personas use this gate?
paradigm persona graph                         # Spawn chain visualization
```

---

## Index Integration

### paradigm scan / paradigm_reindex

The reindex process:

1. Reads all `.paradigm/personas/*.yaml` files
2. Validates schema (fast, no cross-ref)
3. Builds the persona index (`index.yaml`):
   - Per-persona: gates used, flows referenced, routes hit, spawns
   - `gate_coverage`: gate → personas map
   - `route_coverage`: route → personas map
   - `uncovered_routes`: routes in portal.yaml with no persona
4. Stores in scan-index for MCP tool queries

### paradigm doctor

Adds persona checks:

```
Check 9: Persona validation
  ✓ 3 personas defined
  ✓ All gates reference portal.yaml
  ✗ $password-reset flow referenced by user-d but not defined
  ⚠ 4 routes in portal.yaml have no persona coverage

Check 10: Persona spawn chains
  ✓ No circular dependencies
  ✓ All spawn targets exist
  ⚠ user-c produces "client_token" but no step consumes it
```

---

## Ripple Index Extension

The persona index feeds directly into ripple. When `paradigm_ripple` runs:

```typescript
// In ripple traversal, after collecting symbol dependents:
if (personaIndex) {
  const affectedPersonas = personaIndex.gate_coverage[symbol]
    || personaIndex.route_coverage[symbol]
    || personaIndex.flow_coverage[symbol]
    || [];

  result.personas_affected = affectedPersonas.map(p => ({
    persona: p.id,
    steps: p.steps.filter(s => s.gates.includes(symbol) || s.route === symbol || s.flow === symbol),
    spawns_blocked: /* downstream personas that depend on affected steps */,
  }));
}
```

No additional queries — the index has everything pre-computed.

---

## Template Interpolation

Persona YAML supports `{{...}}` interpolation:

| Pattern | Source | Example |
|---------|--------|---------|
| `{{fixtures.X}}` | Persona `fixtures` block or `.paradigm/fixtures.yaml` | `{{fixtures.email}}` |
| `{{produces.X}}` | `produces` from a prior step in the same journey | `{{produces.token}}` |
| `{{response.X}}` | Used inside `produces` to extract from response body | `{{response.data.id}}` |
| `{{context.X}}` | Data passed via `spawns[].context` from parent persona | `{{context.invitation_token}}` |
| `{{parent.X}}` | Alias for context | `{{parent.client_id}}` |
| `{{env.X}}` | Environment variable | `{{env.TEST_API_KEY}}` |

Interpolation is resolved at run time (`paradigm_persona_run`) or during `--dry-run` for validation.

Validation checks that every `{{produces.X}}` reference points to a `produces` key from a step that executes *before* the consuming step (topological order within the journey).

---

## Permutation Engine

Chains can define permutations — variant runs with overrides:

```yaml
permutations:
  - id: monthly-billing
    overrides:
      user-a:
        traits: { billing: monthly }
        journey:
          signup:
            payload: { plan: "agency-monthly" }
            expect: { body: { match: { plan: "agency-monthly" } } }

  - id: expired-invitation
    overrides:
      user-c:
        journey:
          accept-invitation:
            payload: { token: "expired-token-xxx" }
            expect: { status: 401 }

  - id: revoked-admin
    description: "User B's admin access is revoked mid-journey"
    overrides:
      user-b:
        journey:
          view-client-dashboard:
            # Insert a revocation step before dashboard load
            inject_before:
              - id: revoke-access
                route: "DELETE /api/clients/:id/members/:user_id"
                gates: [^authenticated, ^client-admin]
                expect: { status: 200 }
            # Now dashboard should fail
            expect: { status: 403 }
```

This handles:
- **Happy path variants** (billing plans, regions, tiers)
- **Negative testing** (expired tokens, revoked access, invalid payloads)
- **Edge cases** (concurrent access, partial failures)

---

## Implementation Plan

### Phase 1: Schema + CRUD + Validation
- Persona YAML schema with Zod validation
- `persona-loader.ts` — read, write, list, delete persona files
- Index generation during `paradigm_reindex`
- 5 CRUD MCP tools + `paradigm_persona_validate`
- `paradigm doctor` checks

### Phase 2: Ripple + Coverage
- Persona index feeds into ripple results
- `paradigm_persona_affected` tool
- `paradigm_persona_coverage` tool
- Coverage report: routes/gates/flows without persona coverage
- `uncovered_routes` in index

### Phase 3: Execution Engine
- Template interpolation engine
- HTTP runner with step-by-step execution
- `produces` extraction and carry-forward
- Spawn chain orchestration (topological sort)
- `paradigm_persona_run` tool
- Dry-run mode

### Phase 4: Sentinel + Permutations
- Sentinel event schema registration
- Step-level event emission during runs
- Permutation engine (chain overrides, inject steps)
- CLI commands for run + report

### Phase 5: Journey Management Tools
- `paradigm_persona_add_step` / `paradigm_persona_remove_step`
- Step reordering
- University course content
- PLSAT questions

---

## Version Bumps

| Package | From | To |
|---------|------|----|
| `@a-company/paradigm` | 3.8.0 | 3.9.0 (Phase 1) → 4.0.0 (Phase 3) |
| `@a-company/paradigm-mcp` | 3.8.0 | 3.9.0 (Phase 1) → 4.0.0 (Phase 3) |
| Plugin | 3.8.0 | 3.9.0 → 4.0.0 |

Phase 3 (execution engine) warrants a major version — it's a fundamentally new capability.
