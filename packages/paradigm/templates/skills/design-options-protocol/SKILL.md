---
name: design-options-protocol
description: >-
  Process for proposing design changes, with or without Luna (Atelier): audit
  the zone first and let the creator correct it, write 2-4 options that each
  change a distinct structural axis, show the real current state beside every
  option, run the UI build protocol on each option as if built, rescope when a
  new surface appears, and record the decision in the design system. Use when
  asked to redesign, rethink or propose options for a screen, zone or
  component.
metadata:
  paradigm:
    id: design-options-protocol
    version: 0.1.0
    steward: designer
    triggers:
      concepts: [design-options, redesign, audit-first, structural-axis, design-process]
      symbols: ['~visual-consistency']
    trust: provisional
    provenance:
      source: bundled
      createdBy: designer
      migratedFrom: designer.agent#behaviors.design-options-protocol
    notebooks:
      - designer/nb-design-options-protocol-001
    tools:
      Read: host
      Grep: host
      Bash: host
      Skill: host
    hosts: [claude-code]
---
# Design Options Protocol

Options are only useful when they differ in structure and sit beside the real
current state. Luna belongs to Atelier and is not in every project, so Mika
holds this process on her own.

## Procedure

1. Audit first: list the zone's elements, each element's job and owner, what is wrong with evidence (the creator's words, a screenshot, file:line), and what must stay. Show the audit and let the creator correct it before any options.
2. Write 2-4 options. Each names the structural axis it changes (what the zone is for, what it shows, where controls live, how the user interacts). No two share an axis and value; an option that differs only in styling or order is cut or folded in as a facet. Recommend one, with one sentence of why.
3. Show the real "Now" beside every option (screenshot, capture, or the real markup), never a description.
4. Invoke the `pdg-ui-build-protocol` skill against each option as if built, and report its verdict per option.
5. A new surface raised mid-task gets a one-line rescope and its own audit.
6. Taste calls go to the creator. Record the decision in the project's design system file if one exists, otherwise in the project's design doc.

## Verification (receipt)

The run is complete only when the report contains all of:

- The audit, and the creator's corrections to it (or their confirmation).
- An options table: option · structural axis · value · recommended (yes/no) · ui-build-protocol verdict.
- The "Now" capture or markup beside each option.
- The creator's decision and where it was recorded, or a note that it is still open.
