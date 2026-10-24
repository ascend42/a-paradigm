# 26 — Aegis: voice approvals under P8-D58, review of gnomon.md v3.3 (2026-10-17)

Verdict: D58 can ship without putting a key on disk and without letting an agent approve its own card. One condition: **the voice client never holds decision authority.** The voice client reports what it heard. The broker signs `decisionSig` with the hardware approvals key, inside a "voice arm" that a fresh Touch ID or Windows Hello prompt opened. For each card the kernel generates a spoken **handle**, and for gate-class cards a **challenge**. No session, mod or voice process can read either one, and the utterance must echo it.

Speaker id, AEC, playback detection and enrolment are hygiene against accidents. They are not the boundary. What the kernel can verify is the arm (presence), the connection pairing and the handle or challenge secret.

The real loss is in toggle 2. Fresh presence per decision becomes presence per short window, and the window is capped by count and by time. The spec has to say this plainly.

Toggle 1 = reversible voice approvals: cached-unlock-class decisions only. Toggle 2 = gate voice approvals: the fresh-presence class, minus the forbidden set in §2.6.

---

## 1. Threats specific to voice approval (findings)

### Critical
- **S26-C1 The agent approves itself through TTS.** Agent text (spoken summary, Tier 2 gnome line, `local-ack`) goes to TTS, then the speaker, then the mic, then STT, then an approval phrase. AEC is not guaranteed. Speakers plus a cheap mic will leak the phrase. Fix (§2.3):
  - a per-card handle the session cannot read;
  - the approval grammar is muted while our TTS plays, plus a 750 ms tail;
  - the outbound TTS filter drops any approval-grammar match;
  - headphones are required for toggle 2.

  The handle is the control the kernel can verify. The other three are defence in depth.
- **S26-C2 Toggle placement.** If the toggles live in `.gnomon/project.yaml`, a cloned third-party repo, or a commit at the base revision, can turn on voice approvals on the founder's machine. That conflicts with threat 5 ("project scope cannot set policy") and threat 11. Fix: the toggles live only in the root-signed `~/.gnomon/config.yaml`, keyed by `repoId`. `project.yaml` may not carry them, not even as a request (§2.1).
- **S26-C3 The voice device key becomes approval-capable.** The voice principal's key is an Ed25519 file. On Windows, read denial inside sandboxes is `partial` (§A.3), so a sandboxed session could read it. If the voice principal can drive a decision, any holder of that file can too. Fix: an arm is bound to the pair {human `connId`, voice `connId`} that existed when the arm was opened. A second voice connection ends the arm and gains nothing. Where the OS gives a peer PID (Windows pipe `GetNamedPipeClientProcessId`; macOS `LOCAL_PEERPID` via the helper), the voice connection's peer must be the signed `gnomon-voice` binary. `decisionSig` still comes only from the hardware key (B7 holds).

### High
- **S26-H1 Replay and playback.** Sources: media playback, a recording of the founder, a video saying the phrase, another process playing audio. Fix:
  - handles and challenges are single-use and never repeat within an arm;
  - the utterance must start after the card's handle was issued (`t0 ≥ handleIssuedAt`);
  - the playback gate: the voice client refuses while any other process renders audio. It checks this with Core Audio process objects on macOS (`kAudioHardwarePropertyProcessObjectList` / `kAudioProcessPropertyIsRunningOutput`, macOS 14.2+) and `IAudioSessionManager2` active sessions on Windows;
  - toggle 2 requires headphones.

  A live relay of the founder's voice in real time remains a residual (§4).
- **S26-H2 Injection through transcribed text.** Conversation that quotes the phrase ("he said claude admin approve"), dictated text containing the phrase, or an agent that coaxes the human into saying the handle. Fix:
  - approval utterances go through a constrained keyword-spotting grammar, anchored to the whole utterance (the VAD segment is exactly the phrase plus handle, nothing else, ≤ 6 words);
  - the broker never parses free text;
  - approval utterances are never forwarded as `session.send`;
  - handle hygiene: if a live handle or challenge word shows up in any `session.send`, turn text, `textPlanned` or `textSpoken`, the kernel rotates that handle.
