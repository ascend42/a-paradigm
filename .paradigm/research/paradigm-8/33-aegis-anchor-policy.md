# 33 — Aegis: kernel-log head-anchor write policy — 2026-10-17

Evidence: `packages/gnomon/probes/results/p-log-fsync.darwin.json` (M4, APFS, 3×10⁵ rows, 15 checkpoints).

| arm | p99 ms | p99.9 ms | >5 ms |
|---|---|---|---|
| A raw | 0.060 | 0.085 | 0.016 % |
| B rename/commit | 1.217 | 7.72 | 0.94 % (2 % per 50k after row 150k) |
| C pwrite/commit | 0.124 | 7.84 | 0.41 % |
| D rename/64 | 0.143 | 0.178 | 0.006 % |
| E rename/50 ms | 0.067 | 0.231 | 0.016 % |
| F rename, subdir | 7.181 | 7.70 | 1.44 % |

**Addendum (orchestrator, after review).** Aegis flagged that two figures in the brief did not appear in the committed run 1 file: the "p99.9 ≈ 7.8 ms floor for all arms" and "B p99 7.2 ms". Both come from the replicate runs. Those are now committed:
- `p-log-fsync-rep2-reversed.darwin.json` (order F→A): A p99.9 7.79, B p99 7.145 / 4411 >5 ms, D 7.78, E 7.71.
- `p-log-fsync-rep3-interleaved.darwin.txt`.

So the stalling-state p99.9 floor is real across all arms in some runs, raw SQLite included. Run 1 caught the machine mostly in its quiet state. S33-07 and S33-08 stand. G-LOG-04 must report p99.9, not assert it.

## Threat

**S33-01 — Truncation needs no key.** If you delete tail rows, every row that remains still hashes, chains and verifies. Only an anchor catches it. The attacker is a same-user process running outside the sandbox: user malware, or a session that escaped through LaunchServices (§A.2(i)). It stops the kernel (it can signal it, §A.2(ii)), drops rows K+1…N, and restarts the kernel. A sandboxed session can kill the kernel but cannot write `~/.gnomon`, and a kill loses nothing because commits use `synchronous=FULL`.

**S33-02 — The file anchor never stopped that attacker.** The attacker can rewrite `~/.gnomon/head` as easily as `kernel.db`. Against an adversary it does nothing. Against accidents it matters: backup restore, partial copy, crash lag. Coalescing it costs no security. The real anchor is `gnomon-head` in the helper's access group, which only the D68-signed kernel can reach. That gives `full` custody on macOS and `partial` on Windows, where Credential Manager is writable by any same-user process.

**S33-03 — Per-commit anchoring never meant zero exposure.** The anchor is written after COMMIT. An attacker who watches `kernel.db` can SIGSTOP the kernel in that gap. Today `#checkAnchor` accepts any lag, so every row after the last keystore anchor can be dropped without detection. Exposure is closed only when the effect waits for the anchor.

**S33-04 — What deleting the tail buys an attacker:**
- `approval.decide` / `approval.suspect`: wipes the evidence that falsifier §20.10 and §A.1 rely on.
- `approval.rule.learned`, `key.*`, `grant.*`, `config.*`, `manifest.*` decisions, `billing.*`, `approval.voice.arm`, `link.*` pair/revoke: hides standing changes. The rows are root- or approval-signed, so they can't be forged, but they can be erased.
- `session.inject{origin:'peer'}`: breaks L2 for peer bytes.
- `socket.auth.theft`: hides the theft signal.
- `permit.*`: rolls back fuse accounting. That's bounded, and the fuse is a safety rail, not a security boundary.

## Policy

**S33-05 — Coalesced bulk anchoring (arms D+E):**
- File anchor (tmp+rename): written when 64 rows or 50 ms have passed since the first un-anchored row, whichever comes first, and on idle checkpoint. Durable at genesis, rotation and close.
- Keystore anchor: every 1024 rows or 1 s, written asynchronously off the append path. This cadence is provisional until P04 measures XPC + SecItemUpdate cost. Securityd writes to the same APFS volume and may amplify stalls the same way the rename does.
- pwrite in place: rejected. It isn't atomic (a torn head is read as malformed and raises a false INTEGRITY_BROKEN), and it still stalls in arm C (p99.9 7.84 ms).

**S33-06 — Forced anchoring for critical kinds.**
- **The list:** `approval.decide`, `approval.suspect`, `approval.presence.denied`, `approval.rule.learned`, `approval.voice.arm|disarm`, `key.*`, `grant.*`, `config.*`, `manifest.*` (decisions), `billing.*`, `verdict.*`, `link.*` (pair/renew/revoke), `session.inject{origin:'peer'}`, `socket.auth.theft`.
- **Sequence:**
  1. Commit with `F_FULLFSYNC` for that one transaction. Otherwise a power loss can leave the anchor ahead of the db, which the log reads as `truncated`.
  2. Write the file anchor and the keystore anchor synchronously.
  3. Only then return to the caller and release the effect (run the tool, issue the card result, apply the grant).
