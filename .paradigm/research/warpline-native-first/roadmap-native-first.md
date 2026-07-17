# Warpline Roadmap — NATIVE-FIRST (the revised map)

> Premise: FOUNDER DIRECTION TD-2026-07-17-151 (2026-07-17) — Warpline operates natively on
> our own local/private server; our forge is the paramount core product; git is a toggleable,
> limited, safeguarded one-way checkpoint export; GitHub-facing surfaces are not where claims
> are staked. Thesis TD-2026-07-16-810 unchanged. K3 organic arm TD-2026-07-16-426 unchanged.
> Synthesis of the four-lens theorizing pass (Arky/North/Loid/Aegis — see sibling docs in this
> directory). SUPERSEDES roadmap-2026H2 phases P4–P5 sequencing; engine phases P0–P3 are DONE.

## The fused ladder — Arky's phases × Loid's rungs × Aegis's identity stages

**START IMMEDIATELY (pre-phase-0, on today's engine): Rung R1 — the shadow gate.**
`admit --shadow` on our own repo: records verdicts, never blocks. Starts the organic evidence
clock (fabric today: 35 strands, ALL human auto-seals, 0 agent strands — every loop begins at
zero). Feeds organic-K3, HELD precision, and the friction baseline before any cutover risk.
> **[BUILT 2026-07-17, T-2026-07-17-006 / Kit]** `admit --shadow` + `AdmitOptions.shadow`
> shipped (#shadow-gate, packages/warpline/src/fabric/shadow.ts); rows →
> `.warpline/shadow/verdicts.jsonl` (shadowVerdict:v1). Hook-path wiring: `.warpline/
> config.json` `shadowGate:true` (#warpline-config) makes every pick/auto-seal record the
> observe-only verdict — flipped ON for this repo, first live row recorded. Zero-mutation
> invariant pinned in test/shadow-admit.test.ts.

**PHASE 0 (~1–2wk) — native write path, git-absent.**
The keystone inversion (T-030's successor): worktree→pick with no git anywhere —
fork mints a scratch ref at a pickId; **propose SEALS a scratch strand** (durable, addressable,
claim-attached) before judgment; admit weaves scratch-tip × selvage; on CLEAN the daemon
restores merged bytes back into the agent worktree. Every step append-or-CAS. Pulls forward
v3.3 (seal cutover to pick:v3 + the v2-epoch anchor). Exit test: full loop green with no `.git`.
Inversion list I1–I12 (arky-architecture.md §2) is the work manifest.
> **[FIRST SLICE BUILT 2026-07-17, T-2026-07-17-006 / Kit]** #native-write-path
> (packages/warpline/src/fabric/native.ts + CLI `fork` / `propose --native` / `admit
> --native` / `resolve --native`): fork mints scratch refs at the selvage pickId (I9);
> propose SEALS v3 scratch strands from the worktree (snapshotDir → absorb-from-store I2 →
> buildStrandV3 bind-on-seal, git-null provenance I4, claim-attached); admit weaves via
> materializeMergedStateNative ONLY (I6) with CLEAN write-back restore; resolveNative seals
> the council weave. Exit test green: test/native-loop-no-git.test.ts (fork→propose→admit→
> KNOT→payload→resolve→restore, no `.git` anywhere, pure-v3 DAG verifies). NOT yet: I5
> incremental index, daemon verbs (phase 1), live-selvage v3 cutover (deliberately held).
> **[I5 + R1 HYGIENE BUILT 2026-07-17, T-2026-07-17-008 / Kit]** I5 — the worktree
> stat index shipped (#warp-store, src/warp/worktree-index.ts + snapshotDir
> `{indexRoot}`): `.warpline/index` (worktreeIndex:v1) caches path→{mtimeMs,size,ino,
> mode,blobId,gitSha}; warm walks rehash only changed files, fail OPEN on every
> anomaly (racy-timestamp guard per git's lesson; store-presence insurance; corrupt
> index ⇒ cold walk). THIS monorepo (23,085 files): warm walk 7.1s → 0.7–1.6s
> (cold ~50s unchanged); byte-identical treeId+gitOid pinned cached-vs-uncached plus
> touch/edit/add/delete/chmod mutation-detection, path-taken, racy-guard and
> fail-open tests (test/worktree-index.test.ts). Wired behind native propose/resolve,
> worktree pick/admit, `objects snapshot`. R1 hygiene (T-2026-07-17-007): `.loom`
> joined the ALWAYS_IGNORE set in BOTH the byte walk (ignore-rules.ts) and the
> cfg-lens meaning walk (SKIP_DIRS — worktree absorbs had been lifting ~24k
> `#cfg:.loom/states/*` symbols per verdict); shadowVerdict:v1 symbol arrays now cap
> at 50 sorted entries with additive exact totals (a live WORKTREE verdict over a
> 24,403-symbol change = a 5.3KB row); `.warpline/shadow/` + `.warpline/index` stay
> gitignored, `config.json` stays tracked. Residual-inversion audit: I3 (intent/actor
> required from caller, no git fallback) and I4 (gitCommit as nullable breadcrumb)
> verified DONE on the native path — no code owed. Named for phase 1: I1 session/
> task-boundary seal verb rides the daemon API; and the lens-discovery/ignore-rules
> asymmetry (lenses walk gitignored files the byte snapshot skips) wants one shared
> matcher when the daemon lands. 467/467 green.

**PHASE 1 (~2wk) — the solo daemon + THE VALVE. → Rung R2 (mixed mode).**
Home-fabric model: one symmetric `warplined`; loopback/unix socket IS the solo server (Aegis
stage 1: per-agent tokens, server-stamped agentId — client claims advisory; no TLS/PKI theater).
Console re-points from file-reads to the daemon socket. Backup lands (custodianship tax begins).
**The checkpoint valve ships here** (T-2026-07-17-001, founder ask): `warpline stake` —
default OFF, per-ref allowlist, one git commit per blessed seal point; tree =
restoreTree(binding.treeId) verified against the recomputed shadow gitOid; machine trailer only;
stakes are a FIRST-PARENT LINEARIZATION (git gets checkpoints, never topology — it can never
become a shadow authority). Safeguards S1–S5 (aegis-security.md §3): one-way mechanically
enforced (stake marker + hook refusal + no provenance backflow); leakage prevented by
allowlist-by-materialization; refuse-to-commit unless tree recomputes; every emission audited;
recovery = ref move, never an import. Pulls forward M2 refs UX (branch/switch over v3 refs).
> **[VALVE BUILT 2026-07-17, T-2026-07-17-010 / Kit]** `warpline stake [selector]` +
> `warpline stake recover <commit>` shipped (#stake, packages/warpline/src/fabric/stake.ts;
> #stake-guard S1 guards + D5 frozen deny-list `stake-denylist:v1`, fabric/stake-guard.ts;
> #stake-git — the ONE git-write module: pure-TS loose blob/tree/commit objects, no
> index/filters, `update-ref` CAS only, git/stake-git.ts). S4 toggle = `.warpline/config.json`
> `stake:{enabled,refs,branch,repo,author}` (branch default `warpline-stakes`; working-branch
> names + the checked-out branch refused); trailer-only message (`warpline-stake` +
> PickId/StateId/TreeId/Schema: stake:v1); audit sidecar `.warpline/stakes/audit.jsonl`
> (stakeAudit:v1, EVERY invocation incl. refusals). S1 choke point = assertNotStakeInput in
> absorb (covers pick + the auto-seal hook); backfill leaves marker-bearing provenance
> commits unbound; hook install refuses on a marked worktree. Idempotent tip-skip; gitlink
> trees refuse; untrusted-prose content markers scanned (forge §3d — it never crosses).
> 18 new tests (first-parent chain e2e, adversarial planted-sidecar/serialized-envelope/
> marker-spoof/build-tamper, recover clean + refuse, D5 freeze test w/ pinned digest) —
> 486/486 green. NAMED DEVIATIONS/deferrals: `--push` (manual `git push` of the stake
> branch for now), `auto:` cadence, and S5 rule-4 auto-seal-of-divergence (recover REFUSES
> an edited tree; edits seal normally post-recover, parented on the staked pick). Daemon
> wiring = the separate Phase-1 lane. NOT enabled on this repo (founder-visible flip).

**PHASE 2 (~3–4wk) — the team server. → Rung R3 (our own dev cuts over, GATED).**
Team home on LAN/VPC; V3.5 bundles graduate to THE sync protocol (refs/negotiate/bundle/objects
+ unsigned sidecar channel); `/refs/<name>/advance` (per-ref CAS) is the only privileged verb —
the point where scrutiny policy becomes ENFORCEMENT (forge §1d structurally). **M3 SPLITS**:
identity registry pulls into phase 2; per-author signatures stay M3-proper (prerequisite only at
multi-site federation). Remote override discipline: accept-breach / accept-risk / Tier-2+ resolve
are human-class-only, always audited; an agent never accepts its own breach; token minting
human-gated. Sidecars are HR-adjacent data: own-trajectory readable, cross-principal role-gated.
R3 cutover is GATED on falsifiers, not scheduled (below). Dogfood finally populates real
agent/merged strands on the real topology.

**PHASE 3 — the forge surfaces.** Per warpline-forge.md §1 (constitution edition — §5's
"no repo hosting" freeze retired by TD-151; G1–G5 promoted to constitutional law for the
server). The judgment console grows from the shipped Oracle Divergence Viewer over the daemon
API. North's demo server: a hosted READ-ONLY public projection of our live fabric (verdict
feed, KNOT queue, honesty labels) — "we publish ledgers, they publish renders."

## Falsifiers gating the rungs (Loid, pre-registered — breaches name components, not vibes)

- **F1 friction budget** (gates R3): median ≤10s / p95 ≤30s added per change; ≤2 gate
  interruptions per dev-day; false-positive share of interruptions ≤1/3.
- **F2 payload self-resolution** (gates auto-resolve, NOT cutover): of the first 20 organic
  KNOTs, ≥50% get a payload-only proposal AND ≥70% accepted unmodified.
- **F3 the valve is a real rail** (gates R3): 100% stake verification vs binding.treeId (one
  silent failure = hard stop); 3 consecutive monthly recovery DRILLS (git reset AND git-absent
  restore, identical trees); a failed real recovery demotes to R1.
- **Organic K3** (TD-426): survival(linked)−survival(independent) ≥15pts, verdict only at
  n≥50 graded per arm, FIXED evaluation points, moat-silent externally until then.
- First trusted report: ≥100 organic admissions, ≥50 graded, ≥2 agentIds.
- Standing hard stop: FALSE-CLEAN = 0 on live ops.

## Dispositions (North, decisive)

- **Guard Action → INSTRUMENT, never published** (npm/Marketplace off the table): internal
  verdict-regression telemetry on the valve + "the scout" run privately FOR named prospects,
  whose close is a native-server install. README founder-signature moot.
- **P4.1 benchmark → publication PARKED, pipeline retargeted**: re-emerges as research from
  native dogfood (fed by organic K3), never as a GitHub-PR-framed yardstick.
- **Base-rate evidence → keep, re-captioned**: "1 in 16 merges git called clean, meaning
  called broken" — the vision page's opening exhibit (it's a claim about byte-merging, not GitHub).
- **Category claim**: CLAIM "agent-first source control" on OUR ground — dated, with honest
  zeros beneath it, before Cursor's fall ship; every capability sentence TD-810-scoped, moat-silent.

## Metrics (N-ladder, honest current values)

N0 days-of-this-repo-fully-native (0) · N1 organic admissions/week through our gate (0; the 192
were harness) · N2 KNOTs resolved from payload alone (0) · N3 checkpoint stakes used in anger
(0; valve unbuilt) · N4 external private servers (0; end-Q1-2027 off-zero or re-weight).

## Frozen / fallen away

Fallen away: Guard-as-GTM, GitHub-framed benchmark publication, git corroboration as trust
input, hook-as-default (becomes one adapter among several). Still frozen: Tapestry until
phase 3, University course, trademark sweep, per-author signatures until multi-site.

## FOUNDER DECISION POINTS (pending)

1. **Topology**: bless the home-fabric model (one symmetric binary; per project one ref-authority fabric).
2. **Propose seals a scratch strand** (durable pre-judgment proposals — fabric grows per attempt; the honest record of tries).
3. **Stakes = first-parent linearization** (git never sees topology).
4. **The M3 split** (identity registry in phase 2; signatures at federation).
5. **Deny-list rigidity**: valve leakage deny-list is constitution-grade (expanding it = schema change, not a flag).
6. **Re-bless warpline-forge.md as the constitution edition** (freeze-retirement + G1–G5 promotion folded in).

Honest costs, stated once (Arky): external adoption evidence defers behind phase 2 while the
market clock runs; O(store) first-sync and server-side absorb are the named O(x) risks;
custodianship (authn/backup/uptime) is a permanent tax that must not stall meaning-decided coverage.
