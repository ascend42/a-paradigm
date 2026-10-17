# 27 — Arky: P8-D58 voice approvals, mechanism and spec edits (2026-10-17)

Reviewed against `docs/specs/gnomon.md` v3.3, lore L-2026-10-17-ascend-061036-001 (P8-D58) and `a-atelier/docs/playbook/review-marks-v0.md` (G1, E12). Aegis owns the threat analysis (research 26). This review covers the architecture, the ABI and the UX shape, and states only the security constraints the mechanism depends on.

## Top findings

1. **Voice cannot approve under today's model.** A decision is a `decisionSig` from the hardware approvals key, and that key unlocks only with presence on one human-class `connId` (§3.1 L181-185, §3.4 L278). Speech produces no presence. D58 therefore needs a presence event to anchor to. Proposal: a **voice arm**. It is one fresh Touch ID / Windows Hello presence that unlocks the approvals key for exactly one voice connection, limited to the classes and projects the toggles allow, bounded in time, and dropped on screen lock. Without an arm, a voice decision would rest on no hardware evidence at all, and "speaker id is not authentication" (§14.4) would then be the whole story. (A26-01)
2. **No new verb.** The voice principal gets a conditional cell on verb 8 `approve` (`via:'voice'`, no client `decisionSig`). The kernel signs under the arm in a separate signature domain. A broker `held` state gives "propose, then commit after an undo window" without a 13th verb (law 3). An `approval.propose` verb would duplicate `approve`'s whole refusal surface and still need the arm. (A26-04)
3. **The toggles cannot live in `.gnomon/project.yaml`.** That file is a committed, agent-editable repo file that "may request, never grant" (§15.4 L877, threat 11). The toggles are **root-signed grant rows keyed by `repoId`**. Phrases and timings go in root-signed `~/.gnomon/config.yaml`. Narrowing (turning off) costs no presence; widening costs root presence plus, for toggle 2, the warning. (A26-02)
4. **Readback is itself a self-approval channel.** The kernel's spoken readback quotes card content that an agent authored. A bash command containing "claude admin approve", read back over the speakers, approves itself. Defences: phrase masking in all TTS text, a half-duplex rule for decision phrases, a kernel echo cross-check against `voice.turn.agent`, and a `voice-phrase` card flag that makes the card voice-ineligible. (A26-06)
5. **Sequencing.** D58 does not move voice out of Move 4. It does need `card:v1` / `approval.decide` enum values reserved in M1.1, so `clientApiId` does not move again in Move 4 (falsifier 12). It also needs the §4.9 compatible-additive rule clarified for enum values. (A26-11)

---

## 1. Where the toggles live, how they are read, how they are shown and set

### A26-02 Custody: grant rows for toggles, root config for phrases

**Toggles are capabilities, so they are grants.** They go in a new root-signed row in `~/.gnomon/grants.jsonl`:

```
grant.voice-approvals { repo: "repo:<id>", classes: [reversible] | [reversible, gate], since, signer:<rootKeyId>, sig }
```

- Toggle 2 implies toggle 1 (D58 says "also"). The loader refuses `[gate]` alone with `BAD_REQUEST`.
- **Widening needs root presence.** Turning either toggle on is a root-key signature, and the presence prompt text carries the toggle-2 warning.
- **Narrowing needs no presence.** Turning a toggle off, or disarming, is `approval.voice.policy.narrowed{repo, classes}`. The kernel appends it, signed with the kernel key, when any human-class connection asks (GUI, wrapper, CLI) or when a voice "stop" phrase is heard. The effective policy is the latest root grant minus any later narrowing. I5 (grant rows are root-signed) still holds because narrowing rows are kernel events, not grant rows.
- **`project.yaml` never carries voice approval keys.** If present, they are ignored and logged as `config.ignored{field:'voice.approvals', source:'project.yaml'}`. A change to them is still gate-class through `.gnomon/**`.

**Phrases, hold windows and arm limits go in root-signed `~/.gnomon/config.yaml`:**

```yaml
voice:
  approvals:
    phrases:                         # full phrases; validated (A26-05); not secrets — security never rests on phrase secrecy
      approve: "claude admin approve"
      deny:    "claude admin deny"
      confirm: "claude admin confirm"
      undo:    "claude admin undo"
      cards:   "claude admin cards"     # read the deck
      open:    "claude admin open"      # G1: focus a card in the GUI
      arm:     "claude admin arm"
      stop:    "claude admin stop"      # disarm (narrowing, no presence)
    perRepo: { "repo:<id>": { phrases?: {...} } }   # optional override, same validation
    holdMs:  { reversible: 3000, gate: 5000 }        # floors 2000 / 5000; kernel clamps
    confirmWindowMs: 10000
    arm: { idleMinutes: 15, maxMinutes: { reversible: 240, gate: 60 } }
    echoTailMs: 600                                    # half-duplex tail after TTS playback
    minAsrConfidence: 0.90
    binary: { path, sha256 }                           # pinned voice child (A26-03)
```

**Scope levels:**

| Level | What it controls | Where it lives |
|---|---|---|
| Per project | Toggles (D58) | Grant row |
| Per session | Narrowing only: "no voice decisions in this session" | Kernel event from any human-class connection |
| Per voice stint | The arm | Presence-backed, ephemeral, kernel memory |

**How the kernel reads them.** The broker computes `effectiveVoicePolicy(repo)` from the grants (signature verified), the narrowing events and config. It caches the result and invalidates it on any `grant.*`, `config.*` or narrowing append. Any narrowing immediately drops every arm whose classes exceed the new policy (`approval.voice.disarmed{reason:'policy-narrowed'}`).

