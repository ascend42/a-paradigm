# Personas — Spec

> Declarative user journey expectations, validated against real events. Playing pretend with datapoints.

## 1. Philosophy

Personas are a concrete representation of a frame of thought around a product's flow. When a developer sits down to build a feature, they are -- consciously or not -- imagining the people who will use it. The agency owner who creates an organization and invites their team. The invited admin who accepts and configures their workspace. The new user who signs up, pokes around, and either stays or leaves. Personas formalize this act of imagination. They give names, traits, and journeys to the people the developer is already thinking about.

This is not about HTTP scripting. A persona is a declarative expectation: "When User A does X, Y should happen." The persona says *what should be true*, not *how to verify it*. The journey maps each step to Paradigm symbols -- the `^gates` that must be traversed, the `$flows` that must execute, the `#components` that must participate, the `!signals` that must fire. The persona is the claim. The proof comes from elsewhere.

That proof can come from anywhere. A Jest integration test exercises the signup flow and fires events. A Playwright end-to-end test walks through the bulk import UI and fires events. A CI pipeline runs the built-in HTTP convenience runner and fires events. All of these emit structured events to Sentinel, each tagged with the persona, step, and chain they represent. Then `paradigm_persona_validate` compares what Sentinel actually received against what the persona declared should happen. The result is exact: field-by-field comparison, with assertion failures like `"number_of_clients" is 2, expected 0`. The persona does not care who ran the test or what language it was written in. It cares whether the expectation was met.

```
Portal (who CAN)  +  Flows (HOW)  +  Personas (WHO DOES, WHAT RESULTS)
       |                  |                        |
   ^gates            $step chains       journey + expectations + attribution
       |                  |                        |
       +------------------+------------------------+
                          |
           Declarative, testable product topology
                          |
              +--- Any test infrastructure ---+
              |           |                   |
           Jest      Playwright         HTTP runner
              |           |                   |
              +--- Sentinel events ---+-------+
                          |
            paradigm_persona_validate
                          |
             Exact assertion results
```

---

## 2. How It Works

### The Loop

1. **Declare** -- The developer defines persona files describing expected journeys. Each step references Paradigm symbols and declares expected outcomes (status codes, response shapes, field values).

2. **Exercise** -- Any test infrastructure exercises the paths described by personas. Integration tests, end-to-end tests, the built-in HTTP runner, manual QA sessions, load tests, canary deploys -- anything.

3. **Attribute** -- Each test emits events to Sentinel tagged with persona context: `persona_id`, `step_id`, `chain_id`, `run_id`, and `environment`.

4. **Validate** -- `paradigm_persona_validate` queries Sentinel for events matching the persona's declared steps, then performs field-by-field comparison between expected and actual payloads.

### Attribution Tagging

Any test, in any language, can participate by emitting Sentinel events with the right tags:

```javascript
// Example: emitting from a Jest test
sentinel.emit('persona.step.complete', {
  persona_id: 'user-a',
  step_id: 'bulk-import',
  chain_id: 'onboarding',
  run_id: runId,
  environment: 'ci',
  route: 'POST /api/orgs/org_456/clients/bulk',
  status: 200,
  body: { created: 2, invitations_sent: 3 },
  gates_traversed: ['^authenticated', '^org-admin'],
  signals_fired: ['!clients-imported'],
  duration_ms: 142,
});
```

The language does not matter. The framework does not matter. Sentinel is the event bus. Attribution is the contract.

### Environment-Agnostic

Because validation runs against Sentinel events rather than executing tests directly, personas work identically across environments:

| Environment | How tests run | How validation works |
|-------------|---------------|----------------------|
| Local dev | Developer runs tests manually | Validates against local Sentinel |
| CI | Pipeline runs test suites | Validation step queries Sentinel after tests complete |
| Staging | Smoke tests or canary deploys | Validates against staging Sentinel |
| Production | Synthetic traffic with attribution | Validates against production Sentinel |

The persona file never changes. Only the Sentinel endpoint differs.

---

## 3. Storage

```
.paradigm/
  personas/
    index.yaml                    # Auto-generated persona index
    user-a.persona                # One file per persona
    user-b.persona
    user-c.persona
    chains/
      onboarding.yaml             # Named chain: ordered persona execution
```

**Gitignored:** No -- personas are specifications, not runtime data. They are committed alongside the code they describe.

