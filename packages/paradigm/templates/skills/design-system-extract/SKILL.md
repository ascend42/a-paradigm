---
name: design-system-extract
description: >-
  Extract and inventory a project's design system: find where design tokens live
  (Tailwind theme, CSS custom properties, Style Dictionary, Figma/Pencil design-tool
  MCPs), inventory colors/spacing/typography/radii/shadows/motion tokens, catalog
  reusable UI components and their visual API, and flag ad-hoc hex/px/rem values
  that bypass tokens. Use when asked to audit a design system, map design tokens,
  find style drift or hard-coded colors, onboard onto an unfamiliar frontend, or
  before proposing any visual change to an existing UI.
metadata:
  paradigm:
    id: design-system-extract
    version: 0.1.0
    steward: designer
    triggers:
      concepts: [design-system, design-tokens, style-drift, theming, component-catalog]
      symbols: ['~visual-consistency']
      paths: ['**/tailwind.config.*', '**/*.css', '**/tokens/**']
    trust: provisional
    provenance:
      source: bundled
      createdBy: designer
      migratedFrom: designer.agent#behaviors.design-system-maintenance
    notebooks:
      - designer/nb-tw-tokens-theme-s1t2
      - designer/nb-radix-scale-overview-e7f8
      - designer/nb-tw-spacing-scale-c1d2
      - designer/nb-tw-typography-e3f4
      - designer/nb-m3-color-roles-c3d4
    tools:
      Read: host
      Grep: host
      Glob: host
      Bash: host
    hosts: [claude-code]
---
# Design System Extract

Build an evidence-backed inventory of the design system that actually exists in
the codebase — not the one the docs describe. Never assume a tool: detect it.

## Procedure

1. Detect the token source(s). Check, in order, and record every one found:
   - Tailwind: a `tailwind.config.*` file (`theme` / `theme.extend`) or a Tailwind v4 `@theme` block in a CSS entry file.
   - CSS custom properties: `:root { --… }` and `[data-theme=…]` / `.dark { --… }` blocks.
   - Style Dictionary or Tokens Studio JSON (a `tokens` directory, `$value` keys, a `style-dictionary` dependency).
   - CSS-in-JS theme objects (`createTheme`, `styled` theme providers, vanilla-extract `createTheme`).
   - Design-tool MCP servers configured in `.mcp.json` (Pencil, Figma, Paradigm Canvas). If one is present, pull its variables/styles (for Pencil, read the file's style guide and variables) and treat it as a second source to reconcile against code.
   - Native platforms: asset-catalog color sets and SwiftUI `Color` extensions, or Material 3 color schemes on Android.
2. Inventory tokens per category — color, spacing, typography (family, size, weight, line-height), radii, shadows/elevation, motion (duration, easing), z-index, breakpoints. For each token record name, value, and where it is defined. Note whether color tokens are semantic (surface, text-muted, accent) or raw scale steps (blue-500), and whether a dark layer exists as its own token set rather than an inversion.
3. Check scale health. Spacing should follow one base unit (usually 4px or 8px); type should follow one modular ratio; color scales should have consistent step counts across hues. List every value that breaks its scale.
4. Build the component catalog: enumerate the reusable UI components (button, input, card, dialog, …), each with its variants, sizes and states, and which tokens it consumes. Flag near-duplicates (two button implementations, three card styles).
5. Hunt ad-hoc values: search component and style sources for literal hex/rgb/hsl/oklch colors, raw px/rem spacing, arbitrary Tailwind values in square brackets, inline style objects, and `!important`. Exclude the token definition files themselves. Record each offender as file:line with the literal value and the nearest existing token it should use.
6. Write the inventory report (format below). Recommend, in priority order, the smallest set of changes that would bring ad-hoc values onto tokens. Do not apply them unless asked.

## Verification (receipt)

The run is complete only when the report contains all of:

- Token sources: each detected source with its location, or an explicit "none found" per source type checked.
- Token counts per category (for example `color 42 (18 semantic, 24 scale) · spacing 12 · type 9 · radii 5 · shadow 4 · motion 3`).
- Component catalog table: component · variants · tokens consumed · duplicate-of.
- Ad-hoc offenders: a count plus a file:line list (value → suggested token). If the list exceeds 50, give the top 50 by frequency plus the total count.
- Scale breaks: each off-scale value with its location.

If any section is empty, say so explicitly; an omitted section fails the receipt.
