---
id: N-para-101-portal-yaml
title: Portal.yaml
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-101
  - portalyaml-defines-gates
  - lives-at-project
  - gates-check-any
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-101.json
---

## The Gate Registry

`portal.yaml` is Paradigm's gate specification. It defines the gates (`^`) for your project — conditions that must be checked before actions proceed. Gates can check anything: authentication, feature flags, data prerequisites, system health, rate limits, or any other condition your project needs to verify.

This file lives at the **project root** — not inside `.paradigm/`. It is intentionally prominent because gate definitions should be easy to find, easy to audit, and impossible to overlook.

## Structure

A `portal.yaml` has two main sections: `gates` and `routes`.

```yaml
version: "1.0"

gates:
  ^authenticated:
    description: User must be logged in
    check: req.user != null
    type: auth
    effects: []

  ^project-member:
    description: User must be a member of the project
    check: project.members.includes(req.user.id)
    type: role
    requires: [^authenticated]
    effects: []

  ^project-admin:
    description: User must be an admin of the project
    check: project.admins.includes(req.user.id)
    type: role
    requires: [^authenticated]
    effects: []

  ^comment-author:
    description: User must be the author of the comment
    check: comment.authorId === req.user.id
    type: ownership
    requires: [^authenticated]
    effects: []

routes:
  "GET /api/projects": [^authenticated]
  "GET /api/projects/:id": [^authenticated, ^project-member]
  "PUT /api/projects/:id": [^authenticated, ^project-admin]
  "DELETE /api/projects/:id": [^authenticated, ^project-admin]
  "POST /api/projects/:id/comments": [^authenticated, ^project-member]
  "DELETE /api/comments/:id": [^authenticated, ^comment-author]
```

## Gate Anatomy

Each gate definition includes:

- **description** — What the gate checks, in plain English.
- **check** — A pseudo-code expression describing the authorization logic. This is documentation, not executable code — but it should be precise enough that a developer or AI agent can implement it.
- **type** — The category of check: `auth`, `role`, `ownership`, `feature-flag`, `data-readiness`, `environment`, or any custom type that fits your domain.
- **requires** — Other gates that must pass first. `^project-admin` requires `^authenticated`, meaning you must be logged in before the admin check runs.
- **effects** — Side effects triggered when the gate passes. For example, passing `^first-login` might award an onboarding badge. Use `[]` if there are no effects.

## Gate Chains

Gates can chain via the `requires` field. The route `"PUT /api/projects/:id": [^authenticated, ^project-admin]` ensures that:
1. First, `^authenticated` verifies the user is logged in.
2. Then, `^project-admin` checks that the user is an admin of the specific project.

If any gate in the chain fails, the action is blocked. How the failure manifests depends on your discipline: an API returns `403 Forbidden`, a mobile app might disable a button, a CLI exits with an error code.

## When portal.yaml Is Required

Create `portal.yaml` whenever your project has conditions that must be checked before actions proceed:
- Authentication or session validation
- Role or permission checks
- Feature flags or environment checks
- Data prerequisites (cart not empty, profile complete)
- Rate limits or system health checks
- Any precondition that should be documented and auditable

If your project has no gates — no conditions that need to be verified before any action — then `portal.yaml` is not needed.

## The Gate-First Workflow

When adding functionality that requires preconditions, follow this workflow:

1. **Ask Paradigm** — Call `paradigm_gates_for_route` with the route and method (for web APIs), or identify the conditions that must be checked.
2. **Add to portal.yaml** — Define the gates and map them to the actions they protect.
3. **Implement** — Write the code that enforces each gate check.
4. **Test** — Verify that failing a gate blocks the action appropriately for your discipline.

This workflow ensures that conditions are defined *before* implementation, not bolted on after.
