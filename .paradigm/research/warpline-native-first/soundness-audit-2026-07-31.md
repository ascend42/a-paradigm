# Warpline soundness audit — "as bulletproof as git"

**Date:** 2026-07-31 · **Auditors:** Trace (crash safety), Arky (concurrency), Jinx (fail-open), Aegis (integrity), Shield (data loss), Judge (git-parity) · **Commissioned by:** the founder — *"this is source control and we need to be certain that pieces work as deliberately intended."*

---

## STATUS LOG — as of 2026-08-11 (added, not rewritten)

**Everything below this block is the audit AS WRITTEN on 2026-07-31 and is left
verbatim.** A point-in-time audit that gets edited to match the present stops
being evidence. This block records what has changed since; where the two
disagree, this block is current and the text below is the historical record.

### Facts stated below that are now STALE

| Stated 2026-07-31 | Measured 2026-08-11 |
|---|---|
| live fabric **64 lines**, md5 `2503e2e4…`, selvage `state:v0:6ef03392…` | **78 strands**, selvage `…2296765f`, `verify all intact (78 checked)` |
| `.warpline/refs/heads` **does not exist** — "the live repo is not in refs mode" | **exists**; `health` reports `refs mode  refs (selvage)` |
| **687 tests**, never run in CI, 4 dist-tests `skipIf` out of existence | **1006 passing / 110 files / exit 0**, two consecutive clean runs; Warpline into CI at `c56e2fec` |
| "no `--root` and no `WARPLINE_ROOT`" (D-7, P0 item 7) | both exist; `health` reports **which arm** resolved the root |

### Still TRUE, and worth re-reading below

- **0 v3 strands.** The live fabric is 15 v1 + 63 v2. Consequence #2 of the
  structural discovery holds unchanged: *every v3 protection covers zero of the
  founder's strands*, and "v3 fixes that" remains a guarantee not currently held.
- **C-9 is structurally live on this repo.** `health` says so unprompted:
  `contested 0 … 52 verdict(s) had no agent base, so FAST_ADMIT was structurally
  forced and contention was UNREACHABLE (audit C-9), not merely absent`
  (base: predates-field 43, selvage 9). `.warpline/knots/` and `.warpline/claims/`
  still do not exist here — this repo has never produced a contested verdict.
  A genuine KNOT *was* produced on 2026-08-11, but on a scratch repo, not this one.
- **The "Note on the new claims" closing paragraph.** The false-CLEAN rate is
  still uncalibrated; nothing since has measured it.

### Remediation map — finding → commit that ADDRESSED it

Derived from commit bodies, **not** from a per-finding re-verification. Treat as
"where to look", not as proof of closure; the two items above are direct evidence
that being *mentioned* in a remediation commit does not mean *closed*.

| Finding | Addressed in |
|---|---|
| C-2, C-3, C-4, C-8, C-12 | `7a9a555b` (P0 — the cardinal sin, an RCE, two integrity holes) |
| C-5, C-6, C-7 | `7a9a555b`, then `292e740e` (P1 — isolation, write-back safety, durability) |
| C-11, C-13, C-14, C-15, C-16 | `292e740e`, `0f561ecf` (P2 — truncation detection + repair) |
| C-16 | also `5bb2edae` (fabric-lock heartbeat) |
| C-9, C-10 | `280633d9` (P3 — agent-class `abandon`), `3a5c3b75` (the gate CAN fire; agents cannot reach it) — **diagnosed and instrumented, NOT closed** |
| C-1 | `5ab60202`; the P0 item 1 `refs migrate` has since run — `refs/heads` now exists |
| C-6 (truncation detectability) | `bf216132` (`health` surfaces the stake-journal witness) |
| D-7 (`--root`) | `bf216132` (root-resolution arm reported by `health`) |

### NOT re-verified

No auditor re-ran the original demonstrations. C-1 through C-16 have **not** been
individually re-tested against the current code, and this log deliberately does
not mark any of them "closed" on the strength of a commit message. Re-running the
six auditors' demonstrations against HEAD is the outstanding work; until then the
findings below stand as written.

### Defects found AFTER this audit (not in the findings below)

Each is the audit's own "two failure cultures" shape — a silent divergence where
failure renders identically to success:

