---
title: Getting Started
order: 1
description: Install Paradigm, initialize your project, and create your first .purpose file.
---

## Installation

Install Paradigm globally via npm:

```bash
npm install -g @a-company/paradigm
```

Or add it to your project as a dev dependency:

```bash
npm install -D @a-company/paradigm
```

## Initialize a Project

Run `paradigm shift` in your project root. This creates the `.paradigm/` directory and scans your source tree:

```bash
cd your-project
paradigm shift
```

This creates:

- `.paradigm/config.yaml` — Project configuration and conventions
- `.paradigm/scan-index.json` — Auto-generated symbol index
- `.paradigm/navigator.yaml` — Structure map for AI navigation

## Your First .purpose File

Create a `.purpose` file in any source directory to declare its symbols:

```yaml
components:
  AuthService:
    description: Handles user authentication and session management
    type: service
    tags: [feature, auth]

gates:
  ^authenticated:
    description: Requires valid JWT token

signals:
  login-success:
    description: Emitted after successful authentication
```

Every `.purpose` file is a YAML document that describes the symbols in its directory. The five symbol types are Components (#), Flows ($), Gates (^), Signals (!), and Aspects (~).

## Scan Your Project

Run `paradigm scan` to rebuild the symbol index from all `.purpose` files:

```bash
paradigm scan
```

## Connect to Claude Code

Paradigm works as a Claude Code plugin. Install it from the marketplace:

```bash
/install-plugin ascend42/a-paradigm
```

This gives your AI agents access to 100+ MCP tools for navigating, querying, and modifying your symbol graph.

## Next Steps

- [The Five Symbols](/docs/concepts) — Learn the symbol system
- [Purpose Files](/docs/purpose-files) — Detailed authoring guide
- [Components](/docs/components) — Browse the symbol reference
- [Portal Reference](/docs/portal) — Authorization gates and routes