**Index:** `index.yaml` is auto-generated by `paradigm scan` / `paradigm_reindex`. It pre-computes cross-references (gate coverage, route coverage, spawn trees) so MCP tool queries are O(1) lookups.

---

## 4. Schema

### Persona File

```yaml
# .paradigm/personas/user-a.persona
version: "1.0"
id: user-a
name: "Agency Owner (Annual Billing)"
description: "First user -- creates org, bulk-imports clients, configures integrations"

# -- Actor traits ------------------------------------------------
traits:
  tier: agency
  billing: annual
  role: owner
  tags: [admin, billing, onboarding]

# -- Spawn config ------------------------------------------------
trigger:
  type: root                      # root | invitation | signup | api
  # For non-root: type, spawned_by, spawned_at, context

# -- Fixtures ----------------------------------------------------
fixtures:
  email: "owner@agency-test.com"
  password: "Test1234!"
  google_ads_key: "{{fixtures.google_ads_key}}"    # references .paradigm/fixtures.yaml

# -- Journey -----------------------------------------------------
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
    description: "Navigate to clients page -- should be empty"
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
          number_of_clients: 0

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
    signals:
      - "!clients-imported"
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

### Attribution Fields

Every journey step carries implicit attribution fields for Sentinel. These are derived automatically during execution or must be included by external test infrastructure:

| Field | Source | Description |
|-------|--------|-------------|
| `persona_id` | Persona `id` | Which persona this event belongs to |
| `step_id` | Journey step `id` | Which step in the journey |
| `chain_id` | Chain context | Which chain run (if applicable) |
| `run_id` | Execution context | Unique identifier for this validation run |
| `environment` | Runtime | `dev`, `staging`, `prod`, `ci` |

---

## 5. Sentinel Integration

Sentinel is the primary validation path. Every other mechanism -- schema checks, cross-reference validation, the HTTP runner -- feeds into or is secondary to Sentinel event matching.

### Event Schema

```yaml
schema_id: paradigm-personas
event_types:
  persona.step.start:
    fields:
      required: [persona_id, step_id, route, gates]
      optional: [chain_id, run_id, environment, payload_size]
  persona.step.complete:
    fields:
      required: [persona_id, step_id, route, status, body]
      optional: [chain_id, run_id, environment, gates_traversed, signals_fired, duration_ms, produced_keys]
  persona.step.fail:
    fields:
      required: [persona_id, step_id, route, status, failure_reason]
      optional: [chain_id, run_id, environment, expected_status, gate_that_blocked, response_body]
  persona.run.start:
    fields: [persona_id, chain_id, run_id, environment, base_url, permutation]
  persona.run.complete:
    fields: [persona_id, chain_id, run_id, environment, total_steps, passed, failed, duration_ms, spawns_triggered, spawns_blocked]
  persona.validation.result:
    fields: [persona_id, chain_id, run_id, environment, valid, assertions_passed, assertions_failed, assertion_details]
  persona.coverage.report:
    fields: [routes_covered, routes_total, gates_covered, gates_total, uncovered_routes, uncovered_gates]
