# 31 — Arky: kernel linking (P8-R9), design and placement — 2026-10-17

Read-only pass over `docs/specs/gnomon.md` v3.4/3.5 (§1, §2–§5, §7.4, §9, §11.2, §15, §19–§22), TD-2026-10-14-735, lore L-2026-10-14-060023 and L-2026-10-17-080105, `packages/paradigm-mcp/src/utils/symphony-relay.ts` / `symphony-peers.ts`, and `docs/guides/symphony-quickstart.md`. The Paradigm MCP tools (ripple, wisdom, flow) were not reachable in this context; the ripple analysis below was done by hand.

## Conflicts R9 creates with the spec as written

- **A31-01. R9 reverses two §1 non-goals.** §1 lists "Not a second human … teleport" as non-goals. Research 07 §6 defines teleport as "resume on another machine". Handoff *is* teleport, and teammates *are* a second human. §1 has to be amended by a founder ruling, not by an edit slipped in quietly. §21's 8.1 item "signed log-segment exchange between colleagues' kernels" is partly pulled forward.
- **A31-02. Each machine is its own trust set today.** `ns = base32(sha256(rootPublicKey))[0..8]`, and the root key is non-exportable hardware. So the Mac, the PC and the home server will each have their own `ns` and their own `p:<ns>/ascend`. §3.1's Q1 ("several devices under one principal") covers several client devices on one kernel, not several kernels. **Recommendation: keep one `ns` per root.** Join the founder's own kernels with root-signed cross-signature rows (`grant.peer{relationship: self}`), not a shared namespace. Changing how `ns` is derived would move every principal id and `clientApiId`.
- **A31-03. Existing relays cannot be reused for auth.** Symphony's relay (`symphony-peers.ts:170-209`) pairs with a 6-digit code and HMAC-SHA256 keyed by `sha256(code)`. That proof can be brute-forced offline from one observed challenge and proof (10⁶ candidates). It also runs over plain `ws://` and binds every interface (`symphony-relay.ts:200`, `new WebSocketServer({port})`). The nevr.land relay is roadmap only (`symphony-quickstart.md:211-219`). Nothing is deployed. Reuse the UX shape (hub, pairing code), never the crypto.

## 1. Architecture

- **A31-04. A new kernel component `#peer-link` with an outbound-only transport child.** `gnomon-link` is a transport child like `gnomon-web`: it does sockets and framing only, under a new eighth sandbox profile `link` (outbound TCP to configured relay addresses, stdio to the kernel, no files, no keys, no exec). The kernel holds the keys, runs the handshake and parses plaintext frames. **Kernels never listen beyond loopback.** §11.2 rule 1 and §1's "nothing ever listens beyond loopback" stay true word for word. That is the strongest property on offer, and it is why there is no direct listener in v1.
- **A31-05. Reachability in v1 is a blind relay the founder hosts himself.** `gnomon-relay` is a small userland binary (separate package, zero deps). It is the only thing that listens. It forwards opaque, end-to-end-encrypted frames between kernels that are members. It holds a membership list of link-key hashes (root-signed rows the founder adds) and a size-capped encrypted store-and-forward area. The default host is the **home server**, reached over the LAN or over whatever overlay the founder already runs (Tailscale, ZeroTier, WireGuard). Gnomon dials an address and is agnostic to the overlay. nevr.land runs the same binary later for teammates who share no network.
  - Rejected: **WebRTC/ICE**, because it needs dependencies the kernel's zero-deps rule (`G-SEC-01`) forbids. **QUIC** is still experimental in Node. **Hole-punching** is more attack surface than a founder-only build justifies. **mDNS/DNS-SD** advertises presence to everyone on the LAN.
  - Discovery = the relay address recorded at pairing, plus a presence list on the relay keyed by link-key hash.
- **A31-06. Transport security is a Noise handshake with keys pinned at pairing.**
  - Steady state: `Noise_IK_25519_ChaChaPoly_SHA256` with static keys pinned at pairing. Pairing itself: `Noise_XXpsk3`.
  - Both are built from `node:crypto` primitives only (x25519, chacha20-poly1305, hkdf), so the zero-deps rule holds.
  - Must pass the published Noise test vectors (`G-LNK-11`).
  - The relay sees link-key hashes, sizes and timing. It never sees content, and swapping a key fails the handshake.
  - Alternative for Aegis: TLS 1.3 with self-signed certificates minted by the helper. `node:crypto` cannot create X.509 certificates without a dependency.
