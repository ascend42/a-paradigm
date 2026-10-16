# Gnome Persona — a dialog voice and a body for every Gnomon session

Note (2026-10-16): spec v3.2 supersedes parts of this concept. The Tier 1 local restyle is dropped (P8-D52: no restyling, brevity by instruction), and the shell is a localhost GUI, not an in-terminal TUI (P8-D50), so the papercraft breeze, shadow and grain render in the GUI. See docs/specs/gnomon.md §12.6.

Status: concept / ideation (not a build spec). Target: Gnomon 8.0 first-party mod on `mod-abi:v1`.
Parent spec: `docs/specs/gnomon.md` (§4.5 display-block, §11 TUI, §12 mods, §14 voice, laws §10).
Aesthetic decisions: `.atelier/sessions/2026-10-15-gnomon-aesthetic/session.yaml` (light = papercraft, dark = phosphor, Workshop mod with caps).
UX rules applied: `a-atelier/docs/playbook/rules.yaml` — `explain-by-sources-not-narration`, `decision-card-anatomy`, `disclose-ai-involvement`, `agent-work-auditable`, `clarifiers-capped-with-escape`, `voice-short-answer-detail-on-screen`, `reduced-motion-honored`, `color-never-sole-signal`, `ai-quality-measured-not-demoed`.

Everything below is a proposal for the founder to accept, reshape or kill. Where it touches the kernel, the doc says so and stops.

---

## 0. The founder's idea, verbatim

These three quotes are the brief. The rest of this document is an attempt to make them true without breaking the seven laws or the calibrated-trust rules.

```
little triangles slightly skewing to the breeze of the wind with a diagnoal shadow casting
from the top left corner to bottom right on each gnome. the nomes have a soft almost textured
feeling to the paper.
```

```
gnomon's need a 'language' style. in the sense that maybe certain nomons can have a personality
speak because we both know that output completion blocks ... is extrmeley verbose but a person
might want the tool Gnomon to speak back but in simple setences that are more question and answer
and brief update akin to a feeling of dialog boxes in video games. the system tracks the completion
and the raw but the relay always goes through this filter of changing the output message which can
not only save tokens but also always the user to direct the next pieces / research into things /
ask adjacent work questions etc
```

```
i want each gnomon to have a body that is comprised of body and hat. some could be different
colors, different shapes, user can deside to customize look of them in a mod or always via asking
their cluade to edit the mods to a style while the tool is open. bodies are like a short to tall
rectangels, trnagles, ricles. each shape can have an animation set for walking, waiting,
affirmation of yes or no, understood, sorry. if a user adds in custom phrases or words that when
in the response output can make gnomon emote a certain way. eventually people will think of
speaking and talking to their gnomon which is just a skin and protocol on their AI model
```

---

## 1. Vision

A Gnomon session gets a small paper figure (body + hat) and a dialog voice. Instead of reading a 600-token completion block, the operator reads two sentences in a game-style dialog box — "Three files written in src/billing/. Tests: 12 of 12 pass." — followed by up to four choices: carry on, dig into something, ask an adjacent question, or open the raw. The raw completion, every tool call and every kernel event stay exactly where they are today (the hash-chained log, the transcript pane), one key away. The gnome emotes on kernel facts — a nod on an approval, a shake on a deny, a small bow on an error — never on what the model says about itself. The persona is a file any agent can edit live, so "make my reviewer gnome terse and blue" is a sentence, not a build.

Why it matters: dialog-first UX is how the operator will actually run an armada. A person glancing at eight sessions cannot read eight completion blocks; they can read eight lines and eight faces. Companionship is real value here (people keep tools they like looking at), but it is also where agent products lie — "I understand", "I'm confident", a smiling face over a failed test. This mod's whole discipline is companionship without false capability claims: the body is a skin, the voice is a relay, and both say so on screen. The founder's last sentence is the thesis: people will talk to their gnomon, which is "just a skin and protocol on their AI model". The skin must never pretend to be more than the protocol underneath it.

---

## 2. The relay: dialog voice

### 2.1 Architecture

