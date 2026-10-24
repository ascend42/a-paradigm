# 32 — Aegis: kernel linking (P8-R9) threat model and constraints — 2026-10-17

Read: §2, §3.1–3.4, §4.1–4.2, §4.9, §5, §9.1–9.3, §11.2, §12.3–12.5, §14.7, §15, §19.1, §21 and §A of spec v3.4, plus reviews 22, 25, 26 and 30, T-2026-10-14-001 and the P8-R9 lore entry. Read-only; nothing was run.

**Verdict.** Linking can be built without redesigning anything, but only if it is a **new peer protocol through a separate transport child**. It must never be a wider `#web-endpoint` or socket, and it must never reach the 12 verbs. Three things are critical because they get expensive to retrofit:
- Identity across kernels: the 40-bit `ns` is not an identity.
- Handoff fencing.
- Correct `audience`/`sensitivity` labels from Move 1 on, because the egress filter can only be as good as those labels.

## 1. Findings

**S32-01 [C] The link is a separate protocol, never a widened endpoint.** §11.2 rule 1 (127.0.0.1 only, no address field) and the 0600 socket stay as they are.
- Linking adds `gnomon-link:v1`. It has its own closed message set: `hello/auth`, `cowork.msg`, `handoff.offer|accept|abort|ack`, `revoke`, `ping`.
- A peer is never a `gnomon-rpc:v1` client. It cannot call `log.read`, `ref.resolve`, `status`, `session.*`, `permit.*`, `approve` or the `mod.*` relays.
- Rationale: every verb row in §5 assumes a principal from the local trust set. A remote principal reaching any of them is a confused deputy by construction.

**S32-02 [C] `ns` is grindable, so it cannot identify anyone across kernels.**
- `ns = base32(sha256(rootPub))[0..8]` is 40 bits. With point addition plus a hash per try, about 2^40 tries is hours of GPU time, so an attacker can mint a root whose `ns` equals the founder's. Then `p:<ns>/ascend` collides.
- Fix: inside the kernel, compare every foreign principal by its **full `rootKeyId`** (`gkey-p256:v1:<sha256(spki)>`). Show `ns` for display only, and always qualify it, e.g. `p:<ns>/ascend@<rootKeyId8>`.
- A principal whose root is not the local root is never matched against the local trust set (I5).

**S32-03 [C] Handoff: split brain and replay.** Each Secure Enclave root is per machine, and an `hsid` is kernel-issued.
1. The target **mints a new hsid** with lineage `derivedFrom{logId, hsid, epoch}`. Two kernels never own the same hsid.
2. The source **seals before the bundle leaves**:
   - stop the child with the control-message interrupt;
   - append the kernel-signed `session.handed-off{hsid, epoch, to:<peer linkKeyId>, bundleHash, headSeq}`;
   - from then on, refuse `session.send` on that hsid with `FORBIDDEN{gate:'link', reason:'sealed'}`.
3. The bundle is signed by the source over `{bundleId (ULID), sourceLogId, hsid, epoch, targetLinkKeyId, nonce from target's offer-ack, expiresAt, contentHashes[]}`. It is single-use: the target records consumed `bundleId`s.
4. The source may reclaim only after a signed `handoff.abort` from the target, or after timeout plus a fresh-presence card on the source.
5. Pending cards on the source are expired deny-direction. They are re-raised on the target, never carried over as decided.
6. To check in a probe: whether Claude Code's `--resume <uuid>` on two machines forks the transcript (or whether a fork flag exists). Two continuations of the same conversation uuid must be impossible, not just discouraged.

**S32-04 [H] Pairing: phishing and MITM.** `gnomon link pair` is a **root-signed, human-only verb** (I3).
- It is refused from kernel-spawned shells, and it is **never stageable by an agent**. Mods can be staged; pairing must not be, so that injected text like "pair with X" can never produce a card.
- The ceremony:
  - an outbound invite code exchanged out of band (a PAKE such as CPace/SPAKE2, 128-bit-equivalent after the PAKE);
  - a **6-digit SAS** derived from both link keys, both rootKeyIds and the transcript hash, compared on both screens;
  - fresh root presence on **both** sides;
  - the requested **scope** shown on both cards;
  - the peer's self-asserted name shown as unverified.
- The result is a root-signed `grant.link{peerRootKeyId, peerLinkKeyId, scope, expiresAt}` on each side.

**S32-05 [H] Prompt injection carried across kernels.** Co-work messages and handed-off transcripts are untrusted content, and possibly content a peer session was itself injected with.
- Every peer byte a model sees is logged before the read as `session.inject{origin:'peer', peerRootKeyId, linkId, hash, bytes}` (L2), wrapped in a provenance envelope, and labelled `peer:<name>`.
- The receiving session becomes **sticky-tainted** `peer`.
- Cards it raises carry the flag `peer`. That makes them voice-ineligible through §14.7's flag rule, and `always` is refused on them.
- For **teammate** links, `tool.permission` cards in a tainted session also need fresh presence (no cached unlock).
- Residual: the reading model (§15.1 row 4).