- **A31-07. A fifth key class: the link key.** It is X25519, stored in the OS keystore item `gnomon-link-key` behind the helper with the kernel key's custody rules (`partial` on Windows), and bound to `kernelKeyId` + `deviceId` by a root-signed registry row of kind `link`. It is rotated by `gnomon key rotate link`. It never signs anything. Kernel-key signatures stay the only assertion mechanism.
- **A31-08. The pairing ceremony needs root presence on both sides.**
  1. On A, `gnomon link pair` (root-signed CLI verb) shows a payload as QR or text: `{ns, kernelKeyId, linkPub, relay, psk(128-bit), expires: 10 min}`.
  2. On B, `gnomon link pair --accept <payload>` runs XXpsk3 through the relay.
  3. Both screens show a 6-word short authentication string (SAS) derived from the handshake hash. The human confirms the match on each side.
  4. Each side writes a root-signed `grant.peer{peerNs, peerRootKeyId, kernelKeyId, linkKeyId, relationship: self|teammate, scopes:[handoff.send|handoff.receive|cowork], maxAudience, until?}`.
  - Revocation: root-signed `grant.peer.revoke`. The next frame is refused and the relay membership row is dropped.
  - Agents can never pair. Calls from a kernel-spawned shell are refused per I3.
- **A31-09. How a remote kernel and its principals appear locally.**
  - A remote kernel is principal `p:<peerNs>/kernel` with a new reserved `principal.kind: peer`.
  - Remote sessions appear as `p:<peerNs>/s-…`. They are already namespaced, so nothing is renamed or aliased.
  - **A peer calls none of the 12 verbs.** It speaks only the closed link protocol `gnomon-link:v1` (A31-15). The `G-ABI-02` peer row is "✗" everywhere. The redaction class `peer` reads nothing from `log.read`.
  - A teammate's human principal never decides a local card: §3.4's `approve` is hardware-local.
- **A31-10. Ids that must not collide across kernels (ties to armada precondition (d)).**
  - Already safe: `hsid:v1:<ULID>`, `ev:`, `permit:`, `card`, `logId`, `connId`, `armId` (ULIDs), and `hsid:v1d` (derived from the namespaced principal).
  - **Unsafe: `hsid-short`.** It is used three times in the spec (branch names `gnomon/<hsid-short>`, worktree paths, session principal names) and its length is never defined. Two kernels pushing session branches to one remote can collide. Define it in M1.1 as ≥ 80 random bits from the ULID's random part, plus a uniqueness check at spawn.
  - **`turn:<hsid>/<n>`** must continue monotonically across a handoff: the target starts at the source's last `n` + 1.
  - **Paradigm's own ids** (TD random 1..999, history ids = line counts, sequential tasks) collide as soon as two kernels write `.paradigm/` in one repo. That is T-2026-10-14-001(d). **Handoff has one writer at a time and does not need (d). Same-repo co-work does.**

## 2. Handoff