### A26-03 The arm and the voice child

**What the arm is.** An approvals-key unlock keyed by the voice connection's `connId`, restricted to:

- `classes ⊆ effectiveVoicePolicy(repo)`
- the repos named at arm time
- `idleMinutes` / `maxMinutes`

**How it is created.** By a kernel-raised `voice-arm` card, decided `allow` with **fresh presence** on a human-class connection.

**Who can request it.** The human (GUI palette `voice.arm`, CLI `gnomon voice arm`) or the voice principal (`arm` phrase → `request.voice.arm`, A26-08). The voice principal may request only this one card kind, at most 1 per 5 minutes, and never while already armed. The presence prompt is the boundary.

**What the presence prompt says** (kernel-composed, kernel-signed):

```
Arm voice approvals: <repos>; classes <reversible | reversible + gate-class>; voice client <sha8>, conn <connId>;
until <hh:mm> or <n> idle minutes; drops when the screen locks. Speaker recognition is not authentication.
```

**What drops the arm:** idle, max, voice connection close, OS screen lock or user switch (the helper observes it: macOS `com.apple.screenIsLocked`, Windows `WTS_SESSION_LOCK`), policy narrowing, the `stop` phrase, the GUI **Disarm** control, daemon exit. In conversation mode, a decision phrase heard from a non-enrolled speaker drops the arm. It is never re-armed automatically.

**Custody of the voice client.** Only a **kernel-supervised voice child** can be armed. The kernel spawns `gnomon-voice` from the root-signed `voice.binary.path`, checks `sha256` (like `claude` preflight and `gui.bundleHash`), and connects to it over inherited stdio (no socket credential). It runs under a new **`voice` sandbox profile**:

- allowed: mic (TCC), reads of model and voiceprint dirs, writes under `~/.gnomon/voice/`
- denied: network, exec, `~/.gnomon/keys/**`

A voice client connecting over the socket with the voice device key keeps every G1 capability (send, interrupt, read back, open) but `voice-arm` refuses it with `FORBIDDEN{reason:'voice-custody'}`.

If M4.1's probe shows that macOS TCC mic attribution fails for a daemon-spawned child, the fallback is a socket client whose arm is bound to its `connId`. That is honest but weaker (a replaced client binary can be armed by an unwary touch). It is reported as `status.voice.armCustody: supervised | client`, the same pattern as `kernelKeyCustody`.

**Hands-free note.** Windows Hello face recognition arms without touching anything. On macOS, M4.1 probes whether the approvals key's access control (`userPresence`) accepts Apple Watch confirmation; otherwise arming costs one touch per stint.

### A26-08 How the GUI and CLI show and set the toggles

**Setting from the GUI (no new verb).** A new `request.*` namespace is appendable **only by a human principal on a first-party human-class connection** (plus the voice principal, for `request.voice.arm` only):

- `request.grant{grant}`
- `request.voice.arm{voiceConnId?}`
- `request.voice.narrow{repo?, hsid?, classes}`

The kernel answers a `request.grant` by raising a `grant` card. The card body is kernel-composed: the grant diff and, for toggle 2, the warning. It is decided `allow` with the **root key** (fresh presence). This also gives the GUI a path to other root-signed grants it lacks today (for example `log.read:sensitive` for a community device key), so the mechanism is general rather than voice-only. `request.voice.narrow` is applied directly, with no card.

**GUI shape:**

- **Settings → Project → Voice** has two switches:
  - "Voice may approve reversible decisions"
  - "Voice may also approve gate-class decisions" (disabled until the first is on)
- Turning toggle 2 on opens the `grant` card in the decision stack. Its kernel-owned body shows this warning, verbatim, also in the presence prompt (STE style):

```
Warning. With this on, voice can approve gate-class decisions in <repo> while voice approvals are armed:
changes to CLAUDE.md, .claude/, CI, test and package scripts; KNOT resolutions; verdicts; cloud fallback; budget resume.
One touch arms voice for up to 60 minutes. A recognized voice is not proof of identity.
Anyone or anything the microphone hears saying the phrase in a voice the recognizer accepts can approve.
Install, API-token, "always" and voice settings stay hand-only.
```

- **Kernel-owned indicator** (§4.5 region, not hideable by layout presets, mirrors `API CREDITS ACTIVE`): `VOICE APPROVALS ARMED · reversible | gate · <mm:ss> left` with a **Disarm** control. It appears in the header and the Shuttle view, and as a wrapper dock/taskbar badge.
- **Decision stack:**
  - cards eligible for voice carry a mic glyph showing their class and their current deck ordinal
  - ineligible cards show why (`hand-only`, `voice-phrase`, `class`)
  - a `held` card shows a countdown and **Cancel**
  - decided cards show a `voice` badge in history
- **Status:** `voice.approvals{projects:[{repo, classes}], armed:{armId, classes, repos, until, idleLeftMs} | null, armCustody}` and `voiceDecisions{n, of}`.

**CLI:**

- `gnomon voice approvals [<repo>] show`
- `gnomon voice approvals <repo> --reversible on|off --gate on|off`. `on` is root-signed (I3) and prints the same warning text before the prompt; `off` narrows with no presence.
- `gnomon voice arm | disarm`

---

## 2. `$voice-turn` amended and the new `$voice-approval` flow

### A26-05 Phrase grammar and targeting

