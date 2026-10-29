# Paradigm Agents Guide

> Persistent AI agent identities — what they are, how to manage them, how they learn.
> Covers the `paradigm agent` CLI + `paradigm_agent_*` MCP tools.

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

`paradigm shift` rosters a core team of agents on first run, plus specialty roles that activate based on project type or manual addition. All are tier-1 / tier-2 / tier-3 — the tier maps to a default model (opus / sonnet / haiku) but can be overridden in `.paradigm/config.yaml`'s `model-resolution` block.

### Core agents

| Agent | Tier | Role |
|-------|------|------|
| **architect** | tier-1 | Designs systems, writes specs, plans features. Does not write implementation code. |
| **builder** | tier-3 | Implements code per architect specs. Fresh-context principle — never carries assumptions across tasks. |
| **reviewer** | tier-2 | Two-stage review: spec compliance, then code quality. Hands back to builder for fixes. |
| **security** | tier-1 | Audits for auth, secrets, injection, ownership checks. Reads `portal.yaml`. |
| **tester** | tier-3 | Writes and runs tests. Methodical, conservative. |
| **documentor** | tier-3 | Final orchestration stage. Updates `.purpose` files, `portal.yaml`, lore. Never touches source code. |
| **Rune** (compliance) | tier-1 | Owns symbol/aspect enforcement. Graduates checks through a four-state promotion lifecycle: `candidate` → `active` → `enforcing` → `blocking`. Uses `paradigm_compliance` (op `promote`) to advance each concern. Rostered on by `paradigm shift`. |

### Specialty agents

| Agent | Tier | Role |
|-------|------|------|
| **ftux (Nora)** | tier-1 | First-time user experience simulator. Reads only user-facing surfaces (README, --help, error strings) — never source. Produces friction reports at `.paradigm/ftux/reports/YYYY-MM-DD.md`. Runs after builder when the task touches a user-visible surface, before documentor. |
| **captain (Cid)** | tier-1 | Navigation + coverage captain. Briefs the team on what to read before a task; debriefs at the end on what was missed. |
| **intelligence officer (Loid)** | tier-1 | Learning officer. Synthesizes patterns from postflight verdicts into agent journals → notebooks → wisdom. |
| **Atlas** (cartographer) | tier-2 | Generates and maintains `arch.yaml` — a structured architectural map committed alongside `.purpose` files. Uses `paradigm_graph` (op `arch_status`) and `paradigm_graph` (op `arch_diagram`). |

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
- `show <id>` — full agent detail (calls `paradigm_agent` (op `get`))
- `install <source>` — accepts `github:user/repo[/path]` or `@namespace/name` (nevr.land)

The skill checks `paradigm_ambient` (op `health`) first so it can show Neverland metrics (accept rate, threshold, notebook count) alongside the roster.

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

### Shell commands from agents run through the Anthropic API (enforced)

Unlike adoption contracts, this one is enforced in code. When `ANTHROPIC_API_KEY` is set, `paradigm team spawn`, `paradigm team orchestrate` and background orchestrations run agents through the Anthropic API provider, which gives the model four tools: `read_file`, `write_file`, `search_files` and `run_command`.

**Files stay in the project.** Every path the model gives, and the folder it asks `run_command` to use, must resolve inside the run's working directory, with symlinks followed. An absolute path such as `~/.ssh/id_ed25519`, a `../` path, a UNC or device path, or a symlink in the repo that points outside is refused, and the model is told why. An agent can't run with `/`, your home folder or a folder above it as its working directory.

**Some files are never written.** Some files run commands the next time git, your editor, a hook or your shell touches the repo, so `write_file` refuses them even while commands are off:

- `.git`, `.hg` and `.svn`, at any depth, as folders or files
- at any depth: the folders `.claude/`, `.cursor/`, `.vscode/`, `.idea/`, `.devcontainer/`, `.husky/`, `.githooks/`, `.lefthook/` and `.paradigm/` (agents change Paradigm state through Paradigm tools), and the files `.mcp.json`, `.envrc`, `.npmrc`, `.yarnrc`, `.yarnrc.yml`, `.mise.toml`, `mise.toml`, `lefthook.yml`, `lefthook.yaml`, `.pre-commit-config.yaml`, `.pnpmfile.cjs` and `bunfig.toml`
- at the project root: `.github/`, `.gitlab-ci.yml`, `.circleci/`, `.buildkite/`, `azure-pipelines.yml` and `Jenkinsfile`
- `~/.paradigm/`, `~/.claude/` and the consent setting's file (wherever its symlink points)
- any write that would leave a folder looking like a bare git repository (a `HEAD` file with `objects/` and `refs/`, or with a `commondir` or `gitdir` file)
- adding or changing an install-time script (`preinstall`, `install`, `postinstall`, `preprepare`, `prepare`, `postprepare`, `prepublish`, `prepublishOnly`, `prepack`, `postpack`, `dependencies`, `pnpm:devPreinstall`) in any `package.json`, `package.yaml` or `package.json5` (which must be plain JSON)