- **A31-11. A session in transit (`handoff-bundle:v1`, content-addressed, encrypted to the target's link key):**
  - the source log segment for that hsid, signed by the source kernel, with a head-inclusion proof. It is stored on the target as a blob and referenced by a new `xev:<logId>:<evId>` ref scheme. It is never spliced into the target's chain.
  - the transcript, in one of two forms:
    - `resume`: the Claude Code jsonl, re-homed under the target's encoded cwd, then `--resume`. This is unverified across machines and across OS (path encoding, absolute paths inside tool calls), so it needs a probe.
    - `brief`: a userland-composed handoff note, injected as `session.inject{origin:'client'}`. The kernel still composes no prompts.
    - `gnomon-local` transcripts are Gnomon's own format and are portable.
  - the worktree, as a `git bundle` of `gnomon/<hsid-short>` relative to the base. Uncommitted work goes into a kernel-authored WIP commit on the session branch, never `main`. Gitignored files do not travel, and the spec should say so. The repo is matched by `repoId`.
  - **Warpline-mode sessions are refused** (`UNSUPPORTED`, reason `warpline-sync-absent`) until T-2026-10-14-003's bundle sync exists.
  - pending cards, as descriptors only.
  - the session metadata: `declaredModel`, `as`, `mode`, `policyHash`.
- **A31-12. What never travels:** permits, budget, cached unlocks, voice arms, `always` rules, grants, card decisions, Warpline tokens.
  - The target reserves a fresh permit under **its own** fuse and law 7. A teammate handoff spends the teammate's subscription; see question Q3.
  - The target re-raises pending cards with new ids, `causes:[xev:…]`, and its own human's presence. This also answers "cards that need the source human's presence": for own machines the same human decides on the target with the target's hardware key; for teammates the cards become the teammate's decisions.
  - Source cards close as `expired{reason:'handed-off'}`.
  - If the target cannot route the session's `model`, the accept step answers `MODEL_UNAVAILABLE` before anything moves.
- **A31-13. The protocol: seal first, then offer (works when the source machine goes offline).**
  1. **Offer.** The human on the source calls `session.stop{hsid, handoffTo: peer}` with fresh presence. The supervisor stops the child and writes `session.handoff.sealed{hsid, epoch, toKernel}` (kernel-signed). The session enters the new state `sealed`. The bundle is uploaded to the relay. The source laptop may now sleep.
  2. **Accept.** The target raises a `handoff` card. The human there decides `accept` with **fresh presence**.
  3. **Adopt.** The target verifies every hash and the seal signature, then performs a **custody compare-and-swap (CAS)** on the relay slot `custody/<hsid>`, moving the epoch from e to e+1. It logs `session.handoff.adopted`, re-mints the session principal `p:<nsB>/s-…` (hsid unchanged, `parent` = the source principal) and spawns.
  4. **Reclaim.** The source may take the session back only through the same CAS, with presence: `session.handoff.reclaimed`.
  - **Invariant C1: no kernel spawns an hsid without holding the highest custody epoch it has seen.**
  - A relay that misbehaves (an equivocating CAS) shows up as two signed claims at one epoch. On contact, both kernels stop and raise a `gate-class` card logged `link.custody.conflict`. Stated honestly: under a partition plus a lying relay this is detectable, not prevented.
  - Failure before adoption leaves the source's seal in place, and the source can reclaim. Transfer is chunked (1 MiB) and resumable by hash.

## 3. Co-work

- **A31-14. Co-work messaging lives in userland, so no new verb is needed.**
  - A first-party `#cowork-mod` on `mod-abi:v1` exposes `cowork.send` and `cowork.inbox` as tools through the `gnomon-mods` bridge.
  - The kernel adds one thing: the mod host can carry a `mod.command` to the **same mod on a paired peer** over the link, stamped `relayedFor{principal: p:<nsA>/s-…, kernel}` (host-stamped, never mod-asserted).
  - Message shape `cowork.msg:v1 {msgId(ULID), threadId, inReplyTo?, from{hsid, principal}, to{hsid | topic}, kind: note|request|result|ref, text ≤ 16 KiB, refs[], blobs ≤ 4 × 1 MiB, audience, sensitivity}`.
  - Delivery: at-least-once, deduplicated by `msgId`, ordered per (from, to). The outbox keeps 24 h / 1,000 messages. Receipt is logged as `modns.cowork.received`.
  - **The inbox is pull only.** A peer message reaches a model only when that model calls `cowork.inbox`. The bridge then logs `inject.receipt{requester, owner: p:<peerNs>/s-…, refs:[…]}` (L2, L7, matching `G-KNW-02`), wrapped as untrusted data (threat 4).
  - A peer cannot cause local spend. A human may forward a message as a `session.send` (logged with client origin).
- **A31-15. The link protocol `gnomon-link:v1` is closed at 10 frames:** `noise`, `caps`, `handoff.offer`, `handoff.chunk`, `custody.cas`, `handoff.decline`, `mod.frame`, `ack`, `ping`, `bye`. Its id `linkApiId` is frozen per release, like `modAbiId`.
- **A31-16. What may leave a kernel (L6):**
  - `secret` never leaves.
  - `sensitive` and `private` go only to `relationship: self`.
  - Teammates receive `team` or `org` only.
  - A teammate handoff therefore needs a fresh-presence `declassify` card. It lists the bundle's contents, runs the Doodle secret-scan patterns over the transcript, and either relabels the events or refuses.
- **Limits:** 60 messages per minute per session pair, 600 per hour per peer, a 4 MiB link frame cap, and a handoff bundle cap of 512 MiB.

## 4. Contract and ABI changes

- **A31-17. The verb count stays at 12 + 2.** The only verb change is `session.stop`'s optional `handoffTo` param, which the compatible-additive rule allows and which keeps stop's meaning. Accepting reuses `approve{accept|reject}`. Pairing is CLI only and root-signed.
- **Event kinds (kernel-owned `link.*`):** `pair.offered`, `paired`, `revoked`, `connect`, `disconnect`, `auth.fail`, `frame.refused`, `custody.conflict`, `routed{msgId, dir, peer, bytes}`.
- **New `session.*` kinds:** `handoff.sealed`, `handoff.adopted`, `handoff.reclaimed`, `handoff.aborted`.
- **Card kinds:** `handoff`, `declassify`, `peer-pair` (the GUI's SAS confirmation).
- **Refusals:** new gate `link`, used with `FORBIDDEN` (reasons `link-unpaired | link-scope | audience | custody-sealed | custody-conflict`) and `UNSUPPORTED` (reasons `warpline-sync-absent | transcript-unportable`). One new code, `PEER_UNREACHABLE` (−32040, retry-later).
- **G-ABI-02:** add the peer row (✗ on every verb) and a `handoffTo` case (human only).
- **Falsifiers:**
  - `G-LNK-01`: no listener off loopback on any kernel, both OS.
  - `G-LNK-02`: an unpaired or swapped key fails before any plaintext frame is parsed.
  - `G-LNK-03`: no `grant.peer` without root presence on both sides, and a SAS mismatch aborts.
  - `G-LNK-04`: fault injection at every handoff step never yields two live children for one hsid.
  - `G-LNK-05`: none of the items in A31-12 cross.
  - `G-LNK-06`: audience rules hold.
  - `G-LNK-07`: every model-visible peer byte has an `inject.receipt`.
  - `G-LNK-08`: the peer row is refused on every verb.
  - `G-LNK-09`: revocation takes effect within 1 s.
  - `G-LNK-10`: rate and size limits hold.
  - `G-LNK-11`: Noise test vectors pass.
  - `T-LNK-01`: handoffs per week and resume success rate.
- **New nodes:** `#peer-link`, `#cowork-mod`, `$session-handoff`, `$kernel-pairing`, `^peer-paired`.

## 5. Placement

- **A31-18. Dependencies:** M1.2 (blobs, signatures), M1.3 (link key, cross-sign rows), M1.4 (`status.links`, the `handoffTo` param), M1.6 (cards), M1.7 (seal and spawn), M1.9 (idle exit: the link connection must **not** hold the daemon open; offers wait on the relay), M1.11 (mod host). Nothing in Move 2's contracts is needed. Co-work in one repo also needs T-2026-10-14-001(d).
- **Earliest honest slice: M2.8, "own-machines handoff".** It can start once Move 1 has passed, in parallel with M2.1, as Move 4 and M3.7–3.9 already do. Scope:
  - Mac ↔ PC ↔ home server only (`relationship: self`), through the home-server relay over LAN or the founder's overlay;
  - git-mode and `none`-mode sessions, local and Claude backends;
  - `brief` always available, `resume` if the probe passes.
- **M2.9** is co-work for the founder's own machines, in different repos or after (d) lands.
- **M2.10** is teammates (declassify, the nevr.land relay), behind Q2 and Q3.
- **Probes to add to M1.0:**
  - transplanting a Claude transcript plus `--resume` across machines and across OS;
  - Noise over `node:crypto` against the test vectors;
  - Windows outbound-only enforcement for the `link` profile.
- **A31-19. Reserve in M1.1 so `clientApiId` does not move:**
  - card kinds `handoff | declassify | peer-pair`;
  - session state `sealed`;
  - `principal.kind: peer`;
  - refusal gate `link`, its reasons, and the `PEER_UNREACHABLE` code;
  - the kernel-owned `link.*` namespace;
  - ref schemes `xev` and `peer`;
  - the `session.stop.handoffTo` param;
  - `status.links{peers[], relay, custody[]}`;
  - redaction row `peer`;
  - registry row kind `link` and `grant.peer`;
  - the `hsid-short` definition;
  - the turn-continuity rule.
  - `linkApiId` is new and has its own id, so it never touches `clientApiId`.

## 6. Founder questions (minimum)

1. Amend §1: are teleport (handoff) and a second human (teammates) now in 8.x scope? Do teammates run 8.0 installs, against P8-D1 "8.0 is for the founder"?
2. Is the relay a box you host (the home server, recommended), or should Gnomon wait for nevr.land? Do you already run Tailscale or another overlay?
3. When a session is handed to a teammate, their subscription pays and their law-7 scan governs. Is that acceptable, given OPEN 7 (Anthropic's terms)?
4. Is Warpline-mode handoff deferred until Warpline sync (T-003) exists, or should T-003's bundle protocol be pulled forward?
