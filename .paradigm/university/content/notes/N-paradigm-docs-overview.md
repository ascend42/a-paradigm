---
id: N-paradigm-docs-overview
title: "Paradigm Docs: Auto-Generated Documentation"
type: note
author: paradigm
created: "2026-03-17"
updated: "2026-03-17"
tags:
  - docs
  - paradigm
  - documentation
symbols:
  - "#DocsLoader"
  - "#DocsCommands"
  - "#DocsSection"
difficulty: beginner
estimatedMinutes: 10
prerequisites: []
category: paradigm-docs
---

# Paradigm Docs — Auto-Generated Documentation from the Symbol Graph

## What It Does

Paradigm Docs generates complete, navigatable documentation directly from your project's symbol graph. Instead of maintaining documentation separately (which drifts), docs are rendered FROM the same `.purpose` files, flows, gates, and aspects that define your project structure.

Every project using Paradigm gets instant documentation via `paradigm docs serve`.

## Data Sources

The docs system reads from five data sources:

| Source | What It Provides |
|--------|-----------------|
| `.paradigm/scan-index.json` | Components, signals, aspects — all symbols |
| `.paradigm/flow-index.json` | Flow definitions with steps |
| `portal.yaml` | Gates and route-to-gate mappings |
| `.paradigm/university/` | Related guides and notes |
| `docs/` directory | Handwritten custom pages |

## How It Works

1. **Manifest Generation**: `buildDocsManifest()` reads the scan-index and builds a sidebar structure, grouping components by type (commands, services, views, etc.)
2. **Symbol Pages**: Each symbol gets a detail page with description, tags, cross-references, related flows, applied gates, and linked university guides
3. **Flow Pages**: Each flow shows its step sequence (gate → action → signal) as a visual timeline
4. **Portal Page**: Shows all gates and routes in a single reference table

## CLI Commands

| Command | Description |
|---------|-------------|
| `paradigm docs serve` | Launch interactive docs viewer (port 3850) |
| `paradigm docs build` | Generate static documentation site |

## MCP Tools

| Tool | Description |
|------|-------------|
| `paradigm_docs_manifest` | Get sidebar structure and symbol counts |
| `paradigm_docs_page` | Get page data for any symbol, flow, or custom page |
| `paradigm_docs_search` | Full-text search across all documentation |

## Configuration

Add to `.paradigm/config.yaml`:

```yaml
docs:
  enabled: true
  title: null              # defaults to "{project} Docs"
  theme: dark
  customContent: "docs/"   # directory for handwritten pages
  exclude:
    tags: [deprecated, test]
  sidebar:
    collapsed: [aspects, signals]
  output: ".paradigm/docs-site"
```

## Custom Pages

Place markdown files in the `docs/` directory (or the configured `customContent` path). Each file supports YAML frontmatter:

```markdown
---
title: Getting Started
order: 1
description: Quick start guide
---

Your content here...
```

Custom pages appear in the sidebar under "Getting Started" and integrate with auto-generated symbol reference.

## Extracurricular Placement

This content is categorized as `paradigm-docs` (extracurricular track), meaning it does not appear in the default onboarding sequence but is discoverable via `paradigm_university_search({ category: 'paradigm-docs' })`.