Names are compared the way macOS and Windows compare them: case-insensitively with full Unicode case folding, ignoring trailing dots and spaces. Names containing `:`, invisible characters, or new short names like `GIT~1` are refused, and so are symlinked or hard-linked targets. Other `package.json` edits, `portal.yaml`, `CLAUDE.md`, `.gitmodules` and `.gitattributes` are written, and listed under "Review these writes" at the end of the run. This list protects you while commands are off and before you've answered. Once commands are on it limits nothing, because a command can write any of these files itself.

**`run_command` asks once.** It is on by default, but the first time an agent tries a command, Paradigm shows the command and asks:

```
A Paradigm agent wants to run a shell command:
  command: "npm test"
  in:      "/path/to/your/project"

Paradigm agents can run shell commands on your machine with your permissions. Keep this on? [y/N]
```

Your answer is saved in `~/.paradigm/config.yaml` and used from then on:

```yaml
agent-provider:
  allow-commands: true   # false turns run_command off; delete the line to be asked again
```

| Situation | `run_command` |
|---|---|
| `--allow-commands` on this run | Offered and runs without asking. Not saved. |
| `--no-allow-commands` on this run | Not offered. Not saved. |
| Saved `true` | Offered and runs. |
| Saved `false` | Not offered. |
| Not decided, you're at a terminal | Offered. The first call asks the question above. |
| Not decided, no terminal (`--background`, orchestrated from MCP, piped, CI) | Not offered until you decide. |

The command and folder in the question are escaped and cut to 500 characters, the answer is read from `/dev/tty`, and agent output waits until you've answered, so nothing the model writes can draw a fake question. Only `y` or `yes` turns commands on; Enter means no.

The setting is per user, found through your account's home folder (not `$HOME`). It is never read from a project's `.paradigm/config.yaml`, so a repo you clone can't turn commands on for itself, and the agent's file tools can't reach it. A saved value is ignored if the file resolves inside the project, belongs to another user, or is writable by your group or others. It is saved with mode 0600. `CI` being set counts as no terminal. Tools that drive a pseudo-terminal (expect, node-pty) count as a person at the terminal, so pass `--allow-commands` or `--no-allow-commands` from them. Whether `run_command` is offered is fixed when the run starts. Note that once commands are on, a command can do anything you can; keeping its folder inside the project does not limit what the command itself touches. Turn it on only for repos and tasks you trust.

**Commands run without your secrets.** Before a command runs, variables are removed when the name contains `TOKEN`, `SECRET`, `PASSWORD`, `PASSWD`, `CREDENTIAL`, `API_KEY`, `ACCESS_KEY`, `PRIVATE_KEY`, `AUTHTOKEN` or `SESSION_KEY`, ends in `_KEY`, `_AUTH` or `_PAT`, or starts with `AWS_`, `AZURE_`, `GCP_`, `GCLOUD_`, `CLOUDSDK_`, `GOOGLE_APPLICATION_`, `ANTHROPIC_` or `OPENAI_`. Names ending in `_PASS`, `_PW`, `_PWD` or `_DSN`, containing `CREDS`, `COOKIE` or `JWT`, or starting with `TF_VAR_`, `GIT_CONFIG_KEY_` or `GIT_CONFIG_VALUE_` go too, as do `SSH_AUTH_SOCK`, `KUBECONFIG`, `DOCKER_AUTH_CONFIG`, `DOCKER_CONFIG`, `VAULT_ADDR`, `GIT_CONFIG_COUNT`, `GIT_ASKPASS`, `SSH_ASKPASS`, `NETRC`, and any variable whose value holds a URL with a password (`scheme://user:password@host`). `PWD` and `OLDPWD` are kept. This is a safety net, not a sandbox: a command you allowed can still read credential files on disk. Commands get no stdin. Each runs in its own process group (on Windows, its process tree is killed with `taskkill /T /F`), which is killed when it times out and when Paradigm exits or is interrupted. A command that calls `setsid` leaves the group and survives. Agent text streamed to your terminal has escape sequences removed.

