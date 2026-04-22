---
id: N-para-301-doctor-and-validation
title: Doctor & Validation
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-301
  - paradigm-doctor-cli
  - paradigmpurposevalidate-mcp-tool
  - paradigmflowcheck
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-301.json
---

## Doctor & Validation

As a Paradigm project evolves, its metadata can drift out of sync with the actual code. A component gets renamed but its `.purpose` file still references the old name. A gate is added to `portal.yaml` but never implemented. An aspect loses its code anchor when someone refactors the file it pointed to. Paradigm's validation tools catch these inconsistencies before they cause confusion.

The `paradigm doctor` CLI command runs a comprehensive health check across your entire project. It validates several categories of issues:

- **Purpose file integrity**: Are all `.purpose` files valid YAML? Do all symbol references use correct prefixes?
- **Portal.yaml consistency**: Do routes reference gates that are actually defined? Are there gates defined but never used?
- **Aspect anchor verification**: Do all `~aspect` symbols have anchors? Do those anchors point to files and lines that still exist?
- **Orphaned symbol detection**: Are there symbols defined in `.purpose` files that are never referenced anywhere else?
- **Cross-reference validation**: When `#checkout-form` says it uses `$checkout-flow`, does that flow actually exist?

```bash
$ paradigm doctor

Checking .purpose files...
  src/features/checkout/.purpose - OK
  src/features/auth/.purpose - WARNING: #legacy-login referenced but not defined
  src/services/.purpose - OK

Checking portal.yaml...
  ^authenticated - OK (used in 12 routes)
  ^project-admin - WARNING: defined but used in 0 routes

Checking aspects...
  ~audit-required - ERROR: anchor src/middleware/audit.ts:15-35 not found
  ~rate-limited - OK

Results: 2 warnings, 1 error
```

For more targeted validation, the MCP tool `paradigm_purpose_validate` lets you check a specific `.purpose` file or validate all files. You can also include portal.yaml validation with the `includePortal` parameter. This is useful after making changes to a specific area -- run validation on just the files you touched rather than the entire project.

The `paradigm_flow_check` tool specifically validates flow definitions. It checks that gates referenced in flow steps exist in `portal.yaml`, that actions described in steps have corresponding implementations in the codebase (when `checkImplementation` is true), and that signals emitted during the flow are properly defined.

A good rhythm is to run `paradigm doctor` after major changes (adding features, refactoring, renaming symbols) and before committing. Many teams integrate it into their pre-commit hooks or CI pipelines. Think of it as a linter for your Paradigm metadata -- catching problems early is always cheaper than debugging them later.

### Clarification Markers

When a requirement is ambiguous or incomplete in a `.purpose` file, use the `[NEEDS CLARIFICATION: ...]` marker format instead of guessing. For example:

```yaml
components:
  payment-processor:
    description: "Processes payments via Stripe [NEEDS CLARIFICATION: should this support PayPal fallback?]"
```

Clarification markers are reported as **warnings** (not errors) by both `paradigm doctor` and `paradigm_purpose_validate`. They do not block validation or break builds, but they surface during health checks to remind the team that a design question remains open. The exact format `[NEEDS CLARIFICATION: <question>]` is required -- the tooling scans for this specific prefix in all description fields across `.purpose` files. Resolve all markers before shipping by replacing them with the clarified text.
