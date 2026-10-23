# Gnomon console: design

The tokens, components, zones and rules are in `design-system.yaml` next to this file. The rendered system is `specimen.html` (every component in every state, day, night and day without motion, drawn with the real `packages/gnomon-gui/static/styles.css`). The spec it serves is `docs/specs/gnomon.md` v3.4, and the colour values are the G-GUI-10 fixture verbatim. The direction was set in session `2026-10-15-gnomon-aesthetic`, the voice in `2026-10-21-gnomon-voice`, and the system was codified in `2026-10-21-design-systems`.

## The read

An instrument for one operator running an armada. You glance at it many times a day and open it a few times a day to decide. It is exact, calm and quietly beautiful: a made object that reads a larger order.

Gnomon is a desktop instrument. Phone layouts are out of scope for now; a true mobile version will come later as its own work, so nothing here is bent to fit a narrow screen.

## Two modes of one object

- **Day is papercraft:** cut-paper sheets on a grained ground, ink lines, folded paper caps, and pressable ink keys with a hard offset shadow. This deliberately overrides the `default-warm-paper` tell, because the founder wants the papercraft feel.
- **Night is phosphor:** a near-black ground, glowing outlines, bracketed keys and glyph caps. Only the wordmark, the caps, the chosen segment and the tall-view key glow.

## Principles

These settle trade-offs when a new piece of UI doesn't fit what is already here.

1. **Colour means one thing.** The six mineral hues mean *which project* and nothing else. Three semantic colours mean three things: vermilion is failed, amber is a warning (held countdowns, GATE), violet is KNOT. Everything else, status included, is ink. A live mic, a connected kernel, an "ok" and the APPROVED stamp read by their mark (a filled or hollow dot, ✓, a word) and their weight, never by a hue.
2. **The edge says whether it presses.** Anything you can click is a key: one height for every key (`--key-h`, 28px), with a dark key edge. A quiet key changes the look (no offset, softer ink), never the size. A chip is a status label nobody clicks: an 18px line, a faint rule edge. Fields sit between them, with an edge in the secondary text colour (5.8:1 on the page, 6.5:1 on the sheet) that turns to ink on hover and focus. Eight small bordered styles have become three looks: the chip, the small key and the reply's labelled part.
3. **Four sizes, then weight.** Type has four steps: 10.5 for labels, 11.5 for controls, 13.5 for reading and 17 for titles. Past that, hierarchy is weight, case and face: caps for labels, mono uppercase titles at night, Fraunces for titles by day. If something seems to need a fifth size, it needs a different weight.
4. **A 2px grid.** Every padding, margin, gap and inset is an even number of pixels. The only exceptions are a few fixed layout dimensions (the 76px Workshop column, the 140px pile tail).
5. **Say what to do.** A label tells you the next move in the product's own words. A card that voice can decide quotes the exact phrase the voice grammar accepts for it, such as `say “claude admin approve card 3” · reversible`, or says `hand only`. A refusal says what didn't happen and why in plain words, then `next:`. In the GUI the wire code, the symbol and the rule id (`FORBIDDEN`, `#gnomon-voice`, `G-VOX-06`) stay out of the line; they stay in the raw view, the kernel log and the CLI. The founder ruled this on 2026-10-23, after objecting to raw codes several times; it replaces "a refusal gives its code". Voice send refusals already follow it, and the other GUI refusals are migration batch `refusal-copy`.
6. **The kernel's regions can't be hidden.** The voice pill, the link status, run mode, the alerts band, handle words, the held countdown and card bodies stay visible whatever preset, pane or mod is in front.
7. **Model text never looks like a key.** Anything built from the agent's words has a dashed edge and a second cue, and is never drawn as a decision key.

## Type: the mono spine

JetBrains Mono sets everything in both modes. Fraunces appears only on the wordmark and titles by day. Long text gets line-height 1.6 and lines of at most 80 characters. The four-step scale costs two places something, and both are handled on purpose. The Workshop's 76px column grows from 9 to 10.5, so a cap's question truncates at about nine characters and keeps its full text in the tooltip and accessible name. The first-run key digest drops from 34 to 17, and it holds up for comparison by weight, spacing and groups of four rather than by size.

