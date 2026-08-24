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

> **[DAEMON BUILT 2026-07-17, T-2026-07-17-011 / Kit]** `warplined` — the solo daemon
> (#warplined, packages/warpline/src/daemon/{protocol,tokens,lifecycle,server,client}.ts):
> the fabric with a NETWORK FACE, no database beside it. Transport = NDJSON over a unix
> domain socket (`.warpline/daemon.sock`, mode 0600) — chosen over HTTP-over-uds because
> the protocol is pure verb→result (no routing/headers/chunking needed) and node stdlib
> does it in `net` + a line splitter, zero deps; envelope `{rpc:'warplined:v1', id, verb,
> token, params}` → `{id, ok, result|error}` with results = ENGINE SHAPES VERBATIM (G3).
> Verbs 1:1 onto engine fns (G4 — same fabric lock, no new mutation path): status,
> refs.list, fork, propose, admit (native + R1 shadow flag), knot.show, resolve, stake,
> stake.recover, grade.report, shadow.tail. Aegis STAGE 1 landed whole: per-principal
> bearer tokens (`.warpline/daemon-tokens.jsonl`, 0600, gitignored, ALSO on the frozen
> stake deny-list; minting local-CLI-only = the human's act), SERVER-STAMPED identity
> (actor/agentId/decidedBy from the token — spoofed params proven ignored), the
> verb×principal matrix (resolve/stake/stake.recover + accept-breach/accept-risk are
> human-class only; an agent never accepts its own breach), and a daemonAudit:v1 row per
> API call incl. refusals (structural targets only — never prose). Lifecycle: one daemon
> per fabric (O_EXCL pidfile), stale-residue recovery, clean SIGTERM stop; CLI `warpline
> daemon start|stop|status|token mint|token list|call`. **Loid R4 acceptance pulled
> early and PASSED:** the same fixture loop (genesis FF, edit FF, CLEAN WEAVE) run
> in-process vs through the socket is BYTE-IDENTICAL modulo the envelope
> (test/daemon-byte-identity.test.ts); full e2e fork→propose→admit→knot→resolve through
> the socket on a git-less fixture, fabric verify green (test/daemon.test.ts). 500/500.
> NAMED DEVIATIONS/deferrals: token file is `daemon-tokens.jsonl` not `.json` (matches
> the frozen D5 deny-list entry); loopback TCP flag, `warplined backup`, fs-watcher
> index warming, and the console re-point (platform lane) deferred within Phase 1.
> NOT started against this repo's live fabric (fixtures only; founder-visible flip).

> **[PHASE 1 COMPLETE 2026-07-17, T-2026-07-17-012 / Kit]** Close-out: the console
> re-point + `warpline backup` — the two deferred Phase-1 pieces — landed.
> **CONSOLE RE-POINT** (#warpline-routes, packages/paradigm/src/platform-server/
> routes/warpline.ts): a fabric-native GET-only lane (`/api/warpline/fabric/
> {status,refs,shadow-tail,knot/:selector,grade-report}`) that serves THROUGH the
> daemon when `.warpline/daemon.sock` + a read-SCOPED console token are present,
> and in-process otherwise (zero breakage; DaemonRpcError NOT_FOUND is
> authoritative → 404). CONSOLE-AUTH CHOICE: stage 1's "no anonymous reads" held —
> tokenless local-socket reads REJECTED (would drop auth + audit on trust data);
> instead tokens gained an additive `scope:'read'` (`warpline daemon token mint
> console --kind human --scope read`), capped server-side at a READ_ONLY_VERBS
> allowlist (status, refs.list, knot.show, grade.report, shadow.tail) BEFORE
> dispatch; `consoleReadToken()` discovery structurally never returns a full-power
> row. Byte-identity discipline extended to the router: daemon-mode vs in-process
> responses proved byte-identical on refs/shadow-tail/grade-report/knot-404 (+
> identical selvage projection on status), and an adversarial test pins the lane
> to GET-only with every mutating method 404ing
> (packages/paradigm/tests/platform-warpline-router.test.ts).
> **BACKUP** (#warpline-backup, packages/warpline/src/fabric/backup.ts): `warpline
> backup <dest>` (CLI + daemon verb, HUMAN-class) — atomic snapshot: mutable core
> (ledger/refs/sidecars/audits) copied under the fabric lock, the immutable object
> store lock-free after, staged on dest's volume and published by ONE rename;
> CLONE-copy (COPYFILE_FICLONE — CoW on APFS, full copy elsewhere), NEVER
> hardlinks (an in-place ledger append or tamper would mutate a hardlinked
> "backup"); `daemon-tokens.jsonl`/pid/socket/lockfile EXCLUDED (D5
> never-leaves-the-box; daemon audit INCLUDED — accountability survives a dead
> disk); manifest `warplineBackup:v1` with per-file sha256 + counts. `warpline
> backup verify <dest>` recomputes every digest (missing/extra/tampered flagged) +
> runs the FULL verifyFabric authentication against the copy. THE RESTORE PATH IS
> THE ENGINE: a backup IS a home-fabric root — proved by test (open → refs
> identical → verify green → propose/admit a NEW strand against the backup →
> still green; tamper one byte → verify fails, exit 1). warpline 510/510
> (was 501), paradigm platform suite green. Remaining named deferrals (Phase-2
> lane): loopback TCP flag, fs-watcher index warming.
> Nothing enabled on this repo's live fabric (founder-visible flip unchanged).

> **[R2 CLIMBED 2026-07-18, T-2026-07-18-001 / Kit]** Rung R2 (loid-loops.md) landed in
> four pieces. **(1) stake-denylist:v2 (D5 bump):** the FIRST REAL stake (valve flipped by
> the founder: `.warpline/config.json` stake.enabled + refs:[selvage]) was refused by the
> S2 audit on FOUR FALSE POSITIVES — basename-global 'verdicts.jsonl' hit
> `.paradigm/events/verdicts.jsonl` (a paradigm-events file), and byte-substring markers
> hit stake-guard.ts / stake.test.ts / aegis-security.md (source/tests/spec QUOTING the
> envelope marker). v2 redesign (#stake-guard): PATH-ANCHORED sidecar rules (denied where
> they live, under .warpline/ — never basename-global; .warpline stays an any-depth
> STRUCTURAL deny because a stake is a reset target and fabric content inside one would
> stomp the live fabric; the repo's TRACKED .warpline files are fine in git and by
> construction never enter a stake tree) + SHAPE-AWARE content rules (only PARSED
> .json/.jsonl matching an envelope object / sidecar schema tag / sidecar field signature
> refuses — quoting can never match). Freeze test re-pinned (digest
> ddea850595b2…, schema stake-denylist:v2); every live false positive is a MUST-PASS
> fixture and true leaks (real grade rows, serialized envelope, daemon-tokens.jsonl,
> renamed sidecar streams) still refuse (test/stake-denylist-v2.test.ts). CLI refusal
> exit code pinned non-zero. **(2) FIRST LIVE STAKE CUT:** commit
> `440fec31bd57e6cd61d87adbe06a22d08a63028f` on `warpline-stakes` (chain root, no parent) —
> the EXACT sealed state v1 refused (PickId pick:v2:7ac0ad80…, TreeId tree:v1:6863eab8…);
> trailer + marker + rev-parse tree all verified; audit row action:stake. **(3) auto-stake
> cadence:** `stake.auto: 'every-seal'|'daily'|false` (default false) — a successful
> non-shadow seal (#pick + #admit) triggers maybeAutoStakeOnSeal best-effort (S4 still
> rules; failure never blocks the seal; every valve invocation self-audits). NOT enabled
> live (founder-visible flip): add `"auto": "every-seal"` inside the existing `"stake"`
> object of .warpline/config.json to turn it on. **(4) R2 agent write path:**
> `gate: {"agentWrites": "real"}` (#warpline-config) makes an AGENT-ATTRIBUTED pick
> (--agent / $WARPLINE_AGENT_ID, incl. the auto-seal hook) ENFORCE its admit verdict —
> would-not-seal REFUSES (PickGateRefusal; enforced verdict row gate:'real'), override =
> `pick --accept-risk` (row overridden:true, never silent); fail-CLOSED for agents on a
> corrupt config or a crashed gate; humans keep the git door BYTE-IDENTICALLY (proved:
> same tree + clock ⇒ identical fabric.jsonl with gate on/off). The `admit` verb needed
> no routing — non-shadow admit already blocks for real. NOT enabled live (add
> `"gate": {"agentWrites": "real"}` to .warpline/config.json when R2 mixed mode goes
> live). warpline 533/533 (was 510). Live writes this lane: the one stake + its audit row
> only.

> **[F3 DRILL #1 FAILED → DEMOTED TO R1 2026-07-18, cc9812b1]** The first live recovery
> drill (f3-drills.jsonl n=1) FALSE-REFUSED a pristine `git reset --hard <stake>` tree:
> seal-time ref bindings used GIT-COMMIT-TREE semantics (snapshotRef — tracked-but-
> gitignored files IN) while recover's rehash used ignore-honoring WORKTREE semantics
> (snapshotDir — them OUT). Pre-registered rule honored: gate→shadow, auto-stake→off,
> F3 clock restarted. Tasks filed: T-2026-07-18-004 (recover), T-2026-07-18-002 (byte
> custody — same fault line).

> **[THE TREE SEMANTICS DECISION + FIX + DRILL #2 GREEN 2026-07-18, T-2026-07-18-005 / Kit]**
> **THE DECISION (candidate B, ratified in code — snapshot.ts header):** WORKTREE
> SEMANTICS (`worktree:v1` — ignore-honoring snapshotDir rules) is THE canonical tree
> semantics for ALL NEW bindings; the worktree is the source of truth and the git
> commit tree is a legacy adapter view. snapshotRef (full AND incremental) now filters
> by the ref's OWN committed root ignore rules — ref tree ≡ worktree tree of the same
> clean checkout, pinned by test. Existing strands are GRANDFATHERED under their
> recorded semantics (the epoch pattern): new bindings carry additive
> `binding.treeSemantics:'worktree:v1'`; absent = legacy-git. The tag rides OUTSIDE
> the pickId preimage in BOTH epochs (v2 folds only bindingTreeId; the founder-signed
> v3 preimage is untouched — §9/G-law respected). **FIX (T-004):** stake cut now
> computes AND RECORDS `worktreeTreeId` (additive audit field + StakeResult) — the
> honest recovery expectation; S5 recover judges each strand under ITS OWN semantics:
> worktree:v1 binding = itself, legacy binding = `projectTreeWorktreeSemantics`
> (pure, deterministic, from authenticated store bytes only). Validated against
> drill-1 evidence: projection of the seq-40 binding computes tree:v1:2854d1ad… —
> exactly drill #1's observed rehash; **stake 440fec31 REMAINS RECOVERABLE** (no
> drill-void). Legacy-semantics anchors are refused (first post-cutover seal walks
> full once, then re-anchors; bench spot-checked: warm FAST_ADMIT 4.2s, CLEAN merge
> 7.8s on the monorepo clone — not regressed). **BYTE CUSTODY (T-002):** NOOP ⟺ empty
> deltas AND renames AND tree unchanged (under THE semantics); meaning-NOOP +
> tree-changed seals a **byteOnly strand** (additive flag, in the v2 preimage via the
> rest spread; stateId naturally equals the parent's; binding advances; always
> FAST/no-gate — a NOOP verdict never refuses, even agent-attributed under
> gate:'real'; auto-stake counts it; verify/grade/dag/restore all pinned) — doc/lore/
> config-only commits have durable native custody again. **DRILL #2 (f3-drills.jsonl
> n=2, isolated clone, overlay-after-reset): ALL LEGS GREEN** — fresh live stake
> 0f4b2ffe (parent 440fec31, first-parent chain) → backup+verify (42 strands, 0
> failures) → reset → recover GREEN (the drill-1 failure leg) → git-absent restore
> diff-identical (3175 entries). warpline 539/539 (was 533); tsc+build clean; live
> fabric verify exit 0. Live writes this lane: ONE stake + its audit row + the drill
> record row. F3 consecutive-green = 1 of 3; re-promotion to R2 is the
> coordinator/founder's call.

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
- **F4 cold-agent legibility** (gates any GUI-shaped work; founder constraint TD-2026-07-21-766,
  AMENDED by TD-2026-07-28-168 and TD-2026-07-29-259 — see those decisions, not this summary,
  for the binding wording): an agent of ANY provider/make, with no Warpline in its weights and
  no Warpline docs in context, works propose → admit → KNOT using ONLY tool descriptions and
  returned error/refusal objects. **Agent-class completion = all three, computed from
  `f4Trace:v1` rows alone:** (1) it reaches a KNOT verdict — an episode opens on a
  `GATE_REFUSED` refusal carrying `verdict:'KNOT'`; (2) it terminates at the correct door —
  hydrates the work order named by `refusal.pointers.knotPayloadId` when one is ADVERTISED,
  and escalates without attempting a human verb when none is; (3) zero W3 marks in that
  episode. **The resolve leg is NOT part of the agent's score** — `resolve` is HUMAN_ONLY, so
  it runs as a separate scripted human-token harness leg that proves the cycle closes and
  returns the fixture to a resolvable state, contributing nothing to the agent's number. The
  escalation/sidestep split is REPORTED, never gated. Predicate (2) is conditional because
  three of the four KNOT sites emit no payloadId; an unconditional form made the
  byte-downgrade stratum a guaranteed incomplete, failing the bar on wording rather than on
  agents. Strict superset of F2 — F2 tests the payload, F4 tests discovery of the tool
  itself. Runs on the MCP skin AND the CLI skin; a pass on one is not a pass.
  - ⚠️ **The bar's arithmetic is CONTESTED and unratified.** "≥80% across ≥10 cold runs
    spanning ≥2 model families (one non-Claude), median ≤2 wasted turns per refusal recovery,
    ZERO runs requiring human hint" is the ORIGINAL TD-766 wording, retained here verbatim
    because no founder decision has yet replaced it. Pre-freeze panel D-5 falsified it: for
    8/10 the Wilson 95% CI is [0.49, 0.94], so the bar cannot distinguish a true 0.65 from a
    true 0.80. Shield's defensible design is a two-stage n=12 kill-only screen then n=40, and
    ≥4 models over ≥3 families with a conjunctive bar. The "median ≤2" statistic is also
    ambiguous between per-run, median-of-medians and pooled — the code computes per-run and
    the pooled form does not exist. **Open founder decision: the stopping rule and n.**
  - ⚠️ **Both-skins ambiguity, unresolved.** "A pass on one is not a pass" binds the SKINS,
    but the clause never says whether the non-Claude family must appear on BOTH skins or
    whether family-spanning is a property of the run set as a whole. The two readings differ
    by a ~6–8h MCP-client harness plus model procurement. **Open founder decision.**
  Rationale: git is easy for agents because it is MEMORIZED (public corpus); moat-silence +
  no-publishing means Warpline is never in any model's weights, so every agent encounter is
  permanently a cold encounter. Runtime self-description is therefore not polish — it is the
  only available mechanism.
- **Organic K3** (TD-426): survival(linked)−survival(independent) ≥15pts, verdict only at
  n≥50 graded per arm, FIXED evaluation points, moat-silent externally until then.
- First trusted report: ≥100 organic admissions, ≥50 graded, ≥2 agentIds.
- Standing hard stop: FALSE-CLEAN = 0 on live ops.
- Standing hard stop: NO surface work (console, projection, section re-point) begins while
  F4 is unmeasured — the GUI and every future agent consume the SAME refusal object.

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