- An attacker who stops the kernel before step 3 has erased a decision that never took effect. That is harmless.
- **Budget:** about 10 ms for the critical class (`fullfsync` ~10 ms p50 per the kernel-log.ts header), against ≥ 300 ms of Touch ID that already precedes a decision. These kinds happen at human speed. Bulk p99 stays inside the measured envelope while forced anchors stay at or below 1 per 64 appends (the arm D rate).
- **Telemetry:** report `status.log.forcedAnchorRate`. Above 1/64 over any 10⁴-row window, it's outside the measured envelope; re-probe.

**S33-07 — Bounded lag on open:**
- File-anchor lag above 63 rows, or any lag after a clean close (close writes a durable anchor), ⇒ `INTEGRITY_BROKEN{anchor-lag}`.
- Keystore lag above 1023 rows ⇒ append a kernel-signed `daemon.anchor.lag{rows, which}`, shown in `status`.
- Keystore anchor ahead of the db ⇒ `truncated`, as today.

## Spec text

**§3.2, replacing "Chain head … written after every commit":**
"Chain head `{seq, hash, at}` is written to `~/.gnomon/head` within 64 rows or 50 ms of a commit, whichever comes first, and to the OS keystore item `gnomon-head` within 1024 rows or 1 s. Both are written durably at genesis, rotation and close. For a critical kind (list) the commit uses F_FULLFSYNC, both anchors are written before `append` returns, and no effect of that event is released before then. On open, a file anchor lagging by more than 63 rows, or lagging at all after a clean close, ⇒ `INTEGRITY_BROKEN{anchor-lag}`. Only the keystore anchor resists a same-user writer. The file anchor detects accidents."

**§A.1, new item (g):**
"A same-user unsandboxed process can SIGSTOP the kernel and delete up to the last 1023 non-critical rows (≤ 1 s) on macOS without detection. On Windows (keystore `partial`), or with the helper absent, it can delete any number. Critical kinds are anchored before their effect, so they can be erased only before they take effect. Revisit: P04 cost data, or any second human."

## Falsifiers

**S33-08 — Falsifier changes:**
- **G-LOG-04:** 10⁶ appends with critical kinds mixed in at 1/64: bulk p99 < 5 ms, and at most 0.1 % of appends over 5 ms (6× headroom over arm A; arm B fails at 0.94 %). Critical-class p99 < 25 ms. Report p99.9, max and checkpoint count; don't assert them, because max reaches 13–529 ms in every arm.
- **G-LOG-06:** add a case where file-anchor lag above 63 rows, or any lag after a clean close, ⇒ INTEGRITY_BROKEN. Add a case where truncating below the keystore anchor ⇒ `truncated`.
- **G-LOG-10 (new):** for each critical kind, stop the kernel at the first instruction after `append` returns, then truncate the db by one row. Open must report `truncated`. Also: no broker effect can be observed before both anchor writes complete (sequencing probe on the tool-release path).
- **Falsifier §20.9:** wording becomes "bulk append p99 > 5 ms or > 0.1 % over 5 ms at 10⁶ rows".

**S33-09 — Probe follow-ups:**
- Add arm G to `p-log-fsync` (D+E plus forced F_FULLFSYNC + anchor at 1/64) before G-LOG-04 is re-cut.
- Add arm H (keystore via helper) once P04 lands.
- Re-run at 10⁶ rows. B's slow rate grows with db size, so 3×10⁵ understates it.

## Addendum — S33-10: critical-commit durability (D83)

Evidence: arm G (`p-log-fsync-armG-1e6.darwin.json`) put critical commits at p50 56 ms, p99 490 ms and max 1.7 s, which fails the 25 ms budget. Bulk p99 stayed at 0.27 ms. The 1/s comparison sets the final numbers.

**What each mechanism guarantees (Apple Silicon internal SSD, APFS):**

| mechanism | process kill | kernel panic | power loss |
|---|---|---|---|
| commit, no extra flush (`synchronous=FULL` ⇒ fsync(2) on WAL) | safe (survives once write() returns) | probably safe; whether the SoC storage controller's cache survives a panic reset is unverified | neither durable nor ordered; the drive cache may write back in any order |
| F_BARRIERFSYNC | safe | safe | ordered prefix, not durable. Upstream SQLite has no path to it, and libuv's `fs.fsync` uses F_FULLFSYNC first, so it is effectively unreachable |
| F_FULLFSYNC | safe | safe | durable, and implies ordering |

The commit already uses fsync(2), so "plain fsync" and "no extra flush" are the same arm for the commit.