- **S26-H3 Ambiguous card targeting.** The decision stack holds several cards, so "approve" alone could hit any of them. Fix:
  - the handle is mandatory and names exactly one card at one `contentHash`;
  - a superseded or changed card gets a new handle;
  - there is no batch phrase, no "approve all", and no "same again".
- **S26-H4 A sandboxed session's audio and screen on Windows.** On Windows a session can screen-capture the handle, then play it with the phrase, or record the mic. macOS already denies mic/camera through TCC in the `session` profile. Fix:
  - the wrapper excludes the handle and challenge region from capture (`SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` on Windows; `NSWindow.sharingType = .none` on macOS, proven in an M4 probe);
  - the playback gate;
  - the voice client detects concurrent mic use on Windows (CapabilityAccessManager `NonPackaged` `LastUsedTimeStart/Stop`);
  - it is reported `partial` where these cannot be enforced.
- **S26-H5 Toggle 2 turns fresh presence into windowed presence.** This is inherent in D58. Bound it:
  - a separate **gate arm** per fresh presence prompt, with the warning text in the prompt;
  - 5 min hard cap;
  - ≤ 3 gate decisions per arm;
  - a per-decision challenge;
  - headphones;
  - a 5 s hold before effect.

  Optional path that keeps true fresh semantics: companion presence. A Secure Enclave access control with the Watch/companion flag (`kSecAccessControlCompanion`, macOS 15+) would make each gate decision a wrist double-press. This needs an M4 probe and has no Windows equivalent.
- **S26-H6 Browser surface plus an extension (S25-L1).** An all-sites extension reads page memory, so it gets handles and challenges, and it can play audio from a tab. Fix: an arm can be opened only from `surface: wrapper` or a native conformant client that implements capture exclusion. Handles are delivered **only to the arming connection**, never to a browser-surface connection.

### Medium
- **S26-M1 Other people in the room and voice cloning.** Enrolled-speaker gating is required for both toggles (speaker score ≥ threshold on the same utterance). It is necessary but not sufficient: speaker id is not authentication, and nothing in sherpa-onnx detects spoofed or cloned voices. It is an honest limit (§4).
- **S26-M2 Wake-phrase collision and configurable phrases.** If the phrases were editable from a weak source, an attacker could set them to something the agent says all the time. Fix:
  - phrases are root-signed;
  - each phrase is ≥ 3 words and starts with a configured prefix (default `claude admin`);
  - phrases must differ from the voice wake/open phrase and from persona emote phrases;
  - approve, deny and undo must differ by ≥ 2 words and by Double-Metaphone distance ≥ 2;
  - a phrase that matches an English corpus n-gram list is refused at config time.
- **S26-M3 Client claims the kernel cannot verify.** Speaker score, playback state, TTS state, the audio route and ASR confidence are all claims made by userland software. Events must label them `attestedBy: voice`, and no spec sentence may present them as a boundary (`G-HON-06`).
- **S26-M4 Human away.** An arm left open while the founder is away is the window for a bug or TV in the room. Fix: the helper ends every arm on screen lock, display sleep, fast user switch or system sleep (macOS `CGSessionCopyCurrentDictionary` lock state; Windows `WTS_SESSION_LOCK`).
- **S26-M5 "Reversible" is not reversible after effect.** Once a `tool.permission` allow is released, the tool has run. Fix: a **hold** before the broker releases the decision (toggle 1 default 3 s, range 2–10, never 0; toggle 2 fixed 5 s). During the hold the screen echoes the decision and an earcon plays. Undo by phrase or `Esc` turns it into `deny`.
- **S26-M6 Flagged cards.** A card carrying `flags: [hidden-chars|bidi]` has to be looked at. Voice refuses it.
- **S26-M7 Content-judgment cards decided by ear.** KNOT `resolve` and verdict `accept|reject` ask the human to read a split or diff, and Warpline's `resolve` is HUMAN_ONLY by its own security law. Recommendation (founder's call, not a challenge to D58): toggle 2 includes them, but each is a separate root-signed sub-opt-in, default off even with toggle 2 on. Either way a voice decision carries `via: voice` into Warpline's attribution.

