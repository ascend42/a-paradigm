# Paradigm Brain — structure for amorphous personal information (spec)

> Decision: **TD-2026-09-29-204** (status: **proposed**) · Arc: TD-2026-09-26-846, **Phase 5**
> Companion lore: L-2026-09-29-ascend-081346-928
> Contributors: Arky (architect), Loid (forge / learning loop), Aegis (security), Mika (designer), prior-art research
> Status: **ideation locked, pre-build.** Prerequisites land in Phases 3–4; build follows.

## Problem

Paradigm maps codebases: `.purpose` files + a deterministic symbol graph give agents a trustworthy map. Nothing comparable exists for the *amorphous* information in people's personal directories — notes, PDFs, docx, scans, research, project folders, Obsidian vaults. Today's tools split into:

- **Embedding tools** (Smart Connections, Copilot, Khoj) — fuzzy, opaque, drift, degrade at 8–10k files.
- **Explicit-graph tools** (Basic Memory, Tana) — depend on disciplined authoring that nothing enforces.
- **Claude Code on a vault** (dominant 2025–26 pattern) — structure lives as prose rules in `CLAUDE.md`; renames silently break links.

## Scope (founder)

- **Audience:** Paradigm users broadly — including non-developers. Zero-config, safe defaults.
- **Corpus:** *any* folder of mixed files (md, PDF, docx, images). "Obsidian" is a metaphor; vaults are one supported case.

## Verdict: adjacent layer, same engine

Not user-authored `.purpose`. Reuse the engine (symbol graph, `^gates`, deterministic index, suggest→confirm, calibration) behind a new authoring surface.

Why not extend `.purpose` directly:

1. **Syntax collision.** The reference regex (`packages/premise/core/src/aggregator.ts:418`) and `memory-scan.ts:83` would read Obsidian `#tag` → component, `^block-id` → gate, LaTeX `$x$` → flow, `~~strike~~` → aspect. Document bodies must never be symbol-scanned.
2. **PDFs/docx/images can't carry labels**, and users won't accept stray files in their folders.
3. **Non-developers must never see** `.purpose`, `#`, `^`. The `.purpose`-compatible format is internal only.

## Principles

1. **Index, not store.** The Brain points at the user's files; it never copies content into Paradigm and adds no new learning ledger (no "store #13").
2. **The human is the sole certifier; defaults are the strict ones.** Every label, link and gate is a suggestion until confirmed. Roots default-deny; new zones start at the stricter gate. Inference may *tighten* a gate, never loosen one.
3. **Local-first; egress is an enforced `^gate`.** Structure is computed on-machine. Content reaches a cloud LLM only via code-enforced, logged, per-root opt-in.

## Architecture

| Layer | Contents | Storage | Authority |
|---|---|---|---|
| **Scan** (deterministic, local) | paths, sizes, mtimes, existing frontmatter/Obsidian properties, headings, `[[wikilinks]]`, PDF text layer | derived index (SQLite FTS5 beside the aspect graph), incremental by mtime+hash | computed |
| **Declared** | confirmed labels, gates, cross-links, provenance | out-of-tree sidecar `~/.paradigm/brains/<root-hash>/` (internal `.purpose`-compatible); optional write-back to md frontmatter under one reserved `paradigm:` key (opt-in) | **truth** |
| **Inferred** | classification, entity extraction, suggested links, summaries, themes | `suggestions.jsonl` with model, confidence, source content hash; auto-stale when the source hash changes | never truth |

- Existing Obsidian `tags:` map to symbol **tags**, never to symbols.
- The classifier ships as a versioned, certifiable **skill** (skills primitive, 7.10.0); the rules for what counts as truth stay deterministic code.
- Confirmation writes reuse Memory Steward's backup + atomic-write discipline.

### Unit of meaning

A **file / heading / block is an anchor**, not a symbol. **Symbols are the concepts many files point at.** Minting a symbol per note would recreate the junk drawer inside the graph.

### Symbol semantics for documents

| Prefix | Meaning | Anchor rule |
|---|---|---|
| `#` | Entity — project, person, topic, place (by tag, e.g. `[person]`; no new symbol kinds) | files that declare it |
| `$` | Recurring process — tax filing, weekly review, visa renewal | each step anchors to a file/template |
| `^` | Sensitivity boundary — `^private`, `^medical`, `^financial`, `^no-egress`, `^metadata-only`, `^third-party-data` | per folder, inherited, **fail-closed** |
| `!` | Dated event or decision | date + source file required |
| `~` | Cross-cutting theme | ≥1 heading/block anchor |

`^gate` is the highest-value mapping: a personal corpus without enforceable boundaries must never be connected to an agent.

User-facing vocabulary: **Topics**, **Processes**, **Private (stays on this Mac)**, **Events**, **Themes**, **Suggestions**.

## Differentiators (white space)

