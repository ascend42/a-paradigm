# Paradigm University Guide

> Multi-tenant content-pack framework. Shipped in v5.39.0 (additive bridge);
> v6.0 removed the v5 legacy content paths; v6.0.1 refreshed the course content
> for v6 reality (LoreType taxonomy, agent roster, decision-store consolidation).
> This guide stays current through subsequent v6.x patches.

## 1. What it is

Paradigm University is a place to keep structured learning material next to your code. You write notes, quizzes, and checklists; the CLI serves them at `localhost:3839` and your AI agents read them through MCP. It runs locally — nothing is sent anywhere.

You can use material someone else wrote (installed from npm) or you can write your own for your project.

## 2. Two ways to use it

### 2.1 First-party packs (installed)

Paradigm ships an official pack — [`@a-company/university`](https://www.npmjs.com/package/@a-company/university) — with PARA 001–701 courses and the PLSAT certification exam. Install it and run `paradigm university` and it's there. This is the default experience.

Claude University is planned as a **separate project** (see `project_claude_learning_site.md`), not a tenant of Paradigm's University. It's mentioned here only so "first-party" doesn't sound like it means "Paradigm's content, and Paradigm's content only" — the framework is open for any author to publish a pack.

### 2.2 Your project's pack

If you scaffold one, `.paradigm/university/` becomes a project-authored pack that lives in your repo. Run `paradigm university init` to create `pack.yaml`, then add notes, policies, quizzes, and paths with `paradigm university add`. Your team reviews the content through git like any other file.

Both modes work side-by-side. The CLI will show you whichever packs it can find.

---

## 3. Quick start

### 3.1 Launch the default teaching app

```bash
paradigm university
```

Opens the Paradigm University app on `http://localhost:3839` using the installed first-party content (if any). Use `-p, --port <port>` to change the port and `--no-open` to suppress the browser.

### 3.2 See the packs that are installed

```bash
paradigm university list
```

Without a selector, `list` prints the discovered packs (first-party, project, discipline sub-packs) and how many entries each has. Add a selector to list the entries instead — see §3.5.

### 3.3 Scaffold a project pack

```bash
paradigm university init
```

Writes `.paradigm/university/pack.yaml` using your `.paradigm/config.yaml` project name as the pack id (falling back to the working-directory basename). Safe to re-run; use `--force` to overwrite.

To scaffold a discipline sub-pack:

```bash
paradigm university init --discipline design
```

Writes `.paradigm/university/design/pack.yaml` with the parent pack id prefixed (`<project>-design`).

### 3.4 Create content

```bash
paradigm university add note --title "Auth overview"
paradigm university add policy --title "Code review checklist"
paradigm university add quiz --title "Portal gate basics"
```

`add` honors the `--pack`, `--project`, and `--discipline` selectors; when no selector is passed it writes to the project pack. Full option list in the CLI source (`packages/paradigm/src/commands/university/add.ts`).

### 3.5 Launch a specific pack

```bash
paradigm university serve --pack paradigm
paradigm university serve --project
paradigm university serve --project --discipline design
```

Selectors live on `serve` and the other subcommands — **not on the bare `paradigm university` command**. Bare `paradigm university` always opens the default app so muscle memory is preserved.

---

## 4. Disciplines (sub-packs)

### 4.1 What a discipline pack is

A discipline sub-pack is a `pack.yaml` nested inside the project pack. Its purpose is to split authoring between teams — design's content lives under `.paradigm/university/design/`, engineering's under `.paradigm/university/engineering/`, and so on. Each sub-pack has its own id and entry set.

### 4.2 Create one

```bash
paradigm university init --discipline <name>
```

The sub-pack id defaults to `<parent-pack-id>-<name>` so it's globally unambiguous. Sub-packs inherit their parent's branding and theme when those fields are absent from the sub-pack manifest.

### 4.3 Authoring entries in a sub-pack

```bash
paradigm university add note --title "Brand voice" --discipline design
```

The `--discipline` flag scopes the command to the sub-pack. `list`, `show`, `quiz`, `status`, `validate`, and `serve` all accept the same flag.

### 4.4 Shared branding and theme

The root `.paradigm/university/pack.yaml` can declare `branding:` and `theme:`. Sub-packs inherit unless they set their own. Keeps the UI coherent across disciplines without duplicating config.

### 4.5 Sections

#### What sections are

A **section** is a named grouping of entries inside a pack — rendered as a tab in the University UI and as a filter on the CLI and MCP search surfaces. Sections let a single pack carry multiple presentations of content side by side: a course track for structured learning, an index of field notes, a chronological changelog, a featured shelf for landing-page highlights. Sections landed in v6.5; everything below is additive — packs authored before v6.5 continue to render pixel-identical without any manifest changes.

#### Declaring sections in `pack.yaml`

```yaml
id: acme-onboarding
version: "1.0.0"
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

Required per-section fields: `id` (kebab-case), `name`, `order` (integer), `style`. Optional: `description`, `default: true` (exactly one section may carry it).

#### The four `style` values

| Style | Renders as | Use for |
|-------|------------|---------|
| `track` | Ordered paths with progress rings (the v6.4 CoursesView) | Courses, certifications, onboarding tracks |
| `index` | Sortable entry list (alphabetical or `order:`-keyed) | Field notes, references, electives |
| `chronological` | Newest-first by `created:` | Changelogs, release notes, blog-style |
| `featured` | Editor-curated highlights | Landing page, "start here" shelf |

At v6.5 the UI ships a `track`-native renderer; `index`, `chronological`, and `featured` fall back to the track renderer with a one-line dev-console warning. The dedicated renderers land as content demand grows — the manifest schema is locked so future renderers swap in without authoring churn.

#### Opting entries into a section

Every note, policy, quiz, and path can carry `section:` and `order:` in its frontmatter:

```yaml
---
id: N-deployment-runbook
title: "Deployment runbook"
type: note
section: field-notes
order: 10
---
```

Entries without an explicit `section:` land in the section flagged `default: true` (or the first section if none is). For learning paths in particular, the path's own `section:` declares where the path appears; the entries it references can live in any section.

#### Implicit-default back-compat

A pack that omits `sections:` entirely behaves exactly like v6.4: the loader synthesizes an implicit `main` section, the SectionNav collapses, and the UI renders the same single-track view it always did. There is no migration step for existing packs — declaring `sections:` is opt-in for packs that want the tab strip.

#### Worked example: Paradigm's first-party layout

The first-party Paradigm pack declares two sections — Courses (track, default) and Field Notes (index). PARA 001 through 701 live in Courses; nuanced explainers like "Authoring your own University pack" live in Field Notes. The same content_types power both — only the presentation differs.

#### Disambiguation: `section` is overloaded

Two different surfaces use the word `section`, in two different scopes:

| Field | Scope | Meaning |
|-------|-------|---------|
| `pack.yaml -> sections[].id` | Pack | The named tab a group of entries renders under |
| `Q-*.yaml -> questions[].section` | Question | The exam section a PLSAT-style question contributes to (§5.2) |

They share a name because both are organizational groupings, but their scopes never overlap — pack-level sections are about presentation, question-level sections are about exam structure. We considered renaming one and decided the conceptual overlap was clear enough in context that a rename would create more confusion than it resolves. If you find yourself debugging a validator error about "sections," check which one the error refers to.

#### CLI integration

```bash
paradigm university add note --title "Deploy guide" --section field-notes --order 10
paradigm university list --section field-notes
paradigm university validate
```

`add` accepts `--section <id>` and `--order <n>` flags. `list` accepts `--section <id>` as a filter. `validate` (v6.5+) checks: duplicate section ids, more than one default, entries referencing a section that doesn't exist, invalid `style` values, sections with no entries (warning, not error).

#### MCP integration

`paradigm_university_search` accepts an optional `section: <id>` filter. `paradigm_university_pack_list` returns each pack's declared `sections[]` so agents can route queries appropriately. Cross-pack references continue to use `<pack-id>:<entry-id>` — sections are not part of the address space.

---

## 5. The content types

### 5.1 Notes and policies

Markdown files with YAML frontmatter. Stored at `.paradigm/university/content/notes/N-<slug>.md` and `.paradigm/university/content/policies/P-<slug>.md`. Use notes for architecture docs and guides; use policies for checklists and review gates the team must follow.

### 5.2 Quizzes (including PLSAT-style scenarios)

YAML files at `.paradigm/university/content/quizzes/Q-<slug>.yaml`. A quiz is an array of questions, each with labeled choices (A, B, C, …), a correct answer, and an optional explanation. Pass threshold defaults to 0.7.

PLSAT-style scenarios — a shared preamble (`scenario:`) with multiple question variants grouped under one slot — are supported via optional `scenario`, `variants`, `slot`, `section`, and `weight` fields on questions, plus top-level `timeLimit`, `totalSlots`, and `exam: { kind: 'practice' | 'proctored' }`. None of those are required for a simple quiz. The PLSAT exam banks shipped with `@a-company/university` use these extensions.

### 5.3 Learning paths

YAML files at `.paradigm/university/content/paths/LP-<slug>.yaml`. A path is an ordered (or unordered) list of steps, each referencing another entry id (a note, policy, or quiz). Steps can be marked `required: true` and quiz steps can require a passing grade (`passRequired: true`).

Paths are the canonical ordering for `track`-style sections (§4.5) — a track-section's progress ring counts steps in the path, not entries in the section.

### 5.4 Diplomas (completion records)

Auto-generated at `.paradigm/university/diplomas/D-<date>-<student>-<slug>.yaml` when someone finishes a quiz via `paradigm university quiz <id>` or the web UI. They record the score, pass/fail, and timestamp. They're not content you author; they're the trail of what was completed.

---

## 6. Compliance fields (optional)

### 6.1 When to use them

Compliance fields let policies and diplomas carry version + hash provenance. Useful when your team needs to prove "Alice acknowledged version 3 of the incident policy on 2026-04-15" for an audit. For regular learning content, skip them.

### 6.2 `policy_version` and `policy_hash`

Add to a policy's frontmatter:

```yaml
---
id: P-incident-response
title: Incident response
type: policy
policy_version: "1.2.0"
policy_hash: "sha256:a3f1e9…"
compliance:
  retention_years: 7
  revoke_on_change: true
  severity: required
---
```

`severity` is `advisory | required | enforced` — informational only at v5.39/v6.0. `retention_years` and `revoke_on_change` are read by the schema today but no worker acts on them yet (see §6.4).

### 6.3 Diplomas with `policy_versions[]` and `content_hashes[]`

Diplomas can record the version and hash of every entry that factored into the award:

```yaml
id: D-2026-04-15-alice-incident-response
type: quiz
student: alice
earnedAt: "2026-04-15T14:22:10Z"
source: Q-incident-response
passed: true
policy_versions:
  "paradigm:P-incident-response": "1.2.0"
content_hashes:
  "paradigm:P-incident-response": "sha256:a3f1e9…"
```

This freezes the evidence — if the policy later changes, the diploma still shows what was acknowledged.

### 6.4 What is NOT enforced at v5.39.0 / v6.0

The schema accepts these fields. **Nothing enforces them yet.** Specifically:

- No worker invalidates diplomas when `policy_hash` changes.
- No retention worker expires diplomas after `retention_years`.
- No check blocks a commit or gate based on `severity: required`.
- No `paradigm compliance audit` command exists.

Enforcement tooling is v6.x. The schema is stable so packs authored today continue to work when the tooling lands.

---

## 7. For pack authors

### 7.1 Writing a `pack.yaml`

Minimum viable manifest:

```yaml
id: acme-security-onboarding
name: "Acme Security Onboarding"
version: "0.1.0"
schema_version: "1"
tenant_kind: external      # or: first-party | project
description: "Security onboarding for Acme engineers."
```

Required fields: `id`, `name`, `version`, `schema_version`, `tenant_kind`. Optional fields (branding, theme, content_types, disciplines, sections, compliance, dependencies) are documented in `packages/paradigm-mcp/src/types/pack.ts`. See §4.5 for the `sections` field reference.

Use kebab-case for `id`. First-party packs use short names (`paradigm`). Third-party packs should use reverse-DNS or a scoped form (`@acme/security-onboarding`) so ids don't collide across the ecosystem. This is a convention, not a hard check.

### 7.2 Publishing as an npm package

Publish the pack directory (with `pack.yaml` at the root, or nested) as a normal npm package, then add a pointer in the consuming project's `package.json`:

```json
{
  "dependencies": {
    "@acme/security-onboarding": "^1.0.0"
  },
  "paradigm": {
    "universityPack": "node_modules/@acme/security-onboarding/"
  }
}
```

Paradigm's pack loader scans **direct dependencies only** (not transitive) for the `paradigm.universityPack` field. The value is a relative path to the pack root — the directory containing `pack.yaml`.

### 7.3 Cross-pack references and dependencies

Inside an entry, refer to content from another pack using the qualified form:

```yaml
prerequisites:
  - paradigm:N-symbol-basics
  - paradigm:Q-portal-fundamentals
```

Bare ids (e.g. `N-symbol-basics`) resolve against the current pack context — the `--pack` flag, the MCP `pack` arg, or the active project pack if neither is set. The validator rejects bare cross-pack refs so inter-pack wiring is always explicit.

Pack-to-pack dependencies can be declared in `pack.yaml`:

```yaml
dependencies:
  - pack: "paradigm"
    min_version: "6.0.0"
    kind: required       # or: recommended
```

---

## 8. MCP tools

All University MCP tools accept an optional `pack` argument. Default resolution: project pack if present, else first-party.

| Tool | What it does |
|------|--------------|
| `paradigm_university_search` | Search entries by type, tag, difficulty, symbol, category, or free-text query. Accepts `pack` and `discipline`. Result ids are returned in `<pack-id>:<entry-id>` form. |
| `paradigm_university_get` | Fetch a full entry. Accepts bare id or `<pack-id>:<entry-id>`. |
| `paradigm_university_create` | Create a note, policy, quiz, or path. Honors `pack`. |
| `paradigm_university_update` | Update an existing entry. Honors `pack` to disambiguate bare ids. |
| `paradigm_university_onboard` | Return the recommended onboarding sequence for a student. Honors `pack`. |
| `paradigm_university_validate` | Validate pack integrity — broken path steps, bad quiz answer keys, missing titles. |
| `paradigm_university_pack_list` | **New in v5.39.0.** List discovered packs with id, name, version, tenant_kind, discipline, entry_count, path. Optional `tenant_kind` filter. |

### 8.1 `<pack-id>:<entry-id>` addressing

Canonical cross-pack addressing uses a colon: `paradigm:N-symbol-basics`. A bare id (`N-symbol-basics`) resolves against whichever pack is active. This is the authoritative form you'll see in search results and in cross-pack references inside YAML.

---

## 9. Metrics and the v6.3 sunset review

### 9.1 What we count (local-only)

v5.39.0 / v6.0 capture privacy-preserving count snapshots on lifecycle boundaries (`paradigm shift`, `paradigm doctor`, server start/stop, `paradigm university status`). Stored at `.paradigm/university/.metrics/snapshot-YYYY-MM-DD.json`, pruned after 90 days.

A snapshot records: pack count by tenant_kind, project-pack entry counts by type, disciplines count, `last_modified_days_ago`, and 30-day activity deltas (quiz completions, entries created). Plus a hashed project salt — `sha256(projectRootPath + random_salt)` — so snapshots are unique per project but carry no identifying string.

**No entry titles, no content bodies, no user identifiers, no remote send.** The `metrics.remote_consent` key is seeded to `pending` in `.paradigm/config.yaml` so v6.1 can prompt for opt-in without a config-schema migration.

Configurable via:

```yaml
# .paradigm/config.yaml
metrics:
  remote_consent: pending          # pending | granted | declined
  local_snapshots_enabled: true    # set to false to disable capture entirely
```

### 9.2 The v6.3 sunset contract

v6.3 shipped May 2026 and triggered the first cross-adopter University metrics review to decide whether the per-project University primitive earned its keep. The contract: the project-pack primitive is a **candidate for consolidation** if **all four** of these hold at the review:

1. **median project-pack entries < 3** (notes + policies + paths)
2. **median `last_modified_days_ago` > 45**
3. **median `quiz_completions_last_30d` < 1**
4. **adopters_with_project_pack / total_adopters < 0.20** (adoption floor)

AND-gate, deliberately conservative. A single noisy signal does not trigger sunset. "Consolidate" means collapsing project-authored content into wisdom + protocol primitives and retaining only first-party packs as the University surface — no content is lost, just routed.

This is a **docs-only commitment** at v5.39.0 / v6.0. No enforcement code ships yet. The v6.3 review reads the metrics and decides.

### 9.3 How to inspect locally

```bash
paradigm university status
```

Reads the latest snapshot for this project and shows per-pack entry counts and diploma totals.

---

## 10. Migrating from v5

### 10.1 No action required

If you had `.paradigm/university/` before v5.39.0, it continues to work. Entries without a `pack.yaml` sibling are treated as an implicit project pack, id derived from the directory name.

### 10.2 Adding a `pack.yaml` (recommended)

```bash
paradigm university init
```

Gives your pack a stable id, a version, and a place to declare branding, disciplines, and compliance. Takes about five seconds and makes the pack addressable via `<pack-id>:<entry-id>` in MCP tool calls.

### 10.3 The `loadPortalConfigLegacy` removal (v6.0)

The `loadPortalConfigLegacy` back-compat shim introduced in v5.37.12 is removed in v6.0. If you imported it: switch to `loadPortalConfig` and branch on the returned `status` (`'missing' | 'unparseable' | 'ok'`). This is unrelated to University content — flagged here only because both removals land in the same v6.0 release.

---

## 11. What's next (v6.1+)

- **Promotion pipelines** — notebook → project pack, decision cluster → path auto-draft, protocol → runbook. Reducing the authoring cost for content that already exists in other Paradigm surfaces.
- **Compliance enforcement tooling** — `paradigm compliance audit`, retention workers, revocation workers, diploma invalidation on `policy_hash` drift. Schema landed in v5.39/v6.0 so the tooling can be added without another breaking change.
- **Remote metrics opt-in** — v6.1 reads `metrics.remote_consent: pending` and prompts. Target endpoint is `nevr.land/telemetry`. Entirely opt-in.
- **Claude University** — a separate site, not a Paradigm tenant. Tracking at `project_claude_learning_site.md`. The framework bits that make it feasible (pack discovery, timed quizzes, presentational credentials) ship in v6.0.
- **Authoring UI for non-developers** — web CRUD for quizzes/paths, "suggest edit" PR flow. Conditional on v6.3 adoption data.
- **Glossary type, collapsing guide/runbook** — schema tidy-up deferred to avoid churn during the multi-tenant rollout.

---

## Audience track map

- **Project owner adding compliance:** §1, §2.2, §3.3–3.4, §5.1–5.2, §6 (primary), §8
- **First-party pack author:** §1, §2.1, §5, §6, §7 (primary), §8
- **Discipline sub-pack creator:** §1, §2.2, §3.3, §4 (primary), §5, §7.1
- **Section-aware pack author (v6.5+):** §1, §2.2, §4.5 (primary), §5.3, §7.1, §8

---

*Source of truth for the shipped surface: `packages/paradigm/src/commands/university/*.ts`, `packages/paradigm-mcp/src/tools/university.ts`, `packages/paradigm-mcp/src/utils/pack-loader.ts`, `packages/paradigm-mcp/src/utils/university-metrics.ts`, `packages/university/pack.yaml`. Decisions: `docs/private/plans/v6.0-decisions-locked.md`.*
