# Warpline Native-First — the server architecture (design only)

**Task:** T-2026-07-17-002 · **Author:** Arky (architect) · **Premise (FIXED):** founder direction TD-2026-07-17-151 — Warpline's end state is native operation on our own local/private server; git demoted to a toggleable, safeguarded, one-way checkpoint export; GitHub-facing surfaces are not the claim-staking ground.
**Reads with:** `docs/specs/warpline-forge.md` (hereby the constitution seed), `docs/specs/warpline-v3-identity.md` (identity + V3.5 exchange), `warpline-fabric-schema-v2.md`, `warpline-engine.md`, `.paradigm/research/warpline-roadmap-2026H2.md`.
**Engine baseline:** `warpline-surfaces` @ ac0615cd — v3 DAG identity+refs, knotPayload:v1+envelope, claims/CLAIM-BREACH, cfg-lens+honesty labels, agentId×symbol grades+HELD, git-absent restore; 448/448.

## 0. What this document amends, and what it keeps

TD-2026-07-17-151 lifts exactly one freeze: `warpline-forge.md` §5's "no repo hosting — no
remote fabric service" non-goal is **retired**. The remote fabric service is now the product's
center of gravity. Everything else in the forge spec survives the promotion to constitution —
in particular **G1–G5 become constitutional law for the server**:

- **G1** versioned/additive payloads → every wire message carries `schemaVersion`.
- **G2** no ledger positions in contracts → every URL, sync cursor, and API reference on the
  server keys on `pickId`/`stateId`/`contentId`/`stableKey`. The server gets content-addressed
  URLs for free and MUST NOT invent numeric ids (no "PR #42" — an OFFER's id is its claimId).
- **G3** engine shapes verbatim → the server's API returns the engine's exported types.
- **G4** reads are projections; writes are the three verbs (propose / endorse / resolve) plus
  the two transport verbs this doc adds (push-bundle / advance-ref). The server holds no state
  the fabric + sidecars don't.
- **G5** mutable trust data stays in sidecars → the wire protocol carries strands and sidecar
  events on **separate channels** with different trust semantics (§1.3).

One consequence worth stating plainly: the forge spec's posture "live inside other forges
first" (§4) is demoted from strategy to compatibility mode. Guard-as-GitHub-Action becomes an
optional adapter, not the GTM spearhead (§4 of this doc, "falls away").

---

## 1. THE SERVER SHAPE

### 1.1 What a Warpline server *is*

A Warpline server is custody of one or more **fabrics**, where a fabric =

1. the **object store** (`.warpline/objects/` CAS — blobs, trees, states; content-addressed,
   no gc),
2. the **strand DAG** (`fabric.jsonl` arrival log + the DAG index; v3 identity =
   `H(parents + content)`, position-free),
3. **refs** (`refs/heads/<name>` → pickId, per-ref CAS — v3 §2),
4. the **sidecars** (grades.jsonl, claims + evaluations, escalations — mutable beliefs,
   unauthenticated by design),
5. the **admit gate** run against that fabric (the pure verdict + the scrutiny/HELD policy).

Nothing else. There is no "server database" beside the fabric; the server is a fabric with a
network face and an authorization policy on ref advancement. This is the G4 discipline applied
to ourselves: if a server feature needs a table the fabric can't express, the feature waits
for a fabric-schema decision.

### 1.2 Topology — options and recommendation

| Option | Shape | Verdict |
|---|---|---|
| (a) Per-repo daemon only, pure peer-to-peer | every machine runs `warplined`; bundles flow peer↔peer; no designated authority | Honest to the DAG but punts the two things teams actually need — a single answer to "what is the selvage?" and a place scrutiny policy is *enforced* rather than advised. Rejected as the primary shape. |
| (b) Central server only (hub, thin clients) | one server holds the fabric; clients are API callers | Recreates the GitHub dependency shape with our name on it; kills offline/local-first; the daemon work is needed anyway for watching worktrees. Rejected. |
| (c) **Home-fabric model** — symmetric node, asymmetric *role* | one binary, `warplined`, runs everywhere; per project exactly ONE fabric is designated **home** (the ref authority); every other node is a **working replica** syncing via bundles | **Recommended.** |

**The home-fabric model, concretely:**

- **Solo dev, single machine (today → phase 1):** the daemon on your laptop IS the home.
  Loopback HTTP/WS. Nothing is deployed anywhere. This is the dogfood entry point and it must
  stay a first-class permanent mode, not a degenerate one — "local/private server" starts at
  `localhost`.
- **Team LAN / private cloud (phase 2):** the home fabric moves to a box the team reaches
  (Mac mini in the office, a VM in a VPC). Working replicas: each dev machine and each
  **agent workspace** runs the same daemon, seals locally, syncs bundles. Offline work is
  normal operation — strands seal locally against local refs; divergence resolves by weave at
  the home, through the admit gate, exactly as v3 §2 designed ("conflict degrades to merge
  later").
- **Multi-site (later):** homes federate by the same bundle exchange — strand exchange is
  idempotent (content-addressed, dedup-by-pickId) so replication is trivially convergent. The
  ONLY thing that cannot be symmetric is ref-advance authority: each ref has exactly one home
  at a time (a ref-ownership record, itself sealed as a strand — the WEAVE-LAW pattern).
  Federation of *judgment* (which node runs admit for a shared ref) is explicitly deferred;
  multi-site v1 = one home per ref, remote sites propose.

Why (c): it preserves the local-first property that makes agents fast (seal is a local append,
never a network round-trip), gives teams the single authoritative selvage they need, and makes
the solo→team transition a *configuration change* (point `home` at a URL) rather than a
different product.

### 1.3 The wire protocol — V3.5 graduates from "deferred" to THE sync protocol

v3 §4 already specified the exchange unit; it was written as an offline bundle format and
turns out to be the wire protocol whole. Pulled forward verbatim:

- A **bundle** = JSONL of strands (any causal order) + the sender's ref claims.
- **Receiver law** (unchanged, now the server's ingest path): for each strand, recompute
  pickId (reject mismatch) → dedup if present → hold in a staging set until parent closure
  arrives → append in causal order → then fast-forward/merge refs.

The server's use of it, as transport endpoints (HTTP/1.1+WS is sufficient; this is not a
protocol-invention project):

```
GET  /f/<fabric>/refs                     → ref claims {name → pickId}, + heads()
POST /f/<fabric>/negotiate                → body: my heads[];  reply: strand pickIds you lack
GET  /f/<fabric>/bundle?since=<pickId,…>  → bundle: closure of strands above the given heads
POST /f/<fabric>/bundle                   → push a bundle (receiver law above); 200 lists
                                            accepted/deduped/held-for-closure
POST /f/<fabric>/refs/<name>/advance      → {newPickId, expectedOld} — per-ref CAS (v3 §2),
                                            THE authorization point (§1.4); 409 on race
GET  /f/<fabric>/objects/<contentId>      → blob/tree/state by content address
POST /f/<fabric>/objects                  → batch have/want then upload missing objects
--- separate channel, separate trust ---
GET|POST /f/<fabric>/sidecar/<kind>       → grade/claim-eval/escalation EVENTS (append-only
                                            JSONL rows; latest-wins fold at read)
WS   /f/<fabric>/events                   → verdict-class subscriptions (forge §1f predicate)
```

Design notes that do the load-bearing work:

- **Negotiation is trivial by construction.** "Have/want" on a Merkle DAG = exchange heads,
  walk to the common frontier, ship the difference. No sequence numbers anywhere (G2); a
  sync cursor is literally a set of pickIds.
- **Strand channel vs sidecar channel.** Strands are authenticated by their own hashes; the
  receiver verifies, the sender is untrusted. Sidecar rows are *beliefs* — unauthenticated by
  design (v3 §7); the server accepts them only from authenticated principals (§1.4) and folds
  latest-wins per (pickId, kind, author). Never interleave the two in one stream: a bundle
  that smuggles grade rows is malformed.
- **Ref advance is the only privileged verb.** Everything else is content-addressed and
  self-verifying. This is where scrutiny policy becomes *enforcement*: the home daemon
  re-runs `admitDecision` (or verifies the pushed verdict — deterministic, so recompute ==
  check) before advancing a protected ref, and applies the tier rules (HELD, CLAIM-BREACH,
  fragile-symbol ≥1-human) server-side. The forge's "permissions = scrutiny policy" (§1d)
  stops being advisory the day this endpoint exists.
- **Idempotence everywhere:** retrying any POST is safe (dedup by content). This kills the
  entire class of "partial push corrupted the remote" failure modes git's protocol needed
  machinery for.

### 1.4 What is hard anyway (content-addressing does not save us from these)

1. **Authn.** A server implies principals. Minimum viable: server-issued bearer tokens per
   human and per agentId (the agentId that already threads through seal → grades). This is
   *transport* identity — it authenticates the channel, not the strand. Strand-level
   signatures remain M3, but M3's *identity registry* half pulls forward (§4): the server must
   know the set of agentIds and their keys/tokens on day one of phase 2, or `authoredBy` stays
   self-asserted prose and the trust ledger is built on sand.
2. **Authz = scrutiny, and someone must compute it.** Enforcing HELD/tier rules at
   ref-advance means the home runs the grade fold and fragility index. Cheap. The expensive
   cousin: **server-side admit on a proposed state requires the lens** — absorb runs
   `loadLiveGraph` + ts-lens over a materialized tree, i.e. the home needs the language
   toolchain and O(absorb) compute. This is the CI-runner-shaped problem we swore off
   (forge §1c). Phase-2 answer: **client computes, server verifies** — verdicts are
   deterministic pure functions of three stateIds, so the home can recompute cheaply *when
   the states' essences are already in the store*, and the pusher must push states (essences
   ride in the WarpState objects). Full independent re-lift on the server is deferred and
   flagged as the honest gap: until then a malicious client could push a state whose essences
   misrepresent its bytes. Containment: `verify --deep` spot-checks + the M3 signature plan.
3. **Discovery.** "Point `home` at a URL" is fine for teams; zero-config LAN discovery
   (mDNS) is a nicety, not architecture. Parked.
4. **Large trees / first clone.** We have CAS dedup but no packfiles, no delta compression,
   no shallow clone. First sync of a monorepo fabric is O(store). Mitigations in order:
   batch object transfer (one stream, like our own `cat-file --batch` lesson), gzip the
   stream, and — only when it hurts — a pack format. Named now so nobody "helpfully" invents
   packs early (same discipline as v3 §4's loose-strand deferral).
5. **Durability.** When git leaves the room, the fabric stops being backed up by pushing to
   GitHub as a side effect. The server must own a backup story: append-only files make this
   rsync-friendly, and the checkpoint valve (§3) is deliberately NOT it (a stake exports
   trees, not the fabric). Phase-1 requirement: `warplined backup` = atomic snapshot of
   `.warpline/` to a target path; boring on purpose.
6. **The GUI/console transport.** Already solved in kind: the Platform section's ledger
   reader (fs.watch → WS repaint) becomes a daemon client instead of a file reader. Same
   shapes (G3), new socket.

---

## 2. THE INVERSION LIST — every git-as-substrate assumption, and its native-first form

The engine was built coexistence-first: git supplies *events* (commits → auto-seal), *names*
(refs → pick anchors), *bytes* (cat-file → snapshot/materialize), *identity* (user.name →
actor), and *corroboration* (committed fabric.jsonl → tamper cross-check). Native-first
replaces each supply line. Keyed to code as it stands at ac0615cd:

| # | Today (file) | Git assumption | Native-first form |
|---|---|---|---|
| I1 | `fabric/hook.ts` — auto-seal post-commit hook runs `pick --ref HEAD` | **git commits are the event stream**; no commit, no history | **Session/task-boundary seals.** The daemon exposes `pick` as an API/MCP verb; agent harnesses call it at task boundaries (the orchestrator already knows when a task ends — git was only ever a proxy for that). Optional daemon fs-watcher offers "you have unsealed meaning-drift" nudges; auto-seal-on-timer rejected (intent-free strands are noise). The hook survives as a coexistence adapter only. |
| I2 | `absorb.ts` — real refs lift via `materializeTree` = `git archive \| tar` | **git is the byte source for any non-worktree state** | **Absorb-from-store**: `restoreTree` (M1c, already git-absent) materializes any *bound strand's* treeId to a temp dir → `loadLiveGraph` → WarpState. New selector-absorb: `absorb('pick:<id>' \| 'refs/heads/x')` resolves through native refs/bindings, never git. Since v3 mandates bind-on-seal, every native strand is absorbable by construction. |
| I3 | `fabric/pick.ts` + `justification.ts` — actor from `git user.name`/commit author; intent from commit subject; `--ref` means a git ref | **git log is the identity + intent source** | Actor/agentId become **required inputs from the authenticated session** (daemon token → principal; CLI `--agent`/env stays for phase 0). Intent comes from the caller — and the **claim (`claim:v1`) becomes the canonical intent carrier** (it was designed as OFFER metadata; propose-with-claim is the native front door). No git fallback in native mode; an intent-less pick is refused, not defaulted. |
| I4 | `fabric/strand.ts` `provenance: {ref, treeSha, gitCommit}` — the coexistence anchor, IN the pickId preimage | **every strand carries git provenance** | Fields become nullable **coexistence breadcrumbs** (already null-tolerant); native strands carry `{ref: <native ref name>, treeSha: null, gitCommit: null}`. Watch item: provenance is in the v3 preimage, so this is a *value* change, not a schema change — no epoch bump needed. Native provenance wants one addition at the next natural epoch: `workspace`/origin-daemon id (which replica sealed it). Sidecar until then (v3 §6 MAY-NOT-2). |
| I5 | `warp/snapshot.ts` — `snapshotRef` batches via `cat-file --batch`; incremental path overlays `git diff --raw` onto a verified anchor | **git computes what changed** (the delta-native perf win rides git) | **Native incremental snapshot**: the daemon keeps a worktree **index** (path → {mtime, size, ino, blobId} — the one good idea from git's index file), anchored on the last sealed binding treeId. Changed-set = stat-walk against the index (fs.watch keeps it warm); overlay via the existing `writeMergedTree`, byte-identical and fail-open to the full walk — same contract `strandSnapshotAnchor` upholds today, different change-detector. **This is the perf keystone: without it, native-first re-inherits the O(repo) wall that P1 Lane A just tore down.** |
| I6 | `fabric/materialize.ts` — merge bytes read via `gitShowBuffer`/`changedPaths`; conflict-tree materialization via git plumbing | **git is the byte store for merge inputs** | `materializeMergedStateNative` (exists) becomes the ONLY path once all three inputs (base/ours/theirs) are bound strands; changed-path sets come from native tree-walk diff (treeId vs treeId — pure store reads). The git-reading path survives as the coexistence adapter for git-ref inputs only. |
| I7 | **WORKTREE seals can't happen on CLEAN** — T-2026-07-01-030 residue: a CLEAN admit of a worktree returns a verdict but the merged result's seal path assumed a git commit to hang the merge parent on | **an admitted contribution eventually becomes a commit** — false in native-first; agents may never commit | **THE KEYSTONE — the worktree→pick path (§2.1).** Promoted from residue to the central write path of the product. Designed below. |
| I8 | `fabric/anchor.ts` epoch corroboration `method: 'git-history-prefix-match'`; git-tracking of fabric.jsonl as external tamper cross-check | **git is the external witness** | **Replication is the witness.** The home daemon's ingest receipt (strand-set digest acknowledged by another node) supersedes git corroboration for the native era; concretely, `verify` grows a `--corroborate <peer-url>` that compares strand SETS + refs (exactly the set-based comparison v3 §4 already mandates post-exchange). Git corroboration remains valid for the pre-native prefix and is never rewritten. |
| I9 | `fabric/scratch.ts` — scratch forks note a base from the git-era selvage flow | **base = where git was when you started** | Scratch base = **pickId recorded at fork time** against a native ref (mostly true already post-v3-refs); the daemon can mint per-agent scratch refs (`refs/scratch/<agentId>/<n>`) so every in-flight workspace is a named, syncable ref — which is what makes agent work visible in the console *before* admit. |
| I10 | `warp/snapshot.ts`/`blob.ts`/`tree.ts` — shadow `gitOid` sha1 parity as the standing byte-faithfulness proof | **git parity is the proof obligation** | Parity stays **free and kept** (gitOid computation is pure TS sha1 — needs no git binary) but demotes from "standing proof against the substrate" to (a) coexistence-era check and (b) **the checkpoint valve's verification bolt** (§3: a stake commit's tree sha must equal the strand's recomputed gitOid — the valve gets a built-in tamper check for free). |
| I11 | `oracle.ts` — divergence viewer compares two *git branches* | **review = compare git refs** | Oracle over native selectors (any two of pick:/state:/refs/…/WORKTREE). Mechanical once I2 lands; the GUI's stateId-cache pattern is already ref-agnostic. |
| I12 | `git/repo-lock.ts` + assorted `revParse` guards | git repo presence assumed at startup in several CLI paths | Daemon starts git-absent; `git/` collapses into an **optional coexistence adapter module** loaded only when a `.git` exists AND coexistence mode is on. The test for phase 0 exit: full pick→propose→admit→resolve→restore loop green in a directory with no `.git` at all. |

### 2.1 The keystone — the native worktree→pick→admit path (designs T-030's successor)

Native-first agents have worktrees and task boundaries; they do not have commits. The path:

1. **Fork:** agent (or its harness) asks the daemon for a workspace: `warpline fork
   --agent <id>` → daemon records scratch ref `refs/scratch/<agentId>/<n>` at the current
   selvage pickId and (optionally) `restore`s the tree into the agent's directory. Base is a
   pickId, forever (I9).
2. **Work:** the agent edits bytes. The daemon's index (I5) tracks drift cheaply.
3. **Propose = seal the scratch strand.** `warpline propose --agent <id> --claim <…>` lifts
   the worktree (absorb WORKTREE), seals a **scratch strand** — parents `[<base pickId>]`,
   bound (bind-on-seal), claim attached, provenance git-null — and advances only the agent's
   scratch ref. *Inversion of today's flow: today admit judges an unsealed worktree; native
   admit judges a sealed, addressable, syncable strand.* Wins: the proposed state is durable
   before judgment (crash-safe, exchangeable, console-visible), retry-after-race is v3's
   reseal-re-parent instead of "hope the worktree hasn't moved," and the OFFER (forge §1b) is
   literally this strand + its claim — no new object.
4. **Admit = weave.** `warpline admit` runs the verdict between the scratch strand's state
   and the selvage. FAST_ADMIT/CLEAN → seal the **weave strand** (`parents: [selvageTip,
   scratchTip]`, merge recipe folded per v3 §1.1) and CAS-advance `refs/heads/selvage`.
   KNOT/DANGLE/CLAIM-BREACH/HELD → refuse; the scratch ref keeps the work; the knot payload
   carries both sides (all existing machinery, unchanged).
5. **Close the loop on CLEAN — T-030's actual residue:** after the weave seals, the daemon
   **restores the merged tree back into the agent's worktree** (native restore, dirty-dest
   overlay semantics already built) and re-points the scratch ref at the weave. The agent
   continues from merged reality. No commit existed at any step; nothing was lost if the
   process died between any two steps (every step is an append or a CAS).

This path is buildable almost entirely from parts that exist: absorb(WORKTREE), bind-on-seal,
claim:v1, admitDecision, materializeMergedStateNative, restore, v3 refs+CAS. What's genuinely
new: scratch-refs-as-refs, seal-from-scratch-strand plumbing in admit (today it re-absorbs),
and the write-back restore. That is why phase 0 is small (§4).

---

## 3. THE CHECKPOINT VALVE — warpline→git one-way stake export (T-2026-07-17-001)

Founder ask, spec'd. Git's demoted role: a **familiar, read-only, off-site checkpoint shelf**
— for humans who want `git log`/GitHub browsing of blessed states, and as a
disaster-recovery-of-*trees* (never of the fabric).

**Verb + config:**

```
warpline stake [--ref <native-ref>=selvage] [--to <git-repo-path>] [--push <remote>]
# .warpline/config: checkpoint.git = { enabled: false,   ← DEFAULT OFF (toggleable)
#   repo, remote?, branch: 'warpline/stakes', refs: ['selvage'],  ← allowlist (limited)
#   auto: 'off' | 'per-advance' | 'daily' }
```

**What a stake is.** One git commit per exported seal point:

- **Tree** = `restoreTree(strand.binding.treeId)` written into the stake repo's worktree —
  the exact bytes of the sealed stateId. Verification bolt (I10): the created commit's
  `tree` sha MUST equal the strand's recomputed shadow gitOid (pure-TS sha1; no git needed
  to compute the expectation). Mismatch = abort the stake, file a framework bug — never
  "commit anyway."
- **Message** = machine trailer only: `warpline-stake: <pickId>` + `warpline-state:
  <stateId>` + `warpline-schema: <n>`. **No intent prose, no actor names beyond the
  committer field** (`Warpline Stake <noreply>` as committer; author configurable to the
  human owner). Untrusted agent prose never crosses onto a GitHub-rendered surface unframed
  (forge §3d) — the valve's answer is: it never crosses at all.
- **Parent** = the previous stake commit on the stake branch. **Stakes are a first-parent
  linearization of the chosen ref** — the git side gets a chain of blessed trees, NOT a
  mirror of the DAG. Deliberate: exporting the weave topology would make git a shadow
  authority on fabric structure and invite round-tripping. Git gets checkpoints, not history.

**One-way, enforced (never feeds back):**

1. Native provenance never references a stake commit; the stake namespace
   (`warpline/stakes*`, the trailer keys) is **refused as input** by pick/absorb/backfill —
   a guard, not a convention (`isStakeRef()` check in the coexistence adapter).
2. No import verb exists for stakes; `restore` from the fabric is always authoritative. A
   tampered stake branch can mislead a *human browsing GitHub*, never the fabric — and the
   gitOid bolt makes tampering detectable by recompute.
3. The stake repo is ideally a **separate repo** (or at minimum a dedicated branch never
   merged); config refuses `branch: main`-style values for the same reason a backup tool
   refuses to overwrite its source.

**What must NEVER leak** (the deny-list, checked at export):

- the `.warpline/` directory in any form (snapshot already excludes it from trees — the
  valve asserts it anyway, fail-closed);
- **sidecar trust data**: grades.jsonl, claim evaluations, escalation/HELD rows, override
  events — a stake carries zero calibration signal;
- **claims and knot payloads** (they embed agent prose and both sides' bodies);
- intents, resolution reasons, any `untrusted-prose` envelope content;
- agent session keys, daemon tokens, ref-ownership records.

The exported surface is exactly: tree bytes + pickId/stateId/schema trailer. Nothing else,
ever; additions require a founder-signed config schema change, not a flag.

**Safeguards (limited):** default OFF; per-ref allowlist (default `selvage` only — scratch
refs are never stakeable); rate shape `per-advance` or coarser (never per-strand — a stake
marks blessed states, not every append); `--push` is explicit or configured, never implied;
stake failures never block the seal path (the valve is downstream of truth, fully async).

---

## 4. SEQUENCING — from ac0615cd to a private server this repo dogfoods

Prereq note: P1 Lane A (delta-native absorb, T-2026-07-04-003) remains the wall in front of
everything; nothing below re-orders it.

**Phase 0 — native pick/admit without git (the keystone, ~1–2 wk of engine work).**
Build §2.1: selector-absorb (I2), native incremental index (I5 minimal: stat-walk, no watcher
yet), scratch refs (I9), propose-seals-scratch-strand + admit-weaves-from-strand (I7),
merged-tree write-back, actor/intent required (I3), git module behind a coexistence flag
(I12). **Exit test: the full loop runs green in a directory with no `.git`.** Dogfood: one
agent worktree on this repo runs native-only for a week.
*Pulls forward:* **v3.3 seal-path cutover completes here** (all writes through the v3
bind-on-seal path; rewriteFabric deleted per v3 §1.1 if any residue remains).

**Phase 1 — single-user daemon + console-over-existing-GUI + the valve (~2 wk).**
`warplined`: loopback HTTP/WS serving §1.3's read endpoints + pick/propose/admit/resolve as
API verbs; fs-watcher warms the index; the Platform section's Oracle Divergence Viewer /
admit feed re-pointed from file-reads to the daemon socket (same shapes, G3). `warplined
backup`. **The checkpoint valve ships here** (T-2026-07-17-001) — solo devs get their
GitHub-visible checkpoints the day git stops being the write path, which is what makes the
demotion adoptable. Dogfood: this repo's fabric served by a local daemon; stakes pushed to a
`warpline/stakes` branch.
*Pulls forward:* **M2 refs UX** (named wefts, heads listing, log-over-DAG) — the daemon
makes ref surfaces unavoidable; build them here, not as a separate M2 epic.

**Phase 2 — team server + exchange (~3–4 wk).**
V3.5 bundle endpoints (§1.3) whole; per-ref CAS at `/advance` with scrutiny enforcement
(HELD/CLAIM-BREACH/tier rules server-side); token authn per human + per agentId;
client-computes-server-verifies verdicts (§1.4.2); sidecar channel + latest-wins fold;
set-based `verify --corroborate` (I8). Dogfood: home daemon on one machine, 2+ agent
replicas syncing — **the multi-agent merge wedge finally runs on its native substrate**, and
the fabric's zero-agent-strand problem (memory: dogfood gap) is attacked with the real
topology instead of a harness.
*Pulls forward:* **M3 splits.** The identity-registry half (principals, agentId→key/token
binding) pulls INTO phase 2 — a server without authn is a liability, and the trust ledger
needs non-self-asserted agentIds. The signature half (signed strands/BOLTs, key rotation,
signed WEAVE-LAW) stays M3-proper, unblocked-not-blocked by this design (strand shape already
excludes mutable data, so signatures bolt on at the next epoch).

**Phase 3 — the forge surfaces (per `warpline-forge.md` §1, now on our server).**
The translation table renders over the daemon API: KNOT queue, OFFER pages (scratch strand +
claim + verdict), Tapestry with honesty labels, scrutiny/HELD lanes, verdict-class
subscriptions over the events WS. The forge spec's §5 thaw condition (`graded-weaves/week >
0`) is now *produced by phase 2's dogfood* rather than awaited from external adoption — the
gate holds, the route to it changed.

**Falls away / demotes:**

- **Guard-as-GTM** (P3 Lane B GitHub Action as distribution spearhead) → optional adapter,
  built only on pull. The claim-staking ground is the private server (fixed premise).
- Git corroboration as the standing tamper witness (→ replication, I8).
- The auto-seal hook as the default onboarding story (→ daemon verbs; hook = coexistence).
- Shadow-gitOid as a *substrate* proof (→ retained as the valve's verification bolt).
- The roadmap's P4 "publish the benchmark before the platform" ordering loosens: evidence
  now accrues on our own server's fabric first. (P4 itself is not cancelled — re-timed.)

**Honest costs, once.** (1) Deferred: external distribution/adoption evidence (K4-class
signals) moves behind phase 2 — we are choosing depth-on-our-own-substrate over reach, and
the market clock (Cursor Origin, fall 2026) does not pause; the mitigation is that phases
0–2 are also the fastest route to the ≥100-admission statistical run (4.2). (2) O(x) risks:
first-sync is O(object store) with no pack format (§1.4.4); server-side absorb is O(repo)
without the toolchain answer, so phase 2 knowingly ships client-computed/server-verified
with an essence-honesty gap until deep-verify or M3 signatures close it (§1.4.2); one
fabric.jsonl + one sidecar set under multi-replica write pressure will force the deferred
loose-strand/partitioned layout sooner than v3 hoped. (3) Standing tax: we become the
custodian — authn, backup, and uptime are now product surface forever; every week of
daemon/protocol work is a week not spent on lens coverage, and the honesty-label metric
(meaning-decided %) must not silently stall while we build plumbing.

## 5. Founder decision points raised by this document

1. **Home-fabric topology** (§1.2) — one designated ref authority per project, symmetric
   binary. Alternative (pure P2P) rejected above; cheap to revisit before phase 2.
2. **Propose-seals-a-scratch-strand** (§2.1 step 3) — proposed states become durable strands
   pre-judgment. Cost: fabric carries refused proposals (they are history — argued as a
   feature: calibration data). Alternative: ephemeral proposals, weaker crash/exchange story.
3. **Stakes are linearized checkpoints, not a DAG mirror** (§3) — git browsing loses weave
   topology by design.
4. **M3 split** (§4 phase 2) — identity registry pulls forward, signatures stay M3.
5. **Valve deny-list is constitution-grade** (§3) — expanding the exported surface requires
   a config-schema change, not a flag.