### Low
- **S26-L1** The armed state goes in a kernel-owned region of the Shuttle view (`VOICE APPROVE ARMED · reversible · 12:41 left`, and `GATE` in the warning colour). It cannot be overlaid or hidden, and earcons play on arm and disarm.
- **S26-L2** Handles and challenges never enter the chain in plaintext before use: `handleHash` / `challengeHash` only, with plaintext in `approval.decide` after use. Approval utterance text is stored redacted (`claude admin approve ⟨handle⟩`).
- **S26-L3** Deny direction. Under toggle 1, `deny` and `reject` by voice could be allowed on every card kind, because they fail closed. This is recommended but not required. A miss means a re-request, not a breach.
- **S26-L4** An attacker can force disarms by causing handle misses. This is accepted: it fails closed, it is logged, and re-arming costs one touch.

---

## 2. Mechanism

### 2.1 Where the toggles live
Root-signed `~/.gnomon/config.yaml` (§3.4: "tunable only in root-signed config"):
```yaml
voiceApprovals:
  phrases: { prefix: "claude admin", approve: "approve", deny: "deny", undo: "undo", answer: "answer" }   # root-signed, validated (S26-M2)
  projects:
    "<repoId>":
      reversible: false        # toggle 1
      gateClass: false         # toggle 2 — requires reversible: true
      gateKinds: [gate-class, fallback-cloud, resume]   # resolve, verdict only by explicit sub-opt-in (S26-M7)
      holdMs: 3000             # toggle 1 hold, 2000..10000
```
- `.gnomon/project.yaml` may not contain `voiceApprovals`. If it does, the key is ignored and `config.refused{where:'project', key:'voiceApprovals'}` is logged.
- Enabling is the root-signed CLI verb `gnomon voice approvals enable <repo> [--gate-class]`, or a palette command on a human-class connection. Either way the root key presence prompt carries the kernel-composed text.
- Enabling `--gate-class` adds the **warning**, verbatim:

  "Voice will be able to approve gate-class decisions in <repo> for 5-minute armed windows. Anyone who can make your microphone hear your voice and read your screen inside that window can approve settings, hook and policy changes. Speaker recognition is not authentication."
- Disabling (`gnomon voice approvals disable <repo>`) needs no presence. Turning security up must never cost a touch. Disabling disarms every arm for that repo at once.
- The kernel watches the config: any change ends all arms.

### 2.2 Arms: who signs and what ties the decision to the human
- **The reversible arm (toggle 1).** Opened by a fresh approvals-key presence prompt on a human-class connection whose `surface ∈ {wrapper, native-conformant}`. The prompt names the repo, the class, the paired voice `connId` and its peer process, and the expiry. The arm record is `{armId, class:'reversible', repo, humanConnId, voiceConnId, voicePeer{pid, codeSigOk}, openedAt, idleMs:900000, hardMs:3600000, maxDecisions:30}`. It is held in kernel memory only.
- **The gate arm (toggle 2).** A separate fresh presence prompt that shows the S26-C2 warning every time. It requires an active reversible arm on the same pair. Record: `{class:'gate', hardMs:300000, maxDecisions:3}`. It never refreshes on activity.
- **Disarm on any of:**
  - the human or voice connection closes;
  - a new voice connection appears;
  - idle or hard expiry, or the decision limit is reached;
  - screen lock or sleep;
  - a config change;
  - a handle miss (3 for the reversible arm, 1 for the gate arm);
  - a challenge miss;
  - a manual "claude admin disarm" or a GUI control.