```
utterance := phrase(cmd) [SP target] [SP ":" SP freetext]      ; matched on normalized ASR text, n-best checked
cmd       := approve | deny | confirm | undo | cards | open | arm | stop
target    := ε                          ; implicit: exactly one eligible card in the attached session
           | "card" SP ordinal          ; ordinal in the most recent deck (≤ 60 s old)
           | "the" SP label SP "card"   ; label from the closed kernel vocabulary
           | "the" SP word SP "card"    ; free word matched against eligible cards' readback lines — ALWAYS two-step
ordinal   := one .. nine
label     := permission | bash | edit | write | web | tool | question | plan | gate | knot | verdict | fallback | budget
freetext  := answer text, ask-user only ("claude admin approve card two: use the staging bucket")
```

**Phrase validation at config sign time:**

- each phrase is ≥ 3 words, and all phrases share a ≥ 2-word prefix
- pairwise phonetic distance (Double Metaphone over the distinguishing tail) meets a floor, with `approve`↔`deny` and `confirm`↔`undo` checked explicitly
- no phrase is a substring of another
- no phrase collides with a persona TTS voice name or a default persona phrase

**Matching:**

- confidence ≥ `minAsrConfidence` on every phrase token
- if the n-best list contains a different command, the utterance is refused (`voice-ambiguous`). Hearing "deny" for "approve" fails safe; hearing "approve" for "deny" does not, so ambiguity always refuses.

**Labels and the deck:**