## Motion: the lively workshop

Things move only when something happens, and they move quietly. A decision sheet fades in quickly, with no flutter. Deciding stamps it APPROVED, landing straight, then it fades out and the pile closes up over it; no tilt or spin on the way out (the founder, 2026-10-23: "get rid of the whole card tilt and spin aspect and can go with a simple and tasteful fade out"). A failing session droops once and turns its edge vermilion; it never shakes. Caps bob only while their session streams. A voice approval shows its 3-second countdown before the stamp. Reduced motion makes all of it instant.

## The zones

- **Header.** Four things: the Gnomon ▾ wordmark menu, the ⌘K palette field, the quiet kernel status (a link dot, the browser-risk chip) and the voice pill. Every control is 28px and the row never wraps. Rare tools (layout, theme, mods, settings) live in the wordmark menu and the palette, never as keys in the row.
- **Alerts band.** The strip under the header carries kernel alerts only: a re-pinned kernel key and a voice dev build. They stay until you acknowledge them or the cause goes away.
- **Toasts.** Everything else that tells you something happened is one toast style, at the chat column's top-right edge, over the desk so it never pushes the work down. That covers saved, not sent, refusals, voice turning itself off, an update that's ready and standing-grant offers. Outcomes leave after six seconds; failures stay until you close them. Toasts no longer appear bottom-right or bottom-centre, and there is no loose update banner.
- **Sessions (left).** + New session, search, active sessions grouped by project with a swatch and a state note, past sessions collapsed, and a bounded mod slot at the bottom.
- **Centre.** The chat header (title, project, model, run mode, more) with its small controls as 24px keys, then the chat with timestamps, durations and a collapsible activity fold. Offer slips sit under their reply, this session's pending cards are pinned above the composer, and there is one composer with one send key.
- **Stack (right).** The global stack as a paper pile: decision cards first, most urgent first, then alerts, then the slip of loops waiting for trust at the foot. Each card and alert names what it relates to by glyph and word (↻ loop, ◇ session). The cards fan on hover and on keyboard focus so a buried key can always be reached. Each card shows in the stack and pinned in its session, and deciding it in either place removes both.
- **Workshop.** The caps mod, a footer strip by default or a 76px column on either edge: Needs you, Working, and one quiet status line.
- **Overlays.** The palette, new session, Settings, Mods and the Voice settings drawer, where teaching happens inline under its row. Toasts step aside while an overlay is open.

## Voice

Voice is one choice, not two. A trust ladder orders the presets by how much voice does on its own (Off, Talk, Dictate, Send word, Pieces), and the mic follows the rung. Each rung says what it does in a line, and what it costs when it costs something. The header pill always names the rung plus one live fact, with a filled ink dot when the mic is open. When the voice app turns the mic off by itself, the dot goes hollow and the fact gives a short cause (`mic stopped: input kept changing`), with the whole sentence and Restart in the ladder. The input device is never on the pill's face. It shows in the pill's title and in Voice settings › input, the sheet's first row, where you pick the system default or a named mic and watch its level. It shows a vermilion reason when speech wasn't sent. A voice-sent turn runs under the run mode and Always rules like a typed one, so nothing on the pill marks it (TD-2026-10-23-939). The pill opens only the ladder; everything configured lives in the Voice settings sheet. Nobody is ever asked to say the product name.

## CLI voice: instrument readout

Aligned lowercase labels, numbers first, items joined by ` · `, and ✓ ✕ ◆ marks. There is no emoji. Every refusal ends with a `next:` line.

## Loops (session 2026-10-22-gnomon-loops-ui)

