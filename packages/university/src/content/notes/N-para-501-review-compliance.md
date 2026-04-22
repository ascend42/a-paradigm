---
id: N-para-501-review-compliance
title: Automated Review Pipeline & Compliance Checking
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-501
symbols: []
difficulty: beginner
estimatedMinutes: 2
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-501.json
---

## paradigm review

The automated review pipeline uses a two-stage protocol:

### Stage 1: Spec Compliance (always runs)

- **Purpose coverage**: All touched symbols registered in .purpose files
- **Portal gate compliance**: Routes declared in portal.yaml with gates
- **Aspect anchors**: Anchor files still exist, no drift
- **Broken references**: Parent symbols exist
- **Route coverage**: New routes have portal.yaml entries

### Stage 2: Code Quality (--deep only)

- **Security**: eval() detection, hardcoded secrets
- **Convention**: console.log usage (use Paradigm logger)
- **Test coverage**: Gaps in test files

### ReviewFinding Format

Each finding has:
- **type**: blocking (must fix), improvement (should fix), note (informational)
- **category**: purpose-coverage, portal-compliance, aspect-anchors, security, convention
- **message**: Human-readable description
- **suggestion**: How to fix it

### Usage

```bash
paradigm review              # Staged changes
paradigm review --pr 123     # PR via gh CLI
paradigm review --ci         # Exit 1 on blocking
paradigm review --deep       # Include code quality
paradigm review --json       # JSON output
```

## Dynamic Tool Loading

Tools are organized in three tiers:
- **Core** (~15 tools): Always loaded (search, ripple, status, navigate, etc.)
- **Feature**: Auto-detected from filesystem (lore → .paradigm/lore/, etc.)
- **Advanced**: On-demand via `paradigm_tool_activate`

## Response Format

`response_format: 'concise'` on high-traffic tools strips secondary data:
- paradigm_search: returns only { symbol, type }
- paradigm_ripple: returns only { symbol, impact, summary }
- paradigm_status: returns only { project, counts, total }

## compliance-checker.ts

Shared logic extracted from pm.ts postflight. Both `paradigm_pm_postflight` and `paradigm review` use the same compliance checks.
