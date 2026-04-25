# Paradigm Agents Guide

> Persistent AI agent identities — what they are, how to manage them, how they learn.
> Reflects v6.0 surface (`paradigm agent` CLI + `paradigm_agent_*` MCP tools).

## 1. What an agent is

A Paradigm agent is a `.agent` YAML file describing a persistent identity that carries personality, expertise, and a notebook of learned patterns across sessions and projects. When you run `paradigm shift` and ask your AI client to "design a feature", an architect agent picks it up. When you say "implement", a builder picks it up. The same identity comes back next session, with the symbols it has touched still in its expertise table.

An agent profile contains:

- `id` and optional `nickname`
- `role` and `description`
- `personality` — `style`, `risk`, `verbosity`
- `expertise[]` — symbols the agent has worked on, with confidence scores and session counts
- `transferable[]` — patterns learned in one project that apply elsewhere
- `contexts{}` — per-project state (focus areas, last active, sessions on project)
- optional `permissions` — advisory path / tool / dangerous-action scopes

Profiles live in two places:

- `~/.paradigm/agents/<id>.agent` — global, shared across all projects
- `.paradigm/agents/<id>.agent` — project-local, overrides global when both exist

## 2. The core team

`paradigm shift` rosters six core agents on first run, plus three specialty roles that activate on need. All are tier-1 / tier-2 / tier-3 — the tier maps to a default model (opus / sonnet / haiku) but can be overridden in `.paradigm/config.yaml`'s `model-resolution` block.

### The six core agents

| Agent | Tier | Role |
|-------|------|------|
| **architect** | tier-1 | Designs systems, writes specs, plans features. Does not write implementation code. |
| **builder** | tier-3 | Implements code per architect specs. Fresh-context principle — never carries assumptions across tasks. |
| **reviewer** | tier-2 | Two-stage review: spec compliance, then code quality. Hands back to builder for fixes. |
| **security** | tier-1 | Audits for auth, secrets, injection, ownership checks. Reads `portal.yaml`. |
| **tester** | tier-3 | Writes and runs tests. Methodical, conservative. |
| **documentor** | tier-3 | Final orchestration stage. Updates `.purpose` files, `portal.yaml`, lore. Never touches source code. |

### The three specialty agents

| Agent | Tier | Role |
|-------|------|------|
| **ftux (Nora)** | tier-1 | First-time user experience simulator. Reads only user-facing surfaces (README, --help, error strings) — never source. Produces friction reports at `.paradigm/ftux/reports/YYYY-MM-DD.md`. Runs after builder when the task touches a user-visible surface, before documentor. |
| **captain (Cid)** | tier-1 | Navigation + coverage captain. Briefs the team on what to read before a task; debriefs at the end on what was missed. |
| **intelligence officer (Loid)** | tier-1 | Learning officer. Synthesizes patterns from postflight verdicts into agent journals → notebooks → wisdom. |

The full list of role tiers (architect, ftux, security, advocate, product, operations, sales, legal, ethicist, futurist all tier-1; many more tier-2 / tier-3) is at `packages/paradigm-mcp/src/tools/orchestration.ts:181`.

## 3. The roster vs. activation model

Two layers control who orchestrates on a given project:

1. **The agent profile** (`<id>.agent`) — does the identity exist?
2. **The project roster** (`.paradigm/roster.yaml`) — is the agent active on _this_ project?

A profile in `~/.paradigm/agents/` is _available_ globally. A roster entry in `.paradigm/roster.yaml` makes it _active_ for orchestration here. An agent can be benched on this project while still active on others.

```yaml
# .paradigm/roster.yaml
version: '1.0'
active:
  - architect
  - builder
  - reviewer
  - security
  - tester
  - documentor
  - ftux
  - cid
```

When you `paradigm agent bench <id>`, the agent is removed from this project's roster — Maestro skips it. `paradigm agent activate <id>` adds it back. Both operate on the per-project roster, not the global profile.

### Why bench an agent

Each agent in an orchestration pulls token budget. Practical orchestration sweet spot is 3-4 agents in parallel — beyond 5+ the marginal value of an additional voice usually doesn't beat the cost. Common reasons to bench:

- Agent has 0% accept rate on its recent nominations (Neverland threshold rising)
- Project doesn't need that specialty (e.g. no UI ⇒ bench `designer`)
- Agent is a lower-tier duplicate of a more active one

`paradigm agent roster` shows active vs. benched with current expertise summary.

