# Gnomon Loops: the direction

Session `2026-10-22-gnomon-loops-ui` (direct, deep, product gnomon, greenfield). Spec: `docs/specs/gnomon-loops.md` §6. All eight boards were decided by the founder. The rendered direction is [refs/direction.html](refs/direction.html): four screens in the real desk, built on the real `styles.css`, with Day/Night and 1440/1024 toggles.

## The read

Loops are background work the founder trusts, then mostly ignores. Gnomon is glanced at all day and opened a few times a day to trust, steer or stop. The Loops UI is a control room inside the console, not a second app. It stays calm and exact in the papercraft and phosphor register, and gets loud only when a loop needs a decision.

## The shape in one paragraph

A loop announces itself in two places only: the header's kernel status ("loops 1 · 2 waiting") and the stack. The stack now holds decision cards and alerts, each styled by what it relates to (↻ loop, ◇ session). A loop that needs you shows up there: as a loop-choice card, as a failure or pause alert, or as the slip at the foot of the stack for loops waiting for trust. A loop that simply finished says so in a toast and is gone. To look closer, the Loops leaf slides over the centre column. It holds the list grouped by project with needs-you pinned, and each loop's detail: a node graph of its last run, keys in the head and inline budgets. Trusting a loop unfolds its trust card into the centre, so the whole definition reads at 80 characters before you press Trust.

## Decisions

Each decision is listed with the problem it answers, what was chosen, and what it costs.

1. **Where loops live: the centre leaf** (`loops-zone`).
   - Problem: loops need a home that hides neither sessions nor the stack.
   - Choice: the Loops view slides over the centre column, like the mod leaf. Esc folds it to an edge tab ("loops · 1 running · 2 waiting"). It opens from Gnomon ▾ → Loops…, from ⌘K `loops.open` and from the header word.
   - Trade-off: the chat is covered while the leaf is open. In return, decisions and toasts stay beside the view.
2. **Agent-made loops: the slip at the stack's foot** (`agent-loops-surface`).
   - Problem: agents create and change loops freely, and each one waits for trust. Surfacing that must not nag.
   - Choice: a dashed slip under the pile reads "2 loops waiting for trust · no card yet". Each line has a Review key that raises the real `loop-trust` card. No card exists until you ask for one.
   - Trade-off: the stack now holds something that is not a card. The founder chose this over Mika's objection and generalised it into the zone change below.
3. **Trust: the card unfolds into the centre** (`trust-card`).
   - Problem: a full loop definition does not fit on a stack card.
   - Choice: a short `loop-trust` card sits in the stack. Read unfolds the same card over the centre. A changed loop opens on the diff, shown with marks and weight and never with a hue. Then come the ordered listing (argv, realpath, sha, interpreter), triggers, spend caps, land paths with gate-class called out, and protected inputs. Trust and Don't trust come after all of it, with the root key and Touch ID, never standing and never by voice.
   - Trade-off: one extra press before Trust. The trust card keeps the ordered listing even though the detail uses a graph, because you trust text, not shapes.
4. **The running indicator: the header's kernel status** (`running-indicator`).
   - Problem: the loops count, the keep-alive line and Pause all must stay visible whatever is hidden.
   - Choice: a quiet 28px word next to the link dot ("loops 1 · 2 waiting") that opens the leaf. Its tooltip and the leaf head carry "Loops are keeping Gnomon running". Pause all lives in the leaf head, in Gnomon ▾ and in ⌘K `loops.pause-all`. After Pause all, the header word changes at once to "loops paused · 4", and so do the list and the open detail.
   - Trade-off: Pause all is two presses from the desk, or ⌘K. The header row gains a word, which must drop to its count before it would wrap.
5. **Notify and decide: stuck to the stack, done to a toast** (`notify-decide`).
   - Problem: deciding what a loop tells you and what it asks you, under the stack-of-alerts rule.
   - Choice:
     - Fail, stop and kernel pause become loop alerts in the stack: flat sheets with a ↻ loop head, the run path, Open run and Dismiss. Failures get a vermilion edge; kernel pauses a dashed amber one.
     - `loop-choice` is a loop-styled decision card: the line "Raised by loop X (authored by Y)", the path `tsc ✕ → fix ×3 → tsc ✕ → fix ? → ask`, Continue (hand only, Touch ID) and Stop.
     - Goal and landed are 6s toasts at the chat column's right edge, with Open run.
     - Always toasts: the Pause all confirmation, Run now started, a budget applied, GUI outcomes and refusals.
   - Trade-off: loop news lives in two places on purpose. The stack holds what still needs you, so nothing that needs you can time out.
