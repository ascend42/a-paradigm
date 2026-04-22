---
id: N-para-201-gates-deep-dive
title: Gates in Depth
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-201
  - gate-types-include
  - check-expressions-are
  - gates-chain-via
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-201.json
---

## Gate Types

Gates are general-purpose condition checkers. While authorization is a common use case, gates can check any defined condition — feature flags, environment requirements, data prerequisites, system health, and more. Here are the common gate types:

**Auth gates** verify identity — is the user who they claim to be?
```yaml
^authenticated:
  description: User must have a valid session
  check: req.session.userId != null
  type: auth
```

**Role gates** verify permission level — does the user hold the right role?
```yaml
^project-admin:
  description: User must be an admin of the project
  check: project.admins.includes(req.user.id)
  type: role
  requires: [^authenticated]
```

**Ownership gates** verify resource ownership — does the user own this specific item?
```yaml
^comment-author:
  description: User must be the author of this comment
  check: comment.authorId === req.user.id
  type: ownership
  requires: [^authenticated]
```

**State-precondition gates** verify system state — is the system in the right condition?
```yaml
^payment-method-exists:
  description: User must have a payment method on file
  check: user.paymentMethods.length > 0
  type: state-precondition
  requires: [^authenticated]
```

**Environment gates** verify deployment context — is the system running in the right environment?
```yaml
^production-only:
  description: Action is restricted to production environment
  check: process.env.NODE_ENV === 'production'
  type: environment
```

**Capability gates** verify that a feature or capability is available:
```yaml
^feature-enabled:
  description: The feature flag must be active for this user
  check: features.isEnabled('new-checkout', req.user)
  type: capability
```

**Data-readiness gates** verify that required data exists before proceeding:
```yaml
^profile-complete:
  description: User must have completed their profile before accessing this feature
  check: user.profile.isComplete === true
  type: data-readiness
```

The `type` field is metadata for humans and tools — Paradigm does not enforce different behavior based on type. But categorizing gates helps AI agents suggest appropriate checks. Auth, role, and ownership are common in web applications, while state-precondition, environment, capability, and data-readiness gates are equally important across all disciplines.

## Check Expressions

The `check` field contains a **pseudo-code expression** that describes the gate's condition logic. It is not executable code — it is precise documentation:

```yaml
# Good: clear and implementable
check: project.members.some(m => m.userId === req.user.id && m.role === 'admin')

# Bad: too vague
check: user is admin

# Bad: too implementation-specific
check: await db.query('SELECT * FROM project_members WHERE...')
```

The check should be specific enough that a developer can implement it from reading the expression, but abstract enough that it does not depend on a particular ORM or database.

## Gate Chains

Gates chain through the `requires` field. When a route specifies `[^authenticated, ^project-admin]`, the gates are checked in order:

1. `^authenticated` runs first. If it fails, the request is rejected (in HTTP, this is a 401 Unauthorized; other disciplines handle failure differently).
2. `^project-admin` runs next (which itself requires `^authenticated`, already passed). If it fails, the request is denied (in HTTP, a 403 Forbidden).

Chains prevent redundant checks. You never need to re-check authentication inside a role gate — the `requires` field guarantees it already passed.

Deep chains are possible but should be kept shallow for clarity:
```yaml
^super-admin:
  requires: [^authenticated, ^org-admin]  # ^org-admin itself requires ^authenticated
```

## The Effects Field

Gates can trigger side effects when they pass, defined in the `effects` field:

```yaml
^first-purchase:
  description: User is making their first purchase
  check: user.purchaseCount === 0
  type: state-precondition
  requires: [^authenticated]
  effects:
    - id: first-purchase-badge
      oneTime: true
    - id: welcome-discount
      oneTime: true
```

The `oneTime: true` flag ensures the effect triggers only once per user. Effects are useful for gamification, onboarding rewards, and analytics events. If a gate has no side effects, use `effects: []`.

## Implementing Gates

While `portal.yaml` defines *what* gates exist and *where* they apply, your application code must *implement* them. In web applications, the typical pattern is middleware (other disciplines use different enforcement mechanisms):

```typescript
// Express middleware implementing ^authenticated
function authenticated(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

// Express middleware implementing ^project-admin
function projectAdmin(req, res, next) {
  const project = await Project.findById(req.params.id);
  if (!project.admins.includes(req.user.id)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Route applying the gate chain from portal.yaml
router.put('/api/projects/:id', authenticated, projectAdmin, updateProject);
```

The key discipline: the `portal.yaml` definition and the implementation must match. If `portal.yaml` says an operation requires `^project-admin`, the code must actually enforce that check.