1. **Provable staleness** — Memory Steward's graph-validity extended: a file citing a deleted file/code symbol is *proven* stale.
2. **Link integrity under renames** — stable IDs separate from filenames; move/rename is a graph operation rewriting inbound links.
3. **Declared-schema validation** — a doctor for tag entropy, orphans, dangling links, duplicate titles.
4. **Provenance** — human-written vs agent-synthesized vs raw source, with source hash and verification status.
5. **Sensitivity as structure**, enforced at the MCP boundary.
6. **Brain ↔ code links** via workspaces: brain is a member (`brain/#topic`), `exports` expose only ungated symbols; links flow brain→code only.

Layout presets (not rival formats): Johnny.Decimal, Karpathy "LLM Wiki" (`raw/` + index/log), Obsidian properties/Bases. **Do not use the name "PARA"** — collides with University's PARA courses.

## Security (Aegis) — must be true before ship

- `brain.yaml` (portal.yaml analogue): allow-listed roots, default-deny; folder globs → sensitivity gates.
- Blocked by default: `~/Library`, `.ssh`, password-manager exports, mail stores, browser profiles.
- Local detectors *before* any labelling: secret scanner, ID/passport/card-number patterns; hits refuse indexing and flag the folder.
- Zero-config default = **local-only** (parse, OCR, embeddings). Cloud assistance = plain-language per-root opt-in; sensitive zones never sent.
- Egress enforced in code (not advisory), append-only egress log, plain-language "what left my computer" page.
- One-button **forget this folder** (`paradigm brain purge`).
- Document text is always data (injection envelope); agents never edit user files — only sidecars, only after confirmation.
- Hardened parsers: sandboxed, size/time caps, no docx macros.
- Red-team corpus passes: injection in md/PDF/images, secrets in odd formats, third-party DM export, OCR of IDs/faces/EXIF GPS.
- Platform section inherits `^local-only` Origin/Host enforcement.

## UX (Mika)

- **Primary surface:** Platform section (`paradigm serve`, single command / double-click), reusing the Memory ledger pattern (row, score, rationale, one-click accept). CLI secondary. Obsidian plugin = optional connector. Not Conductor.
- **Labelling:** suggestion-first, batched (≤10 per session), keyboard triage, rationale beside each; label folders not files unless outliers.
- **Anti-graveyard:** earn keep through *retrieval and decay*, never capture chores. Every label must answer a question; unused labels fade visibly; weekly 2-minute digest. Success metric = **questions answered**.
- **First 10 minutes:** pick a folder → local-only scan with a visible "nothing has left your computer" badge → map by type/size/recency → private zones auto-flagged and locked → triage ~10 folder suggestions → ask one real question ("find my lease") and get a correct answer → only then offer cloud-assisted labelling.

## Learning loop (Loid)

suggest → human verdict → calibrate (confidence vs verdict, **per vault, per label type, per file type**) → reliably-accepted heuristics promote to a per-vault skill/protocol; repeatedly rejected classes throttle. Staleness = type-decay + graph-validity. Prune signal = labels with no retrieval hits in 90 days. No new ledger — reuses existing calibration shapes.

## Prerequisites (land in Phases 3–4; pay off for code too)

1. **One shared frontmatter parser** in premise-core (today: `memory-scan.ts` and `skill-loader.ts:151` each have one).
2. **`SourceType` gains `'frontmatter'`** (`packages/premise/core/src/types.ts:44` is closed).
3. **Heading/block anchor kind** — `CodeAnchor` is `{path, lines}` (`types.ts:110`); line ranges don't survive document edits.
4. **Incremental index** replacing per-call re-aggregation (`graph-slice.ts:145` PERF) and linear search (`symbol-index.ts:97`); `.purpose` discovery ignore list (`purpose/core/src/aggregator.ts:153`).

## MVP (one real folder, ~1–3k files)

1. `paradigm brain scan` — read-only; reports broken links, orphans, duplicate titles. Day-one value, zero labelling.
2. Private zones enforced — gated files never appear in MCP output.
3. Topic suggest→confirm on ~50 files; acceptance measured.
4. One brain→code cross-link via workspace, with the staleness proof.

Out of MVP: PDF content understanding beyond text layer, `$` processes, `~` themes, embeddings, cloud assistance.

### Pass criteria (all required)

- Zero false symbols from document bodies.
- Incremental reindex < 2 s.
- Zero gated-content leaks across 100 probe queries.
- Suggestion acceptance ≥ 60% (else the inference layer is noise).

## Risks

1. Sensitive/third-party data exposure — amplified by OCR of images and scans.
2. Injection and exploits through document parsers.
3. Developer-shaped UX leaking through (symbols, YAML, CLI) — kills non-developer adoption; the University/Platform section precedent was broken for months.
4. Becoming store #13 / a second-brain graveyard.

## Open questions

- Product name (user-facing) — "Brain" is a working title.
- Local model choice for OCR/classification on non-Apple hardware.
- Whether write-back to md frontmatter is offered at all in v1, or deferred.
