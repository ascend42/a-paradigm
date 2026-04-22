---
id: N-para-101-first-steps
title: Your First Steps
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-101
  - paradigm-shift-creates
  - start-with-one
  - create-portalyaml-if
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-101.json
---

## Getting Started with Paradigm

Before diving into theory, let's get your hands dirty. This lesson walks through the concrete steps to set up Paradigm in a real project. You will encounter terms like *symbols*, *purpose files*, and *gates* — each gets its own deep-dive lesson later in this course. For now, focus on the workflow: initialize, document, scan, go.

## Step 1: Initialize the Project

Run `paradigm shift` in your project root. This creates the `.paradigm/` directory with a starter `config.yaml`:

```bash
paradigm shift
```

`paradigm shift` runs non-interactively by default — it auto-detects your discipline from project markers (`package.json`, `Cargo.toml`, `go.mod`, etc.), selects an appropriate agent roster, configures model tiers, installs hooks, and generates AI instruction files (CLAUDE.md, AGENTS.md). One command, full setup.

You can customize later with flags like `--verify` (health check) or `--workspace <name>` (multi-project workspace).

After init, you will have:
```
.paradigm/
  config.yaml    # Includes detected discipline and stack
  tags.yaml
  agents.yaml
```

## Step 2: Create Your First Purpose File

Pick a source directory that contains meaningful code — perhaps your main feature module or your API routes. Create a `.purpose` file:

```yaml
name: User Authentication
description: Handles user login, registration, and session management
context:
  - Uses bcrypt for password hashing
  - Sessions stored in Redis with 24h TTL
  - Rate limited to 5 login attempts per minute

components:
  #auth-handler:
    description: POST /auth/login and POST /auth/register endpoints
    file: auth.ts
    tags: [feature, auth]
    signals: ["!login-success", "!login-failed"]
    gates: ["^authenticated"]

  #session-manager:
    description: Creates and validates user sessions in Redis
    file: session.ts
    tags: [state, auth]
```

Start small. You do not need to document every file on day one. Begin with the most important module and expand over time.

## Step 3: Set Up portal.yaml (If Needed)

If your application has any protected endpoints, create `portal.yaml` at the project root:

```yaml
version: "1.0"

gates:
  ^authenticated:
    description: User must have a valid session
    check: req.session.userId != null
    type: auth
    effects: []

routes:
  "POST /auth/login": []
  "POST /auth/register": []
  "GET /api/profile": [^authenticated]
  "PUT /api/profile": [^authenticated]
```

Note that public routes like login and register have empty gate arrays `[]` — they are listed to document that they are intentionally unprotected.

## Step 4: Run Your First Scan

Generate the navigator map so AI agents can find symbols quickly:

```bash
paradigm scan
```

This reads all `.purpose` files and `portal.yaml`, builds a symbol index, and writes `navigator.yaml`.

## Step 5: The Orientation Protocol

When starting a new AI session (or when an AI agent first encounters your project), the agent should follow this protocol:

1. **Call `paradigm_status`** — Gets a project overview: symbol counts, health, available features.
2. **Read `config.yaml`** — Understands the discipline, conventions, and preferences.
3. **Check `portal.yaml`** — Knows about security gates if they exist.
4. **Use `paradigm_navigate`** — Finds the relevant code area for the current task.

This four-step orientation takes ~500 tokens total and gives the agent everything it needs to work effectively.

## Step 6: Iterate

Paradigm grows with your project. As you add features:
- Create `.purpose` files for new directories
- Add gates to `portal.yaml` for new protected routes
- Record team decisions in `.paradigm/wisdom/decisions.yaml`
- Log antipatterns in `.paradigm/wisdom/antipatterns.yaml`
- Run `paradigm scan` periodically to rebuild the navigator

## Common Pitfalls

- **Do not document everything on day one.** Start with the most critical module and expand.
- **Do not skip portal.yaml.** If you have any gates or preconditions, you need it.
- **Do not forget to re-scan.** After adding new `.purpose` files, run `paradigm scan` to update the navigator.
- **Do not put .purpose files in .paradigm/.** They live alongside source code.
- **Do not use raw console.log.** Use the Paradigm logger from the start to build good habits.
