---
name: ui-build-protocol
description: >-
  Design pass run whenever UI is built or changed (styles, components,
  templates, layout, UI copy), by any agent in any project, before the work is
  called done and again at finish review: inventory every changed element,
  check consistency with its siblings, zone placement, every state in every
  theme, copy, narrow-width behaviour, accessibility and the design record, then
  return a verdict with file:line change proposals. Use when UI work is about to
  be reported done, when reviewing a UI change, or when a zone looks
  inconsistent.
metadata:
  paradigm:
    id: ui-build-protocol
    version: 0.1.0
    steward: designer
    triggers:
      concepts: [ui-consistency, design-review, component-reuse, zone-placement, ui-states, design-system]
      symbols: ['~visual-consistency']
    trust: provisional
    provenance:
      source: bundled
      createdBy: designer
      migratedFrom: designer.agent#behaviors.ui-build-protocol
    notebooks:
      - designer/nb-ui-build-protocol-001
    tools:
      Read: host
      Grep: host
      Bash: host
      Skill: host
    hosts: [claude-code]
---
# UI Build Protocol

Check the whole zone, not only the element that changed. Run this pass before
UI work is called done, and again on a finish review.

## Procedure

1. Inventory: list every element added or changed (control, component, copy string, token, state) with where it lives (surface and zone, e.g. header right group, settings sheet) and the existing element it relates to (same role elsewhere, sibling in the same zone).
2. Consistency: each element reuses the existing component and tokens for its role; it matches its siblings in height, radius, key style, spacing and type size; no one-off style; nothing wraps inside a control in a compact zone.
3. Placement and structure: it belongs in that zone (live control vs settings vs status vs notice); it does not duplicate an entry point that already exists; notices never sit loose in a toolbar.
4. States: default, hover, focus, pressed/selected, disabled, loading, empty and error are all visible and distinct, in every theme the project has.
5. Copy: uses the system's current vocabulary (no retired terms), its voice rules (no emoji where forbidden), and fits its space at the narrowest supported width.
6. Responsiveness: the zone holds at narrow widths (wrap, overflow menu or truncate with a title), never by squeezing a control onto two lines.
7. Accessibility: invoke the `pdg-a11y-audit` skill (it covers contrast per state and theme, the keyboard-only pass, and targets and reach). Then run the playbook v1 passes below; rule ids come from Atelier's rules file when Atelier is installed.
   - a. Grayscale: capture it desaturated beside the colour capture; hierarchy holds and no state or category is told apart by hue alone (grayscale-holds-hierarchy). Simulate deutan and protan first (deuteranomaly is the most common), then tritan.
   - b. Realistic data: 0, 1, 5, 50 and 200 items; very long names and labels; a failed image; a pasted paragraph; labels about 35% longer as translations would be; other currency and date formats (stress-with-real-content).
   - c. States, including the in-between: every state the component can enter; disabled says why, loading blocks a second submit, error says what and what next and resets for retry, success names the result. Draw the state diagram per changed screen and walk interrupted paths too, like a modal closed halfway through a form (functional-states-say-what-happened, in-between-states-designed).
   - e. Hover parity: anything shown on hover is reachable by focus and by tap (hover-has-equivalent).
   - g. Grouping: space inside a group is visibly smaller than space between groups; boxes only where spacing can't group (group-by-space-before-boxes, tell card-soup); spacing sits on the base unit (spacing-on-base-unit).
   - h. Reading text: body at least 16px, line height about 1.5, measure about 60-75ch and never over 80, nothing clipped when line height is raised to 1.5 (readable-body-text).
   - j. Friction log: walk the real task end to end as a user and log every hesitation, wrong turn and wait, separately from the rules (friction-log-walkthrough).
   - k. System: run `atelier system lint` and `atelier check <files>` where a design system exists.
8. Design record: a new pattern is codified in the project's design system (or flagged for it); any departure from an approved render or decision is listed with its reason.

## Output

A verdict (approved / approved-with-fixes / rework) and concrete change
proposals for the builder (file:line, before -> after), ranked by cost to the
user. Say what the verdict covers: the review can establish that the build
holds up and passes the heuristics, not that it solves the right problem or
that users can finish the task; name the cheapest check that would
(close-with-falsifying-study). Mika proposes, she does not silently rewrite;
anything that needs a taste decision goes to Luna or the creator as a board.

## Verification (receipt)

The run is complete only when the report contains all of:

- The inventory table: element · zone · related element.
- A result (pass / fail / n/a with a one-line reason) for steps 2-8 and for each playbook pass a, b, c, e, g, h, j and k, each with its evidence (capture, measurement or file:line).
- The `pdg-a11y-audit` receipt, or a note that the skill was unavailable and its checks were applied inline.
- The verdict, what it covers, and the ranked change proposals.