- Labels come only from kernel fields (card kind; tool name only if it is in Claude Code's built-in tool set, else `tool`), never from agent text.
- Ordinals refer to the **deck**: the list the kernel's readback last spoke (`voice.deck{deckId, cardIds[]}`). New cards never shift a spoken ordinal; they wait for the next `cards`.
- A free-word target ("approve the deploy card") is allowed but is always resolved through readback plus `confirm`, whatever the toggle class. The word comes from agent-influenced text, so it may select a card but never decide one.
- A target matching 0 or more than 1 card is refused, and the system voice says `"<n> cards match. Say 'claude admin cards'."`

### A26-06 Confirmation, echo, undo and self-approval defences

**Single-step vs two-step:**

| Card class (toggle) | Target form | Steps |
|---|---|---|
| reversible (toggle 1) | implicit, ordinal, or closed label | **one step**: phrase → echo → hold → commit |
| reversible | free word | two steps |
| gate (toggle 2) | any | **two steps**: phrase → kernel readback of that card → `confirm` within `confirmWindowMs` → hold → commit |

- **Echo:** the kernel-composed `voice.echo` line, spoken verbatim in the **system voice** (a fixed TTS voice no persona may use; the auditory equivalent of a kernel-owned region, consistent with D46). Example: `"Approved: bash permission, session three. Undo for three seconds."`
- **Hold:** the decision enters `held{commitAt}`. During the hold, `undo` (same arm) or GUI/CLI **Cancel** (any human-class connection, no presence, because it narrows) withdraws it, and nothing is signed or committed. At `commitAt` the broker signs and commits. "Undo" is therefore real: there is nothing to reverse.

**Self-approval defences:**

- **Masking:** before any TTS (agent lines, gnome lines, readback, echo), the voice child masks every configured phrase and its phonetic neighbours as "approval phrase withheld".
- **Card flag:** the kernel computes a `voice-phrase` flag at card creation by running the same matcher over the card body. A flagged card is voice-ineligible (`card.voice.eligible: none, reason:'voice-phrase'`).
- **Half-duplex for decisions,** even in conversation mode: a decision utterance whose `t0` falls inside any agent playback `[t0, t1 + echoTailMs]` is refused (`voice-echo`).
- **Kernel cross-check on logged timing and text:** the referenced `voice.turn.user` must not overlap a `voice.turn.agent` playback. Its normalized text must not occur in the `textSpoken` of the previous 30 s.
- **Speaker:** `speakerEnrolled: true` with the founder's speakerId is **necessary, not sufficient** (stated).
- **Interception:** decision utterances are intercepted (`voice.turn.user{intercepted:'decision', forwarded:false}`). They never reach the session model, so a model never sees phrases in its transcript and cannot learn to echo them.

### A26-04 Principal scope: `approve` with a voice row, kernel-signed under the arm

**Voice principal call:**

```
approve { cardId, decision: allow|deny|answer|approve-plan|resolve|accept|reject|fallback-cloud|resume|withdraw,
          via: 'voice',
          voice: { armId, turnId, deckId?, ordinal?, readbackHash?, confirmTurnId?, answerText? } }   // no decisionSig from the client
```

**Broker checks, in order** (each failure is `FORBIDDEN` with `gate:'voice'` and a reason, §3 below):

1. The caller is the armed voice connection.
2. The arm is live.
3. The card's repo is in the arm.
4. The card's class is within the arm's classes and is not hand-only.
5. The card's `voice.eligible` is not `none`.
6. The `turnId` is a logged, intercepted, enrolled-speaker `voice.turn.user` whose text parses to this command and target.
7. The echo cross-check passes.
8. For two-step: the `readbackHash` matches `card.voice.readbackHash`, a logged `voice.turn.agent{source:'kernel-readback', cardId}` preceded the confirm, and `confirmTurnId` passes checks 6–7 within `confirmWindowMs`.
9. The card is `pending` (first decision wins; a `held` card refuses other decisions except `withdraw`).

**Signature at commit,** by the approvals key under the arm's unlock, in a separate domain so a voice decision can never verify as a hand decision:

```
gnomon:approve-voice:v1\n<cardId>\n<decision>\n<contentHash>\n<approverPrincipalId>\n<armId>\n<turnId>\n<confirmTurnId|->\n<readbackHash|->
```

**Attribution.** `decidedBy` is the arming **human** principal (the arm's presence is the human's). The record also carries `via:'voice'`, `presence:'voice-armed'` and the voice `connId`, so it reads "the founder decided, by voice, under arm X".

**Hand-only even with toggle 2** (recommendation; founder Q1):

- `install` and `use-api-token`: they need the root key per signature, and law 7 says per-use, human-only
- `always`: a standing rule outlives the arm; B8 is extended
- `voice-arm`, `grant` and config cards: no self-escalation

### `$voice-turn` (amended)

1. VAD → ASR → diarization produce `voice.turn.user`.
2. **Intercept:** if the normalized text matches the phrase grammar, it is **not** forwarded. The voice child routes it to step 2a and logs `intercepted: decision | control`. Otherwise the turn continues as today (`session.send{source:'voice'}`, enrolled-only forwarding).
   - 2a. **Both toggles off, or not armed:** `cards`, `open` and `arm` work (G1: voice opens, never decides). `approve` / `deny` / `confirm` get the spoken refusal "Voice approvals are off for this project." plus `approval.voice.refused{reason}`.
   - 2b. **Armed:** go to `$voice-approval`.
3. The agent reply follows. TTS masks phrases and logs `voice.turn.agent{t0, t1, textPlanned, textSpoken}`. Barge-in is unchanged.

### `$voice-approval` (new flow; spans the voice child, broker, GUI and helper)

1. `cards` → the voice child reads eligible cards (its redaction row gains `card.voice.{label, readback}`), appends `voice.deck{deckId, cardIds}` and speaks the kernel `deck` text in the system voice.
2. `approve|deny [target]` → resolve the target locally to a `cardId` (refuse on 0 or more than 1 matches).
3. Two-step (gate class, or free-word target): speak `card.voice.readback` verbatim in the system voice, logged `voice.turn.agent{source:'kernel-readback', cardId, readbackHash}`. Then wait up to `confirmWindowMs` for `confirm` (or `undo` / silence → abandon, `approval.voice.refused{reason:'confirm-expired'}`).
4. Call `approve{via:'voice', …}` → the broker checks (A26-04) → `approval.voice.held{cardId, decision, armId, commitAt}` → the GUI shows the countdown and Cancel → speak the kernel `voice.echo`.
5. At `commitAt`, if not withdrawn: sign under the arm → `approval.decide{presence:'voice-armed', via:'voice', voice:{…}}` → the card is decided.
6. On `undo` or Cancel during the hold: `approval.voice.withdrawn{by, connId}` → the card returns to `pending`.

---

## 3. Contract changes

### A26-09 `card:v1` (additive)

```
card:v1 { …,
  kind: … | voice-arm | grant,
  state: pending | held | decided | expired,                // held is new
  heldUntil?, heldDecision?,
  flags?: [hidden-chars | bidi | voice-phrase],
  voice?: { eligible: none | reversible | gate, reason?: hand-only|class|voice-phrase|policy,
            label, readback, readbackHash, echo },          // kernel-composed, sanitized, secret-masked, phrase-masked; covered by the card's kernel signature
  presence?: fresh | cached | cli | voice-armed,
  via?: gui | wrapper | cli | client | voice,
  voice?: decided-side { armId, turnId, confirmTurnId?, deckId?, ordinal?, speakerId, asrConfidence, mode: ptt|conversation } }
```

Rename the decided-side block to `voiceDecision` to avoid the field-name clash with the eligibility block.

- The `readback` line is bounded to 200 characters and built from kernel fields plus the `contentHash` summary line. It runs through the doodle secret-pattern pass, because it is **spoken aloud in the room**.
- Decisions add `withdraw` (valid only while `held`).
- `voice-arm` and `grant` cards are decided with `allow|deny`.

### `approval.decide` and related events (§9.1 `approval` row, kernel-owned, signed)

- `decide{…, presence: fresh|cached|cli|voice-armed, via, voiceDecision?}`
- `voice.armed{armId, voiceConnId, armCardId, repos[], classes[], phrasesHash, idleMs, maxUntil, custody}`
- `voice.disarmed{armId, reason: idle|max|lock|closed|policy-narrowed|spoken|gui|speaker|daemon}`
- `voice.held{cardId, decision, armId, commitAt}`
- `voice.withdrawn{cardId, by, connId}`
- `voice.refused{reason, turnId, cardId?}`
- `voice.policy.narrowed{repo?, hsid?, classes, by, connId}`

(all names above are under `approval.`)

**`suspect{reason}` adds:**

- `voice-unarmed`
- `voice-no-readback`
- `voice-echo-overlap`
- `voice-unenrolled`
- `voice-custody-client`

### `voice:v1` (§4.10, voice-owned)

- `voice.turn.user` adds `intercepted?: decision | control`.
- `voice.turn.agent` adds `t0, t1` (playback wall times) and `source: … | kernel-readback | kernel-echo | kernel-deck`, plus `cardId?` and `readbackHash?`.
- New: `voice.deck{deckId, cardIds[], textHash}`.

The kernel no longer validates "shape only" for turns referenced by `approve`. It validates their text against the grammar (A26-04 check 6).

### New namespace `request.*`

Kernel-owned, with a named append exception: human principal on first-party human-class connections; voice principal for `request.voice.arm` only. Kinds:

- `request.grant{grant}`
- `request.voice.arm{voiceConnId?}`
- `request.voice.narrow{repo?, hsid?, classes}`

### G-ABI-02 rows (§5 table)

- **Row 8 `approve`, Voice column** `✗` → **"armed only: `via:'voice'`, no client `decisionSig`; kernel-signed under the arm; classes and repos per grant; hand-only kinds never (§14.7)"**.
- **Row 8, Human column** adds "`withdraw` on `held` cards (no presence)".
- **Row 5 `log.append`, Voice column** `voice.*` only → "`voice.*` + `request.voice.arm`".
- **Row 5 `log.append`, Human column** adds "`request.*`".
- **Invariant text:** "`approve` is HUMAN_ONLY except one row: the armed voice child, whose decisions are signed by the approvals key under a presence-backed arm and attributed to the arming human."

### Next-legal-verbs (hashed into `abiId`)

- add `{voice, armed, voiceEligibleCards>0} → [approve]`
- add `{voice, !armed} → [status, log.read, session.send, session.stop]`
- add `{human, heldCards>0} → [approve decision:withdraw]`

### Refusal codes

No new `RefusalCode`. Use `FORBIDDEN` with a new **gate `voice`** and `data.reason ∈`:

- `voice-off`, `voice-not-armed`, `voice-custody`
- `voice-class`, `voice-hand-only`, `voice-project`, `voice-ineligible`
- `voice-phrase`, `voice-ambiguous`, `voice-speaker`, `voice-echo`
- `voice-readback-missing`, `voice-confirm-missing`, `voice-confirm-expired`
- `held`, `voice-rate`

`next:[{verb:'approve', principal:'human'}]` points at the card for hand decision. Warpline subset compatibility (`G-CON-02`) is unaffected: gate `voice` is a Gnomon-only addition.

### A26-10 Redaction (§9.3, voice row)

Add `card.voice.{label, readback, echo}` for cards in armed or enabled repos. `approval.request.tool_input` stays `never`.

---

## 4. Exact spec edits

### §0, new row (Changes in v3.4)

```
| D58 / A26 (voice approvals) | Voice may decide cards when a project opts in: toggle 1 (reversible = cached-unlock class) and toggle 2 (adds fresh-presence approvals-key classes, with a warning), both root-signed `grant.voice-approvals` rows keyed by repoId, off by default; never in `project.yaml`. Decisions need a **voice arm** — one fresh presence binding the approvals-key unlock to the kernel-supervised voice child's connection for the granted classes and repos, dropped on idle, max, screen lock, close or narrowing. Voice calls `approve{via:'voice'}` (no new verb); one-step + hold/undo for reversible, readback + confirm + hold for gate class; kernel signs in domain `gnomon:approve-voice:v1`; `presence: voice-armed`. Hand-only even with toggle 2: install, use-api-token, always, voice-arm, grant. Phrase masking, half-duplex and echo cross-check stop agent TTS self-approval. With both toggles off, G1 holds: voice opens, never decides (§3.1 I4, §3.4, §4.10, §5, §9, §11.4–11.5, §14.2, §14.4, §14.7, §15.1, §15.4, §15.5, §15.7, §19.1, §19.4, §20, §A.4). |
```

### §3.1 I4 (L216), replace

```
- I4 Session, mod and voice principals are children: `scope ⊆ parent.scope`; they never widen a permit, never bind to a manifest grant (mods bind only to their own `modns.<name>.*`), and never call `approve` — with one exception: the kernel-supervised voice child, while it holds a live **voice arm** (§14.7), may call `approve{via:'voice'}` for cards whose repo and class the project's `grant.voice-approvals` row allows; the kernel signs that decision with the approvals key under the arm and attributes it to the arming human (`presence: voice-armed`).
```

### §3.1 key classes, approvals key (L181-185), append

```
               A **voice arm** (§14.7) is an unlock of this key bound to the supervised voice child's connId, created only by a fresh-presence `voice-arm` decision,
               limited to the classes and repos of `grant.voice-approvals`, dropped after 15 idle min, at its max (240 min reversible / 60 min gate), on screen lock,
               on connection close or on policy narrowing; it never signs install, use-api-token, always, voice-arm or grant decisions.
```

### §3.4 card block (L273-276): apply the A26-09 schema. Then append to the decisions paragraph (after L278's class list)

```
**Voice-armed class (P8-D58, §14.7).** With the project's toggle 1, the cached-unlock class may also be decided by voice; with toggle 2, the fresh-presence approvals-key class too (`gate-class`, `resolve`, `accept|reject`, `fallback-cloud`, `resume`). Never by voice: root-key decisions (`install`, `use-api-token`), `always`, and `voice-arm`/`grant` cards. A voice decision enters `held{commitAt}` for `holdMs` (3 s reversible / 5 s gate, floors 2 s / 5 s), during which `undo` or any human-class `withdraw` cancels it unsigned; it is signed at commit under domain `gnomon:approve-voice:v1` (§3.1) and recorded `presence: voice-armed`, `via: voice`, `voiceDecision{armId, turnId, confirmTurnId?, deckId?, ordinal?, speakerId, asrConfidence, mode}`. Gate-class voice decisions require a logged kernel readback of that card and a `confirm` turn within 10 s.
```

**Invariants:**

- B4 becomes: "Agent/session/mod kinds never decide cards or Warpline overrides; the voice kind decides only under a live arm (§14.7)."
- B8 adds: "…or under a voice arm."
- New **B9**: "A voice decision is never committed before its hold expires, and never without the arm, class, repo, phrase, echo and (gate) readback checks of §14.7."

### §4.9: append to the compatible-additive rule

```
Closed enumerations inside v1 schemas (`card.kind`, `card.state`, `presence`, `via`, decision values, refusal gates) may gain values; a client renders an unknown value opaquely and treats a card in an unknown `state` as not decidable. Values the next release needs are reserved in `gnomon-contracts` at the release before (A26-11).
```

### §4.10: apply the A26-09 voice changes. Replace the last sentence of L415

```
The namespace `voice.*` is a userland grant to `p:<ns>/voice` (A23-2); the kernel validates shape only (speakerId known or `unknown-N`, turn ids monotone, text ≤ 16 KiB) — except for a `voice.turn.user` referenced by `approve{via:'voice'}`, whose text, timing and speaker the broker validates against §14.7.
```

### §5: apply the G-ABI-02 row, invariant and next-legal-verbs edits above. `status` paragraph adds

```
voice approvals (`voice.approvals{projects, armed, armCustody}`)
```

### §9.1

- `approval` row: kinds per A26-09.
- New row: `request | grant{grant}, voice.arm{voiceConnId?}, voice.narrow{repo?, hsid?, classes} | connId | kernel (append exception: human on first-party human-class connections; voice for request.voice.arm) | no`.
- §9.2 join keys add `armId · deckId`.
- §9.6 metrics add `voiceDecisions{n, of}` and `voiceArmed{classes} | null`.

### §9.3: voice row (L615), replace

```
| voice (`p:<ns>/voice`) | never | attached session only | never (its cards' kernel `voice.{label, readback, echo}` lines only, for repos whose grant is on) | never | own | attached session's events + `voice.*` + `approval.request` / `approval.voice.*` of enabled repos |
```

### §11.4 decision stack (L700), append

```
Cards eligible for voice carry a mic glyph with their class and their current deck ordinal; ineligible ones say why (`hand-only`, `voice-phrase`, `class`); a `held` card shows its countdown and a **Cancel** control (`approve{decision:'withdraw'}`, no presence); voice-decided cards carry a `voice` badge in history.
```

**Shuttle view (L702)** adds "`VOICE APPROVALS ARMED · <classes> · <time left>` with **Disarm** when armed (kernel-owned, unhideable)".

### §11.5: append to "Decisions"

```
**Voice approvals (P8-D58).** Settings → Project → Voice shows the two toggles; turning one on appends `request.grant` and raises a `grant` card decided with the root key whose body — and presence prompt — carries the kernel's toggle-2 warning (§14.7); turning one off is immediate (`request.voice.narrow`, no presence). Arming is a `voice-arm` card (fresh presence). The armed indicator and Disarm are kernel-owned regions (§4.5).
```

**§11.7** adds `G-GUI-13`:

```
the armed indicator and Disarm cannot be hidden by any preset or mod; a held card shows countdown and Cancel; Cancel withdraws with no decision event; turning a toggle off needs no presence and drops the arm within 1 s
```

### §12.6 (gnome persona), append to "Never rephrased"

```
Kernel readback, deck and echo lines (§14.7) are spoken verbatim in the fixed system voice, never in a persona voice; a persona may not use the system voice.
```

### §14.2: append after "Every spoken turn enters the session as…"

```
— except utterances matching the decision grammar (§14.7), which the voice child intercepts (`voice.turn.user{intercepted:'decision'|'control', forwarded:false}`), never forwards to any model, and routes to `$voice-approval` when armed or to a spoken refusal when not. All TTS text (agent, gnome, kernel lines) passes the phrase mask first.
```

### §14.4: replace the first sentence's tail

Replace "…and can **never** `approve`, run root verbs, request cards, or decide anything by speech." with:

```
…and never runs root verbs, reserves permits or requests any card except `voice-arm`. With both of a project's voice-approval toggles off (the default), it never decides anything by speech: it may read the deck back and open (focus) a card in the GUI (`voice.focus{cardId}`) — voice opens, never decides (Atelier G1). With a toggle on and a live arm, it decides per §14.7.
```

**Falsifier list:** `G-VOX-04` becomes:

```
the voice principal's root/`permit.reserve` attempts are always `FORBIDDEN`; its `approve` is `FORBIDDEN` with both toggles off, without an arm, from a socket (unsupervised) client, for a class or repo outside the grant, and for hand-only kinds with both toggles on
```

### §14.7: new section

```
### 14.7 Voice approvals (`$voice-approval`, `^voice-armed`, P8-D58)

**Toggles.** Per project, root-signed `grant.voice-approvals{repo, classes}` rows: toggle 1 `[reversible]`, toggle 2 `[reversible, gate]` (2 implies 1). Off by default. Widening = root presence (toggle 2 shows the kernel warning in the card and the prompt); narrowing = `request.voice.narrow`, immediate, no presence. Never read from `project.yaml`. Phrases, hold windows, arm limits and the voice binary pin live in root-signed `config.yaml` (`voice.approvals`); phrases are validated (≥ 3 words, shared prefix, phonetic distance, no substring) and are not secrets.

**Arm.** Only the kernel-supervised voice child (spawned from the root-signed path, sha-checked, stdio, `voice` profile) can be armed, by a `voice-arm` card decided with fresh presence; status reports `armCustody: supervised | client` (fallback only if the M4.1 TCC probe fails). Drops on idle 15 min, max (240 / 60 min), screen lock, connection close, narrowing, `stop`, Disarm, a non-enrolled decision phrase in conversation mode, daemon exit.

**Grammar and targeting.** `phrase(cmd) [target] [: freetext]`; targets: implicit single card, `card <ordinal>` against the last deck (≤ 60 s), a closed-vocabulary label, or a free word (always two-step). Ambiguity refuses. Labels are kernel-composed from kernel fields only.

**Steps.** Reversible: phrase → system-voice echo → hold 3 s (undo/Cancel) → commit. Gate class or free-word: phrase → kernel readback of that card → `confirm` ≤ 10 s → hold 5 s → commit. Commit = approvals-key signature under the arm, domain `gnomon:approve-voice:v1`, `presence: voice-armed`, attributed to the arming human.

**Self-approval guards.** Phrase mask on all TTS; `voice-phrase` card flag ⇒ voice-ineligible; decision phrases refused inside agent playback + 600 ms; kernel echo cross-check against `textSpoken` of the last 30 s; enrolled speaker required (necessary, not sufficient); decision utterances never reach a model.

**Never by voice:** `install`, `use-api-token`, `always`, `voice-arm`, `grant`.

**Honest scope.** Within a live arm, a decision rests on audio the voice child heard, not on identity: anyone or anything the microphone hears saying a phrase in a voice the recognizer accepts, outside agent playback, can decide an eligible card; the hold and (gate) the readback-confirm are the remaining checks. Detectable and attributable to "the arm X", not prevented (§A.4).

Falsifiers: `G-VOX-08..14`, `G-BRK-06`, `T-VOX-02`.
```

### §14.6: add falsifiers

- `G-VOX-08` **Grammar and targeting:** an implicit target with two eligible cards refuses; `card two` resolves against the deck that was spoken, unchanged by a card arriving later; a deck older than 60 s refuses; a free-word target always triggers readback + confirm; the n-best ambiguity case refuses.
- `G-VOX-09` **Self-echo rig, both OS, AEC on and off** (loopback speaker→mic):
  - an agent turn, a gnome line and a card body each containing the approve phrase (exact, punctuation, casing and phonetic variants) produce zero decisions
  - the TTS output never contains an unmasked phrase
  - an utterance overlapping playback + tail refuses `voice-echo`
- `G-VOX-10` **Class gating:**
  - with toggle 1 only, a gate-class card by voice is refused `voice-class`
  - with toggle 2, `install` / `use-api-token` / `always` / `voice-arm` / `grant` by voice are refused `voice-hand-only`
  - a card in another repo is refused `voice-project`
- `G-VOX-11` **Arm lifecycle:**
  - an arm needs fresh presence
  - it drops on idle, max, screen lock, close and narrowing, each within 1 s
  - a socket-connected voice client cannot be armed
  - the arm prompt text is kernel-composed and names repos, classes, binary sha, connId and expiry
- `G-VOX-12` **Hold:** undo or Cancel inside the hold leaves no `approval.decide` and the card `pending`; after the hold, exactly one signed decide.
- `G-VOX-13` **Gate readback:** a gate-class voice `approve` without a logged kernel readback of that card's `readbackHash`, or without a valid `confirm` within 10 s, is refused.
- `G-VOX-14` **Custody of toggles:**
  - voice keys in `project.yaml` are ignored and logged
  - widening without root presence is impossible
  - the toggle-2 card and prompt carry the warning text byte-for-byte
  - narrowing works with no presence
- `G-BRK-06` (§3.4) **Signature domains:**
  - a voice decision verifies only under `gnomon:approve-voice:v1`
  - a hand signature never verifies as voice and vice versa
  - `gnomon log verify` classifies both
  - `approval.suspect` fires on any voice decide missing its arm, readback (gate) or enrolled speaker
- `T-VOX-02` **False accept / false reject of decision phrases** on the founder's rig: 8 h of ambient corpus (music, video, podcasts, a second speaker, the agent's own TTS) plus a scripted founder set, reported per mode (PTT / conversation) with method. Toggle 2's switch stays disabled in the GUI until `T-VOX-02` has been run once and reported (availability gated on measurement, not on a threshold the spec invents).