**S32-06 [H] Cross-kernel confused deputy, spend and law 7.**
- A peer can never:
  - reserve a local permit;
  - cause a `claude` spawn;
  - request `api-token`, `fallback-cloud` or `resume`;
  - reach `mod.command` or `knowledge` federation;
  - trigger a presence prompt directly. Prompt-bombing is MFA fatigue.
- An inbound message is **queued, not delivered**. Delivering it into a turn draws on a local, human-granted `grant.link` budget (law 5: zero by default, so an attended human sends it on).
- Permits are bound to the issuing `logId` and are never transferable.
- On handoff, the target runs its own law-7 preflight and its own `layersHash`/`gitHash`; any difference is gate-class.

**S32-07 [H] Leaks on egress: secrets and founder-only events.** There is one egress filter. The defaults, by scope:

| Scope | Events that may cross |
|---|---|
| teammate | only events explicitly addressed to the link **and** `audience ≥ team` |
| own machine | `private` allowed |
| every link | never `secret`; never `sensitive` without the handoff card listing it |

- L6 forbids relaxing labels in place, so a handoff to a teammate is a **projection**:
  - the source human sees a manifest card (fresh presence) listing the transcript, blobs, files and their sensitivity;
  - a secret-scan pass runs (best effort);
  - redactions are recorded.
- Keys, tokens, `grants.jsonl`, Warpline credentials, session keys, cached unlocks, voice arms, handles and challenges, the kernel head anchor and `~/.claude` credentials **never** cross.
- The target mints its own session key and borrows its own roster credential (I1).
- Session lists, card stacks and `status` are not shared. Even presence ("which sessions exist") is opt-in metadata.

**S32-08 [H] Own machine is not the same trust set.** Each machine's root is a non-exportable Secure Enclave or TPM key, so the founder's laptop and desktop are two `ns`es.
- An own-machine link is a **scoped cross-attestation**: each root signs `grant.link{scope:'self'}`. It is never a merge, and a peer root never becomes a signer of local registry or grant rows in 8.0 (I5 unchanged).
- §21's "cross-signed roots" must not be pulled forward as a shortcut.

**S32-09 [H] Transport placement and end-to-end security.**
- A `gnomon-link` transport child runs under a new `link` sandbox profile: network, no keys, no home, no exec. It moves opaque, length-prefixed ciphertext only.
- **The kernel** runs the handshake (Noise XX/IK via `node:crypto`: X25519, Ed25519, ChaCha20-Poly1305, HKDF; still zero dependencies), so plaintext and keys never sit in the network-facing process.
- A new key class, the **link key**: Ed25519, held in the keystore behind the helper like the kernel key, with a root-signed registry row and a domain-separated signature (`gnomon:link-auth:v1`).
- It is rotatable and revocable without touching the kernel key, and compromising it does not allow forging kernel events.

**S32-10 [M] A stolen machine or a teammate gone rogue.**
- Link grants are **short-lived** (default 30 days, renewed with presence). Revocation is a root-signed `link.revoke` that drops connections immediately and is pushed to the peer as best effort.
- A thief still needs presence on the stolen root to pair anew. Note that `.userPresence` falls back to the login password, so the probe should test `biometryCurrentSet` for link verbs.
- Inbound handoffs always need fresh presence on the target, so a thief or rogue peer can offer but never run.
- A rogue teammate keeps everything already sent. Revocation is not retroactive.

**S32-11 [M] Rate limits and DoS.**
- Pre-auth: handshake attempts per source and a connection cap that never evicts an authenticated link (mirrors §11.2 rule 8).
- Post-auth, per link: messages per minute, bytes per day, handoff offers per hour, peer-caused cards per hour.
- Exceeding a limit pauses the link with `link.paused` and a card. Nothing is auto-decided.

**S32-12 [M] Teammate handoff moves the Claude conversation onto another person's subscription.** That is OPEN 7 (terms) plus law 7.
- Teammate handoff stays off until OPEN 7 resolves.
- Own-machine handoff stays on the founder's subscription.

**S32-13 [M] Ids and refs.**
- Every id that crosses must be globally unique: ULID or log-qualified (`connId`, `cardId`, `permitId`, `armId`, `turn:` included).
- Peer ids are resolved only under `peer:<logId>/…` and never dereference a local object.
- T-2026-10-14-001(d) (TD/L/h ids) must land before decisions or lore are exchanged.

**S32-14 [L] Discovery and metadata.**
- mDNS/DNS-SD is a **hint only**. Identity is the pinned link key, and poisoning yields at most a failed handshake.
- No mDNS advertisement by default. Advertise `gnomon-link` with no names or sessions in TXT records.
- `link.*` is a kernel-owned namespace: `paired, revoked, connected, auth.fail{reason}, msg.in|out{hash, bytes, audience}, handoff.offered|sealed|accepted|aborted|completed, paused, rate`.

## 2. What may never cross a link