```

### Event Matching

When `paradigm_persona_validate` runs:

1. **Query Sentinel** for all `persona.step.complete` events matching the persona ID (and optionally a specific `chain_id` or `run_id`).
2. **Match events to steps** using the `(persona_id, step_id)` pair.
3. **Compare payloads field-by-field** against the step's `expect` block:
   - `expect.status` vs event `status`
   - `expect.body.match` vs event `body` -- exact value comparison per field
   - `expect.body.has` vs event `body` keys -- presence check
   - `signals` vs event `signals_fired` -- all declared signals must appear
   - `gates` vs event `gates_traversed` -- all declared gates must appear
4. **Return structured assertion results** with exact expected and actual values.

### Assertion Output

Each failed assertion includes the exact expected value, the exact actual value, and a human-readable message:

```json
{
  "persona_id": "user-a",
  "run_id": "run_2026-02-26_001",
  "valid": false,
  "steps": [
    {
      "step_id": "signup",
      "matched": true,
      "passed": true,
      "assertions": []
    },
    {
      "step_id": "load-clients",
      "matched": true,
      "passed": false,
      "assertions": [
        {
          "type": "body.match",
          "field": "number_of_clients",
          "expected": 0,
          "actual": 2,
          "message": "Step load-clients: 'number_of_clients' is 2, expected 0"
        }
      ]
    },
    {
      "step_id": "bulk-import",
      "matched": true,
      "passed": false,
      "assertions": [
        {
          "type": "signal",
          "field": "signals_fired",
          "expected": ["!clients-imported"],
          "actual": [],
          "message": "Step bulk-import: signal '!clients-imported' was not fired"
        }
      ]
    },
    {
      "step_id": "integrations-page",
      "matched": false,
      "assertions": [],
      "message": "No Sentinel event found for step 'integrations-page' -- step was never exercised"
    }
  ],
  "summary": "1/4 steps passed. 2 assertion failures. 1 step never exercised."
}
```

### Querying Sentinel Directly

Agents and developers can query Sentinel for persona events outside of validation:

```
paradigm_sentinel_events({ schema: "paradigm-personas", type: "persona.step.fail", limit: 10 })
```

---

## 6. Convenience Runner

The built-in HTTP runner (`paradigm_persona_run`) is a convenience, not the core architecture. It exists so developers can quickly exercise persona journeys without writing separate test code. It is one of many possible sources of Sentinel events.

**When to use:** Quick smoke tests, CI pipelines needing a simple end-to-end pass, validating persona definitions before writing dedicated tests.

**When NOT to use:** Complex UI interactions (use Playwright), performance testing (use k6), tests requiring database setup/teardown or mocked dependencies (use your test framework). In all cases, emit Sentinel events with persona attribution from your test infrastructure.

### Runner Tool Schema

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

### Runner Response

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
      "sentinel_event_id": "evt_a1b2c3",
      "duration_ms": 142
    },
    {
      "id": "bulk-import",
      "status": "fail",
      "route": "POST /api/orgs/org_456/clients/bulk",
      "gates": ["^authenticated", "^org-admin"],
      "response": { "status": 403, "body": { "error": "Insufficient permissions" } },
      "expected_status": 200,
      "failure": "Status mismatch: expected 200, got 403",
      "gate_that_blocked": "^org-admin",
      "sentinel_event_id": "evt_g7h8i9",
      "duration_ms": 23
    }
  ],
  "spawns_blocked": ["user-b", "user-c"],
  "summary": "1/5 passed. Failed at step 3 (bulk-import): ^org-admin gate returned 403."
}
```

Every step emits a Sentinel event (referenced by `sentinel_event_id`). After the runner completes, `paradigm_persona_validate` can be called to perform the full assertion comparison.

---

## 7. Validation

Validation operates at three levels: schema correctness, cross-reference integrity, and Sentinel event matching.

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
| **Flows exist** | Every `$flow` references a defined flow |
| **Routes match portal** | Every `route` exists in `portal.yaml` routes |
| **Gate alignment** | Gates in step match (or are subset of) gates for that route in `portal.yaml` |
| **Spawn targets exist** | Every `spawns[].persona` references an existing persona file |
| **Spawn chains acyclic** | No circular spawn dependencies |
| **Produces consumed** | Every `{{produces.X}}` was produced by an earlier step |
| **Fixtures resolved** | Every `{{fixtures.X}}` exists in persona `fixtures` or `.paradigm/fixtures.yaml` |
| **Context passed** | Every `{{context.X}}` matches `spawns[].context` keys from parent |

### Coverage Validation

| Check | What It Reports |
|-------|-----------------|
| **Route coverage** | Routes in `portal.yaml` with no persona step hitting them |
| **Gate coverage** | Gates in `portal.yaml` with no persona traversing them |
| **Flow coverage** | Flows with no persona exercising them |
| **Negative testing** | Gates only tested as "pass" -- no persona tests the 403 case |

---

## 8. Ripple Integration

When a symbol changes, ripple reports which personas are affected.

### When Gates Change

