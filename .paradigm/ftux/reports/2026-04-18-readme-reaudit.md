# FTUX Re-Audit — README Restructure Validation (2026-04-18)

**Agent:** Nora (FTUX)
**Task:** Validate whether the restructured README fixes the friction identified in the first audit (`2026-04-18-readme-audit.md`).

## Scope

New `README.md` only, re-audit after restructure. I re-walked it top-to-bottom as a first-time reader who just heard about Paradigm and has npm. I also confirmed `paradigm --help` and `paradigm shift --help` align with the README text.

---

## Scores on 6 Validation Asks

### 1. First 30 seconds — "what is it + one command to run" without scrolling or jargon

**Score: fixed**

Line 7: *"One command to make your codebase AI-ready."* — crystal-clear tagline, no jargon.
Lines 15–19: *"## Install" → `npm install -g @a-company/paradigm`*.
Lines 21–26: *"## Run it" → `cd your-project` + `paradigm shift`*.
Line 28: *"That's it. `paradigm shift` scaffolds everything your AI assistant needs to understand your codebase — a project map, access rules, IDE instruction files, and enforcement hooks — in one command. Safe to re-run. Works with TypeScript, Python, Rust, Go, Swift, and more."*

A first-time reader can see what Paradigm is, how to install it, and what to run, all above the fold (lines 7–28). No scrolling required on a standard viewport. The phrase "project map, access rules, IDE instruction files, and enforcement hooks" is plain English with zero undefined nouns. This is a clean fix.

### 2. `paradigm shift` framing consistency — one command, one purpose

**Score: fixed**

Every `shift` reference now reduces to the same idea: "full project setup in one command, safe to re-run."

- Line 7 tagline frames the product around one command.
- Line 25–28: the bare invocation is THE install-and-use path.
- Line 128: *"`paradigm shift` — the one command"* is a dedicated H2.
- Line 132: *"Run it on a fresh project or an existing one. It detects which case it's in and does the right thing."* — resolves the old "propagate vs setup vs scaffolder" ambiguity by saying plainly: it handles both cases.
- Line 149 (invocation table): *"Full project setup. Idempotent. Safe to re-run."*
- Line 299: *"`paradigm shift` runs all of these by default."*
- Line 317 (plugin section): *"Still run `paradigm shift` inside each project to create the per-project files."* — consistent with the "one command" framing; no longer contradictory.
- Line 335: *"`paradigm shift` covers first-time setup and most re-runs."*
- Line 339 (commands table): *"Full project setup; safe to re-run."*

The old three competing framings (propagate / full-setup / scaffolder) are now all compatible facets of "full project setup." `paradigm shift --help` output (verified via Bash) matches exactly: *"Full project setup in one command (init + team init + scan + sync all IDEs + doctor)."* The source of truth and the README now agree.

### 3. `.purpose` dead-end — is the skeleton + filled example enough?

**Score: partially-fixed**

Big improvement over the old README (which showed no `.purpose` content at all). Lines 163–170 now show the empty default skeleton:

```yaml
version: "2.0"
id: root
description: ""
components: []
```

Lines 172–190 show a filled example with components, tags, signals, gates. Line 192 gives the next-step guidance: *"Place additional `.purpose` files inside feature directories (e.g., `src/features/checkout/.purpose`) to describe subsystems with more precision. Your AI assistant reads these before touching your code."*

**Why only partially-fixed:** the example declares `signals`, `gates`, and `tags` as structural keys before the reader has seen the symbol table (which is 60+ lines later, at line 243). A first-time reader sees `signals: [payment-submitted, payment-failed]` and `gates: [authenticated, cart-not-empty]` without yet knowing that signals are `!`-prefixed events and gates are `^`-prefixed auth checkpoints. The example is decipherable from context, but it would be stronger if either:
  (a) a one-line gloss near the example said *"signals are events your code emits; gates are authorization requirements"*, or
  (b) the example was narrowed to just `id`, `description`, `components[].id`, `kind`, `tags`, `description` — deferring signals/gates to a later "fill in auth" section.