```
  backend driver events ──► kernel-log (hash-chained, complete, unchanged)      ← truth; `r` opens it
        │  turn.partial · turn.event · tool.result · turn.result
        │  approval.* · permit.* · session.* · oracle.result · refusal
        ▼
  gnome-persona mod (child, `mod` profile) ── event{event:v1} feed (grant-bound)
        │
        ├─ Tier 0  status templates   (deterministic, persona-authored strings, kernel fields only)
        ├─ Tier 2  model-authored tail (the session model writes `say` + `choices` itself)
        └─ Tier 1  local restyle      (gnomon-local, small model, span-grounded paraphrase; fallback)
        ▼
  display-block:v1  →  gnome.dialog view:  [body+hat]  "line"  · mode label · choices (kit.Button→command)
                                           modns.gnome.line {turn, mode, spanRefs, lenTokens}  → log
```

The relay consumes events, never the transcript widget. It emits a `display-block:v1` tree per turn (so it renders identically in the TUI, Conductor, constellation, the Mod band) and appends one `modns.gnome.line` event per line so the dialog itself is in the log. "Model-visible ⟺ logged" (spec §9.7, law 2) holds in both directions: nothing the gnome shows is absent from the chain, and nothing the gnome says reaches the model unless it went through `session.send` as a logged turn.

Kernel log, always kept: the raw is not an archive the gnome summarizes once and discards. It is the primary record; the dialog line is a derived view over it, like the Shuttle view is a derived view over sessions. If the relay crashes (`G-MOD-03`), the transcript pane is simply what you see.

### 2.2 Who runs the filter (three tiers, in order of preference)

Tier 0 — deterministic templates for status. Every kernel event with a fixed shape gets a persona-authored string with slot fills from kernel fields only: `approval.request{kind}` → "A {kind} card is waiting." · `permit.deny` → "Blocked: no permit ({dimension} at {n} of {of})." · `session.exited{code}` → "Session ended, exit {code}." · `oracle.result{pass:true}` → "Certified: {nodeId} ({n} of {of})." · `turn.sent` → "Noted." Zero model tokens, zero latency, no paraphrase risk. Expected to cover most of what an operator glances at during an armada run.

Tier 2 — the session model writes the dialog itself. When the persona is on, the session receives a short standing instruction (as a mod-shipped skill, §6) to end each turn with a fenced tail:

```
<gnome say="Three files written in src/billing/. Tests: 12 of 12 pass."
       choices="run the e2e suite | show the diff | why did invoice.ts change | something else" />
```