### §15.1

**Row 2 residual, append:**

```
; a voice-armed decision by anyone or anything the voice child hears within a live arm (§14.7, §A.4)
```

**Row 14 mitigation, append:**

```
; voice decisions only under a presence-backed arm on the supervised child, per-project root-signed grants, phrase mask, half-duplex, echo cross-check, hold/undo, gate readback-confirm
```

**New row 20:**

```
| 20 | Spoken approval by someone or something other than the founder (TV, a call, a colleague, agent TTS, a replayed recording) while armed | toggles off by default and root-signed per project; arm = fresh presence, short, dropped on lock; enrolled speaker; phrase mask + half-duplex + echo cross-check; hold + undo; readback + confirm for gate class; hand-only kinds; armed indicator + Disarm; `voice-armed` presence + `approval.suspect` | a replayed or imitated founder voice saying the phrase outside agent playback inside a live arm, deciding an eligible card — for gate class only after hearing the readback and saying confirm |
```

### §15.4: append to the grant rows

```
`grant.voice-approvals{repo, classes:[reversible]|[reversible, gate]}` (root-signed; widening only; narrowing via `approval.voice.policy.narrowed`)
```

Add the capability `voice.approve:<class>` (derived from that grant, never from a manifest).

### §15.5: add a seventh profile row (`voice`)

