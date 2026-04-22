---
id: N-para-201-portal-protocol
title: The Portal Protocol
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-201
  - specification-before-implementation
  - four-steps-ask
  - paradigmgatesforroute-suggests-gates
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-201.json
---

## Specification Before Implementation

The Portal Protocol is Paradigm's prescribed workflow for adding guarded operations. Its core principle is **specification before implementation** — you define what conditions must be met before you write the handler code. This inverts the common (and dangerous) pattern of building functionality first and bolting on checks later.

The idea is universal: define what gates an operation needs before you implement the operation itself. In a web API, this means defining route gates before writing handlers. In a mobile app, it might mean specifying which screens require which conditions before building the UI. In a CLI tool, it means declaring what preconditions a command requires before writing the command logic.

## The Four Steps

### Step 1: Ask Paradigm

Before writing any handler, call `paradigm_gates_for_route` with the route and method:

```
paradigm_gates_for_route({ route: "/api/projects/:id/members", method: "POST" })
```

This tool analyzes your existing `portal.yaml` and suggests gates based on patterns:
- The route is under `/api/` → probably needs `^authenticated`
- It modifies a project resource → probably needs `^project-admin` or `^project-member`
- It is a POST (mutation) → higher gate requirements than a GET

The suggestions are not binding, but they catch common oversights. You might realize you need a gate you had not considered.

### Step 2: Add to portal.yaml

Add the route with its required gates:

```yaml
routes:
  # Existing routes...
  "POST /api/projects/:id/members": [^authenticated, ^project-admin]
```

If you need a new gate that does not exist yet, define it in the `gates` section:

```yaml
gates:
  ^project-admin:
    description: User must be an admin of the project
    check: project.admins.includes(req.user.id)
    type: role
    requires: [^authenticated]
    effects: []
```

### Step 3: Implement the Gate Checks

Write the middleware or handler code that enforces each gate. The implementation must match the `check` expression in portal.yaml. How a failed gate manifests depends on your discipline:

- **Web APIs** return HTTP status codes (401 for failed identity checks, 403 for failed authorization)
- **Mobile apps** might disable UI elements or show an upgrade prompt
- **CLI tools** might exit with a specific error code and message
- **Desktop apps** might gray out menu items or show a dialog

Here is an example for a web API:

```typescript
async function projectAdmin(req, res, next) {
  const project = await Project.findById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  if (!project.admins.includes(req.user.id)) {
    log.gate('^project-admin').warn('Access denied', {
      userId: req.user.id,
      projectId: req.params.id
    });
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.project = project;  // Attach for downstream use
  next();
}
```

Notice the Paradigm logger usage: `log.gate('^project-admin').warn(...)` for a denied gate.

### Step 4: Test Gate Failures

Verify that failing a gate produces the correct behavior. In a web API, this means testing rejection status codes:

```typescript
it('rejects non-admin attempting to add member', async () => {
  const res = await request(app)
    .post('/api/projects/proj_123/members')
    .set('Authorization', `Bearer ${memberToken}`)  // member, not admin
    .send({ email: 'newuser@example.com' });

  expect(res.status).toBe(403);
});
```

Test both the pass path (authorized user succeeds) and the fail path (unauthorized user is rejected). The concept of pass/fail is universal across all disciplines — only the specific failure response varies.

## Common Gate Patterns

Over time, projects develop recurring gate patterns:

| Pattern | Gate Name | Check |
|---------|-----------|-------|
| Any logged-in user | `^authenticated` | `req.user != null` |
| Resource membership | `^{resource}-member` | `resource.members.includes(req.user.id)` |
| Resource admin | `^{resource}-admin` | `resource.admins.includes(req.user.id)` |
| Resource creator | `^{resource}-creator` | `resource.createdBy === req.user.id` |
| Item author | `^{item}-author` | `item.authorId === req.user.id` |
| Feature flag | `^feature-{name}` | `features.isEnabled(name, req.user)` |

These patterns are reusable across projects. When you call `paradigm_gates_for_route`, the tool draws from these patterns to make suggestions.

## The Cost of Skipping the Protocol

The Portal Protocol makes conditions a first thought rather than an afterthought. By defining gates in portal.yaml before writing handlers, you create an auditable specification that is separate from (and checkable against) the implementation. Whether you are protecting API endpoints, gating CLI commands, or controlling feature access in a mobile app, the principle is the same: specify first, implement second.