- `health` counted contested verdicts from shadow rows only, while the native
  path persists payloads to `.warpline/knots/` — it reported "ZERO contested
  verdicts" with a real KNOT on disk (`ae708ec5`).
- Both code-lenses ignored the repo's own `.gitignore`; 55.9% of a *worktree*
  absorb was build output carrying absolute machine paths in symbol ids
  (`ae708ec5`). The sealed ledger was never affected (`f988b090`).
- Renames graded as destruction: a moved file read as retire+born, falsely
  overturning 29% of strands on a 40-seal run and corrupting the calibration
  signal (`f8978bb1`).
- `oracle` scored *any* failed git measurement as "git merged clean" — the cell
  that flatters the headline claim (`81f98359`).
- Concurrent `git worktree add` raced on the shared `.git/worktrees` registry;
  `oracle` ran two adds per invocation, unlocked, by construction (`81f98359`).

---

## Method, and why it differs from every prior review

Two rules bound every auditor:

1. **The test suite was inadmissible as evidence.** Established the same day: Warpline's 687 tests never ran in CI, its test files are never typechecked (6 real type errors hide there), root `npm run typecheck` has no root tsconfig and checks nothing, `ci.yml` had not run since 2026-02-04 with five consecutive failures, and four dist-dependent tests `skipIf` themselves out of existence. A green suite was proving very little. Auditors had to **demonstrate breaks**, not infer safety.
2. **All experiments in `os.tmpdir()`.** Per D-7 there is no `--root` and no `WARPLINE_ROOT`; ~31 `repoRoot()` sites mean an in-repo scratch fabric drives the *live* one.

**Isolation held.** The live fabric was fingerprinted before and after: **64 lines, md5 `2503e2e4bea85e4eafeb52eed95709d0`, selvage `state:v0:6ef03392…`, 37 shadow verdicts** — byte-identical at every checkpoint across six agents running deliberately destructive experiments.

Findings marked **[verified]** were independently re-checked against the code or the live fabric in the main session before being recorded here. Others are auditor-asserted with `file:line`.

---

## Verdict

**The judgment layer is sound and in several respects ahead of git. The custodianship layer is not ready to be the only copy of anything.**

Use Warpline alongside git, never instead of it, until P0 closes.

The audit found a consistent shape, best stated by Jinx: **two failure cultures in one package.** Where Warpline owns the substrate — the native object store, restore path-hardening, daemon auth, the shadow boundary, the fabric lock — it is rigorous and genuinely fail-closed, and in places better than git. Where it delegates to git and catches the result, it converts every error into "absent," and on the merge path *absent means delete*.

---

## The structural discovery that reframes everything

**[verified]** The live repo is **not in refs mode**:

```
.warpline/refs/heads   → does not exist
.warpline/knots        → does not exist
.warpline/claims       → does not exist
strands: 49 v2 + 15 v1 + 0 v3
agentIds: NONE
```

`warpline fork` against the founder's own repo refuses with `UNSUPPORTED → refs.migrate`. `cli.ts:1087` already prints *"(no refs/heads — legacy selvage mode; run `warpline refs migrate`)"*.

Three consequences that outrank any individual bug:

1. **The multi-writer write path is switched OFF, not merely unexercised.** Everything the auditors demonstrated working — KNOT, resolve, the full loop — they demonstrated only *after* `refs migrate` in a scratch repo. Judge's scratch KNOT is plausibly the first this system has produced outside a test file.
2. **Every v3 protection covers zero of the founder's strands.** No positional fields, mandatory bind-on-seal, merge recipe in the hash — all real, all protecting an epoch with 0 live strands. The live data sits entirely in v1/v2, the epoch carrying the laundering defect (C-4). *"v3 fixes that"* is not a guarantee currently held.
3. **The primary concurrency safety net is disengaged** — see C-1.

---

## CRITICAL — findings that lose, corrupt, or expose data

### C-1 — The working CAS is disabled on the live fabric, and 11 of 64 strands are CAS-blind **[verified]**
*Arky D-A. Blast radius: permanent, unrepairable ledger corruption on the founder's own repo.*

Because the repo is unmigrated, `seal.ts:139` reads `null` for the pickId ref, so the ref-CAS block at `:140-143` is skipped and `writeRef` at `:147` never runs. **The exact mechanism Arky demonstrated catching a real race is entirely disengaged here.**