The relay splits the tail from the prose, renders `say` as a quote (it is the model's own words, labelled so), and turns `choices` into buttons. The prose stays in the transcript. This is the only tier that can actually save generation tokens (see 2.3), because the model may now be told to keep the prose short too.

Tier 1 — a local small model restyles. When a turn has no tail (model ignored the skill, local backend without the skill, a 7.x transcript), `gnomon-local` with a 1–4B instruct model (Qwen-class) produces a ≤ 2-sentence paraphrase plus ≤ 4 choices. Constraint: span-grounded. Each sentence must align (fuzzy, ≥ 0.8 token overlap) to a span in the raw message prose; each number must appear verbatim in the raw; a sentence that fails grounding is replaced by a verbatim quote of the raw's first sentence and the mode label flips to `quote`. Tool results are never input to the paraphraser — only the model's own message text — so a hostile file cannot author the gnome's line.

Claude never runs the relay as a second call. A second Claude call to shorten a Claude completion costs strictly more than the completion did. The founder's "save tokens" is achievable only through Tier 2's brevity instruction, through choices, and through Tier 1 being local — not through restyling as such.

### 2.3 Honest token analysis

Restyling output after the fact does not reduce generation tokens: the raw completion has already been paid for (in subscription-window usage under law 7). What does save:

1. Brevity instruction (Tier 2). The model's closing prose in a Claude Code turn is typically 150–800 output tokens; a `say` tail is 20–60. If the skill also says "keep closing prose to the facts; the dialog tail is the summary", a turn's final prose can drop by roughly 60–80 %. But closing prose is a small share of a tool-using turn — tool calls, file reads and tool results dominate. Realistic effect on total turn usage: on the order of 3–10 %, not 50 %. Say so in the UI; never market this as a token saver.

2. Choices narrow follow-ups. A picked chip ("show the diff") is a precise next turn; a typed vague question ("wait what changed?") often costs a clarifying round-trip. If choices avoid one clarifying turn in every 5–10 turns, that is a 10–20 % reduction in turn count on conversational stretches — larger than (1), and the honest reason this mod is worth building for budget. Measure it: `modns.gnome.choice.picked` vs typed follow-ups per session.

3. Local restyle (Tier 1) costs zero subscription usage and ~0.3–1.0 s on Apple silicon for ~800 tokens in / ~60 out. It costs compute permits (law 1 applies to local sessions) and adds latency after `turn.result`. It never saves cloud tokens; it only avoids spending them on the restyle.

4. Tier 0 is free in every dimension and should carry as much as possible.

Net: the mod is a readability and steering instrument first; its budget effect comes from fewer turns, modestly shorter prose, and nothing else. `G-HON-*` wording rules apply to any copy that mentions savings.

### 2.4 Hard invariants (the relay's law)

- Never rephrase: card bodies (`inbox.card`, `ask-user`, `plan`, `knot.split`, `budget.meter`), refusals (`refusal:v1` text), billing (`API CREDITS ACTIVE`, `api-token`), security/approval text, certification results. These are kernel-owned regions per §4.5 and unreplaceable by construction (`G-MOD-07`); the gnome may announce their existence by kind and `{n, of}` only — "A permission card is waiting." — and must step aside while a card is focused. Decision cards are never read back in the gnome's words, ever (rules: `decision-card-anatomy`, `decision-critical-facts-first`).
- Never invent facts not in the raw. Enforced by span-grounding in Tier 1, by labelling in Tier 2 (the model's own words, so any invention is the model's and is in the transcript too), and by a falsifier: `G-GNM-01` no `modns.gnome.line` contains a number, path or identifier absent from its source turn.
- Mark paraphrase vs quote vs status. Every line carries a visible mode label in the footer: `status` (Tier 0), `quote` (Tier 2 or verbatim), `paraphrase` (Tier 1), plus `mod:gnome-persona` per the fencing rule. The AI label is never a button (rule `disclose-ai-involvement`).
- Raw always inspectable. `r` on a dialog line opens the source turn in the transcript at that turn; `R` opens the kernel-log slice (`gnomon log --turn`). The choice "show raw" is always present as the last chip or as the key hint.
- The gnome never decides. Choices are follow-up prompts, never approvals. The mod's manifest cannot request `approve` (§12.4); a choice whose text pattern-matches a decision verb on a focused card is refused by the mod itself before it reaches `session.send`.
- Reserved keys untouched. `y n a d Enter Esc` and digits while a card is focused are never bound to choices (`G-MOD-06`). Choices use digits only when no card is focused, letters otherwise.
- Sanitized like everything else: every string through the §4.5 sanitizer before render or log.

### 2.5 Choices as the steering mechanism

Four fixed semantic slots, optionally filled with turn-specific text:

| Slot | Default label | What it sends |
|---|---|---|
| next | "carry on" | `session.send` of the persona's `continue` phrase, or the model's proposed next step verbatim |
| deeper | "dig into {x}" | a question about the thing the line named (model-proposed or extracted span) |
| adjacent | "ask something near this" | opens the composer pre-filled with the line's subject as context, cursor at the end |
| raw | "show raw" | view toggle only, no turn, no spend |

Cap of four, always an escape (rule `clarifiers-capped-with-escape`: ≤ 4, "something else" or free text always available). Every choice that sends a turn draws on the attached session's permit (mod effect `spend`), goes through `kernel.call{verb:'session.send'}` under the mod's principal with the caller's hsid attached, and is only ever fired by a user keystroke (`G-TUI-04` extends to mod commands).

---

## 3. Persona protocol: `persona:v1`

A persona is a small YAML document, one per gnome, readable and writable by agents through the mod's tools. Personas live in the mod's per-mod state (`state.set`), not in the mod's package tree, because any edited file inside an installed mod stops it loading until re-carded (`G-MOD-05`, `packageHash`). That is exactly the property the founder wants: "ask Claude to edit the mod to a style while the tool is open" becomes a tool call that hot-applies, not a reinstall.

```yaml
schemaVersion: persona:v1
id: reviewer-ink
name: Ink
binds:                      # which sessions wear this persona
  role: reviewer            # builder | reviewer | teacher | tender | any
  backend: any              # claude | local | any
voice:
  register: terse           # terse | plain | warm   (tone only; never capability)
  person: none              # none (telegraphic, game-dialog) | first | third
  tense: past-fact          # "Ran 12 tests." not "I'll run the tests."
  length: { maxSentences: 2, maxWords: 28, maxChoices: 4 }
  vocabulary:
    forbid: [understand, think, feel, know, believe, sure, confident, realize, happy to, obviously]
    prefer:
      acknowledged: ["Noted.", "Got it, queued."]
      done: ["Done.", "Finished."]
      failed: ["That failed:", "Stopped:"]
      waiting: ["Waiting on you:", "Needs a decision:"]
    continue: "carry on"
  status:                   # Tier 0 templates; slots are kernel fields only
    approval.request: "A {kind} card is waiting."
    permit.deny: "Blocked: {dimension} at {n} of {of}."
    oracle.result.pass: "Certified {nodeId} ({n} of {of})."
    session.exited: "Session ended, exit {code}."
emote:                      # secondary layer; kernel events are primary (see §4.3)
  phrases:                  # matched on the model's own prose only, never tool results
    "all green": wave
    "heads up": tilt
    "rolled back": bow
  allow: [wave, tilt, bow, blink, bounce]   # yes/no/sorry are reserved for kernel events
body:
  shape: triangle           # rect-short | rect-tall | triangle | circle
  height: 3                 # TUI rows (2–4); GUI scales
  hue: project              # project (soft hue from Workshop) | a named token from the palette
  texture: paper            # paper | flat   (GUI only; TUI ignores)
hat:                        # style only; semantics are Workshop's (shape = work type, fill = backend, violet = KNOT)
  style: folded             # folded | peaked | flat-cap | none
tts:
  voice: kokoro:af_sky
  rate: 1.0
motion:
  breeze: 1.0               # 0 disables; reduced-motion forces 0
  emoteDuration: 600        # ms, GUI; TUI uses frame swaps on events
```

Roles without misleading anthropomorphism. A reviewer gnome is terse and past-fact; a teacher gnome is `plain`, allowed one more sentence, and may use the `prefer.waiting` idiom more. None of them gets a different set of truths — the register changes, the facts and labels do not. The calibrated-trust rules are baked into the vocabulary block:

- `understood` emote = acknowledged receipt. The line says "Noted." or "Got it, queued." — a receipt idiom. It never says "I understand" (rule `explain-by-sources-not-narration`: personality in tone, capability claims factual).
- `sorry` emote = an error or refusal happened. The line pairs the courtesy with the fact and the limit: "Sorry — stopped: tsc exit 1." or "Sorry — blocked by the budget fuse (90 of 100)." (rule `ai-failure-explains-limit`). Courtesy is allowed; a claim of regret-as-insight is not.
- `yes`/`no` emotes are reserved for kernel decision events (an approval or a deny by the human), never for the model agreeing with the user.
- No "thinking" pose. While a turn streams, the gnome walks (works). Status copy says what happened ("read 4 files"), not what was thought.

Live editing. Agent-facing tools exposed through the per-session `gnomon-mods` MCP server (§12.3, A23-3): `persona.get{id}`, `persona.set{id, patch}` (JSON-merge patch; validated against `persona:v1`; `forbid` list may be extended but its defaults cannot be removed — that is the one non-negotiable field), `persona.preview{id, fixture}` (renders a fixture to a block so the agent can show the user before applying). Every change logs `modns.gnome.persona.changed{id, hash, by: principalId}`; the TUI footer shows "persona changed by {by}" once. Rollback is `persona.set` with the previous hash from the log.

---

## 4. Bodies and animation

### 4.1 Body + hat

Body shapes: short rectangle, tall rectangle, triangle, circle — the founder's set. Hat on top. Reconciled with the aesthetic session's Workshop decision, which already assigned the hat meaning (shape = work type, filled = Claude, outlined = local, soft hue = project, violet only for KNOT): the hat tells the truth, the body is yours. A persona chooses hat style (folded, peaked, flat cap) within the work-type silhouette and cannot override fill or hue semantics; the body's shape, height, hue and texture are free. This keeps one glance honest across the Workshop and the stage: a violet hat is always a KNOT, whatever the gnome looks like.

Colour: project hue on the body by default (the Workshop's soft hues; sage measured 3.96:1 on paper so hue is a fill, never text). State is never colour-only (rule `color-never-sole-signal`): every emote has a pose and a text label, and the dialog line itself is the primary signal.

### 4.2 The animation set, per shape

| Emote | Meaning (label shown to a11y / log) | Triangle | Rectangles | Circle |
|---|---|---|---|---|
| walk | working (turn streaming) | lean-step alternation | foot-shuffle, hat bob | roll a quarter turn |
| wait | idle, nothing streaming | still, breeze only | still | still |
| yes | human approved / oracle passed | tip forward once | nod (compress 10 %) | bounce once |
| no | human denied / oracle failed | lean back once | shake (±4 px) | wobble |
| acknowledged | turn received | brief blink or hat tilt | hat tilt | blink |
| sorry | error / refusal / permit denied | bow (apex dips, shadow shortens) | slump | deflate 5 % |
| certified (variant of yes) | contract node certified | hat lifts and resettles | hat lifts | hat lifts |

Each emote has a GUI version (duration from `motion.emoteDuration`, eased) and a TUI version (a single frame swap: 2–3 glyph frames per emote, advanced only on the next event — see 4.4).

### 4.3 Triggers: kernel events first, phrases second

Primary — kernel events, which cannot be faked by model text:

| Event | Emote |
|---|---|
| `turn.partial` (streaming) | walk |
| `turn.sent` | acknowledged |
| `approval.decide{allow\|always\|approve-plan\|answer}` | yes |
| `approval.decide{deny\|reject}` | no |
| `approval.request` | wait + the Workshop's "needs you" placement |
| `permit.deny`, `session.refused`, `tool.result{error}`, `refusal` | sorry |
| `oracle.result{pass:true}`, contract node certified | certified |
| `oracle.result{pass:false}` | no |
| `session.exited` | wait, then fade / sit down |
| idle (no events) | wait |

Secondary — custom phrases from `emote.phrases`. Matched on the model's own prose only (never tool results, never card text), case-insensitive, whole-word. Phrases can only trigger the expressive subset (`wave`, `tilt`, `bow`, `blink`, `bounce`); they can never trigger `yes`, `no` or `certified`, because those must mean a human or an oracle acted. This closes the injection path where a file containing "all tests pass" would make the gnome nod.

### 4.4 Rendering: papercraft (light), phosphor (dark), terminal

Papercraft (GUI clients: Conductor, constellation, a future web client; light mode): cut-paper sheets. Breeze: each triangle skews by a slow sine, ±2–3° about its base, period 4–7 s, per-gnome phase offset so a row never moves in unison; rectangles and circles sway less (±1°). Shadow: a single soft drop shadow offset top-left → bottom-right (about 2 px, 3 px, blur 2–3 px, 18–24 % ink) plus a hairline darker edge on the bottom-right sides so the sheet reads as lifted; the shadow shortens on `sorry` and lengthens on `yes` so the figure appears to lift. Texture: a grain layer (noise, multiply, 3–5 % opacity) over body and hat; a single fold line on the hat. Ink lines, pressable keys for choices, per the session's Paper-atelier decision.

Phosphor (GUI dark, and the TUI's default dark): glyph gnomes in mono, glow as a text-shadow in the GUI, bracketed choices `[1 carry on]`, no skew (a glowing triangle that leans reads as a glitch); shadow becomes a dim offset duplicate one cell down-right.

Terminal (`#tui`): a gnome is 2–4 rows × 3–5 columns of glyphs — `▲` apex over `▟█▙` for a triangle, `▇`/`█` stacks for rectangles, `●`/`◉` for circles; hats `▲ ◆ ▬ ⌂` after Workshop's hat-shape table; shadow = one dim `▞` or `░` cell down-right; paper texture = none (a single dim `░` cell behind is the most a cell grid will give). Motion in the TUI is frames swapped on events: `G-TUI-02` demands zero renders while socket and keyboard are silent, and the Workshop override permits motion only while a session streams — every `turn.partial` is an event, so the walk cycle advances per partial and stops when the stream stops. There is no breeze in the terminal; a timer would break the invariant. Honest summary: the paper feeling lives in the GUI clients; the terminal gets a glyph with a shadow cell and event-driven poses, and the same `persona:v1` drives both.

Reduced motion (`prefers-reduced-motion`, or the TUI setting `motion: reduced|off`): breeze frozen at a fixed phase, emotes become instant pose changes (no tweens), nothing loops, the walk becomes a static "working" pose with the glyph label. Nothing ever flashes more than three times a second. Every emote has a text label in the accessibility tree and the log, so a screen-reader or NO_COLOR user gets "acknowledged", "sorry: permit denied" as text.

---

## 5. Voice

The dialog line is what gets spoken. `#gnomon-voice` (§14) already distinguishes `textPlanned` from `textSpoken` and already requires a spoken summary distinct from the full text answer (§14.2). The gnome line is that summary: the voice client takes `modns.gnome.line.say` as `textPlanned` for `voice.turn.agent{source: claude|local}` and the persona's `tts.voice` as `ttsVoice`. Choices are not read aloud as a list (rule `voice-short-answer-detail-on-screen`); the client appends one spoken clause — "Pick one on screen, or ask." The §14.2 local acknowledgement that bridges Claude's TTFT is the gnome's `acknowledged` emote with the persona's `prefer.acknowledged` string ("Noted."), logged `source: local-ack`.

Status lines (Tier 0) are speakable as-is. Card announcements are spoken by kind only ("A permission card is waiting."); nothing in a card body is ever spoken by the gnome, and no voice can approve (`G-VOX-04`); the gnome's principal has the same wall. Barge-in truncates the gnome's line like any other agent turn. Per-gnome voices give an armada different speakers for different roles, which is the one place anthropomorphism earns its keep: the ear tells reviewer from builder before the eye does.

---

## 6. Where it lives

A first-party mod, `gnome-persona` (`manifest:v1 {kind: mod, abi: "mod-abi:v1"}`, trust tier `first-party`), one child process under the `mod` profile.

Views (pure `render(input) → display-block:v1`, with fixtures and golden renders on both OS):
- `gnome.dialog` — the dialog box: body+hat glyph/sheet, the line, the mode label, the choices. Slot: a transcript footer or its own pane; `card.detail:*` is append-only and the gnome never renders inside a card.
- `gnome.stage` — the bodies at work, two zones as the Workshop decision says ("needs you" lined up with their question kind; "working" moving while streaming). Likely the Workshop view grown a body, or a sibling view sharing the same `persona:v1` files; to be decided (open question 2).
- `gnome.persona` — the persona editor/preview, so a human can tune without an agent.

Commands: `gnome.next`, `gnome.deeper`, `gnome.adjacent`, `gnome.raw`, `gnome.mute` (dialog off, transcript only), `gnome.persona.edit`. Keybindings respect the reserved set.

Tools (agent-facing via `gnomon-mods` MCP): `persona.get`, `persona.set`, `persona.preview`.

Events (`modns.gnome.*`): `line{turn, mode: status|quote|paraphrase, spanRefs[], lenTokens, personaHash}`, `choice.picked{turn, slot, text}`, `emote{name, cause: eventId|phrase, personaId}`, `persona.changed{id, hash, by}`.

Effects declared: `read` (event feed, view inputs, state.get), `write` (state.set for personas, `log.append` of `modns.gnome.*`), `spend` (choices that send a turn draw on the attached session's permit; the Tier 1 local restyle consumes compute permits). No `network`; the mod talks to the local model through the kernel, never a socket of its own.

Kernel / ABI changes needed: none that break law 3, and the doc wants to keep it that way. Specifically:
1. Message text in the feed. Tier 1 and the phrase layer need the model's prose from `turn.event` bodies, which the redaction matrix marks sensitive. This is a grant row (the install card names it: "reads message text of sessions it is attached to"), not an ABI change. Tool results are not requested.
2. The Tier 2 tail instruction. The kernel composes no prompts of its own beyond the pointer line and the adapters' envelope (§2.1), and `mod-abi:v1` has no "contribute to the session envelope" RPC — and it is already at its eight. So in 8.0 the instruction ships as a mod-provided skill that the session loads like any other; the model may ignore it, and Tier 1 catches that. If the skill route proves unreliable, an envelope contribution is an 8.1 ABI question, not an 8.0 patch.
3. Local restyle as a session. The cleanest law-abiding path is `kernel.call{verb:'session.open', model:'local'}` under the mod's principal, so compute permits and `nothing spends by default` apply unchanged. Whether a mod may hold a long-lived local session is a grant-table question (open question 4).
4. Voice. The voice client needs to accept a mod event as its speakable source. That is a userland change in `gnomon-voice`, not the kernel.
5. Motion preference. `view.render{viewId, input, width, cancelToken}` already passes host-side input; the host adds `prefs.motion` to `input`. No shape change to the RPC.

---

## 7. Risks and honest edges

- Trust miscalibration. A friendly face over a paraphrase raises confidence beyond what the raw earns (the citations note in the rules says the same about citations). Mitigations: mode label on every line, `r` always one key away, `yes`/`no` reserved for kernel events, forbidden-vocabulary defaults that cannot be removed. Residual: the operator may still skim the face and skip the raw; measure it (choice `raw` rate vs lines shown) and revisit.
- Cute over useful. If the stage becomes the thing people watch, it has failed the "instrument glanced at many times a day" read. Default off for the stage; default on for the dialog line; both one toggle from off.
- Paraphrase drops a caveat. A 28-word line can omit "but the migration is untested". Span-grounding stops invention, not omission. Tier 2 (the model writes its own line) is better here because the model knows what matters; Tier 1 is explicitly a fallback. Falsifier `G-GNM-02`: on a fixture set of N completions × K runs, the rate of omitted "but/however/except" clauses is reported with method, never claimed.
- Latency. Tier 2 arrives with the completion (no cost). Tier 1 adds 0.3–1.0 s after `turn.result` on a laptop and more on a busy GPU; the box shows the walk frame and "…" until then, never a stale line. On low-end machines Tier 1 should be off and the box shows the first sentence of the raw as a `quote`.
- Accessibility of animation. Vestibular triggers (sway, loops) are real; reduced motion is honoured and the TUI has none by construction. Every emote has text. The claim stays "technically conformant", not "accessible", until tested with users on their own assistive tech (rule `conformance-is-not-accessibility`).
- Cost. Tier 1 compute is on the fuse's compute dimension and is visible in `status`; the mod can never request an `api-token` card or spend cloud tokens on its own behalf. Budget claims about the mod are banned until measured (§2.3; rule `ai-quality-measured-not-demoed`).
- Injection via phrases. Closed by matching only the model's own prose and by the expressive-only subset. Residual: the model itself can be steered to say "all green"; that moves a wave, not a nod.
- Persona drift softening refusals. A `warm` register must not wrap a `BILLING_REFUSED` in cheer. Refusal text is kernel-owned and verbatim; the gnome adds only the `sorry` pose and the register's courtesy word.
- Windows / terminal matrix. Glyph coverage (`▟▙▞░`) is uneven across fonts; fixtures must include an ASCII fallback set (`/_\`, `[#]`, `(o)`) and `G-TUI-03` applies.

---

## 8. Open questions for the founder

1. Default posture: dialog line on and stage off, or both on? (The doc proposes line on, stage off.)
2. One mod or two: should `gnome.stage` be the Workshop view grown a body, or a sibling that shares `persona:v1`?
3. Register for the default gnome: telegraphic game-dialog (`person: none`) as proposed, or first person with the forbidden list?
4. May a mod hold a long-lived local session for Tier 1 under its own principal, and what grant row names it?
5. Is the Tier 2 skill route acceptable for 8.0, or is an envelope-contribution RPC worth an ABI bump later?
6. Should the gnome announce cards at all (by kind and count only), or stay silent and let the card speak?
7. Which emotes, if any, should be allowed to vary per project hue versus staying identical across the armada?
8. Name for the default personas (one per role: builder, reviewer, teacher, tender) — or no names, since names invite "talking to"?

---

## 9. Suggested first prototype

Two weeks, TUI only, one shape:

1. Tier 0 templates for six events (`approval.request`, `approval.decide`, `permit.deny`, `turn.sent`, `oracle.result`, `session.exited`) and a triangle gnome with three glyph frames (wait, walk, sorry) and a shadow cell. No local model, no GUI.
2. Tier 2 tail skill for Claude sessions; the relay splits the tail, renders `say` as `quote`, four choices wired to `gnome.next|deeper|adjacent|raw`.
3. `persona.set` live editing of `voice.vocabulary.prefer` and `body.shape` only.
4. Measurements, reported with method: tail compliance rate (N = 40 turns × 3 runs), choice-picked vs typed follow-ups per session, `raw` open rate, closing-prose token delta with and without the skill.

Decide after the numbers whether Tier 1 and the papercraft stage are worth their latency and their motion. Nothing in step 1–3 touches the kernel.
