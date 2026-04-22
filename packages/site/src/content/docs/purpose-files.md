---
title: Purpose Files
order: 3
description: How to write and maintain .purpose files — the source of truth for your symbol graph.
---

## What is a .purpose File?

A `.purpose` file is a YAML document placed in a source directory. It declares the symbols defined in that directory — components, flows, gates, signals, and aspects. Together, all `.purpose` files form your project's **symbol graph**.

## Structure

```yaml
description: >
  Brief description of what this directory contains.

components:
  UserProfile:
    description: Displays and edits user profile information
    type: view
    tags: [feature, user]
    parent: "#UserModule"

flows:
  $user-update:
    name: User Profile Update
    trigger: "PUT /api/users/:id"
    steps:
      - type: gate
        symbol: ^authenticated
      - type: gate
        symbol: ^user-owner
      - type: action
        symbol: "#UserProfile"
      - type: signal
        symbol: "!user-updated"

gates:
  user-owner:
    description: User can only modify their own profile

signals:
  user-updated:
    description: Emitted when a user profile is modified

aspects:
  ~audit-required:
    description: All profile changes must be audit-logged
    anchors:
      - file: user-service.ts
        line: 42
```

## Placement

Place `.purpose` files in directories that contain related code. The file describes the symbols defined in that directory and its immediate children. A project typically has one `.purpose` per feature module or service.

## Component Fields

| Field | Required | Description |
|-------|----------|-------------|
| `description` | Yes | What this component does |
| `type` | No | Structural role: view, service, command, utility, store |
| `tags` | No | Behavioral tags: feature, integration, critical, state |
| `parent` | No | Parent component reference for hierarchy |

## When to Update

The Paradigm stop hook will remind you to update `.purpose` files when you modify source code. As a rule, update your `.purpose` whenever:

- You add a new component, flow, gate, signal, or aspect
- You change what a component does (update the description)
- You rename or remove a symbol
- You add a new route (also update `portal.yaml`)

## Scanning

After modifying `.purpose` files, run `paradigm scan` to rebuild the symbol index. The pre-commit hook does this automatically before each commit.

## Best Practices

- One `.purpose` per logical module or feature directory
- Keep descriptions concise but specific
- Use `type` for structural role (view, service, command)
- Use `tags` for behavioral classification (feature, integration, state)
- Reference related symbols using their prefixes: `#component`, `$flow`, `^gate`, `!signal`, `~aspect`