The only remaining guard is the stateId CAS at `seal.ts:129-134`. stateIds are many-to-one — the documented reason V3.2 moved refs to pickIds (`refs.ts:5-7`). Verified against the live fabric: **11 of 64 strands have `stateId === parentStateId`** (9 are `byteOnly` byte-custody strands, `pick.ts:318`). For those the CAS evaluates `S !== S` → false → **passes unconditionally**. It is structurally blind to 17% of this repo's real seals.

And the auto-seal hook **is installed and backgrounds** `.git/hooks/post-commit:97` **[verified]**:
```sh
( $WARPLINE_BIN pick --ref HEAD --quiet >/dev/null 2>&1 || true ) &
```

So the conjunction that corrupts is: two commits close together (rebase, `git am`, amend, a commit script, an agent doing two commits) → two backgrounded `pick` processes → one holds the lock through a large absorb (**2,729 files** on this repo) exceeding `STALE_MS = 30_000` → the second steals the lock → both pass the blind CAS → both `appendStrand` with the same `parentPickId`. Result: `chain-break`, and `rewriteFabric` refuses identity-field mutation so **there is no repair path**.

*vs git:* `git commit` takes `index.lock` and `HEAD.lock` and **never steals either** — it refuses and tells the human. Warpline chooses steal-and-continue. **Weaker than git.**

*The mitigation already exists in code:* on the migrated v3 path the same broken-mutex scenario degrades to a **reported abandoned head** — legal, harmless, visible in `verify`. `migrateSelvageToRefs` is at `refs.ts:146`, exposed as `warpline refs migrate`. **[verified]**

### C-2 — The merge silently drops changes to any non-ASCII filename **[verified]**
*Jinx J-1. Blast radius: the VCS cardinal sin, on the default path.*

`src/git/git-exec.ts:270` runs `git diff --name-only` **without `-z`** and splits on newlines. Its two siblings in the same file use `-z` explicitly, with the comment *"so exotic paths survive unquoted"* (`:230`, `:305`). `core.quotePath` is unset → defaults true → `café.txt` returns as the octal-escaped literal `"caf\303\251.txt"`.

Driven through the real `computeMerge`: the phantom path enters the plan as a DELETE, the real file never enters at all, and `materializeMergedState` therefore keeps the **base** version. Zero conflicts. `state` non-null → `admit.ts:828` takes the success branch → sealed **CLEAN**. The loss is durably content-addressed and self-verifying: `merge.result === binding.treeId` holds, on the wrong bytes.

Triggers on any accent, CJK, Cyrillic, emoji, space, quote, backslash, or newline in a path. `materialize.ts:8-9` promises *"a wrong merge is the VCS cardinal sin"* — committed silently, on a one-word fix. The same call site poisons `oracle.ts:192-193`, the product's headline detection claim.

### C-3 — `restore` writes into `.git` and executes code **[verified]**
*Aegis S1. Blast radius: arbitrary file write → RCE.*

`snapshot.ts:505` is `new Set(['.git', '.warpline'])` — exact-match, case-sensitive. This machine's filesystem is case-insensitive (verified directly). Aegis wrote `.GIT/hooks/post-commit` through the guard and **watched it fire on the next `git commit`**, clobbered `.git/HEAD` via `.Git`, and overwrote a real ledger via `.WARPLINE`. Also accepted: `.git ` (trailing space), `.git.`, `GIT~1`, and HFS-ignorable codepoints.

Reachability is not exotic: on a case-*sensitive* filesystem (Linux CI, Docker — i.e. much of a swarm) an agent creates `.GIT/hooks/`, and the strand is a legitimately sealed, correctly hashed, verify-clean carrier. It detonates on a macOS box.

*vs git:* fixed in 2014 as CVE-2014-9390, via `is_hfs_dotgit()`/`is_ntfs_dotgit()` and `core.protectNTFS`/`core.protectHFS`, both on by default. **Warpline's guard is the 2013 version of git's.**

### C-4 — A crash window heals itself into a permanent lie **[verified]**
*Trace F-1, corroborated by Judge item 7. Blast radius: silent, permanent, undetectable corruption.*

`seal.ts:145-147` does three unsynced writes — append, publish selvage, write ref. The comment reads *"lesser-evil crash ordering"*, so the window was known and accepted. Crash in it and the selvage lags the ledger tip.

