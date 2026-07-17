# Warpline Native-First — the Security Model of the Private Server

**Author:** Aegis (security) · 2026-07-17 · native-first theorizing pass
**Fixed premise:** TD-2026-07-17-151 — Warpline-native local/private server is the product; our forge is core; git is a toggleable, safeguarded, one-way checkpoint export (T-2026-07-17-001).
**Reads with:** `docs/specs/warpline-forge.md` (§1d, §3d, G1–G5), `warpline-v3-identity.md` (§2 refs/CAS, §7 R4, §9.3), `warpline-flows.md` (§2 scrutiny ladder), Arky's native-first topology doc (this directory — stages: solo daemon → team server → multi-site).
**Prior Aegis findings carried in:** HIGH-1 attribution unsigned (`justification.ts:109` — `signature: 'unsigned:'+sha256`; `hook.ts` header states self-assertion explicitly), R4 trust ledger deliberately unauthenticated (accepted-as-posture, v3 §9.3), R1 whole-fabric re-chain residual (no chain secret), P2.4 injection envelope shipped (`envelope.ts`).

---

## 1. Does M3 pull forward? — No. Something smaller and cheaper does.

### 1.1 The analysis

The local CLI's trust boundary is the OS user. Self-asserted `agentId` is *honest* there:
anyone who can invoke the CLI can also write `.warpline/` directly, so per-strand
signatures would add ceremony, not security. HIGH-1 was accepted on exactly that ground.

A server breaks that equivalence in one specific way: **the append API becomes reachable
by principals who cannot touch the disk.** The moment two principals share one endpoint,
a client-supplied `agentId` is an impersonation primitive — agent A seals as agent B,
poisons B's grade trajectory (the moat data), and inherits B's Tier-0 privileges later.
That is not a v3-era exotic attack; it is a one-line curl.

But the fix is **not** per-strand cryptographic signatures. Split the two things M3
conflates:

- **Authentication of the connection** — "who is calling me right now." A server needs
  this on day one. It is session/transport machinery, cheap and boring.
- **Signatures on the record** — offline verifiability, non-repudiation, portability of
  attribution across machines. This is M3 proper, and *within a single-server trust
  boundary it buys nothing the connection auth doesn't*, because the server is already
  the sole writer: if you trust the server to run the gate, you trust it to stamp the
  author.

The load-bearing rule that replaces M3 at phase 1: **server-stamped identity.** The
server derives `actor`/`authoredBy.agentId` from the authenticated session and refuses
any client payload whose identity fields mismatch the session principal. The client
field degrades to advisory; the session is the truth. HIGH-1's practical impersonation
surface closes without touching the strand schema, the pickId preimage, or key
management.

**M3's real deadline is exchange (V3.5 / multi-site).** A bundle arriving from another
server carries strands whose attribution the receiving server never witnessed —
transport auth authenticates the *peer server*, not the *authors inside the bundle*.
Accepting cross-site attribution on "the peer says so" makes grades poisonable
transitively and breaks the moat. Per-author signatures become a prerequisite there,
not before.

### 1.2 The staged identity model (matched to Arky's topology)

**Stage 1 — solo daemon** (one machine, one human, N local agents):