There is still no narrative "run shift, then run `paradigm beacon` and look at this output" hello-world showing what the AI assistant actually *sees* after you fill in a `.purpose`. The reader is handed a template but isn't shown the payoff loop. This is the same gap as the old report's #10 (missing_coverage), just smaller.

### 4. Undefined-term count in first 50 lines — target zero

**Score: fixed (essentially)**

Lines 1–50 contain no undefined jargon. I re-checked each potentially-loaded term:

- Line 7: "AI-ready" — understood from context.
- Line 28: "project map, access rules, IDE instruction files, and enforcement hooks" — all concrete, plain English.
- Line 28: "TypeScript, Python, Rust, Go, Swift" — universally recognized.
- Lines 32–46 (sample output): `paradigm`, `navigator.yaml`, `agents.yaml`, `.purpose`, `portal.yaml`, `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, `.claude/hooks/` — these are labeled inside the output block with descriptions ("Project configuration", "Symbol navigation map", etc.). A first-timer doesn't need to know them deeply; the reader just sees "my tool created these and they're labeled."

"Meta-framework," "authorization topology," "on-demand intelligence," "disciplines," "stack presets," "knowledge graph," "Premise" — all the old jargon is gone from the first 50 lines. "Symbol navigation map" (line 44) is the only ambiguous phrase but it is self-labeling inside a file listing, not a standalone concept the reader has to hold.

**One minor nit:** "authorization gates" (line 58) appears in the sample output label. It's close enough to self-explanatory ("gates" + "authorization") that I wouldn't block on it, but it's the first semi-technical phrase a first-timer hits. It appears in a visually-compact labeled file listing where the ambiguity has low cost.

### 5. Three-install-path paralysis — npm primary, others in `<details>`

**Score: fixed**

Lines 15–19 present `npm install -g @a-company/paradigm` as THE install command with no competing alternatives visible. The "Other ways to install" section (lines 69–124) wraps all three alternatives (install script, manual source, Claude Code plugin) in `<details>` tags, collapsed by default. A first-timer reads one install command; advanced users expand the disclosure. Clean fix.

One small observation: the Claude Code plugin being in `<details>` alongside "manual install from source" slightly undersells it for Claude Code users — but that's a product-positioning question, not a first-time-user friction, and doesn't affect the default path.

### 6. Concepts section ordering — should `.purpose` lead instead of symbols?

**Score: partially-fixed (ordering could still improve)**

Current order in the Concepts section:
- Line 243: The five symbols
- Line 257: `.purpose` files
- Line 261: `portal.yaml`
- Line 265: Enforcement hooks
- Line 278: The agent team

**Here's the nuance:** the reader has *already seen* a filled `.purpose` example at line 163–190 (in the "What you just got" section), 60+ lines before the symbol table. So the symbol table at line 243 is no longer the first encounter with Paradigm concepts — it's the explainer for symbols the reader has already met in the `.purpose` example. In that sense, the ordering works: "here's what you got → then here's the vocabulary → then here's the topology → then the hooks that enforce it → then the team that uses it."

**However**, inside the Concepts section itself, I'd still argue `.purpose` should lead because:
(a) the `.purpose` example is the artifact the reader was just handed by shift,
(b) symbols only make sense *inside* `.purpose` files, commit messages, and AI prompts — so they're consumers of `.purpose`, not foundations,
(c) line 245 itself says: *"Use these prefixes in `.purpose` files, commit messages, and AI prompts"* — which implies `.purpose` is the precondition. Leading with symbols asks the reader to hold the table in their head before they see *where* it's used.

Swapping symbols ↔ `.purpose` inside Concepts would tighten it. That said, this is a polish-level ordering call, not a friction blocker. Readers won't stall here because the `.purpose` example earlier primed them.

---

## New Friction (regressions or new issues)

1. **"Authorization topology" still appears once (line 262)** — inside the `portal.yaml` concepts block: *"A single project-root file describing your authorization topology — the gates (auth requirements) and the routes that require them."* The term is now immediately glossed in the same sentence ("the gates... and the routes..."), so it's acceptable, but it is the one surviving phrase from the old audit's undefined-term list. Low severity.

2. **"14 disciplines" and "16 presets" still appear (line 234)** — *"14 disciplines auto-detect your stack; 16 presets cover common frameworks."* The numbers-without-definition pattern flagged in the old audit survives here. At this point in the read the friction is lower (the reader has already been sold on the tool), but "disciplines" in this sentence is still opaque. A first-timer doesn't know whether a "discipline" is a programming language, a framework family, a team role, or something else. Medium-low severity because it's in a benefit-bullet list where the abstraction is tolerable.

3. **MCP introduced without acronym expansion** — line 303: *"Paradigm ships an MCP server..."* The acronym is never expanded to "Model Context Protocol." A reader who hasn't used Claude Code / Cursor may not recognize MCP. Low severity because anyone in the target audience likely knows it, but it's a one-word fix.

4. **"Gates" naming collision with the label in the sample output (line 58, "Authorization gates")** vs the first-symbol-table introduction at line 251 ("`^authenticated` — Authorization checkpoint"). The same word means the same thing both places, so there's no contradiction — just a note that "gate" pulls double duty as a symbol name and as a portal.yaml entity. The `portal.yaml` concepts block (line 262) resolves this by calling them "gates (auth requirements)." Acceptable.

5. **The "What you just got" section (line 159) shows a filled `.purpose` example with `signals` and `gates` keys before those terms are defined (line 251, 253).** This is the same ordering tension flagged under Ask #3 and Ask #6 — noted here as a reinforcing data point, not a new issue.

None of these rise to the level of the old critical/high findings. No actual regressions from the old README.

---

## Regressions (things the old README had that the new one lost)

None material.

The old README's "Quick Start → One Command Setup" six-chain (`paradigm init && paradigm sync --all && ... && paradigm doctor`) is gone — correctly — because `paradigm shift` subsumes it. A reader who specifically wants to know what shift does under the hood gets that information in the "What it does" section (lines 132–141), which enumerates the 6 steps as narrative rather than as a copy-paste command. Better, not worse.

The old README's visible enumeration of three install paths side-by-side is gone. Two of them are now inside `<details>`. This is a UX win, not a regression. The plugin install still appears in `<details>` where Claude Code users might want it higher-up, but that's a positioning tradeoff not a regression.

Everything the old README covered (commands table, packages table, IDE support, MCP, Sentinel, University, Conductor, agent team, workspaces) is still present. Content completeness preserved.

---

## Side-by-Side Comparison

| Original Friction | Severity | New State |
|-------------------|----------|-----------|
| `paradigm shift` buried at line 219 with "propagate updates" framing | **critical** | **fixed** — now THE primary command at line 25, with a dedicated H2 section "paradigm shift — the one command" at line 128 |
| 6-command Quick Start chain (`init && sync --all && mcp setup && constellation && beacon && doctor`) | **critical** | **fixed** — chain removed entirely; replaced by `paradigm shift` as the sole recommended command |
| `.purpose` dead-end — "edit .purpose" with no template | **critical** | **partially-fixed** — empty skeleton (line 163) and filled example (line 172) both shown, but no narrative hello-world loop showing what shift → edit `.purpose` → AI-assistant-sees-it looks like end-to-end |
| No "first run / hello world" section | **critical** | **partially-fixed** — the "What you'll see" output mock (line 32) and the filled `.purpose` example (line 172) together approximate a hello-world, but there's no "now run `paradigm beacon` and see this" payoff moment |
| 20+ undefined jargon terms in first 50 lines | **high** | **fixed** — first 50 lines now contain zero undefined abstractions; jargon deferred to labeled contexts |
| Three competing install paths presented side-by-side | **high** | **fixed** — npm is the only path visible by default; others collapsed into `<details>` |
| Symbol System table shown before reader has reason to care | **high** | **fixed** — now at line 243, in the Concepts section, after the reader has seen filled `.purpose` content; the intro line "Read this section when you want depth. You don't need any of it to get value from the tool" (line 241) further lowers the stakes |
| Second `shift` mention 159 lines after install, framed as "full setup" | **high** | **fixed** — all `shift` mentions are now consistent and most are in the top half |
| Three conflicting framings of `shift` (propagate / full-setup / scaffolder) | **high** | **fixed** — single framing throughout ("full project setup, safe to re-run") |
| Tagline dense with jargon ("meta-framework, structured context, authorization topology, on-demand intelligence") | **medium** | **fixed** — new tagline is *"One command to make your codebase AI-ready."* |
| Three "pillars" introduced without file examples | **medium** | **fixed** — "pillars" framing dropped entirely; `.purpose` and `portal.yaml` are shown as files with real content |
| MCP "included" vs "must configure" contradiction | **medium** | **fixed** — the plugin vs manual-mcp-setup distinction is cleanly addressed in the `<details>` plugin block (line 122) |
| `~/.paradigm-cli/` hidden constraint for the script install | **medium** | **fixed (by relocation)** — the constraint is still there (line 88) but only for users who opt into the script install; it's no longer on the default path |
| Third framing of `shift` at line 396 | **medium** | **fixed** — consolidated into one framing |

---

## Verdict

**ship-with-minor-edits**

The restructure is a substantial improvement. All four original critical findings are fixed or partially-fixed, no regressions, and the first 30 seconds experience is now clean. The remaining asks are polish, not friction.

Three small edits would close out the partial-fixes without restructuring anything:

1. **Add one micro-gloss near the filled `.purpose` example (line 190ish):** *"`signals` are events your code emits (see `!` symbols below); `gates` are authorization requirements (see `^`)."* — resolves the forward-reference problem where the example uses terms defined 60 lines later.

2. **Add a 3–5 line "What your AI sees" block after the `.purpose` example (between lines 192 and 194)** showing a one-sentence example of how an AI assistant uses the `.purpose` content — something like: *"Run `paradigm beacon` to generate `.paradigm/beacon.md`, a compact orientation file your AI assistant reads in ~300 tokens. With the `.purpose` above, the AI knows your project has a `#checkout` component with `!payment-submitted` signals before reading any source."* — closes the dead-end loop that the old friend likely stalled on.