`fabric verify` **catches this** — `chain-break … rolled-back tip`, exit 1. Correct. But the next `pick` derives `parentPickId` from the **ledger tip** while the CAS compares the **selvage** — both stale, so it passes. The new strand's `parentPickId` and `parentStateId` name **different parents**, and its delta is diffed against the wrong one (a symbol recorded born twice). `fabric verify` then reports **"all intact", exit 0 — permanently.**

Root cause verified: `strand.ts:140` documents the invariant *"parentStateId (always the ledger tip)"*, and **nothing anywhere enforces it**. Grepping every use, `parentStateId` is only ever written (`anchor.ts`, `admit.ts` ×3, `resolve.ts`, `pick.ts`) and declared — never compared. A documented invariant with no checker.

Fix: one assert in `sealState` before the append, plus a symmetric per-strand check in `verify.ts`. Structurally impossible on v3 — which holds zero live strands.

### C-5 — CLEAN admit silently destroys uncommitted work, unrecoverably **[verified]**
*Shield F-1. Blast radius: loss of work no copy exists of.*

`native.ts:674` calls `restoreTree` directly. Three amplifiers, each verified:
- **Blast radius is the whole merged tree**, not the merged paths — a file touched by neither side is overwritten too.
- **The default target is `repoRoot()`** (`cli.ts:627`, `daemon/server.ts:371,399`) — the human's own working directory.
- **There is no `--no-restore` flag on the CLI** (verified: zero matches in `cli.ts`), though `noRestore` exists in the daemon and MCP schemas. A CLI user cannot decline the write-back.

Shield inflated every object afterward: the clobbered bytes are in no blob. `propose` snapshotted *before* the edit; the write-back takes no snapshot of what it overwrites. No stash, no reflog, no undo verb.

**The guard already exists and is bypassed.** `restore.ts:60-68` implements the right policy. Same directory, same run: `warpline restore --to X` refuses "dest not empty"; `warpline fork --into X` silently overwrites.

*vs git:* aborts — *"Your local changes would be overwritten by merge."*

### C-6 — History truncation is completely undetectable
*Aegis S2. Blast radius: deniability — silent erasure of the accountability record.*

Tamper-evidence against **mutation** is real: six mutation classes (intent, actor, timestamp, parent link, middle deletion, reorder), six detections, exit 1 every time, on both a synthetic fabric and a replica of the live one.

Against **tail deletion** it does not exist. On a faithful copy of the live 64-strand fabric, Aegis cut to 26 strands and rolled the selvage back: `VERIFY 26 strand(s) — all intact`, exit 0. **59% of the record erased, zero evidence**, and the remainder is a fully operable base that new strands chain onto cleanly.

The chain authenticates that what is *present* is consistent; **nothing attests to how much should be there.** The one length attestation — the epoch anchor's `prefixCount` — covers only the v1 prefix and is itself a strand inside the file being truncated.

**The evidence to close this is already on disk and simply not consulted.** `config.json` has `stake auto: every-seal`; `refs/heads/warpline-stakes` and `.warpline/stakes/audit.jsonl` record a pickId per seal — a git-backed append-only journal of every tip this fabric has ever had. It is git's reflog. `verify.ts` never imports it.

*Current backstop worth stating:* `fabric.jsonl` is git-tracked, so **git is presently Warpline's anti-truncation control** — which evaporates in the git-absent world M1 promises.

### C-7 — Zero `fsync` in the entire package **[verified]**
*Trace F-3, Judge item 2.* `grep -rnE "fsync|fdatasync|O_SYNC" src` → **0 matches**.

`tmp`+`rename` is atomic against *process death*, not *power loss*: without an fsync on the tmp fd before the rename and on the parent directory after, the rename can reach stable storage before the data. The ledger append has none either. **"PICK sealed → exit 0" is a claim about the page cache.** Git has fsynced loose objects by default since 2.36.

---

## HIGH

