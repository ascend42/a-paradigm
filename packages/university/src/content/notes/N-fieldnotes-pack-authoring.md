---
id: N-fieldnotes-pack-authoring
title: "Authoring your own University pack"
type: note
author: paradigm
created: '2026-05-18'
updated: '2026-05-18'
section: field-notes
tags:
  - university
  - authoring
  - electives
symbols: []
difficulty: beginner
estimatedMinutes: 6
summary: "How to scaffold and ship a project pack for your codebase."
---

## What a pack is

A **pack** is a self-contained University tenant: one `pack.yaml` manifest plus a `content/` directory of notes, policies, quizzes, and learning paths. Paradigm's pack loader discovers packs at startup and serves them through a single UI at `localhost:3839`. Each pack has its own id, version, branding, and (since v6.5) sections.

You author a pack when you have learning material that belongs **next to your codebase** — onboarding guides for new engineers, security policies the team must acknowledge, scenario-based quizzes that mirror your real incident playbook. The content lives in git, gets reviewed in PRs, and is served to humans and AI agents alike.

## The four pack types

Paradigm recognizes four kinds of packs, distinguished by their `tenant_kind` and discovery path:

| Kind | `tenant_kind` | Discovered at | Use when |
|------|---------------|---------------|----------|
| First-party | `first-party` | `node_modules/@a-company/university/` | You're contributing back to Paradigm itself |
| Project | `project` | `.paradigm/university/` | Your team's onboarding, policies, scenarios |
| Discipline | `project` | `.paradigm/university/<name>/` | Splitting authoring by team — design, security, infra |
| External (npm) | `external` | Direct deps with `paradigm.universityPack` pointer | Publishing reusable packs to npm |

The default mode — running `paradigm university` from any Paradigm project — surfaces the first-party Paradigm pack. Adding `.paradigm/university/pack.yaml` to your repo creates a project pack that appears alongside it.

## Scaffolding a project pack

The fastest way to start is:

```bash
paradigm university init
```

That writes `.paradigm/university/pack.yaml` with a sensible default manifest derived from your `.paradigm/config.yaml` project name. Re-run with `--force` to overwrite. To scaffold a discipline sub-pack:

```bash
paradigm university init --discipline design
```

After init, the CLI prints a tip about sections (new in v6.5) — read it before authoring your first batch of entries.

## A minimum viable `pack.yaml`

```yaml
id: acme-onboarding
name: "Acme Onboarding"
version: "0.1.0"
schema_version: "1"
tenant_kind: project
description: "Engineering onboarding for Acme."
```

Required fields: `id`, `name`, `version`, `schema_version`, `tenant_kind`. Use kebab-case for the id. Everything else — branding, theme, sections, disciplines, dependencies, content_types — is optional.

For the full field reference (including the v6.5 `sections:` block), see [`docs/guides/university.md`](../../../../docs/guides/university.md) §4.5 and §7.

## The four content types

Every pack speaks the same content vocabulary:

### Notes (`N-<slug>.md`)

Markdown with YAML frontmatter. Stored at `content/notes/`. Use notes for architecture docs, onboarding pages, deep-dive explainers. Frontmatter must include `id`, `title`, `type: note`. Optional but recommended: `tags`, `difficulty`, `summary`, `section`, `order`.

### Policies (`P-<slug>.md`)

Same shape as notes (`type: policy`), stored at `content/policies/`. Use policies for review checklists, security gates, anything the team must acknowledge. Policies can carry `policy_version` and `policy_hash` for audit provenance (see the guide §6).

### Quizzes (`Q-<slug>.yaml`)

YAML at `content/quizzes/`. A quiz is an array of questions, each with labeled `choices` (A, B, C, …), a `correct` answer, and an optional `explanation`. Default pass threshold is 0.7. PLSAT-style scenarios — shared `scenario:` preamble + multiple `variants` per `slot` — are supported when you need exam-grade content.