```
paradigm_ripple({ symbol: "^org-admin" })

Response includes:
  personas_affected:
    - persona: user-a
      steps: [bulk-import, integrations-page, add-google-ads]
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

The persona index pre-computes these mappings so ripple lookups are O(1).

```typescript
// In ripple traversal, after collecting symbol dependents:
if (personaIndex) {
  const affectedPersonas = personaIndex.gate_coverage[symbol]
    || personaIndex.route_coverage[symbol]
    || personaIndex.flow_coverage[symbol]
    || [];

  result.personas_affected = affectedPersonas.map(p => ({
    persona: p.id,
    steps: p.steps.filter(s =>
      s.gates.includes(symbol) || s.route === symbol || s.flow === symbol
    ),
    spawns_blocked: /* downstream personas that depend on affected steps */,
  }));
}
```

---

## 9. MCP Tools (11 tools)

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

### Validation and Analysis

| Tool | Description | Tokens |
|------|-------------|--------|
| `paradigm_persona_validate` | Full validation: schema + cross-refs + Sentinel event matching with exact assertion results | ~300 |
| `paradigm_persona_coverage` | Coverage report: which routes/gates/flows have persona coverage, which don't | ~250 |
| `paradigm_persona_affected` | Given a symbol, return affected personas + steps | ~200 |

### Execution

| Tool | Description | Tokens |
|------|-------------|--------|
| `paradigm_persona_run` | Convenience HTTP runner. Emits Sentinel events with full attribution. Secondary to Sentinel validation. | ~500 |

---

## 10. MCP Tool Schemas

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
      sentinel: { type: 'boolean', description: 'Compare against Sentinel events (default: true when available)' },
      run_id: { type: 'string', description: 'Validate against a specific run. Omit for latest.' },
      chain_id: { type: 'string', description: 'Validate against a specific chain execution.' },
      environment: { type: 'string', description: 'Filter Sentinel events by environment (dev, staging, prod, ci).' },
    },
  },
}
```

**Returns:**
```json
{
  "persona": "user-a",
  "valid": false,
  "schema_errors": [],
  "cross_ref_errors": [
    { "type": "gate-not-found", "step": "bulk-import", "gate": "^org-admin", "detail": "Not defined in portal.yaml" }
  ],
  "sentinel_assertions": {
    "run_id": "run_2026-02-26_001",
    "environment": "ci",
    "steps": [
      { "step_id": "signup", "matched": true, "passed": true, "assertions": [] },
      {
        "step_id": "load-clients", "matched": true, "passed": false,
        "assertions": [
          { "type": "body.match", "field": "number_of_clients", "expected": 0, "actual": 2, "message": "Step load-clients: 'number_of_clients' is 2, expected 0" }
        ]
      },
      {
        "step_id": "bulk-import", "matched": true, "passed": false,
        "assertions": [
          { "type": "signal", "field": "signals_fired", "expected": ["!clients-imported"], "actual": [], "message": "Step bulk-import: signal '!clients-imported' was not fired" }
        ]
      },
      { "step_id": "integrations-page", "matched": false, "message": "No Sentinel event found for step 'integrations-page'" }
    ],
    "summary": { "total_steps": 5, "matched": 4, "unmatched": 1, "passed": 2, "failed": 2 }
  },
  "warnings": [
    { "type": "no-negative-test", "gate": "^org-admin", "detail": "Only tested as pass -- no persona tests the 403 case" }
  ],
  "coverage": {
    "routes": { "covered": 5, "total": 12, "uncovered": ["DELETE /api/orgs/:id"] },
    "gates": { "covered": 6, "total": 9, "uncovered": ["^billing-active"] },
    "flows": { "covered": 4, "total": 7, "uncovered": ["$password-reset"] }
  }
}
```

---

## 11. Persona Index

Auto-generated by `paradigm scan` / `paradigm_reindex`. Pre-computes all cross-references.

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
    signals: ["!clients-imported", "!integration-connected"]
    spawns: [user-b, user-c]
    tags: [admin, billing, onboarding]

  user-b:
    name: "Invited Admin (Existing Account)"
    trigger: invitation
    spawned_by: user-a.bulk-import
    steps: 3
    gates: [^invitation-valid, ^account-exists, ^authenticated, ^client-admin]
    flows: [$invitation-accept]
    routes: ["POST /api/invitations/accept", "GET /api/clients/:id/dashboard", "PUT /api/clients/:id/settings"]
    spawns: []
    tags: [invited, admin]

  user-c:
    name: "Invited User (New Account)"
    trigger: invitation
    spawned_by: user-a.bulk-import
    steps: 2
    gates: [^invitation-valid, ^authenticated, ^client-member]
    flows: [$invitation-accept, $account-creation]
    routes: ["POST /api/invitations/accept", "GET /api/clients/:id/dashboard"]
    spawns: []
    tags: [invited, user, new-account]

chains:
  onboarding:
    description: "Full onboarding chain: owner -> invited admin -> invited user"
    order: [user-a, user-b, user-c]
    total_steps: 10
    total_gates: 8