- **C-8 — `git` errors are read as "file absent", and absent means DELETE.** *Jinx J-2/J-3.* `materialize.ts:136-138` `.catch(() => null)` on all three sides. A missing object, corrupt pack, EMFILE or ENOMEM all collapse to "does not exist on that side", and `resolveFile` deletes the file from the merged tree. Zero conflicts, sealed CLEAN. Same conflation at `git-exec.ts:285` defeats the NON_BLOB fail-closed guard, and at `stake-guard.ts:290` makes a **security guard whose failure mode is allow**. *The native path (`computeMergeNative`) is structurally immune — the git path is the default.*
- **C-9 — The R2 agent gate is dead twice, and the planned fix reaches only one break. [verified]** *Jinx J-4.* D-9 blamed the missing `WARPLINE_AGENT_ID`. There is a second, independent structural block: `pick.ts` contains **zero** scratch references, so `admit.ts:570` falls back to `readSelvage`, `baseId === selvageId`, and `admit.ts:129` short-circuits to FAST_ADMIT. Confirmed on live data — all 37 shadow verdicts are `{FAST_ADMIT: 22, NOOP: 15}`; KNOT, CLEAN, HELD and DANGLE **cannot occur on this path**. **Aegis's M-1 (export the env var) will not arm this gate.** Do not count it as shipped until a KNOT is observed on that path.
- **C-10 — Permanent agent wedge; the ladder loops and the exit verb does not exist. [verified]** *Arky D-D, reproduced organically during stress.* After a KNOT or a crash between `native.ts:668-670`, `admit` returns NOOP without clearing scratch and `fork` refuses with `next: [{verb:'admit'}]` — a closed cycle. `resolve` is HUMAN_ONLY. `native.ts:270` tells the agent *"Admit it first, or resolve/abandon it explicitly"* — and **there is no `abandon` verb anywhere in the codebase.** *vs git:* `git merge --abort` is always available and never human-only. An all-agent swarm halts on its first genuine conflict.
- **C-11 — `HUMAN_ONLY_VERBS` is a law on one skin and a suggestion on the other.** *Aegis S3.* Enforced at `daemon/server.ts:204`; the native CLI has no token, no principal, no gate. `warpline resolve` sailed past authorization and failed only on a missing argument. FG-1 rests on `resolve` being the act the security law forbids — that law holds for an agent on MCP and evaporates for an agent with a shell, which every coding agent has.
- **C-12 — `stake recover` leaves the fabric reporting itself corrupt. [verified]** *Shield F-3.* `stake.ts:729-734` is an if/else writing **one** of the two tip pointers; every other write path writes both. After a real rollback: `selvage` and `restore HEAD` disagree, and `fabric verify` exits 1 with a chain-break — immediately after the disaster-recovery verb. It self-heals on the next seal, but that window is exactly when a frightened operator decides whether to trust the tool. Tested only in its no-op shape.
- **C-13 — A torn tail line bricks every verb including the diagnostic.** *Trace F-2.* Proven reachable **without a crash** — a real `pick` on a full disk committed a 142-byte partial line; after freeing space, `log`, `selvage`, `restore`, `pick` and `fabric verify` all fail. No `fsck`, no `--skip-corrupt`, no repair verb. Recovery is hand-editing JSONL. Largest live fabric line: 307,905 bytes.
- **C-14 — The MCP bearer token is copied into every backup.** *Jinx J-11.* `backup.ts:122` excludes by **root basename only**; `.warpline/daemon/mcp.token` is two levels deep, so it is copied and hashed into the published manifest. `cli.ts:1337` and `backup.ts:33` both promise "secrets never travel". Tokens have no expiry and no revocation.
- **C-15 — Fixed `.tmp` names defeat the CAS they publish.** *Arky D-B, demonstrated.* `refs.ts:95`, `fabric.ts:139`, `scratch.ts:61` use a shared `${p}.tmp`. Two writers can interleave such that A renames B's value into place and returns success. *vs git:* per-ref `O_EXCL` `.lock`, never a shared staging name. Three-line fix; the pid+random pattern already exists at `object-store.ts:58`.
- **C-16 — Shadow refusals are masked as success.** *Jinx J-12.* `server.ts:368` nests the refusal at `result.result.refusal` while the probes at `server.ts:207` and `mcp/server.ts:236` test the outer object, so a shadow CLAIM_BREACH/KNOT returns `isError:false` and audits `ok:true`.

---

## MEDIUM and below (condensed)