**Every command is logged.** Each `run_command`, whether it ran or was refused, is appended to `~/.paradigm/logs/<project-hash>/agent-commands.jsonl` (mode 0600, outside the repo so neither the repo nor the agent can edit it). Each line has the project, command (cut to 4 KB, with its full length), folder, exit code, agent and time. Environment values are never written. Set `DEBUG=1` to also see each command in the Paradigm log output on stderr.

## 7. How agents learn

Three storage tiers feed the learning loop:

1. **Lore** (`.paradigm/lore/entries/YYYY-MM-DD/L-*.lore`) — narrative timeline of sessions. Records `symbols_touched`, `confidence`, `summary`. Project-local.
2. **Journals** (per-agent, in `~/.paradigm/agents/<id>/journal/`) — what the agent learned this session. Includes `trigger` (correction_received, confidence_miss, pattern_discovered, etc.), `insight`, `transferable: bool`, `confidence_before/after`.
3. **Notebooks** (`.paradigm/notebooks/<agent>/nb-*.yaml`) — promoted patterns the agent has applied with measurable results. Carries `appliedCount`, `successRate`, `scope` (`generalizable | project-specific | platform-specific`), `publishable: bool`.

Promotion flow: lore entry → journal (postflight, when something was learned) → notebook (when `appliedCount` and `confidence` cross thresholds, with human approval gate per the promotion-pipelines spec).

`paradigm agent sync <id>` is the bootstrap path — it walks lore and seeds expertise. The continuous path is the postflight learning loop:

- `paradigm ambient postflight` runs at session end (auto-fired by the stop hook)
- Reads pending verdicts from `.paradigm/events/verdicts.jsonl` (durable, not cleared on session start)
- Writes journal entries; promotes high-confidence repeat patterns to notebooks
- Updates expertise scores using a `0.7 * existing + 0.3 * new` rolling average

Each record has a home: `repo` (committed, shared), `user` (just you) or `machine` (this computer). See [Where learning lives](./learning-scopes.md) for teach's "This repo or just you?" question, the migration, visibility and the commit guard.

See §9 of the [University guide](./university.md) for the related project-pack content surface — University holds first-party teaching content, separate from agent-learned notebooks.

## 8. MCP tools

All agent tools accept JSON args; ~50–200 token responses. Defined in `packages/paradigm-mcp/src/tools/agents.ts`.

| Tool | What it does |
|------|--------------|
| `paradigm_agent` (op `list`) | List all profiles. `scope: "all" \| "global" \| "project"`. Returns top expertise + state per agent. |
| `paradigm_agent` (op `get`) | Full profile by id or nickname. Includes integrity check, transferable patterns, project contexts. |
| `paradigm_agent` (op `expertise`) | Find best agents for a symbol. Returns ranked list with confidence + sessions. `response_format: "concise"` returns just the top agent. |
| `paradigm_agent` (op `bench`) | Bench an agent (per-project). |
| `paradigm_agent` (op `activate`) | Activate a benched agent (per-project). |
| `paradigm_agent` (op `prompt`) | Fetch the role prompt for an agent. Used by orchestration to seed Task-tool contexts. Enum: `advocate, architect, builder, compliance, ftux, tester, reviewer, security, documentor`. |

Two related tools used during orchestration:

- `paradigm_orchestrate_inline` — runs the multi-agent flow. In Claude Code, agents launch as isolated `Task` tool contexts (true multi-agent — separate memory per agent). In Cursor and other IDEs without Task tool support, agents run sequentially in the same context (sequential roleplay). Configured via `orchestration.default_mode` in `agents.yaml`, defaults to `faceted`.
- `paradigm_ambient` (op `health`) — Neverland health (accept rate, notebook count, threshold drift) — surfaced by the `paradigm:agents` skill in its roster output.

## 9. Common workflows

### First time on a project

