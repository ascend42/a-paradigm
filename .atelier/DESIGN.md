# Warpline Console: design direction

Session `2026-10-14-warpline-console` set this direction with Luna and Mika. It is approved as the starting version. The approved comps are `sessions/2026-10-14-warpline-console/refs/direction.html` (inside a repo) and `refs/repos.html`, option B (the org level). Comps are local renders and gitignored. The decision record is `sessions/2026-10-14-warpline-console/session.yaml`, and the enforced tokens and rules are in `design-system.yaml`.

## The read
This is the control room for an agent armada's source control. You and a dev team check in a few times a day to make the calls machines can't. The register is calm, exact and dark, like a loom, and violet only ever means "git is blind here."

## What stays
The Warpline design system (`docs/specs/warpline-design-system.md`) is preserved whole:
- **Palette:** ink and linen ground. Amber is branch A, teal is branch B, and violet is the git-blind conflict.
- **Type:** Fraunces for meaning, Inter for chrome, JetBrains Mono for bytes.
- **The three system rules:** violet only where git is blind; restraint by default; no count animation.

## Structure
- **Two levels (v1).** An org dashboard of repos (visibility, activity, needs-you counts, plus a cross-repo needs-you list) leads to a repo page with tabs: Inbox, Floor, Code, Offers, Tapestry, Runs, Releases, Fleet, Settings. The creator likes the form and function but finds the style too generic; giving it Warpline's own character is a v2 item.
- **Inbox first.** A repo opens on its Inbox: decisions ranked by expected loss, with the folded admissions below.
- **Live band.** The band above the Inbox is the Floor in miniature. It can be hidden, compact or expanded, and it moves only when a pick is admitted, a KNOT forms, or a KNOT is resolved. The Floor tab is the same view at full size.
- **Deciding happens in a split view.** The queue sits on the left and the decision on the right: both intents, contested slots, blast radius, and a resolve form with a required reason. Sealing a decision advances to the next item.
- **Roles by domain.**
  - Owner decides everything, including gate, auth and pipeline changes.
  - Developer decides KNOTs only in the domains they own and sees the rest read-only, with the reason stated.
  - Observer reads.
  - Agents never sign in; they act through MCP or the CLI and appear on the Floor.

## Look
- **Control room dials 3·4·7.** Strict grid, dense rows, and events with real presence (arrive, cinch, settle), all gated on reduced motion.
- **One meaning per hue.** "Needs a human" is drawn neutral: a linen outline with a human mark. Humans are filled linen chips and agents are outlined grey.

## Forge surfaces (TD-2026-10-14-551)
- **Code:** files at any state, with meaning blame per symbol in the margin and an honesty label on every file (meaning-decided or byte-decided).
- **Runs:** the verdict runs first, so a KNOT is never built. Checks become signed witnesses, and a failing required check parks a protected landing.
- **Releases:** signed cuts (BOLTs) with their checks attached.
- **Settings:** visibility, collaborators, protected refs and required checks, and webhooks.

## Open
- The v2 look for the org/repo shell.
- A failure colour for failed checks. It needs its own board, because every hue already carries a meaning.
- Offer review threads, which are deferred.
- Build gate: no console build starts while F4 (cold-agent legibility) is unmeasured.
