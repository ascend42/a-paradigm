# Scout: YC's QM ("quartermaster") — multiplayer agent harness (2026-10-15)

yc-software/qm, MIT, open-sourced 2026-07-31 ("a multiplayer agent harness for work. In Slack and on the web."), HN 682 points (item 49126604). 15,426 stars, 1,909 forks, ~958 open issues/PRs; two authors do almost all commits; SECURITY.md "early, experimental". Read-only clone at scratchpad/untrusted/yc-harness (514e952). Orchestrator verified: pi-models.ts:52 HARNESS_IDS = ["pi","claude","mock"] (README's "four coding agents" false on main); claude-harness.ts:475-476 bypassPermissions + allowDangerouslySkipPermissions; types.ts:19 scopes personal|channel|team|org|group; docs/swarms.md:105 workers sharing a forum disk coordinate writes themselves.

## Architecture
Server (Fastify + Postgres + pg-boss) in your Fly/AWS account; durable run queue, orchestrator, session tape. Claude Code via Agent SDK as a stateless loop (bypassPermissions, settingSources:[], tools bridged through one `qm` MCP server); Pi the other loop. One durable sandbox computer per scope across ~10 backends. Org posture Strict/Auto/Dangerous; regex command policy SECURITY.md admits is bypassable. Memory: per-scope versioned records with sensitivity labels + source scope; pgvector.

## Teams and colleagues
- Scopes personal/channel/team/org/group, each with memory, files, keychain view, crons, apps, sandbox; cross-scope only via audited grants.
- Identity: Slack, magic link, OIDC; principal links fold sign-ins into one person (admin-only, evidence, reversible).
- Teams: member/admin roles behind a flag; team skills "Phase D".
- Sharing posture Isolated/Open; model discretion is the only output control (admitted).
- Handoff: hand-off skill DMs a colleague; request-access asks for their credential.
- Approvals: durable, DM to the requesting actor only; no approver roles or quorum. Portal-only walls: agent can never change grants, impersonate, or decide approvals. Swarm workers never inherit approvals/grants. Unattended (crons/webhooks) needs explicit unattendedGrants for credentials.
- Credentials: broker + egress proxy injection; escape hatches leak plaintext; #1082 git creds not bound to turn identity.
- Audit: plain Postgres table, no hash chain; in-memory 50k ring without DATABASE_URL; admins read transcripts/memory without consent.
- Cost: spend export by person/scope; budgets in-memory without Postgres; #586 all models priced $5/MTok input-only from estimated tokens.
- Colleague agents talk via session mailboxes/swarm messages, treated as data not authorization. Share = read-only allowlisted snapshots, links not revocable.

## Multi-agent
Swarms behind a flag: atomic reservation of limits (32 agents, depth 4, 128 msgs, 1 h, 10 min/turn), requestId idempotency, per-swarm sequence + audience, cascading pause/stop. Shared board disk with no merge, conflict detection or adjudication.

## Users report
Praise: README, per-person scoping. Criticism: astroturfing, token burn, rushed vs "Buzz", multiplayer vs async doubts, qm name clash. Issues #290, #2000, #136/#220 pool recovery, #586, #1082, #607, #1050. Its own docs/SPEC.md "Wall of shame" (1,443 regex sites, hand-rolled queues, process-memory state, backend sprawl) — the most useful file.

## Gnomon ahead / behind
Ahead: merge adjudication, tamper-evident log, metered cost, key-proven identity, spec-as-contract. Behind (deliberately out of 8.0): multi-human scopes, Slack/web, credential broker + egress proxy, per-scope sandboxes, attended/unattended semantics, org skill packs, durable server state for colleagues.
Steal: attended/unattended as a principal mode; grants never inherit + delegated messages are data; atomic swarm budget reservation + requestId (maps to permit:v1 + idem); portal-only walls (external confirmation of HUMAN_ONLY); principal links/device folding; allowlisted share snapshots; Wall of shame as named reviewer lenses; memory records with sensitivity + source scope.
Avoid: bypassPermissions + regex policy; in-memory/estimated budgets; silent in-memory fallbacks; admin content reads without consent; unrevocable bearer links; backend sprawl; marketing the code doesn't back.

## Change in 8.0 now (cheap now, version bump later)
1. Principal vs device keys: several device keys under one human principal.
2. Globally unique principal and log ids: namespaced principals (root-key fingerprint or org); envelope `log` = genesis ULID logId.
3. Registry rows name their signer (rootKeyId) so the trust set can hold an org root or several humans.
4. `org`/`team` in event:v1 and permit:v1 scope/ladder now (null in 8.0).
5. Approval card: requestedBy, approverPolicy (self today; roles/quorum later), attended:bool; approver principal in the gnomon:approve:v1 preimage.
6. Audience/sensitivity on events (private default) for later redaction/sharing.
7. hsid:v1d keyed on the namespaced principalId.

## 8.1 for teams
Team trust set (cross-signed roots, org grants); signed log-segment exchange between colleagues' kernels merged by causal order; shared Warpline fabric as the team's verifiable state of record; approver roles + quorum; unattended grants; credential broker; per-person/team cost rollups from metered permits; read-only share snapshots; interop — Gnomon as a QM decision provider and merge gate, neurons as a QM memory provider ("QM swarms admit they cannot merge").