```bash
paradigm shift                       # rosters core agents (incl. Rune) + ftux + cid
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

`relation` is human-readable context shown in `agent get`. `share_notebooks` is reserved — it currently has no runtime effect; pair-learning will read it.

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

Each reciprocal pair has a canonical notebook path: `.paradigm/notebooks/_pairs/{a-b}/` (alphabetically sorted ids, regardless of who declared the pair). The directory is reserved — no learning entries are written there yet. Pair-learning will use it so partner state lives next to the pair, not inside either agent's profile.

### Marketplace primitives (contracts-only)

Three typed shapes are defined in `packages/paradigm/src/commands/agent/registry-types.ts` for the eventual nevr.land marketplace:

- **`PartnerBundle`** — groups partnered agents into a single SKU
- **`ReciprocalInstallMeta`** — metadata that an agent's install should prompt-install partners
- **`PartnerCoverage`** — registry-index indicator marking paired agents and showing pairs

These are **contracts only** at v6.0.3. No live consumer wiring; they exist so registry response shapes stay forward-compat when nevr.land lands. Local code surfaces `PartnerCoverage` from registry response when present (graceful default when absent).

---

## 12. Framework-Bug Protocol (v6.0.5+)

When an agent encounters an MCP tool that misbehaves — write tool reports success but the read tool can't find the data, behavior contradicts the documented contract, etc. — and the cause is in framework code (not your project), the framework-bug protocol gives the agent a sanctioned place to surface it instead of silently hand-editing files to work around the bug.

### What it is

A convention layered on the existing `paradigm_task` (op `create`) primitive. Agents file a high-priority task tagged `framework-bug` with two pieces of code-location evidence: a writer file:line and a reader file:line that demonstrate the divergent contract. Without that evidence, the report is downgraded to a plain task (no `framework-bug` tag). This is the same evidentiary bar a human bug report would clear.

### When agents file these

- A write tool succeeds but the corresponding read tool reports the data as missing or wrong (the v6.0.4 aspect-anchor path-resolution bug is the canonical example — see `.paradigm/research/path-bug-and-agent-protocol-analysis.md` §1).
- A tool's behavior contradicts its documented contract.
- Two locations in framework code can be cited demonstrating where writer and reader disagree on a convention.

The agent should continue the session, not block on the framework bug. The task is a signal to you (and to triage-owning archetypes), not a halt instruction.

### Triaging one in your task list

When `paradigm_task` (op `create`) lands one of these in your local list, ownership follows the broken tool's domain:

| Tool domain | Triage owner |
|-------------|--------------|
| Compliance (`paradigm_aspect` (op `check`), `paradigm_drift_*`) | Rune |
| Security (`paradigm_portal_*`, gate verification) | Aegis |
| Learning (`paradigm_notebook_*`, nomination) | Scholar / Loid (paired) |
| Navigation / coverage (`paradigm_status`, `paradigm_navigate`) | Cid |
| Other | First archetype to surface owns triage |

If the tool's domain crosses archetypes (e.g., a path-resolution helper used by both compliance and security), the first archetype to surface the bug owns triage and adds the second as reviewer — same partner pattern Scholar+Sheila use.

### What NOT to do

Hand-editing the affected `.purpose`, `portal.yaml`, or other Paradigm-owned files to work around the framework bug. That converts a framework defect into project-state drift; the bug ships unfixed for every other adopter, and your project accumulates a hand-edit that the next MCP write will overwrite or invalidate.

### v6.1 escalation path

The soft-block primitive is available: framework bugs that actively mislead session decisions can additionally be surfaced via `paradigm_propose_block(claimant: 'framework', ...)`. The block persists across session resumes until upstream fixes (or the user overrides it locally). The protocol is: file the framework-bug task AND propose a soft-block when the bug blocks correctness, not just convenience.

For the full team analysis behind this protocol — including the rejected-for-now tool-surface option (`paradigm_framework_issue`) and the calibration rationale — see `.paradigm/research/path-bug-and-agent-protocol-analysis.md`.

---

## Audience track map

- **First-time on a project:** §1, §2, §3, §9 ("First time on a project")
- **Customizing the team:** §3, §4 ("Roster management"), §9 ("Adding a specialty agent", "When an agent stops being useful")
- **Building agent permissions:** §6, §10
- **Understanding the learning loop:** §7, §8
- **Pairing agents:** §11
- **Framework bugs surfaced by agents:** §12

---

*Source of truth for the shipped surface: `packages/paradigm/src/commands/agent/*.ts`, `packages/paradigm-mcp/src/tools/agents.ts`, `packages/paradigm-mcp/src/tools/orchestration.ts` (tier + role-prompt definitions). Skill at `plugins/paradigm/skills/agents/SKILL.md`.*