gate_coverage:
  ^public: [user-a]
  ^authenticated: [user-a, user-b, user-c]
  ^org-member: [user-a]
  ^org-admin: [user-a]
  ^invitation-valid: [user-b, user-c]
  ^account-exists: [user-b]
  ^client-admin: [user-b]
  ^client-member: [user-c]

route_coverage:
  "POST /api/auth/signup": [user-a]
  "GET /api/orgs/:id/clients": [user-a]
  "POST /api/orgs/:id/clients/bulk": [user-a]
  "POST /api/invitations/accept": [user-b, user-c]
  "GET /api/clients/:id/dashboard": [user-b, user-c]

uncovered_routes:
  - "DELETE /api/orgs/:id"
  - "PUT /api/users/:id/password"
  - "POST /api/billing/webhook"
```

---

## 12. Chain Schema

Chains define ordered multi-persona executions with dependency relationships.

```yaml
# .paradigm/personas/chains/onboarding.yaml
version: "1.0"
id: onboarding
name: "Full Onboarding Chain"
description: "Owner creates org, invites admin and user, both accept and use the platform"

order:
  - persona: user-a
    wait_for: null
  - persona: user-b
    wait_for: user-a.bulk-import
  - persona: user-c
    wait_for: user-a.bulk-import     # can run parallel with user-b

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

  - id: revoked-admin
    description: "User B's admin access is revoked mid-journey"
    overrides:
      user-b:
        journey:
          view-client-dashboard:
            inject_before:
              - id: revoke-access
                route: "DELETE /api/clients/:id/members/:user_id"
                gates: [^authenticated, ^client-admin]
                expect: { status: 200 }
            expect: { status: 403 }