Loops are background work you trust, then mostly ignore. A loop shows itself in two places: the header's kernel status ("loops 1 · 2 waiting") and the stack. Anything that still needs you goes to the stack. A loop-choice is a card. A failure, stop or kernel pause is an alert, a flat sheet that decides nothing. Loops waiting for trust sit in a dashed slip at the foot. A loop that simply finished says so in a 6-second toast. The Loops view is a leaf over the centre column: a list grouped by project with a pinned needs-you group, and a detail with the node graph, keys that name their cost, and inline budgets. Trusting a loop unfolds its card into the centre, so you read the whole definition before you press Trust.

This session changed two earlier rules. The stack now holds alerts as well as decision cards, which was the founder's call over Mika's objection. Toasts are recorded at the chat column's edge, which is where they already ship. The direction is in [DIRECTION.md](../../sessions/2026-10-22-gnomon-loops-ui/DIRECTION.md) and [direction.html](../../sessions/2026-10-22-gnomon-loops-ui/refs/direction.html). The components, rules and build requirements are in `design-system.yaml`. The graph's fit for three of the four spec loops is still a build requirement, and Today's ruler is a future list view.

## Local model (session 2026-10-22-gnomon-local-model)

Setting up a local model is a section of the Settings sheet, "Local model · kernel-owned", between Voice and Permissions. Its form opens inline under its row (the shipped Mods Configure form, now the `settings-form` component): server, address, model, who may use it, and an Advanced fold for the endpoint name and the runner. The key names its cost, **Save · root card**. Because a typed password is the expensive step, nothing that can be checked without signing waits for the card: the page checks the address and model, then the kernel checks the server, read-only, before the card is raised (rule no-password-for-a-typo). While a sheet is open, toasts are hidden and the stack sits under the scrim, so the row says "card waiting" in place and offers **Decide in the stack**, which focuses the card, never its Allow (rule form-says-where-the-card-is). The card is a grant with the new **⊙ gnomon** family and lists every field it signs. Turning the model off takes no card; the GUI asks once, inline, only when loops would stop. A loop that can't start for want of a local model says so in its detail, pins to needs you, and, when a scheduled start is refused, raises a `refused-start` alert, so it never fails silently. The reference is [local-model.html](../../sessions/2026-10-22-gnomon-local-model/refs/local-model.html). Its CSS lives in `styles.css` with the rest of the GUI.

## Folders (session 2026-10-23-gnomon-folder-picker)

You choose a folder; you don't type one (rule paths-are-chosen). New session lists up to six recent folders, each with its project swatch, the repo name, the path shortened with ~ and when it was last used. The centre session's folder is already chosen (else the most recent), so ⌘N then Enter opens a session there. **Choose folder…** asks the kernel to open the Mac's own chooser; the kernel draws it, so it works in the wrapper and in a browser on the same Mac, and the wrapper keeps no page IPC. Typing a path is folded under **Type a path ▸**, and shown open only when the kernel can't open a chooser. The kernel checks every choice before Open is enabled. A file, a missing path or a folder macOS won't let Gnomon read gets a ✕ line with the next step. The home folder is allowed, with an amber ◆ warning that auto-edits is off there. The sheet stays open until the session opens, so a refusal shows in place. The same `folder-field` (compact, without recents) replaces the typed paths in Settings › Local model runner and Mods › Add from folder. Dragging a folder in from Finder waits until after 8.0; the Mac's chooser already accepts one. GUI copy says "folder", not "cwd".

The same session made one key height the rule: `--key-h`, 28px, for every key in every zone. Quiet keys, fold keys, segment keys and the chat header's glyph keys were 24px beside 28px keys, which the founder saw as inconsistent button heights. The reference is [folder-picker.html](../../sessions/2026-10-23-gnomon-folder-picker/refs/folder-picker.html), with every key before and after on board K. Both changes are pending migration batches (`folder-field`, `key-height`).

## What's next

The `migration:` list in `design-system.yaml` (now including the pending batches settings-form, folder-field and key-height) is the work that brings the shipped UI onto this system, batched by zone and component (notices and toasts, chips and small keys, the card voice tag, status colour, field edges, type, spacing, radius, copy). Each batch goes through the UI review on its own. Offer slips and the one-offer-per-reply rule stay open until session `2026-10-20-gnomon-mod-invitations` closes.