## 4. CLI commands

Surface lives at `paradigm agent <subcommand>`. All commands are at `packages/paradigm/src/commands/agent/`.

### Listing and showing

```bash
paradigm agent list                  # global + project profiles, top expertise
paradigm agent list --json           # JSON output
paradigm agent list --global         # only global
paradigm agent list --project        # only project-local

paradigm agent show <id>             # full profile detail
paradigm agent show <id> --json
```

`list` shows top 3 expertise entries per agent; `show` shows the full table (top 20 in human output, all in `--json`).

### Roster management

```bash
paradigm agent roster                # show active vs. benched
paradigm agent bench <id>            # remove from this project's roster
paradigm agent activate <id>         # add to this project's roster

paradigm agent roster init           # create initial roster from project type
paradigm agent roster add <ids...>   # add one or more
paradigm agent roster remove <ids...>
```

### Creating and bootstrapping

```bash
paradigm agent create <id> --global                      # default scope is global
paradigm agent create <id> --role "..." --description "..."
paradigm agent create <id> --deny-paths ".env*,*.key"    # advisory deny patterns

paradigm agent sync <id>             # bootstrap expertise from existing lore
paradigm agent sync <id> --dry-run   # preview without writing
```

`create` defaults to `--global` — most agents you'd want shared across projects. Use `--global=false` for a project-specific override. `sync` walks `.paradigm/lore/entries/` and seeds `expertise[]` from `symbols_touched` arrays in past lore entries, so a freshly-created agent has a working memory of what got touched in the codebase.

### Permission scopes (advisory)

```bash
paradigm agent scopes <id>           # show current approved scopes
paradigm agent review [id]           # review pending scope changes
paradigm agent approve <id>          # quick-approve pending changes
paradigm agent deny <id>             # deny pending changes
```