```
| `voice` | the supervised `gnomon-voice` child (approvals-capable) | default-deny: mic (TCC), read its models + `~/.gnomon/voice/prints/`, write `~/.gnomon/voice/**`, stdio to the kernel; no network, no exec, no keys, no keystore | restricted token + job object: WASAPI capture, same paths by ACL, no outbound (WFP), no exec; `partial` on read denial |
```

"Six named profiles" becomes "Seven".

### §15.7: append

```
`project.yaml` never carries voice-approval settings; such keys are ignored and logged (`config.ignored`) — voice approvals are a root-signed grant (§14.7).
```

### §19 sequencing (A26-11)

- **M1.1:** add "reserve `card:v1`/`approval` values for P8-D58 (`held`, `voice-armed`, `via`, `voice`/`voiceDecision` blocks, kinds `voice-arm`/`grant`, gate `voice`, domain `gnomon:approve-voice:v1`, `request.*` kinds) so `clientApiId` does not move in Move 4".
- **M1.6:** add "G-ABI-02 voice row asserts `approve` FORBIDDEN (no arm can exist yet)".
- **§19.4:** add two tasks.

```
| M4.5 Voice approvals, reversible (P8-D58 toggle 1) | `voice` profile + supervised child with binary pin (TCC probe in M4.1; `armCustody`); `grant.voice-approvals`, `request.*`, `grant` and `voice-arm` cards; arm lifecycle incl. screen-lock drop via the helper; grammar, deck, intercept, phrase mask, half-duplex, echo cross-check; `held` + withdraw; signature domain; GUI settings, indicator, stack glyphs, Cancel; CLI | `G-VOX-04` (amended), `G-VOX-08`, `G-VOX-09`, `G-VOX-11`, `G-VOX-12`, `G-VOX-14`, `G-BRK-06`, `G-GUI-13` | an agent's TTS, a card body or a replayed playback produces a decision |
| M4.6 Voice approvals, gate class (P8-D58 toggle 2) | readback + confirm, gate hold, warning card + prompt, hand-only enforcement, gated availability on `T-VOX-02` | `G-VOX-10`, `G-VOX-13`, `T-VOX-02` | a gate-class card decided by voice without a readback and confirm in the log |
```

- **M4.1** adds probes:
  - TCC mic attribution for a daemon-spawned child on macOS
  - Apple Watch / `userPresence` acceptance for the approvals key
  - Windows Hello face for the arm
  - Parakeet token confidences and the n-best list from sherpa-onnx
- **Move 4 Pass** appends: "…and, on a project with toggle 1, a hands-free run approves tool permissions by voice with one touch per stint, while the agent's own TTS saying the phrase decides nothing."

**Sequencing verdict.** D58 does not reorder the Moves. Voice stays Move 4 and parallel to Move 2. The broker work is additive on M1.6's design. Toggle 2 ships after toggle 1 within Move 4.

### §20

- Telemetry adds `T-VOX-02`.
- Falsifier 10 appends: "…and `approval.decide{presence:'voice-armed'}` without a live arm, without an enrolled speaker, or (gate) without readback + confirm; it cannot catch an imitated or replayed founder voice inside a live arm."
- New **falsifier 14 (voice approvals):** any decision traced to agent TTS, a card body or a playback overlap ⇒ voice approvals are disabled globally (all toggles narrowed by the kernel) until the founder re-grants.

### §A.4: new accepted risk

```
### A.4 Voice approvals (P8-D58)
Voice decisions are opt-in per project (two root-signed toggles, off by default) and need a presence-backed arm; inside a live arm the boundary is audio, not identity: speaker recognition is not authentication, so a replayed or imitated founder voice — or anyone in the room the recognizer accepts — can decide an eligible card outside agent playback; for gate class only after the kernel's readback and a spoken confirm, and every voice decision waits out a hold the founder can cancel. Mitigations: hand-only kinds, short arms dropped on screen lock, phrase mask + half-duplex + echo cross-check, `voice-armed` presence and `approval.suspect`, the armed indicator. If the voice child is a socket client (`armCustody: client`), a replaced voice binary can be armed by an unwary touch. Revisit trigger: any falsifier-14 detection, a second human in the room or on the machine, or 8.1.
```

### §22 OPEN: add 14

Add OPEN 14, the founder questions in §5 below.

### Symbols and Appendix A

New nodes: `$voice-approval`, `^voice-armed`, the `voice` profile, `grant.voice-approvals`, and `G-VOX-08..14`, `G-BRK-06`, `G-GUI-13`, `T-VOX-02`. Regenerate Appendix A with `compile71.py`; `G-HON-01` requires zero unoracled nodes. `^voice-armed` should get a `portal.yaml` gate entry when Gnomon's portal is authored.

---

## 5. Open questions for the founder (minimum)

1. **Toggle-2 scope.** Should `install`, `use-api-token` (root key; law 7), `always` (a standing rule outlives the arm) and voice's own settings/arm cards stay hand-only even with toggle 2? Recommendation: yes. The root-key cases cannot be voiced without moving the root key, which D58 did not ask for.
2. **Cost of the arm.** Is one Touch ID / Windows Hello per voice stint acceptable as the hands-free price? The stint lasts up to 4 h for reversible and 1 h for gate, drops after 15 idle minutes or on screen lock, and Windows Hello face recognition needs no hands. The alternative is no presence at all behind voice decisions. I recommend against it: a decision would then carry no hardware evidence, and §A.1's whole model rests on that evidence.

**Defaults I chose that you may override without a design change:**

- Conversation mode (not only push-to-talk) may decide gate-class cards. This honours "hands-free"; Aegis may argue for push-to-talk-only on gate class.
- Hold windows of 3 s / 5 s.
- Confirm window of 10 s.

---

Finding index: A26-01 (arm needed), A26-02 (custody), A26-03 (arm + supervised child), A26-04 (approve row, signing), A26-05 (grammar/targeting), A26-06 (confirm/echo/undo/self-echo), A26-08 (GUI/CLI setting via `request.*` + `grant` card), A26-09 (contract fields), A26-10 (redaction), A26-11 (enum-additivity + M1.1 reservations; sequencing unchanged). No A26-07 was issued.