```

Each permutation generates a distinct `run_id` when exercised, so Sentinel events from different permutations do not collide during validation.

Permutations handle: happy path variants (billing plans, regions), negative testing (expired tokens, revoked access), and edge cases (concurrent access, partial failures).

---

## 13. Template Interpolation

Persona YAML supports `{{...}}` interpolation:

| Pattern | Source | Example |
|---------|--------|---------|
| `{{fixtures.X}}` | Persona `fixtures` block or `.paradigm/fixtures.yaml` | `{{fixtures.email}}` |
| `{{produces.X}}` | `produces` from a prior step in the same journey | `{{produces.token}}` |
| `{{response.X}}` | Used inside `produces` to extract from response body | `{{response.data.id}}` |
| `{{context.X}}` | Data passed via `spawns[].context` from parent persona | `{{context.invitation_token}}` |
| `{{parent.X}}` | Alias for context | `{{parent.client_id}}` |
| `{{env.X}}` | Environment variable | `{{env.TEST_API_KEY}}` |

Interpolation is resolved at run time (by the convenience runner, by external test infrastructure reading persona files, or during `--dry-run`). Validation checks that every `{{produces.X}}` reference points to a `produces` key from a step that executes *before* the consuming step.

---

## 14. Examples

### Assertion Output: Failures with Exact Payloads

A bug is introduced: `load-clients` returns stale data and `bulk-import` fails to fire a signal.

```
paradigm_persona_validate({ persona_id: "user-a", run_id: "run_2026-02-26_001", environment: "ci" })
```

Result:

```json
{
  "persona_id": "user-a",
  "valid": false,
  "sentinel_assertions": {
    "steps": [
      { "step_id": "signup", "matched": true, "passed": true },
      {
        "step_id": "load-clients",
        "matched": true,
        "passed": false,
        "assertions": [
          {
            "type": "body.match",
            "field": "clients",
            "expected": [],
            "actual": [{"id": "client_orphan_1", "name": "Leftover Corp"}],
            "message": "Step load-clients: 'clients' is [{\"id\":\"client_orphan_1\",\"name\":\"Leftover Corp\"}], expected []"
          },
          {
            "type": "body.match",
            "field": "number_of_clients",
            "expected": 0,
            "actual": 1,
            "message": "Step load-clients: 'number_of_clients' is 1, expected 0"
          }
        ]
      },
      {
        "step_id": "bulk-import",
        "matched": true,
        "passed": false,
        "assertions": [
          {
            "type": "signal",
            "field": "signals_fired",
            "expected": ["!clients-imported"],
            "actual": [],
            "message": "Step bulk-import: signal '!clients-imported' was not fired"
          }
        ]
      },
      { "step_id": "integrations-page", "matched": true, "passed": true },
      { "step_id": "add-google-ads", "matched": true, "passed": true }
    ],
    "summary": { "total_steps": 5, "matched": 5, "passed": 3, "failed": 2, "assertion_failures": 3 }
  }
}
```

The messages are exact and actionable:
- `Step load-clients: 'number_of_clients' is 1, expected 0` -- stale data in the test database.
- `Step bulk-import: signal '!clients-imported' was not fired` -- missing event emitter in the bulk import handler.

No ambiguity. Exact field, exact expected value, exact actual value.

---

## 15. Index Integration

### paradigm scan / paradigm_reindex

1. Reads all `.paradigm/personas/*.persona` files
2. Validates schema (fast, no cross-ref)
3. Builds the persona index (`index.yaml`): per-persona gates/flows/routes/signals/spawns, `gate_coverage`, `route_coverage`, `uncovered_routes`
4. Stores in scan-index for MCP tool queries

### paradigm doctor

```
Check 9: Persona validation
  ok  3 personas defined
  ok  All gates reference portal.yaml
  ERR $password-reset flow referenced by user-d but not defined
  WARN 4 routes in portal.yaml have no persona coverage

Check 10: Persona spawn chains
  ok  No circular dependencies
  ok  All spawn targets exist
  WARN user-c produces "client_token" but no step consumes it

Check 11: Sentinel event coverage
  ok  Sentinel schema paradigm-personas is registered
  WARN user-a.integrations-page has no Sentinel events in last 7 days
  ok  8/10 steps have recent Sentinel coverage
```

---

## 16. CLI Commands

```bash
# CRUD
paradigm persona list                          # List all personas
paradigm persona show <id>                     # Full detail
paradigm persona create <id> --name "..."      # Interactive creation
paradigm persona delete <id>                   # Delete (with confirmation)

# Validation
paradigm persona validate                      # Schema + cross-ref + Sentinel
paradigm persona validate <id>                 # Validate one
paradigm persona validate --no-sentinel        # Schema + cross-ref only
paradigm persona coverage                      # Coverage report vs portal.yaml

# Execution (convenience runner)
paradigm persona run <id> --base-url http://localhost:3000
paradigm persona run --chain onboarding --base-url http://localhost:3000
paradigm persona run <id> --dry-run
paradigm persona run --chain onboarding --permutation monthly-billing

# Analysis
paradigm persona affected ^org-admin           # Which personas use this gate?
paradigm persona graph                         # Spawn chain visualization
```

---

## 17. Implementation Notes

### Phase 1: Schema + CRUD + Validation
- Persona YAML schema with Zod validation
- `persona-loader.ts` -- read, write, list, delete persona files
- Index generation during `paradigm_reindex`
- 5 CRUD MCP tools + `paradigm_persona_validate` (schema + cross-ref only)
- `paradigm doctor` checks

### Phase 2: Ripple + Coverage
- Persona index feeds into ripple results
- `paradigm_persona_affected` tool
- `paradigm_persona_coverage` tool
- Coverage report: routes/gates/flows without persona coverage
- `uncovered_routes` in index

### Phase 3: Sentinel Integration
- Sentinel event schema registration (`paradigm-personas`)
- Attribution tagging specification
- Event matching engine in `paradigm_persona_validate`
- Field-by-field assertion comparison with exact payloads
- Helper libraries for emitting attributed events from common test frameworks

### Phase 4: Convenience Runner + Permutations
- Template interpolation engine
- HTTP runner with step-by-step execution and Sentinel event emission
- `produces` extraction and carry-forward
- Spawn chain orchestration (topological sort)
- `paradigm_persona_run` tool, dry-run mode
- Permutation engine (chain overrides, inject steps)

### Phase 5: Journey Management Tools
- `paradigm_persona_add_step` / `paradigm_persona_remove_step`
- Step reordering
- University course content

---

## Version Bumps

| Package | From | To |
|---------|------|----|
| `@a-company/paradigm` | 3.8.0 | 3.9.0 (Phase 1) -> 4.0.0 (Phase 3) |
| `@a-company/paradigm-mcp` | 3.8.0 | 3.9.0 (Phase 1) -> 4.0.0 (Phase 3) |
| Plugin | 3.8.0 | 3.9.0 -> 4.0.0 |

Phase 3 (Sentinel integration with field-by-field assertion matching) warrants a major version -- it transforms personas from static specifications into a live validation system.