6. **The list: by project, needs-you pinned** (`loop-list`).
   - Problem: what one row shows, and how the list groups.
   - Choice: a needs-you group pinned on top (waiting for trust, kernel-paused, waiting to land), then project groups. Each row has two lines. Line one: state mark, name first, state, next due. Line two: spend against caps, "local only", effective autonomy with the reason for any cap, and the author. The name comes first so truncation eats the facts, never the name, and the full row text is in `title=`.
   - Trade-off: a loop can appear twice, pinned and in its project.
   - Future: the founder wants **Today's ruler** (a 24h ruler of past runs and next fires per loop) as an alternate view later. It is recorded as future and is not built in 8.0.
7. **Detail: the node graph** (`loop-detail`).
   - Problem: how a loop's graph and its last run read.
   - Choice: the founder picked the graph over my recommendation (the ordered listing), and the detail now draws it to Mika's requirements:
     - It fits at 1024. The graph lays out left to right when there is room and top to bottom when the leaf is narrow, so green-typecheck fits at 100% at 1024. Zoom (− fit +) scales inside the graph's own frame, never the page.
     - Edge labels sit only in the gaps between boxes or beside arcs, never on a box.
     - Verdicts read by mark (✓ ✕ ? … ·), by edge weight (the last run's path is solid and heavy, untaken edges are dashed) and by box edge (a failed node is heavy, an unreached one dashed). Colour is a second cue only.
     - Night text uses the system's secondary and ink tokens, which pass AA on the sheet.
     - Below the graph comes the last run as a trace, with model text dashed as agent-claimed.
   - Trade-off: the trust card and the detail now use two forms, the listing and the graph.
8. **Steer and stop: keys in the detail head, inline budgets** (`steer-stop`).
   - Problem: run, pause, resume, budgets, untrust, delete and revert.
   - Choice: the keys live in the detail head, and each one names its cost:
     - Run now is disabled with the reason in words when a loop waits for trust.
     - Resume after a kernel pause reads "Resume · presence".
     - Each budget is a field. Lowering it shows "Apply · tighter" and applies now. Raising it shows "Loosen · needs trust" and raises a `loop-trust` card, with the old cap holding until you trust it.
     - Landed shas carry Revert.
   - Trade-off: steering always means opening the loop.

## The stack-of-alerts zone change (the founder's rule)

The founder's words, verbatim: "i think i like the idea of the stack being a stack of alerts and other decision cards and decision cards canbe styled a certain way depending on what they relate to".

This changes the stack zone, which until now held only decision cards:

- **Order:** decision cards first, then alerts, then the waiting-for-trust slip at the foot. A decision key is never buried under an alert tail, and the pile still fans on hover and focus.
- **Alerts** are sheets that decide nothing. They are flat (no fold shadow), carry only quiet keys (Open run, Dismiss) and never a decision key. A state edge applies only for the three semantic meanings: vermilion for failed, dashed amber for a warning or kernel pause.
- **Family styling** names what a card relates to by glyph and word in the head: ↻ loop, ◇ session, and later ✦ mod and voice. Never by hue, because colour means one thing: the six minerals are projects, plus the three semantic colours.
- **What stays elsewhere:** kernel alerts stay in the band, and outcomes stay toasts.

Mika codifies this as a zone change in `design-system.yaml` (`zones.stack`, a new `alert` component, the card `family` head). Luna does not write that file.

## Open for the build and for Mika

- Mika codifies the loop components, the stack zone change and the vocabulary ("waiting for trust", "loop run" versus "run mode").
- The voice tag chip on permission cards overflows at the 300 to 340px stack width. This is an existing system issue, seen in every reference.
- The graph's two layouts are proven on green-typecheck. In the build, the four spec examples should each be checked at 1024 against the same rules.

[Open the direction](refs/direction.html)