Mutual exclusion is a **30-second wall clock with no heartbeat** and no notice to the victim (Arky D-C; `restoreTree` runs *inside* the lock, 1.7s measured for a 4,000-file merge). **~13-agent availability ceiling**, with lock-timeout and CAS refusals thrown as bare `Error`s rather than typed `refusal:v1` — mislabelled as `ENGINE`/transport through the daemon, inviting a thundering herd (Arky D-E). **Strands are never re-hashed on any live path** (Arky D-F) — the ledger is weaker than the object store here. **The shared worktree index** is an unlocked read-modify-write that grew to 54 MB / 308k entries in one stress run and never prunes (Arky D-G). **`restore` is non-atomic** — a partial tree persists after the fail-closed throw (Jinx J-15). **Raw ANSI injection** from attacker-authored `intent` in `warpline log` can overwrite Warpline's own labels (Aegis S4; `frameProse` has exactly one call site). **Bearer token accepted in argv** (Aegis S5). **`status` reports "clean", exit 0, over a bricked ledger** (Judge). **Trailing garbage on loose objects is undetected** and objects are written `0644` where git uses `0444` (Judge). **`objects verify` is weaker than the read path it polices** — parse-then-reserialize vs `readVerified`'s raw-frame recompute. **A byte-conflict KNOT reports an empty `contested` set** while the actionable data sits in a sibling field the refusal never points at (Judge) — which also makes the meaning-vs-byte thesis externally unobservable. **`agentId` sanitization collapses distinct principals onto one scratch ref** (Shield F-4). Several **structurally unreachable** mechanisms: `STALE_BASE` has zero producers, the stake deny-list is 100% dead, the trust floor is starved by legacy sidecar rows, `.warpline/f4/` has never been written.

---

## What is genuinely SOUND — and where Warpline beats git

Named deliberately: a refactor could quietly undo any of these.

**Solid:**
- **The object store is built to git standard and past it.** `readVerified` (`object-store.ts:78-91`) re-hashes raw framed bytes on **every** read and throws — git only verifies under `fsck`. Bit flip and truncation both caught; `restore` failed closed on both.
- **Tamper-evidence against in-place mutation is real** — six classes, six detections, on a replica of the live fabric.
- **Every ref write is tmp-then-rename.** The git repository-destroying truncate-then-write mode does not exist here.
- **The fabric lock is careful work** — `O_EXCL` acquire, owner-token release, steal-by-atomic-rename so exactly one stealer wins. 20 concurrent agents → 13 sealed, 7 clean timeouts, **0 corruption**.
- **CAS-before-mutation ordering is correct everywhere**, and the v3 per-ref CAS demonstrably catches a real race.
- **Backup round-trips byte-perfectly** — full `.warpline/` destruction and restore: 54/54 files identical, 9/9 strands verified. Deny-list inclusion, so new sidecars are protected by default.
- **git-absent restore is real** and can still seal new strands with `.git` deleted.
- **`admit` never writes to the user's worktree during merge** — that attack failed. Merges land in temp dirs.
- **Daemon auth is fail-closed throughout**; the `--operator` escalation attack failed; client-supplied identity is genuinely ignored, including nested `params.claim.agentId` forgery.
- **Path traversal proper is blocked** — `..`, absolute, backslash, drive-letter, NUL, symlink-through, hardlink-break all refused. C-3 is a normalization bug in the name lookup, not a failure of the byte writer.
- **The merge fails closed where it must** — binary-both-sides, symlink/gitlink, mode divergence, add/delete-vs-edit, token overlap.
- **`fork` is deliberately lock-free** optimistic design — the thing git's single index cannot do.

**Stronger than git:**
1. **The KNOT payload is a real artifact** — both canonical bodies, per-side attribution, blast radius, and a resolution envelope naming what `resolve` accepts. Git gives three markers in a file.
2. **Reasoning is in the permanent record** — `decidedBy`/`reason`/`contended`, content-addressed and chain-protected. Git's *why* lives in a PR thread on someone else's server.
3. **Merge bytes are re-derivable and verified** — `MergeRecipe` in native treeIds, with `merge.result === binding.treeId` enforced.
4. **`refusal:v1`** — a typed, prose-free, exit-code-mapped vocabulary shared verbatim by CLI, daemon and MCP. Git's error surface is prose and exit 1.
5. **Untrusted-prose envelopes** — agent prose is content-addressed and structurally excluded from verdict inputs. Git has no threat model for adversarial commit messages in an agent pipeline.
6. **Sealed work outlasts a reflog** — append-only, identity-CAS on rewrite, no gc, no 90-day clock, and `verify` proactively reports abandoned heads. Shield tried to make sealed work unrecoverable and **could not**.
7. **Stake is allowlist-by-materialization** — the exported tree is built from the object store into a clean temp dir. You cannot leak what you never copy.

