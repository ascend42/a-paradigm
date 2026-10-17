# 28 — Panel: a librarian agent for old materials? (Atelier N2 follow-up, 2026-10-17)

Panel: Loid, Rune, Cid, Arky. Claims re-verified by the orchestrator: `~/.paradigm/agents/archivist.agent` exists (nickname Index) and is not on `.paradigm/roster.yaml`; TD-2026-09-19-110 exists (lore L-2026-09-21-ascend-000314-001).

**Question (founder):** should a new agent clean up and audit old materials and files, like a librarian, or does this belong only in the neurons project?

**Short answer:** no new core agent. The librarian already exists as `archivist` ("Index"), benched in this project. TD-2026-06-14-467 says to route a new governance need to the existing owner by tense. TD-2026-09-19-110 (Memory Steward) says to extract a new agent only if it earns its own voice.

## Voices

- **Loid:** old material is past tense, so it is Loid's. TD-467 gave Loid archival (90-day retention); TD-110 gave memory hygiene through `paradigm memory review`, which is advisory and never auto-deletes. The gap is scope: the steward reads MEMORY.md, not `.paradigm/research/` or `docs/private/`. Commit 07433bc7 shows the founder doing this work by hand. Whatever is chosen must feed calibration, because kept and discarded findings teach what holds value and what rots.
- **Rune:** the stop hook already flags stale `.purpose` files and dead aspect anchors (`paradigm-common.sh:357-381`). The same graph test works elsewhere: a doc, decision or lore entry citing a symbol, file or task that no longer exists is provably stale. Supersession links are mostly implicit; only 8 decisions carry supersede markers.
- **Cid:** branches (19) and stashes (6) are present-tense state and belong on Cid's stale-open surface. A new agent would split the queue, which is why TD-467 rejected a PM agent.
- **Arky:** draw the boundary by store. Paradigm owns project-bound artifacts whose staleness can be checked against code. Neurons owns sourced cross-project claims, and `tend` already covers orphans, contradictions, dangling links, duplicates, stale claims, stale inbox and stale skills. Atelier owns its decision records and `rules.yaml`. The bridge runs one way: rules point to neurons, never the reverse.

## What rots, and who owns it today

| Material | Owner today |
|---|---|
| Stale `.purpose`, dead aspect anchors | Rune (stop hook, enforced) |
| MEMORY.md entries | Loid (TD-110) |
| Task archival and stale-open tasks | Cid / Loid (TD-467) |
| Superseded research and specs (`.paradigm/research`, `docs/private`, `docs/specs`) | **nobody**, done by hand |
| Lore and decisions superseded without links | **nobody** |
| Dead branches and stashes | **nobody** |
| Human docs (READMEs, guides) | Index, **benched** |
| Neurons: orphans, stale claims, duplicates | `tend`; the founder resolves audits |
| Old Atelier sessions | **nobody** |

## Options

- **(a) New core "librarian" agent,** partnered with Loid and Rune. It breaks TD-467 and TD-110 and overlaps Index. Falsifier: over 30 days, under 20% of its findings are ones existing scans would have missed, which would make it chrome.
- **(b) A protocol owned by Loid and Rune, with Index activated for human docs.** Widen `paradigm memory review` into a review of research, specs, lore and decisions. Rune supplies the dead-reference test, Loid the age and superseded-by test. Branches and stashes go on Cid's board. Findings are `propose_block severity:'advise'` and never delete. Falsifier: pre-register the hand-marked supersessions from the last 60 days (e.g. 07433bc7) and replay the scan on the tree before they were marked. It must flag at least 70% of them, and the founder must keep at least 50% of its findings, measured through `overrides.jsonl`.
- **(c) Neurons only, via `tend`.** This leaves the "nobody" rows unowned, and `tend` can't see the symbol graph.

## Recommendation

**(b), with (c) unchanged on the neurons side.**

1. Widen Loid's Memory Steward to a Paradigm artifact review.
2. Rune supplies the graph-validated staleness test.
3. Branches and stashes go on Cid's stale-open surface.
4. Activate Index (`paradigm shift`) for guides and READMEs.

Everything stays advisory and founder-decided.

**Boundary:** if staleness can be checked against code or the symbol graph, Paradigm curates it. If it is a sourced cross-project claim, neurons curates it. When knowledge moves from a Paradigm doc into a neuron, the doc gets `superseded_by: n:<slug>`. Neurons never point back.

**Revisit trigger:** promote to a dedicated agent only if (b)'s keep rate holds, the curation workload crowds out Loid's calibration work, and the falsifier for (a) passes. Old Atelier sessions are an Atelier backlog item under Luna.
