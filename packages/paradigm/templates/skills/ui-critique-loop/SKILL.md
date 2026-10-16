---
name: ui-critique-loop
description: >-
  Visual critique-and-fix loop for web UI: capture real browser screenshots at
  320, 768 and 1440 px plus a 1440 dark-mode shot, score the screen against a
  10-point design review checklist (contrast, touch targets, tokens, responsive
  layout, motion, dark mode, keyboard focus, loading/empty/error states, heading
  hierarchy, alt text), propose concrete fixes, then re-screenshot and diff until
  the checklist passes. Use when asked to review, critique, polish or QA a page,
  screen or component visually, check responsiveness or dark mode, or approve UI
  work before merge.
metadata:
  paradigm:
    id: ui-critique-loop
    version: 0.1.0
    steward: designer
    triggers:
      concepts: [ui-review, visual-qa, responsive-design, dark-mode, design-critique]
      symbols: ['~responsive', '~visual-consistency']
    trust: provisional
    provenance:
      source: bundled
      createdBy: designer
      migratedFrom: designer.agent#behaviors.review-checklist
    notebooks:
      - designer/nb-tw-responsive-mobile-u3v4
      - designer/nb-wcag-reflow-w9x0
      - designer/nb-hig-dark-mode-e1f2
      - designer/nb-radix-dark-mode-m5n6
      - designer/nb-wcag-target-size-u7v8
    tools:
      Read: host
      Grep: host
      Skill: host
      mcp__claude-in-chrome__navigate: 1.0.0
      mcp__claude-in-chrome__resize_window: 1.0.0
      mcp__claude-in-chrome__computer: 1.0.0
    hosts: [claude-code]
---
# UI Critique Loop

Critique what renders, not what the code intends. Every judgment in this loop
must point at a screenshot.

## Procedure

1. Establish the target: the URL or route, the state to show (logged in, seeded data, open dialog), and whether the app supports dark mode. Start the dev server if needed and confirm the page loads without console errors.
2. Choose an output directory for this critique (for example `ui-critique-<date>` in the working directory) and state it in the report. Capture round 0 with a browser tool (Claude in Chrome or an equivalent screenshot-capable browser MCP): resize to 320, 768 and 1440 px wide and screenshot each; then switch to dark mode (prefers-color-scheme emulation or the app's theme toggle) and screenshot at 1440. That is four screenshots per round, saved as `<round>-<viewport>.png` — `r0-320.png`, `r0-768.png`, `r0-1440.png`, `r0-1440-dark.png`. Scroll-capture long pages.
3. Score the 10-point checklist against the screenshots, marking each pass, fail or n/a with the screenshot that proves it:
   1. Contrast meets WCAG AA — 4.5:1 body text, 3:1 large text and UI components.
   2. Touch targets are at least 44x44 px with at least 8 px between them.
   3. Values come from design tokens — no ad-hoc colors, spacing or radii visible as off-scale.
   4. Layout holds at 320, 768 and 1440 — no horizontal scroll, clipped text or overlapping elements.
   5. prefers-reduced-motion is respected — non-essential animation stops.
   6. Dark mode is a designed layer — no pure-black on pure-white inversions, no lost borders, no unreadable text.
   7. Keyboard navigable with a visible focus indicator on every interactive element.
   8. Loading, empty and error states are designed, not only the happy path.
   9. Typography hierarchy is correct — one h1, sequential headings, readable line length.
   10. Images carry alt text; decorative images have empty alt.
4. For items 1, 2, 7 and 10 invoke the `pdg-a11y-audit` skill rather than eyeballing — contrast and focus need measurement, not impressions. If that skill is not available in this host, apply its checks inline: measure contrast ratios, measure target sizes, tab through for focus, and inspect alt attributes.
5. Write the critique: for each failed item, what is wrong, where (viewport + element), why it matters, and a concrete fix proposal expressed in tokens or component changes. Rank fixes by user impact.
6. Apply the fixes if asked (or hand them to the implementer), then capture the next round with the same four screenshots at the same viewports and state.
7. Diff rounds: compare each viewport pair, re-score the checklist, and confirm every fixed item now passes without regressions elsewhere. Repeat from step 5 until all items pass or the remaining failures are accepted explicitly. Stop after three rounds and report what is still open.

## Verification (receipt)

The run is complete only when the report contains all of:

- The output directory, and in it four screenshots per round named `<round>-<viewport>.png` (`rN-320.png`, `rN-768.png`, `rN-1440.png`, `rN-1440-dark.png`). List every file path so the receipt can be checked; a missing file fails the receipt.
- A checklist table: item · round-0 result · final result · evidence (screenshot file name).
- The fix list with the status of each fix (applied, proposed, declined).
- The round count and, if any item still fails, the reason it was accepted or left open.

Without screenshots there is no critique — if no browser tool is available, stop and say so instead of reviewing from source code.