---

## The operating-mode caveat

The live fabric is **64 strands, all serial, all anonymous, 15 v1 + 49 v2, zero v3, zero KNOTs, zero merges, zero agentIds** — and the multi-writer path is switched off.

So these verdicts hold **only because nothing has stressed them**: the entire lock (zero contentions ever), every CAS failure branch (64 serial seals means every CAS has always compared equal), all v3 protections (zero live strands), the concurrency model, the conflict path, and the auditability record. C-1 is *latent*: 11 CAS-blind strands already exist and are safe today only because two `pick` processes have never overlapped — while the hook that would overlap them is installed.

The one thing genuinely battle-tested is the single-writer serial seal path and `fabric verify`, with 64 real invocations behind them, which held under every attack mounted.

---

## Consolidated remediation

**P0 — before Warpline is anyone's sole custodian**

| # | Action | Why first |
|---|---|---|
| 1 | **`warpline refs migrate`** on the live fabric | One existing command. Downgrades C-1 from *permanent unrepairable corruption* to *reported abandoned head*. Highest value per unit of work in the entire audit, and the CLI already prints the instruction. |
| 2 | **Add `-z` to `changedPaths`** (`git-exec.ts:270`) | One word. Cardinal sin. Live on the default path. |
| 3 | **Normalize before the reserved-name lookup** (`snapshot.ts:505`) | Case-fold, strip trailing dots/spaces, reject `~1` shortnames, NFC-normalize. Apply in `snapshotDir` too so the name can never enter a tree. This is an RCE. |
| 4 | **Close the laundering** — assert in `sealState` that the selvage names the ledger tip; check `parentStateId` in `verify.ts` | An integrity break that heals into a permanent lie is worse than the break. |
| 5 | **Route the admit write-back and `fork --into` through `restore()`'s existing dirty guard**, and expose `--no-restore` | The guard is already written; two call sites skip it. |
| 6 | **`fsync`** the ledger append, loose objects, both ref renames, and parent dirs — or state the non-guarantee in the spec | "Sealed" is currently not a durability claim. |
| 7 | **`--root` / `WARPLINE_ROOT`** (D-7) | You cannot safely test, demo or onboard onto a system whose every command targets production. Cheapest item here. |
| 8 | **Distinguish "absent" from "failed"** in `materialize.ts:136-138` and `git-exec.ts:285` | Absent means delete. A bad disk sector should never be a merge decision. |

**P1**

`fabric repair` + `refs set` (detection without repair is a dead end a real crash will find) · agent-class **`abandon`** verb (unblocks F4; without it a swarm halts on its first conflict) · cross-check the **stake journal** against fabric membership to make truncation loud · pid+random the three `.tmp` names · CLI human-verb gate · exclude `mcp.token` from backups by full path · fix the shadow-refusal nesting · heartbeat the lock mtime and move `restoreTree` outside it · typed `LOCK_TIMEOUT`/`TIP_MOVED` refusals · project `merged.conflicts` into `refusal.contested` so a KNOT is never empty · `status` must read the fabric.

**P2**

Migrate the live fabric to v3, or stop crediting v3's guarantees · conservative gc/pack (today "nothing is ever deleted" is load-bearing *for* recoverability) · decide the replication question explicitly — one fabric, one disk, one manual backup verb is currently the top-line risk, and git's blast radius is bounded by replication that Warpline has no analogue for.

---

## Note on the new claims

Semantic adjudication rests on the essence hash and the lens. A **wrong CLEAN is a silent wrong merge** — a failure mode git cannot have, because git never claims to understand meaning. The mitigations are real and visible (`dependencyAdjacent` downgrades disjoint-set CLEANs to `confidence: 'independent'`, and the CLI prints the hedge). But the ground truth cited — the 6.2%/275 Guard base rate, the Move-3 pilot — calibrates a *detection* claim, not the *false-CLEAN* rate this write path now depends on. **Adding a guarantee git does not make means owning a failure mode git does not have.**
