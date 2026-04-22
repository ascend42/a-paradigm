---
title: Portal & Gates
order: 4
description: Define and enforce authorization rules with portal.yaml and gate symbols.
---

## What is portal.yaml?

Portal.yaml is the single source of truth for authorization in your project. It declares **gates** (authorization checks) and maps them to **routes** (API endpoints).

```yaml
version: "1.0"
gates:
  authenticated:
    description: User must be logged in
    check: req.user != null
  project-admin:
    description: User must be admin of the project
    check: project.admins.includes(req.user.id)

routes:
  "GET /api/projects/:id": [^authenticated]
  "PUT /api/projects/:id": [^authenticated, ^project-admin]
```

> **Note on the `^` prefix.** Gate **keys** in `portal.yaml` are bare ids (`authenticated:`, `project-admin:`). The `^` prefix is used only in **references** to gates — in route arrays, flow steps, `.purpose` files, and prose (e.g. `^authenticated`). Paradigm attaches the prefix automatically when emitting references.

## Gate Anatomy

Every gate has three parts:

| Field | Required | Description |
|-------|----------|-------------|
| description | Yes | Human-readable explanation of the check |
| check | No | Pseudocode expression for the authorization logic |
| type | No | Classification (e.g., "auth", "ownership", "role", "network") |
| location | No | Where the gate is enforced (e.g., "middleware", "express-bind") |
| prizes | No | Empty array `[]` — reserved for future gate reward tracking |

Gates are **referenced** with the `^` prefix in routes, flow steps, and prose (`^authenticated`, `^project-admin`, `^comment-author`). Gate **keys** inside `gates:` are bare.

## Common Gate Patterns

**Authentication** — Is the user logged in?
```yaml
authenticated:
  description: User must be logged in
  check: req.user != null
```

**Role-based** — Does the user have the right role?
```yaml
project-admin:
  description: User must be admin of the project
  check: project.admins.includes(req.user.id)
```

**Ownership** — Does the user own the resource?
```yaml
comment-author:
  description: User must be the comment author
  check: comment.authorId === req.user.id
```

## Route-to-Gate Mapping

Routes map HTTP methods and paths to an ordered chain of gates:

```yaml
routes:
  "GET /api/projects": [^authenticated]
  "POST /api/projects": [^authenticated]
  "PUT /api/projects/:id": [^authenticated, ^project-admin]
  "DELETE /api/comments/:id": [^authenticated, ^comment-author]
```

Gates are evaluated left to right. If any gate fails, the request is denied with a 403.

## MCP Integration

When adding new endpoints, Paradigm helps enforce portal coverage:

- `paradigm_gates_for_route` suggests which gates an endpoint needs
- The **stop hook** blocks session completion if routes lack portal.yaml entries
- `paradigm docs serve` shows the full route-gate table in the Portal section

## Best Practices

- One responsibility per gate — don't combine auth + ownership in a single gate
- Always include a `description` — it's what developers read first
- Keep `check` expressions simple pseudocode, not implementation details
- Update portal.yaml whenever you add or modify protected endpoints