```yaml
id: Q-onboarding-portal
title: "Portal basics"
type: quiz
passThreshold: 0.7
questions:
  - id: q1
    prompt: "Which symbol marks an authorization check?"
    choices:
      A: "#"
      B: "^"
      C: "!"
      D: "$"
    correct: B
    explanation: "Gates use the caret prefix."
```

### Learning paths (`LP-<slug>.yaml`)

YAML at `content/paths/`. A path is an ordered (or unordered) list of steps, each referencing another entry by id. Paths are the canonical ordering for `track`-style sections — students traverse a path step by step, and the UI tracks progress per-step.

```yaml
id: LP-onboarding
title: "Acme onboarding track"
ordered: true
section: courses
steps:
  - content: N-acme-welcome
    required: true
  - content: Q-onboarding-portal
    required: true
    passRequired: true
```

## Sections (v6.5)

Sections group entries into named tabs in the UI. A pack with one section behaves exactly like a v6.4 pack (single-section packs collapse the section nav). A pack with two or more sections shows a tab strip and lets the author pick a presentation `style` per section:

| Style | What it renders | Good for |
|-------|----------------|----------|
| `track` | Ordered learning paths with progress rings | Courses, certifications |
| `index` | Alphabetical or `order:`-sorted entry list | Field notes, references |
| `chronological` | Newest-first by `created:` date | Changelogs, release notes |
| `featured` | Editor-curated highlights | Landing page, "start here" shelf |

Declare sections in `pack.yaml`:

```yaml
sections:
  - id: courses
    name: Courses
    order: 0
    style: track
    default: true
    description: Structured learning paths.
  - id: field-notes
    name: Field Notes
    order: 1
    style: index
    description: Nice-to-knows and electives.
```

Then opt entries in via frontmatter:

```yaml
---
id: N-deployment-runbook
section: field-notes
order: 10
---
```

Entries without a `section:` land in the section marked `default: true` (or the first section if none is marked). At v6.5 the UI renders `track` natively and falls back to `track` rendering for the other styles — `index`, `chronological`, and `featured` ship their dedicated renderers as content demand grows.

## Cross-pack references

To reference content from another pack, qualify the id with `<pack-id>:`:

```yaml
prerequisites:
  - paradigm:N-symbol-basics
  - paradigm:Q-portal-fundamentals
```

Bare ids resolve against the current pack context (the `--pack` flag, the MCP `pack` argument, or the active project pack). The validator rejects bare cross-pack refs — inter-pack wiring is always explicit so packs don't silently shadow each other.

You can also declare hard dependencies in `pack.yaml`:

```yaml
dependencies:
  - pack: paradigm
    min_version: "6.0.0"
    kind: required
```

## Validate before you commit

```bash
paradigm university validate
```

Catches the integrity issues that bite later: broken path steps, bad quiz answer keys, missing titles, duplicate section ids, two sections marked default, entries referencing sections that don't exist. Run it in CI if your team authors content regularly.

## Publishing as an npm package

To share a pack across projects, publish the pack directory as a normal npm package:

```json
{
  "name": "@acme/onboarding-pack",
  "version": "1.0.0",
  "files": ["pack.yaml", "content/"]
}
```

Then consuming projects add a pointer in their `package.json`:

```json
{
  "dependencies": {
    "@acme/onboarding-pack": "^1.0.0"
  },
  "paradigm": {
    "universityPack": "node_modules/@acme/onboarding-pack/"
  }
}
```

Paradigm's pack loader scans **direct dependencies only** for the `paradigm.universityPack` pointer — transitive deps are ignored to keep discovery predictable.

## Where to go next

- [`docs/guides/university.md`](../../../../docs/guides/university.md) §4.5 for the canonical sections reference.
- [`docs/guides/university.md`](../../../../docs/guides/university.md) §7 for the full `pack.yaml` field list.
- `paradigm university add` for scaffolding individual entries (`note`, `policy`, `quiz`, `path`).
- `paradigm university validate` whenever you've moved entries between sections or renamed an id.

The pack format is stable. The four content types and the cross-pack reference syntax landed in v5.39.0; sections landed in v6.5.0; everything else has been additive.