- **Signing.** The voice principal calls `approve{voice:{handle, challenge?, decision, utteranceHash, t0, t1, speakerId, speakerScore, asrConfidence, attest:{ttsActive, otherRender, route: headphones|speakers-aec}}}` with no `cardId` and no `decisionSig`. The kernel then:
  1. resolves the handle to a card;
  2. checks the arm, the class, the forbidden set, the flags, rate limits, `t0 ≥ handleIssuedAt`, the challenge for gate cards, and the attestations (refusing on `ttsActive`, `otherRender`, or `speakerEnrolled:false`);
  3. puts the decision on hold;
  4. after the hold, signs with the approvals key under domain
     `gnomon:approve-voice:v1\n<cardId>\n<decision>\n<contentHash>\n<approverPrincipalId>\n<armId>\n<utteranceHash>\n<handleHash>\n<challengeHash|->`.

  The approver is the human principal, with `via: p:<ns>/voice`, `presence: voice`, and `voiceArm{armId, class, humanConnId, armPresenceAt}`.

### 2.3 Handles and challenges
- **Handle.** Each pending card in an armed repo gets one word, drawn without replacement per arm from a fixed public 256-word list built for phonetic distance. The voice client only needs the public list for its grammar, never the live mapping. The handle is delivered only to the arming human connection, in the kernel-owned card region, with capture exclusion. It is spoken into the ear only when `route: headphones`. The chain stores `handleHash` only. Utterance form: `<prefix> <approve|deny|answer> <handle> [option-digit]`. For `ask-user`, a free-text answer is dictated after an earcon and confirmed by the hold.
- **Challenge (gate arm).** After `<prefix> approve <handle>`, the kernel shows two words from a 2048-word list (about 22 bits), bound to `{cardId, contentHash, armId}`. It shows them on screen only, or spoken into headphones. The voice client speaks the kernel-composed summary line verbatim (never in the gnome's words, D46). The human says `<prefix> confirm <w1> <w2>` within 20 s. One try only. The S26-M7 kinds additionally require the card to have been focused on screen ≥ 2 s (the client reports a kernel-owned region visibility event).
- **Hygiene.** If a live handle or challenge word appears in any forwarded text, model output, or TTS input, that handle rotates (S26-H2). If the TTS filter matches the approval grammar, the client speaks "[approval phrase withheld]" and logs `voice.tts.filtered`.

### 2.4 Hold, echo, undo
On intent acceptance:
- `approval.voice.held{cardId, decision, until}`;
- on-screen echo in the kernel region ("Allowing Bash `…` in 3 — say claude admin undo");
- an earcon.

Undo (phrase or `Esc` on the arming connection) logs `approval.voice.undone` and records `deny`. Deny-direction decisions skip the hold.

### 2.5 Rate limits
- Reversible arm: ≥ 2 s between decisions, ≤ 30 per arm.
- Gate arm: ≥ 10 s between decisions, ≤ 3 per arm, ≤ 2 gate arms opened per hour per repo.

When a limit is exceeded the kernel refuses the intent, and the arm stays open.

### 2.6 Forbidden even with both toggles on
| Never by voice | Why |
|---|---|
| `install` (including linked-mod re-approve and manifest widening) | root key, standing grant |
| `use-api-token` | root key, law 7, per-use human act |
| `always` / `approval.rule.learned` | standing rule (B8, S25-C2) |
| every root-signed verb: `key *`, `trust`, `grant.*`, `mod link|unlink|dev|rollback`, `gui pin`, `billing api-token`, `voice enrol|forget`, `voice approvals enable` | root key presence per signature by design |
| `daemon stop`, `log segment` | CLI approval-signed, out of scope |
| `voice-share` | consent belongs to each speaker |
| any card with `flags` | must be read (S26-M6) |
| cards with `attended:false` while no arm exists | arms do not wait for cards |
| `resolve`, verdict `accept|reject` unless sub-opted (S26-M7) | content judgment |

### 2.7 Events (all `approval.*`, kernel-owned, broker-signed)
`approval.voice.arm{armId, class, repo, humanConnId, voiceConnId, voicePeer, expiresAt, maxDecisions}` · `approval.voice.disarm{armId, reason: expiry|idle|limit|conn-closed|new-voice-conn|screen-lock|config|handle-miss|challenge-miss|manual}` · `approval.voice.intent{armId, cardId, decision, handleHash, challengeHash?, speakerId, speakerScore, asrConfidence, attest{…}, attestedBy:'voice'}` · `approval.voice.held{cardId, until}` · `approval.voice.undone{cardId, by}` · `approval.voice.refused{reason}` · `approval.decide{…presence:'voice', via:'p:<ns>/voice', voiceArm{…}}` · `config.voice.approvals{repo, reversible, gateClass, gateKinds, phrasesHash}` (root-signed) · `voice.tts.filtered{turnId}` (voice grant).

### 2.8 Refusal reasons
These are `FORBIDDEN{reason:'voice:<r>'}`, following the S25-C2 pattern, so the code map does not change. Values for `<r>`:

`off` · `gate-off` · `not-armed` · `surface` · `conn` · `forbidden-kind` · `flagged-card` · `handle` · `challenge` · `stale-utterance` · `tts-active` · `playback` · `speaker` · `route` (gate without headphones) · `rate` · `screen-locked` · `peer` (voice peer is not the signed binary).

---

## 3. Spec edits (gnomon.md v3.3 → v3.4)

1. **§0, new "Changes in v3.4" table.** Add rows:
   - D58 (voice approvals: two root-signed per-repo toggles, the arm, handles and challenges, the hold);
   - S26-C1..C3, H1..H6, M1..M7, L1..L4 with their targets.
2. **§3.1 approvals key (lines 181–185).** Append:

   "A **voice arm** (§14.7, D58) is a further unlock of this key, opened only by fresh presence on a human-class connection whose surface is the wrapper or a native conformant client, and paired with one voice `connId`; the broker alone signs under it; a decision arriving on any connection other than the paired voice connection never uses it."
3. **§3.1 key list (line 193).** Change the voice clause to:

   "voice principal has its own device key (§14.4); that key never signs a decision — voice intents are co-signed by the broker under a voice arm (§14.7)."
4. **§3.1 signature domains (line 210).** Add `gnomon:approve-voice:v1\n<cardId>\n<decision>\n<contentHash>\n<approverPrincipalId>\n<armId>\n<utteranceHash>\n<handleHash>\n<challengeHash|->`.
5. **§3.1 I3 (line 215).** Add `voice approvals enable` to the root-signed list. `voice approvals disable` is device-authenticated and requires no presence.
6. **§3.1 I4 (line 216).** Replace with:

   "I4 Session, mod and voice principals are children: `scope ⊆ parent.scope`; they never widen a permit or bind to a manifest grant (mods bind only to their own `modns.<name>.*`). Session and mod principals never call `approve`. The voice principal calls `approve` only in its intent form (no `cardId`, no `decisionSig`) and only inside a voice arm (§14.7); the broker signs, the approver is the human, and with both D58 toggles off the intent form is refused `FORBIDDEN{reason:'voice:off'}`."
7. **§3.4 card:v1 (line 276).** Change `presence?: fresh|cached|cli` to `presence?: fresh|cached|cli|voice, voiceArm?:{armId, class, humanConnId}, via?: principalId`.
8. **§3.4 decision classes (line 278).** After the S25-H1 sentence, insert:

   "**Voice (D58, §14.7):** with toggle 1 on for the card's repo, cached-unlock-class decisions may arrive as a voice intent inside a reversible arm; with toggle 2 on, the fresh-presence kinds listed in the repo's root-signed `gateKinds` may arrive inside a gate arm with a challenge. `install`, `use-api-token`, `always`, `voice-share`, flagged cards and every root-signed act are never decided by voice. Voice decisions are held (§14.7) before release."
9. **§3.4 invariants (line 286).**
   - B4 becomes: "Agent/session/mod kinds never decide cards or Warpline overrides; the voice principal never decides — it submits an intent the broker co-signs under a human-opened arm (§14.7)."
   - B8 add: "…nor under a voice arm."
   - New B9: "A voice-arm decision is released only after its hold and only if its handle (and, for gate arms, its challenge) matches a live, unused value bound to the card's current `contentHash`."
10. **§5 matrix row 8 (line 432).** Change the Voice cell from `**✗**` to `intent form only, inside an arm (§14.7); no decisionSig`.
11. **§5 G-ABI-02 (line 442).** Change "`approve` is the only HUMAN_ONLY verb" to:

    "`approve` is the only HUMAN_ONLY verb: every decision's approver is the human; the voice principal's intent form is decided by the human's arm and signed by the broker (domain `gnomon:approve-voice:v1`)."

    `G-ABI-02` adds the voice-intent row: off, unarmed, wrong connection, forbidden kind ⇒ refused.
12. **§9.1 approval row (line 579).** Add the §2.7 kinds and `presence: voice`.
13. **§9.3 redaction (lines 608–615).** Add a column `approval.voice handle/challenge`: human = the arming connection only; every other class = never. State: "handles and challenges are not in the chain before use (hashes only)."
14. **§11.4 Shuttle view (line 702).** Add "voice-arm state (class, time left), kernel-owned, cannot be hidden."
15. **§11.5 Decisions (line 708).** Append:

    "A connection may open a voice arm (§14.7) only from the wrapper or a native conformant client; the browser surface cannot arm and never receives handles."
16. **§12.6 Never rephrased (line 763).** Append:

    "The TTS channel never speaks an approval-grammar match (withheld and logged `voice.tts.filtered`); no gnome line or choice is ever a voice approval."
17. **§14.2 (line 821).** Append:

    "While TTS plays and for 750 ms after, the approval grammar is muted; barge-in still works for speech."
18. **§14.4 (line 829).** Replace "and can **never** `approve`, run root verbs, request cards, or decide anything by speech" with:

    "and never runs root verbs or requests cards; it decides nothing by speech unless the human has enabled D58 for the repo and opened an arm (§14.7) — with both toggles off, voice opens and never decides."

    Replace `G-VOX-04` here with the new text in item 22.
19. **New §14.7 "Voice approvals (D58)".** Contents = §2.1–2.8 of this review, verbatim apart from structure.
20. **§15.1 row 2 (line 848), Residual.** Append:

    "with D58 on: an intent inside a live voice arm from someone who can make the microphone hear the founder's enrolled voice and read the handle (and challenge) inside the window."
21. **§15.1 row 14 (line 860).**
    - Mitigation: add "voice decides only via broker-signed arm + kernel handle/challenge + hold".
    - Residual: replace with "microphone access is the OS's permission; a live relay or clone of the founder's voice plus sight of the screen inside an armed window (§14.7, §A.1(f))".
22. **§14.6 falsifiers (line 837).** Rewrite `G-VOX-04` and add new ones:
    - `G-VOX-04` with both toggles off, every voice `approve` form is `FORBIDDEN{voice:off}`; root verbs and `permit.reserve` are `FORBIDDEN` regardless.
    - `G-VOX-08` a `voiceApprovals` key in `.gnomon/project.yaml` (base revision or worktree) enables nothing and logs `config.refused`.
    - `G-VOX-09` TTS self-approval: a session whose output contains `<prefix> approve` plus every list word, played through speakers with AEC, produces zero decisions (filtered, muted, handle unknown).
    - `G-VOX-10` replay: a recording of a valid earlier approval utterance yields `voice:handle` or `voice:stale-utterance`; another process rendering audio yields `voice:playback`.
    - `G-VOX-11` a second voice connection (same key) ends the arm; an intent from it is `voice:conn`.
    - `G-VOX-12` no session, mod, voice or browser-surface connection can read a live handle or challenge (log, `ref.resolve`, `status`, relays).
    - `G-VOX-13` targeting: with 5 pending cards, an intent decides exactly the card whose handle was spoken at its current `contentHash`; a card changed after issue gets a new handle.
    - `G-VOX-14` every item in §2.6 is refused by voice with both toggles on.
    - `G-VOX-15` the hold: undo within the hold yields `deny` and the tool never runs.
    - `G-VOX-16` gate arm: no headphones ⇒ `voice:route`; one wrong challenge ⇒ disarm; a 4th decision ⇒ `voice:rate`; expiry at 5 min with no refresh.
    - `G-VOX-17` screen lock or sleep ends every arm within 1 s.
    - `G-VOX-18` arming from `surface: browser` ⇒ `voice:surface`.
    - `G-VOX-19` handle hygiene: a live handle in forwarded text rotates it.
23. **§19.4.** M4.3's kill condition changes from "or a decision made by speech" to "or a decision made by speech outside a voice arm". Add M4.5 "Voice approvals (D58)", oracles `G-VOX-08..19`, falsifier "any voice decision without a matching arm, handle and hold". Add an M4 probe for capture exclusion (both OS), the audio-render process listing, and companion presence (macOS 15+).
24. **§20 falsifier 10 (line 1057).** Add: "…or an `approval.decide{presence:'voice'}` without a preceding `approval.voice.arm` for the same pair, beyond its class, or after its hold was undone." Add to the cannot-catch list: "a voice decision made by someone who reproduced the founder's voice and read the handle inside an arm."
25. **§A.1 (line 1091).** Add (f) as in §4 of this review. Revisit trigger: "before any second human or 8.1, voice gate arms are removed or replaced by companion presence."
26. **Appendix A (lines 1117, 1139).** Add `G-VOX-08..19` to `sym:#gnomon-voice`, `sym:$move-4` and `sym:#approval-broker`.

---

## 4. Honest limits (for §A.1(f) and `G-HON-06`)

- **(f) Voice approvals (D58).**
  - With toggle 1 on and a reversible arm open, a person who can make the microphone hear speech the client accepts as the founder's enrolled voice, and who can read the card's handle (on the wrapper's screen, or in the founder's headphones), can allow a tool call, answer an `ask-user` or approve a plan. They can do this up to 30 times within ≤ 60 min, each one held 2–10 s with an echo the founder may not be watching.
  - With toggle 2 on and a gate arm open, the same person who can also read a 2-word challenge can approve up to 3 gate-class decisions within 5 min.
  - Speaker recognition is not authentication: a voice clone or a live relay passes it.
  - The playback, TTS-state, route and speaker checks are claims made by the voice client, not verified by the kernel. They stop accidents, not a compromised voice client.
  - What the kernel does verify: each arm began with a hardware presence prompt; only the paired voice connection used it; each decision echoed a single-use secret that no session, mod or browser connection could read; nothing in §2.6 was decided.
  - On Windows, capture exclusion and audio-render detection are `partial` until the M4 probe proves them, and mic denial for sessions is not enforced.
  - Detectable and attributable to "a speaker accepted inside arm `<armId>`", not prevented.
- Toggle 2 is a deliberate trade of the fresh-presence guarantee for speed. The founder chose it under a warning, and the spec states it that way rather than calling it presence.
- The S26-M7 kinds, if sub-opted, put a content judgment (KNOT split, verdict) on hearing alone. The challenge proves who spoke, not that the human read the diff.

Prior-findings status: S25-C2 (`always` fresh) and B7 (no decision key on disk) stay closed under this design. S25-H1 (connection binding) gains one named, paired exception, the voice `connId`. S25-L1 (extension) is closed for voice by S26-H6.
