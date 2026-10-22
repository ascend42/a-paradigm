---
name: a11y-audit
description: >-
  WCAG 2.2 AA accessibility audit of a screen, page or component: measure text
  and non-text contrast, check color-only meaning, focus visibility, full keyboard
  path and focus traps, touch target size (24px AA minimum, 44px recommended), prefers-reduced-motion, text-spacing
  resilience, heading order and image alt text, and produce a criterion-by-criterion
  pass/fail table with evidence. Use when asked for an accessibility review, a11y
  check, WCAG compliance, contrast check, keyboard or screen-reader readiness, or
  before shipping any user-facing UI.
metadata:
  paradigm:
    id: a11y-audit
    version: 0.1.0
    steward: a11y
    triggers:
      concepts: [accessibility, wcag, contrast, keyboard-navigation, focus-management, inclusive-design]
      symbols: ['~accessible']
    trust: provisional
    provenance:
      source: bundled
      createdBy: a11y
    notebooks:
      - a11y/nb-contrast-calculation
      - a11y/nb-color-never-alone
      - a11y/nb-color-blindness-patterns
      - designer/nb-wcag-contrast-text-o1p2
      - designer/nb-wcag-focus-indicators-s5t6
      - designer/nb-wcag-motion-reduce-c5d6
      - designer/nb-wcag-text-spacing-y1z2
    tools:
      Read: host
      Grep: host
      Bash: host
    hosts: [claude-code]
---
# Accessibility Audit (WCAG 2.2 AA)

Audit against measurable criteria. Every verdict needs evidence: a measured
ratio, a key sequence, a size, or the markup that proves it. Prefer native HTML
fixes over ARIA — only add ARIA where no native element exists.

## Procedure

1. Scope the audit: list the screens, states (default, hover, focus, error, disabled, dark mode) and components in scope, and the conformance target (AA unless told otherwise).
2. Contrast (1.4.3, 1.4.11): compute the contrast ratio for every text/background pair and every UI boundary (input borders, focus rings, icons that convey meaning). Pass is 4.5:1 for body text, 3:1 for large text (24px, or 18.66px bold) and 3:1 for non-text UI. Measure the actual rendered colors, including over images and gradients, for every state in scope (enabled, hover, focus, pressed, selected, error) in every theme the product has. Disabled controls are exempt.
3. Use of color (1.4.1): find every place color alone carries meaning — error fields, status badges, chart series, required markers, links in body text. Each needs a second cue (icon, text, pattern, underline). Check the palette under protanopia, deuteranopia and tritanopia simulations.
4. Focus visible (2.4.7, 2.4.11 Focus Not Obscured): tab to every interactive element and confirm a visible focus indicator that is not hidden by sticky headers or overlays. Measure the indicator's contrast against adjacent colors: at least 3:1 (1.4.11 Non-text Contrast; 2.4.13 Focus Appearance is the stricter AAA bar). Flag any `outline: none` without a replacement.
5. Keyboard path (2.1.1, 2.1.2, 2.4.3): complete the primary task using only the keyboard. Record the tab order, confirm it matches visual order, that no element traps focus (except modal dialogs, which must trap and release on Escape), that custom widgets follow the WAI-ARIA interaction pattern (arrow keys in tabs and menus, Enter/Space on buttons), and that a skip link exists on pages with repeated navigation.
6. Target size (2.5.8): measure interactive targets. The WCAG 2.2 AA minimum is 24x24 CSS px (or equivalent spacing); 44x44 CSS px with 8px gaps is the stricter AA-plus bar and the Apple HIG bar. Report each target against both, and state which bar the audit enforces. On touch, use 44pt / 48dp for primary actions and check reach: primary actions sit in the thumb zone (the lower middle of the screen in one-handed use), not in corners.
7. Motion (2.3.3): enable prefers-reduced-motion and confirm non-essential animation, parallax and auto-playing media stop or reduce. Nothing flashes more than three times per second.
8. Text spacing and reflow (1.4.12, 1.4.10): apply line-height 1.5, paragraph spacing 2x, letter spacing 0.12em and word spacing 0.16em; confirm no clipping or overlap. Check content reflows at 320 CSS px without horizontal scrolling.
9. Structure and alternatives (1.3.1, 2.4.6, 1.1.1): confirm one h1 and sequential heading levels, landmarks (header, nav, main, footer), form fields with programmatic labels and errors announced via aria-live, icon-only buttons with accessible names, meaningful alt text on informative images and empty alt on decorative ones.
10. Report and prioritize: each failure with its criterion, location, evidence, user impact (who is blocked) and the smallest fix. Order by severity — blockers first (keyboard traps, missing names, unreadable contrast), then degradations.

## Verification (receipt)

The run is complete only when the report contains a table with one row per
criterion checked:

| WCAG criterion | Result (pass / fail / n/a) | Evidence |

Evidence must be concrete: the measured ratio and the two colors for contrast,
the key sequence for keyboard findings, the measured size for targets, the
element and its markup for structure findings. n/a requires a one-line reason.
List the states and themes covered; any state in scope but not tested is a
gap, reported as such.

Report the keyboard-only result as "technically conformant", never as
"accessible": an audit shows the criteria pass, not that disabled people can
finish the task. Say which check would establish that (a session with an
assistive-technology user).