See §6 below for what these scopes do (and don't).

### Registry (nevr.land)

```bash
paradigm agent search <query>                    # search nevr.land
paradigm agent install @scope/name               # install from registry (nevr.land)
paradigm agent install @scope/name --global      # install globally
paradigm agent publish --namespace <ns>          # publish to nevr.land
```

The registry endpoint defaults to `https://nevr-api.onrender.com`; override with `NEVR_REGISTRY_URL`. Source forms accepted by `paradigm agent install`:

- `@scope/name` — fetch the latest from nevr.land
- `@scope/name@version` — pinned version

The `paradigm:agents` skill (§5 below) also documents a `github:user/repo` install form — that is a skill-level capability that fetches a `.agent` YAML directly from a GitHub repo and saves it to `~/.paradigm/agents/`.

## 5. The `paradigm:agents` skill

Claude Code users get a higher-level wrapper at `/paradigm:agents`, which combines the CLI commands with status checks and registry-aware install flows. Subcommands recognized by the skill:

- `roster` (default) — show active + benched with expertise summaries
- `onboard` — check default agents (architect, builder, tester, reviewer, security, documentor) and create + sync any missing
- `bench <id>`, `activate <id>` — wrap the CLI calls
- `show <id>` — full agent detail (calls `paradigm_agent_get`)
- `install <source>` — accepts `github:user/repo[/path]` or `@namespace/name` (nevr.land)

The skill checks `paradigm_ambient_health` first so it can show Neverland metrics (accept rate, threshold, notebook count) alongside the roster.

## 6. Adoption contracts (advisory permissions)

`.agent` files can declare a `permissions` block:

```yaml
permissions:
  paths:
    read: ["src/**", "tests/**"]
    write: ["src/components/**"]
    deny: [".env*", "*.key", "node_modules/**"]
  tools:
    allow: [Read, Edit, Bash]
    deny: [WebFetch]
  dangerous_actions: [git_push, npm_publish]
```

**These are advisory.** Per CLAUDE.md: "Adoption contracts — Agent permission scopes declared in `.agent` files are advisory text injected into agent prompts. They represent intent and guide agent behavior — they are not wired to Claude Code's tool permission system. A 'denied' scope is a recommendation, not a hard block. If hard enforcement is required, pair adoption contracts with Claude Code tool permission controls."

The intent is twofold: (1) the agent reads its own scope each session and self-restricts, (2) reviewers see exactly what an agent claims it should and shouldn't touch. Hard enforcement requires Claude Code's `.claude/settings.json` permissions, configured separately.

`paradigm agent review`, `approve`, and `deny` manage scope-change proposals — when an agent wants to expand its claimed scope, it routes through this approval queue rather than silently edits its own `.agent` file.

## 7. How agents learn

Three storage tiers feed the learning loop:

1. **Lore** (`.paradigm/lore/entries/YYYY-MM-DD/L-*.lore`) — narrative timeline of sessions. Records `symbols_touched`, `confidence`, `summary`. Project-local.
2. **Journals** (per-agent, in `~/.paradigm/agents/<id>/journal/`) — what the agent learned this session. Includes `trigger` (correction_received, confidence_miss, pattern_discovered, etc.), `insight`, `transferable: bool`, `confidence_before/after`.
3. **Notebooks** (`.paradigm/notebooks/<agent>/nb-*.yaml`) — promoted patterns the agent has applied with measurable results. Carries `appliedCount`, `successRate`, `scope` (`generalizable | project-specific | platform-specific`), `publishable: bool`.

Promotion flow: lore entry → journal (postflight, when something was learned) → notebook (when `appliedCount` and `confidence` cross thresholds, with human approval gate per the v6.1 promotion-pipelines spec).

`paradigm agent sync <id>` is the bootstrap path — it walks lore and seeds expertise. The continuous path is the postflight learning loop:

- `paradigm ambient postflight` runs at session end (auto-fired by the stop hook)
- Reads pending verdicts from `.paradigm/events/verdicts.jsonl` (durable, not cleared on session start)
- Writes journal entries; promotes high-confidence repeat patterns to notebooks
- Updates expertise scores using a `0.7 * existing + 0.3 * new` rolling average

See §9 of the [University guide](./university.md) for the related project-pack content surface — University holds first-party teaching content, separate from agent-learned notebooks.

## 8. MCP tools

All agent tools accept JSON args; ~50–200 token responses. Defined in `packages/paradigm-mcp/src/tools/agents.ts`.

| Tool | What it does |
|------|--------------|
| `paradigm_agent_list` | List all profiles. `scope: "all" \| "global" \| "project"`. Returns top expertise + state per agent. |
| `paradigm_agent_get` | Full profile by id or nickname. Includes integrity check, transferable patterns, project contexts. |
| `paradigm_agent_expertise` | Find best agents for a symbol. Returns ranked list with confidence + sessions. `response_format: "concise"` returns just the top agent. |
| `paradigm_agent_bench` | Bench an agent (per-project). |
| `paradigm_agent_activate` | Activate a benched agent (per-project). |
| `paradigm_agent_prompt` | Fetch the role prompt for an agent. Used by orchestration to seed Task-tool contexts. Enum: `advocate, architect, builder, compliance, ftux, tester, reviewer, security, documentor`. |

Two related tools used during orchestration:

- `paradigm_orchestrate_inline` — runs the multi-agent flow. In Claude Code, agents launch as isolated `Task` tool contexts (true multi-agent — separate memory per agent). In Cursor and other IDEs without Task tool support, agents run sequentially in the same context (sequential roleplay). Configured via `orchestration.default_mode` in `agents.yaml`, defaults to `faceted`.
- `paradigm_ambient_health` — Neverland health (accept rate, notebook count, threshold drift) — surfaced by the `paradigm:agents` skill in its roster output.

## 9. Common workflows

### First time on a project

```bash
paradigm shift                       # rosters six core agents + ftux + cid
paradigm agent roster                # confirm active list
paradigm agent sync architect        # seed expertise from existing lore
paradigm agent sync builder
```

`shift` does the agents.yaml + roster init for you; the explicit `sync` calls are useful when joining a project that already has lore but no agent profiles synced yet.

### Adding a specialty agent

```bash
paradigm agent create designer --global \
  --role "UI/UX specialist; reads .purpose and design tokens; writes specs"
paradigm agent activate designer
```

Or pull one from the registry:

```bash
paradigm agent search "swift mobile"
paradigm agent install @somebody/swift-expert --global
paradigm agent activate swift-expert
```

### When an agent stops being useful

```bash
paradigm agent roster                # check accept rate / threshold
paradigm agent show <id>             # see expertise + transferable patterns
paradigm agent bench <id>            # take it out of orchestration
```

The agent stays available globally. Reactivate later with `paradigm agent activate <id>`.

### When orchestration feels too slow

Three or four agents in parallel is the practical sweet spot. Bench specialists you don't need:

```bash
paradigm agent bench performance
paradigm agent bench seo
paradigm agent bench i18n
```

Each removed agent saves both token budget and orchestration latency. Reactivate per task when you actually need them.

## 10. The `.agent` file format

Minimum viable profile, written by `paradigm agent create`:

```yaml
id: architect
nickname: architect
role: System architect specializing in distributed architecture
description: Deliberate and precise; designs systems, writes specs
version: 1.0.0
personality:
  style: deliberate
  risk: conservative
  verbosity: detailed
expertise: []
transferable: []
contexts: {}
created: '2026-04-18T12:00:00.000Z'
updated: '2026-04-18T12:00:00.000Z'
```

After `paradigm agent sync` and a few sessions:

```yaml
expertise:
  - symbol: "#auth-middleware"
    confidence: 0.85
    sessions: 7
    lastTouch: "2026-04-15T14:22:10Z"
  - symbol: "$checkout-flow"
    confidence: 0.62
    sessions: 3
    lastTouch: "2026-04-12T09:11:02Z"
transferable:
  - id: pattern-jwt-rotation
    description: "Rotate JWT signing keys via #key-rotation gate before expiring sessions"
    learnedIn: project-a
    appliedIn: [project-b, project-c]
    successRate: 1.0
contexts:
  project-a:
    focus: ["#auth-middleware", "$checkout-flow"]
    sessionsInProject: 12
    lastActive: "2026-04-15T14:22:10Z"
```

Registry-installed agents also carry `scope`, `registry`, `distribution`, `installedAt`, and a top-level `tags[]` array.

---

## 11. Partners (v6.0.3)

Agents can declare reciprocal **partners** — other agents they pair with for a body of work. Scholar (research) pairs with Sheila (educator). Builder might pair with Tester. The field is structural metadata: it shapes how agents appear next to each other in `agent get`/`agent list` and reserves the surface for future learning-loop coupling.

### Field shape

```yaml
# in agents.yaml or .agent file
partners:
  - id: sheila
    relation: educator-pair          # optional, free-form label
    share_notebooks: off             # off (default) | read | read-write
```

`relation` is human-readable context shown in `agent get`. `share_notebooks` is reserved — at v6.0.3 it has no runtime effect; v6.1+ pair-learning will read it.

### Reciprocal vs pending

When A lists B and B lists A, the pairing is **reciprocal** — shown with a green ✓ in `agent get`. When A lists B but B doesn't list A back, the pairing is **pending** (yellow ⚠) — legal, mirrors how nevr.land trust contracts will work. One-way is intentional in mentor/lead patterns, accidental in typos; the surface lets you tell at a glance.

```
$ paradigm agent get scholar

  Partners (1)
    sheila  ✓ reciprocal  — educator-pair
```

If a declared partner isn't installed locally:

```
  Partners (1)
    sheila  (not installed) — paradigm agent install sheila
```

### Pair notebook namespace (reserved)

Each reciprocal pair has a canonical notebook path: `.paradigm/notebooks/_pairs/{a-b}/` (alphabetically sorted ids, regardless of who declared the pair). The directory is reserved at v6.0.3 — no learning entries are written there yet. v6.1+ pair-learning will use it so partner state lives next to the pair, not inside either agent's profile.

### Marketplace primitives (contracts-only)

Three typed shapes are defined in `packages/paradigm/src/commands/agent/registry-types.ts` for the eventual nevr.land marketplace:

- **`PartnerBundle`** — groups partnered agents into a single SKU
- **`ReciprocalInstallMeta`** — metadata that an agent's install should prompt-install partners
- **`PartnerCoverage`** — registry-index indicator marking paired agents and showing pairs

These are **contracts only** at v6.0.3. No live consumer wiring; they exist so registry response shapes stay forward-compat when nevr.land lands. Local code surfaces `PartnerCoverage` from registry response when present (graceful default when absent).

---

## Audience track map

- **First-time on a project:** §1, §2, §3, §9 ("First time on a project")
- **Customizing the team:** §3, §4 ("Roster management"), §9 ("Adding a specialty agent", "When an agent stops being useful")
- **Building agent permissions:** §6, §10
- **Understanding the learning loop:** §7, §8
- **Pairing agents:** §11

---

*Source of truth for the shipped surface: `packages/paradigm/src/commands/agent/*.ts`, `packages/paradigm-mcp/src/tools/agents.ts`, `packages/paradigm-mcp/src/tools/orchestration.ts` (tier + role-prompt definitions). Skill at `plugins/paradigm/skills/agents/SKILL.md`.*