**Which threat this serves.** The S33-01..03 adversary is a same-user process. It reads the page cache, and it can SIGSTOP, kill and truncate. It cannot cut power or cause a panic. The rule "no effect before the anchor" is a **visibility ordering** property: the commit returns, then the keystore write is awaited, then the effect is released. Program order already provides this; no disk flush adds anything against this adversary.

Power-loss correctness is a separate **consistency/availability** property: a durable anchor should never be ahead of the durable db. D82 never fully had it. Bulk keystore anchors (1/s, written after fsync(2)-only commits) can already persist ahead of a lost WAL tail, and F_FULLFSYNC on critical rows alone does not remove the false-`truncated` mode. Securityd's own flush might order our earlier WAL writes, but nothing guarantees it. Verify in P04.

**Anchor durable, db commit lost.** After a power loss or panic the keystore anchor is at seq N, the db head is below N, and open reports `truncated`. A same-user attacker who kills the kernel, truncates, and waits for the next reboot produces the same on-disk state. **The cause can be classified but must never downgrade the verdict.**

**Recommendation (P8-D83):**

1. **Mechanism:** critical commits use the bulk durability (`synchronous=FULL`, no `PRAGMA fullfsync`). Sequence: commit, then file-anchor rename, then **awaited** keystore write, then release the effect. F_FULLFSYNC stays only under the opt-in `durability:'power-loss'`, plus genesis, rotation and close.
   Decision rule: if the 1/s arm shows F_FULLFSYNC p99 < 25 ms, the stronger variant is acceptable *only* as "flush before every keystore write": one F_FULLFSYNC on any fd on the volume (it flushes the whole drive cache), run inside the serialised keystore writer for bulk and critical alike. Adding it only to critical rows costs latency and does not close the bulk false-alarm mode.
2. **Open-path rules:**
   - Every anchor records `boot` = `kern.bootsessionuuid` (helper-supplied boot id on Windows). Only the keystore copy is authoritative, because a same-user process can rewrite the file anchor.
   - Keystore ahead of db, **same boot** ⇒ `INTEGRITY_BROKEN{truncated, cause:'tamper'}`. No power loss can have happened.
   - Ahead, **different boot**, file anchor not `closed` ⇒ `INTEGRITY_BROKEN{truncated, cause:'unclean-reboot'}`. The log still refuses appends. Recovery is presence-gated and appends a kernel-signed `daemon.log.gap{lostFrom, lostTo, lostHash, bootPrev, bootNow}`.
   - Ahead after a `closed` anchor ⇒ `tamper`. A clean close is durable.
   - Optional: critical anchors carry `kind`, so the gap row can name what was lost.

**§3.2, replacing the D82 critical sentence:** "For a critical kind (list), `append` resolves only after the commit, the file anchor and the keystore anchor have completed, in that order, and no effect of the event is released before then. This is an ordering guarantee against a same-user process, not a power-loss guarantee. Each anchor records the boot session. On open, a keystore anchor ahead of the db is `INTEGRITY_BROKEN{truncated}`, with `cause` `tamper` if the boot session is unchanged or the last anchor was a clean close, and `unclean-reboot` otherwise. Neither cause is accepted silently. Recovery requires presence and appends a signed `daemon.log.gap`."

**Falsifiers:**
- **G-LOG-04:** bulk clauses unchanged at 10⁶ rows. The critical class is measured at **1/s for ≥ 600 events**, interleaved with bulk background load: p99 < 25 ms; report p99.9 and max. The 1/64 sustained mix (arm G) stays as a reported stress figure, not asserted.
- **G-LOG-10:** unchanged (the security property), plus one assertion: the keystore write starts only after COMMIT returns.
- **G-LOG-11 (new), power-loss classification by fixtures:**
  - (a) keystore ahead, same boot ⇒ `truncated/tamper`
  - (b) ahead, different boot, not closed ⇒ `truncated/unclean-reboot`, appends refused
  - (c) ahead, different boot, closed ⇒ `tamper`
  - (d) a forged `boot` in the file anchor alone changes nothing
  - (e) ack ⇒ exactly one signed `daemon.log.gap`, and the chain verifies across it
  - Manual (release candidate): one hard power cut on a desktop Mac at 1/s critical load; record which cause is reported.

**To verify before the spec adopts this:** panic survival of the storage-controller cache; securityd's flush behaviour (P04); libuv on Darwin using F_FULLFSYNC; `kern.bootsessionuuid` reachable without new deps (spawn `/usr/sbin/sysctl` once at open, or helper-supplied). Comment drift to fix with the change: the `kernel-log.ts` header (lines 60–62) claims a power loss can never leave an anchor ahead of the db, which is false for bulk keystore anchors. Minor correction to S33-01: surviving a kill comes from write() completing; `synchronous=FULL` matters for OS crashes.