3. **Expand MCP on first use (line 303):** *"Paradigm ships an MCP (Model Context Protocol) server..."* — one word, zero structural change.

None of these block ship. The README is materially better than it was 24 hours ago.

---

```yaml
# Agent Relay
status: success
summary: |
  README restructure successfully addresses all four critical findings from the original
  audit. paradigm shift is now THE primary command at line 25 with a single unambiguous
  "full project setup, safe to re-run" framing throughout. The 6-command chain is gone.
  Three install paths collapsed to one visible default with the rest in <details>.
  Jargon cleared from the first 50 lines. The .purpose dead-end is partially fixed —
  an empty skeleton and a filled example are both shown, but no narrative hello-world
  closes the loop between "edit .purpose" and "AI assistant uses it." Three small polish
  edits would tighten the partial-fixes, but none block ship.
artifacts:
  - .paradigm/ftux/reports/2026-04-18-readme-reaudit.md
decisions:
  - overall verdict: ship-with-minor-edits
  - remaining ask 1: add a one-line gloss defining signals/gates near the filled .purpose example (line 190), since those terms are defined 60+ lines later
  - remaining ask 2: add a 3-5 line "What your AI sees" block after the .purpose example, showing a concrete paradigm-beacon → AI-assistant payoff loop
  - remaining ask 3: expand MCP to "Model Context Protocol" on first use (line 303)
handoff_to: builder
handoff_context: |
  Three non-blocking polish edits remain. All are single-paragraph or single-word
  additions; no restructuring required. After these three edits the README should
  clear for ship. Specifically: (1) near line 190 add a one-sentence gloss — "signals
  are events your code emits (!); gates are authorization requirements (^)"; (2)
  between lines 192 and 194 add a 3-5 line block showing that after filling .purpose,
  running paradigm beacon produces beacon.md that the AI reads in ~300 tokens — this
  closes the hello-world loop the first audit flagged as critical; (3) line 303
  expand MCP to "Model Context Protocol" on first use. These three edits take the
  verdict from ship-with-minor-edits to ship-it.
```