| MUST | MAY DEFER |
|---|---|
| Bind loopback-only or unix domain socket, socket mode 0600 | TLS (loopback) |
| Per-agent bearer token, minted by the daemon (token issuance = the human's act; one token per agent worktree) | Per-strand signatures (M3) |
| Server-stamped identity on every append (rule above) | User accounts / roles beyond human-vs-agent |
| Append-only audit line per API call: `(session principal, verb, target, at)` | Key rotation ceremony |

Honest trust claim to print in the console: *"attribution authentic within this
machine's OS-user boundary; the daemon is the trusted stamper."* No enterprise theater:
stage 1 is a socket, tokens, and an audit line.

**Stage 2 — team server** (LAN/private net, several humans + agent fleets):

- MUST: real connection authn — mTLS-lite (one self-signed CA per server; client certs
  per human and per agent) *or* per-principal tokens over TLS. Principal classes:
  `human`, `agent`, `operator`. Server-stamped identity unchanged.
- MUST: override verbs restricted by class (§2) and sidecar read ACLs (§2).
- SHOULD: **server receipts** — the server signs each strand it seals with a single
  server key (custody signature, not authorship). This is an M3 down payment that
  upgrades R1: whole-fabric re-chain now requires the server key, not merely disk
  write. One key, no per-author PKI.
- MAY DEFER: per-author end-to-end signatures — with the caveat *stated, not hidden*:
  the server is a trusted party; a compromised server can forge attribution. Acceptable
  for a private team server; it must say so on the trust page.

**Stage 3 — multi-site** (V3.5 exchange, bundles between servers):

- M3 is a **prerequisite**: per-author signatures over the strand (schema-epoch
  decision per forge-spec §3b posture), a key directory per site, minimal revocation
  (a revoked key stops *future* trust accrual; it does not rewrite history). Receive
  path additionally enforces: pickId recompute, causal-append, epoch-anchor
  verification (all already speced, v3 §3–§5).
- Grades never cross sites raw (R4 + moat): a remote agent's trust is recomputed
  locally from locally-witnessed outcomes, or imported only as explicitly-labeled
  hearsay. Non-portable calibration is the moat *and* the security posture — same fact.

**Verdict: M3 does not gate phase 1.** What pulls forward into phase 1 is
server-assigned identity + audited overrides. Signatures activate at stage 2 as a
single server key (receipts), and become per-author only at stage 3.

---

## 2. The trust boundaries of the server

### 2.1 Principals

`operator` (founder/admin; mints identities, flips toggles) · `human` (teammate) ·
`agent` (fleet member; identity minted by a human — **token minting is an operator/human
verb**, or agents sockpuppet their way to self-endorsement) · the server process itself
(trusted stamper) · later: external witness runners (attest-only principals).

### 2.2 Verb × principal matrix

| Verb | Who | Server-side enforcement |
|---|---|---|
| propose / seal (append strand) | any authenticated principal | identity server-stamped; scrutiny tier computed **server-side** decides seal vs HELD |
| endorse | principal with domain trust ≥ threshold | endorsement signs the Offer's `stateId`; server recounts weights at seal inside the same critical section as the per-ref CAS (v3 §2) — client-claimed "approved" is never trusted; stale-target endorsements refused |
| resolve KNOT | tier-gated; Tier 2+ = `human` class only | `KnotResolution.decidedBy` MUST equal the session principal — server-written, never client-supplied; `reason` required (already engine law, `resolve.ts`) |
| **accept-breach** | `human` only | was a CLI flag (`cli.ts:444`); on a server it is a **remote-invocable override**. Audit row = principal + reason, appended to `.warpline/claims/evaluations.jsonl` (already the record, `admit.ts` breach path). **An agent must never accept its own breach** — self-override is the exact failure the gate exists to catch |
| **accept-risk** | `human` only | same mechanics via `.warpline/grades-escalations.jsonl` (`admit.ts:175-180, 461-479`; `grade.ts:338-362`). Override clusters surface in the console (Loid's calibration pass pattern) |
| grade / grade-overturn | `human` or a designated calibration process | grades are the moat AND the future permission input — grade-poisoning is privilege escalation with a fuse. R4 accepted `grades.jsonl` as unauthenticated *on disk*; the server must therefore be its **only network-reachable writer**. Host-disk tamper stays an accepted residual (verify + corroboration + receipts) |
| attest / epoch anchor / WEAVE-LAW change | `operator`; law changes only via a pick satisfying the *prior* law (flows §3) | server refuses law writes that bypass the gate |
| toggle checkpoint valve | `operator` | §3 S4 |
| mint identity / token | `operator` (stage 1: the human) | anti-sockpuppet line |

### 2.3 Reading the sidecars — the sensitive data nobody threat-modeled yet

`grades.jsonl`, `claims/evaluations.jsonl`, `grades-escalations.jsonl` are
**performance records about named agents AND named humans** — calibration failures,
overridden escalations, breach history. On a team server this is HR-adjacent data.

Policy: a principal reads **their own** trajectory freely; cross-principal and
aggregate reads require `operator` or a `reviewer` grant scoped per domain. Scrutiny
*outputs* (the tier on an offer) are public to participants — you may see *that* a
change was HELD; you may not enumerate a colleague's failure history without the role.
Stage 1 collapses this (one human sees all); stage 2 makes it explicit.

### 2.4 What enforces scrutiny-policy-as-permissions server-side

The forge constraint (§1d) says the forge stores no ACL — permission = grades (earned)
× fragility (computed) × WEAVE-LAW (sealed). Server-side that becomes three rules:

1. **The tier computation runs on server-held inputs only.** Fragility, grades, and law
   are read from the server's own sidecars/fabric at seal time; client-computed
   scrutiny is a display hint, never an input.
2. **The gate is the only write path.** Every mutation lands via propose/endorse/resolve
   (G4) inside the server's append+CAS critical section; there is no "admin writes a
   strand" endpoint.
3. **The only ACL the server may hold** is (a) the principal class (human / agent /
   operator) and (b) sidecar read visibility (§2.3). Anything richer is the forge-side
   ACL the constraint spec bans — if a permission question can't be answered from
   grades+fragility+law+class, the answer is a spec change, not a table row.

### 2.5 Named threats and their closures

impersonation → server-stamped identity (§1) · sockpuppet self-endorsement → human-gated
identity minting + the anti-collusion different-lens rule (flows §2) · endorsement
replay → endorsements bound to `stateId`, recounted at seal, stale targets refused ·
override abuse at distance → human-class-only + audited + cluster-surfaced ·
grade poisoning → server-only writer + grader role · prose injection → §4 · server-host
disk tamper → accepted residual, mitigated by verify (`verify.ts` full walk), git
corroboration during coexistence, and stage-2 receipts (R1 upgrade).

---

## 3. The checkpoint valve — "safeguarded," defined (T-2026-07-17-001)

**A stake** = one plain git commit in a *designated stake repo* whose tree is the
materialized bytes of a sealed strand's `binding.treeId`, labeled (commit message +
trailer) with `pickId`, `stateId`, `treeId`, and the engine version. Five safeguards;
all five are the definition of the founder's word "safeguarded."

### S1 — one-way, mechanically

- The stake repo is one the fabric **never reads**: a separate repo (or dedicated
  branch namespace), marked by a committed root marker file (`.warpline-stake`) that
  serves as both provenance label and machine-readable refusal signal.
- The auto-seal hook (`hook.ts` — today's git→warpline direction) **refuses to install
  or run** where the marker is present. `seal`/`absorb` refuse a source tree containing
  the marker except via the explicit recovery verb (S5).
- No provenance backflow: a staked commit sha must never appear as
  `provenance.gitCommit` on a new strand — that field means "born from this commit,"
  which would be a lie and would launder the valve into an import path.

### S2 — the leakage denylist (and why it's actually an allowlist)

**Mechanism first:** the stake tree is *built by materialization* — `restore`
(`restore.ts:52`) writes the bound tree from the object store into a clean directory,
which is then committed. You cannot leak what you never copy. The denylist below is a
**post-build audit** (defense in depth), not the primary mechanism.

Must never enter a stake tree:

- `.warpline/` **in its entirety**: `fabric.jsonl`, `fabric-legacy.json`, `objects/`,
  `states/`, `warp/`, `refs/`, `oracle.jsonl`
- `grades.jsonl`, `grades-escalations.jsonl` — trust/performance data (§2.3)
- `claims/` — claim documents + `evaluations.jsonl` (calibration probes naming agents
  and humans)
- `knots/` payloads — they carry **both sides' bodies, both intents, and enveloped
  prose**; once in a git tree the envelope's frame-on-render control is gone
- any serialized `untrusted-prose` envelope, anywhere — the stake audit greps the
  produced tree for the `"kind":"untrusted-prose"` marker and denied path patterns and
  **refuses the commit** on a hit
- secrets by the usual rules (the stake inherits the project's gitignore semantics for
  the materialized tree — materialization must not resurrect ignored/unsealed files,
  which it can't, since only sealed bound bytes exist in the store)

### S3 — determinism check

After materializing and before committing: recompute the tree address and require it to
equal the strand's `binding.treeId` — the same recompute machinery verify already runs
(`verify.ts:310` enforces `merge.result == binding.treeId`; the bound-bytes walk
enforces objects recompute). **Mismatch = refuse the stake.** A stake that does not
reproduce its binding is disinformation with a git sha. The commit records the
pickId↔treeId↔git-tree correspondence so any later audit can re-verify offline.

### S4 — toggle semantics

- **Off by default in native mode.** Enabling = an explicit config write
  (`checkpoint.enabled` + target repo path), an `operator` verb on the server, and an
  **audited event** (principal, at) — as is every subsequent stake emission (pickId →
  git sha mapping appended to an events stream inside `.warpline/`, *not* inside the
  stake repo).
- Stakes are cut **only at sealed states** — never from a dirty worktree; the valve has
  no opinion about unsealed bytes because unsealed bytes have no `binding.treeId` to
  verify against (S3 makes this structural, not policy).
- No auto-stake cadence without the toggle; with it, cadence is config, but every
  emission still passes S2+S3.

### S5 — reset-recovery re-entry (the integrity of the escape hatch)

`git reset --hard <stake>` puts the working tree at a state **the fabric already
knows** — the stake *is* a sealed stateId. The re-entry rule:

1. `warpline recover --stake <sha>` reads the pickId from the stake label.
2. Verify the working tree hashes to that strand's `binding.treeId` (S3's check,
   re-run on re-entry — a stake repo tampered after the fact fails here).
3. **Move the working ref** to the staked pickId (per-ref CAS, v3 §2). A ref movement,
   not a new strand: recovery must not mint history.
4. Only if the tree does *not* hash (the human edited after resetting) is a new strand
   sealed — **parented on the staked pickId**, keeping the DAG truthful about where the
   divergence began.
5. The auto-seal hook never fires on the reset itself (S1's refusal covers the stake
   repo; in the working repo, recovery runs with the hook's guarded block bypassed by
   the recover verb, which does the ref move under the fabric lock).

Net: recovery consumes exactly one datum from git — the pickId label — and verifies it
against the fabric before acting. The valve never becomes an import path, and a reset
can never desync fabric from worktree, because the fabric's ref is repointed in the
same operation that accepts the reset.

---

## 4. The injection surface at server scale

### 4.1 The pure-function law, restated as a server-side invariant

**No server-side decision — verdict, tier assignment, ranking, notification routing,
subscription matching, auto-action, or log-derived automation — may read the `body` of
an `untrusted-prose` envelope. Prose reaches exactly two sinks: the escaped
frame renderer (`frameProse`) and an agent context, framed. Everything else consumes
only `contentAddress`.**

The engine already holds this (`envelope.ts` layers 1–3; `admit.ts`/`predict.ts` pure
over structural inputs; `test/injection-envelope.test.ts`). The server adds sinks the
CLI never had:

- **Console pages** — HTML: XSS joins prompt injection as the same class. The §3d frame
  rule becomes: escape + visible marking + no markdown execution + no link resolution,
  enforced in the one shared renderer (G3: one shape, one frame component).
- **Notifications** — a digest quoting a knot intent is a render surface; worse,
  notification **subjects/titles** get interpolated into templates, URLs, and OS
  notification APIs. Rule: prose never enters a subject line or any templated field —
  subjects are built from structural fields only (verdict class, symbol, tier).
- **Webhooks** — third parties receive the **typed envelope**, never a bare string
  (the untrusted provenance must survive serialization to the consumer).
- **Search** — indexing prose is fine; result snippets re-enter through the frame.
- **Server logs** — prose in logs is injection into every log-reading agent. Log the
  `contentAddress`, never the body.

### 4.2 The CI-style test that enforces it

1. **Canary taint test (the server twin of the pure-function tests):** build a fixture
   fabric in which *every* prose field is a unique canary string; drive the full server
   surface (verdicts, tiers, rankings, notifications, webhooks, logs); assert no canary
   appears in any decision output, routing choice, subject line, or log line — and in
   rendered HTML only inside frame markers, escaped.
2. **Hostile-corpus render goldens:** every console/notification template rendered
   against a corpus of script tags, ANSI, markdown link/image syntax, template syntax
   (`{{ }}`, `${ }`), and frame-boundary collision strings; assert escaped-inside-frame
   or refused (`isValidEnvelope` failure ⇒ refuse-to-render, already the engine rule).
3. **Boundary typing:** any API/response field originating from agent input is typed
   `UntrustedProse`; the server boundary validator rejects bare strings where envelopes
   are expected. A type-level test pins the schema so a bare-string field can't be
   added without failing CI.
4. **The blind red-team corpus (roadmap 5.4) remains the gate before any
   auto-resolution tier** — the server inherits it unchanged; no "auto-resolve" button
   until it passes (forge-spec §3d, restated here because a server makes the button
   temptingly easy to add).

---

## 5. Summary of positions

1. **M3 does not pull forward to phase 1.** Server-stamped identity + human-gated
   token minting + audited overrides close the server-scale impersonation gap.
2. **M3's hard deadline is stage 3 / V3.5 exchange**; stage 2 takes the cheap down
   payment (single server key = custody receipts, upgrading R1).
3. **Overrides become remote-invocable** → accept-breach / accept-risk / Tier-2+
   resolve are human-class verbs, server-enforced, always audited, cluster-surfaced.
4. **Sidecars are sensitive** — performance data about agents and humans; own-trajectory
   free, cross-principal reads role-gated from stage 2.
5. **The only server ACL** is principal class + sidecar visibility; everything else is
   grades × fragility × law, computed server-side from server-held inputs (§1d honored
   structurally).
6. **"Safeguarded" =** S1 one-way (marker + hook refusal + no provenance backflow) ·
   S2 allowlist-by-materialization + denylist audit · S3 refuse-on-treeId-mismatch ·
   S4 off-by-default audited toggle, sealed-states-only · S5 recovery = ref move, never
   an import, never silent new history.
7. **The pure-function law at server scale:** prose has two sinks (frame, framed agent
   context); everything else touches only the content address — enforced by canary
   taint tests, hostile render goldens, and boundary typing.
