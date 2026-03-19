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

## Connect to Claude Code

Paradigm works as a Claude Code plugin. Install it from the marketplace:

```bash
/install-plugin ascend42/a-paradigm
```

This gives your AI agents access to 100+ MCP tools for navigating, querying, and modifying your symbol graph.

---

## Scenario A: Starting a New Project

If you're building something from scratch, plan your architecture **with** symbols from day one. Give your agent a prompt like this:

```
I'm starting a new project: [describe your app].

Help me plan the architecture using Paradigm symbols. For each major
piece, identify:
- Components (#) — the services, views, and modules we'll build
- Flows ($) — multi-step processes that span components
- Gates (^) — auth checkpoints and access control
- Signals (!) — events that trigger side effects

Create .purpose files for each directory as we scaffold.
```

Your agent will help you think through the structure before writing code. As you build each piece, the `.purpose` files grow alongside the implementation — your codebase is mapped from the first commit.

**Tip:** You don't need to map everything upfront. Start with the core components and flows, then add gates, signals, and aspects as the design solidifies.

---

## Scenario B: Mapping an Existing Codebase

If you already have a codebase, you want your agent to retroactively discover and map its structure. Give your agent this prompt:

```
Scan this codebase and map it using Paradigm symbols. For each source
directory:

1. Identify the key components (#) — services, models, utilities, views
2. Find multi-step flows ($) — checkout, onboarding, deploy pipelines
3. Locate auth gates (^) — middleware, guards, permission checks
4. Spot signals (!) — events, webhooks, notifications
5. Note cross-cutting aspects (~) — logging, rate limiting, audit trails

Create a .purpose file in each directory with what you find.
Then run `paradigm scan` to build the index.
```

The agent will walk your source tree, read the code, and create `.purpose` files that describe what already exists. This typically takes a few minutes for a medium-sized project.

**Tip:** After the initial mapping, run `paradigm doctor` to check for inconsistencies and missing coverage.

---

## Next Steps

- [The Five Symbols](/docs/concepts) — Learn the symbol system
- [Purpose Files](/docs/purpose-files) — Detailed authoring guide
- [Components](/docs/components) — Browse the symbol reference
- [Portal Reference](/docs/portal) — Authorization gates and routes