`approve` in every form, root verbs, grants, every key or token, the api-token, permits, cached unlocks, voice arms, handles and challenges, presence prompts, `secret` events, mod relays, knowledge queries, `log.read`/`status`.

## 3. Transport constraints (relay, direct, overlay)

These apply to every option:
- The kernel's end-to-end layer is the security. The transport is defense in depth only.
- Mutual authentication against pinned link keys, forward secrecy, per-session counters (replay), fail closed, no unauthenticated fallback.
- The transport child holds no keys.
- There is no inbound listener on a public interface by default.

By option:
- **Direct LAN:** bind to named interfaces only, and only while a link is enabled. The Windows firewall rule needs an install-time admin step (§16).
- **Relay (nevr.land):** **untrusted** for confidentiality and integrity.
  - It sees who talks to whom, when, and sizes. It may store ciphertext with an expiry.
  - Drops are detected by acks.
  - The relay account is not an identity, and the relay can neither pair (PAKE + SAS) nor replay (nonces + consumed ids).
- **Overlay (Tailscale/WireGuard):** acceptable as a pipe. The tailnet IP and the coordination server are **not** identity (the coordinator can add nodes unless tailnet lock is on), so the kernel's end-to-end layer still runs on top.

## 4. Falsifiers to add

- `G-LNK-01` A peer connection calling any `gnomon-rpc:v1` verb or relay is refused. `G-ABI-02` gains a `peer` row: every verb refused.
- `G-LNK-02` A root ground to the same `ns` with a different `rootKeyId` is refused at handshake and never matches a local principal.
- `G-LNK-03` A replayed bundle, an expired one, or one addressed to another target is refused. After `handed-off`, the source refuses `session.send`. A crash mid-handoff leaves at most one live continuation.
- `G-LNK-04` Pairing without presence on both sides, from a kernel-spawned shell, or as an agent-staged request is refused. A MITM'd handshake shows mismatched SAS.
- `G-LNK-05` Every peer byte a model sees has a prior `session.inject{origin:'peer'}`. Cards from a tainted session carry `peer`, are voice-ineligible, and refuse `always`.
- `G-LNK-06` A peer cannot cause a permit grant, spawn, presence prompt, or `api-token`/`fallback-cloud` card. An inbound message spends nothing without a link budget.
- `G-LNK-07` An egress fixture with `secret`, `private` (teammate scope) and `sensitive` without a manifest yields zero bytes on the wire. Seeded secrets in a transcript are redacted or block the handoff.
- `G-LNK-08` After revocation or expiry, the next frame is refused within 1 s.
- `G-LNK-09` A relay that tampers, reorders or replays ciphertext is detected and the link drops. The relay never holds plaintext.
- `G-LNK-10` The `link` profile cannot read keys or home, or exec.
- `G-LNK-11` Rate limits pause the link and never evict an authenticated link.
- `G-LNK-12` Spoofed mDNS yields no connection to a non-pinned key.

## 5. Honest limits for §A (new §A.5)

- A paired peer is a trust relationship. A teammate can lie, and injection carried across kernels rests on the reading model.
- Secret scanning is best effort.
- Data sent is the recipient's. Revocation is not retroactive, and the recipient kernel's redaction is their kernel's honesty, not ours.
- SAS comparison rests on human diligence.
- A stolen machine whose login password is known can act within its link-grant lifetime.
- A relay sees metadata.
- Windows `kernelKeyCustody: partial` extends to the link key. **Teammate links require `full` link-key custody.**

Revisit trigger: the first teammate pairing.

## 6. Must be true in Move 1 (cheap now, a redesign later)

1. Keep §11.2 rule 1 and the socket ACL as they are. Add a sentence saying linking will be a separate transport child under its own profile.
2. **Label correctly from day one.** `turn.event` bodies, `session.inject`, `approval.request.tool_input` and oracle evidence default to `sensitive`, and every kind gets a default in the §9.1 table. An all-`normal` Move 1 makes every future egress filter leak.
3. Principal comparison by full `rootKeyId`, never `ns`. The principal parser accepts foreign roots without treating them as local.
4. ULID or log-qualified ids for `connId`, `cardId`, `permitId`, `armId` and turns. Permits are bound to `logId`.
5. Reserve these in `gnomon-contracts` (the one-release-ahead rule, A26-11):
   - principal kind `peer`, key kind `link` (closed-kind registry posture);
   - card kinds `link-pair`/`handoff-accept`, flag `peer`, `via: link`, refusal gate `link`;
   - `session.inject.origin:'peer'`, session state `handed-off`, `session.derivedFrom`;
   - the kernel-owned `link.*` namespace;
   - a `peer` row in the §9.3 matrix (nothing by default).
6. The session profile denies reads of the future link keys and pin store (`~/.gnomon/keys/**` already covers them if they live there; keep them there).
7. T-2026-10-14-001 (a) S1 and (d) collision-free ids are preconditions for linking, not only for the armada.

Hand-off: Arky, for the transport and protocol shape against S32-01, 03 and 09. Founder: S32-12 (teammate handoff waits on OPEN 7).
