# FTUX Friction Report — README Audit (2026-04-18)

**Agent:** Nora (FTUX)
**Hypothesis under test:** `paradigm shift` should be THE single entry point — all a first-time user really needs to know is `paradigm shift` and its overloads/subcommands.

## Surface Examined

1. `README.md` (root) — lines 1–500, read in full, in order
   - (Did not descend into `docs/guides/**`, `CHANGELOG.md`, or `--help` output. Findings below were severe enough from README alone that descending was unnecessary to form the verdict. This is noted as scope, not laziness — further surfaces exist to audit in a follow-up.)

## Task Attempted

Simulated goal: *"I'm a developer who just heard about Paradigm. I want to: (1) understand what it is in 30 seconds, (2) install it, (3) run my first command and see something useful happen, (4) know what to do next."*

I walked the README top-to-bottom exactly as a first-time reader would.

## Step-by-Step Walkthrough

### Step 1: Read the tagline and lead paragraph (lines 12–16)

- **Action:** I read the top of the page to understand what Paradigm is in 30 seconds.
- **Outcome:** confused
- **Friction type:** undefined_term, assumed_context
- **Severity:** medium
- **Quote:** *"A language-agnostic meta-framework that gives AI agents structured context to navigate, understand, and modify any codebase — 8.5x fewer tokens, 88% lower cost."* (line 14) and *"Paradigm is a developer tools ecosystem that brings **structured context**, **authorization topology**, and **on-demand intelligence** to modern software projects"* (line 16)
- **Note:** "Meta-framework," "structured context," "authorization topology," "on-demand intelligence," "14 auto-detected disciplines and 16 stack presets" — five undefined abstractions in two sentences. I can guess "structured context" means something about context for AI, but "authorization topology" and "disciplines" are opaque. I don't have a concrete mental model yet. The 30-second goal is not met.

### Step 2: Read "The Problem" and "The Solution" (lines 18–44)

- **Action:** Continued reading to ground the abstractions.
- **Outcome:** partially confused
- **Friction type:** undefined_term
- **Severity:** medium
- **Quote:** *"| **Purpose** | Define what things are and why they exist (`.purpose` files) | / | **Portal** | Define who can access what, under what conditions (`portal.yaml`) | / | **Premise** | Aggregate everything into a queryable knowledge graph |"* (lines 32–34)
- **Note:** `Purpose / Portal / Premise` is introduced as the "Three pillars" but these are capitalized proper-noun concepts with one-line descriptions. The `.purpose` file and `portal.yaml` are mentioned with no file-format example, no showing of what one looks like. "Knowledge graph" (Premise) gets zero concrete example. I can tell what they *claim* to do but not what they *are*. Also note: `University`, `Sentinel`, `Multi-Agent Orchestration` are listed as "tooling" at line 42–43 but add to the surface area the reader is asked to hold in their head before installing anything.

### Step 3: Read "Symbol System" (lines 62–76)

- **Action:** Looked at the five symbols.
- **Outcome:** confused
- **Friction type:** buried_info, assumed_context
- **Severity:** high
- **Quote:** *"| `#` | Component | `#checkout`, `#Button` | Any documented code unit | / | `$` | Flow | `$checkout-flow` | Multi-step process | / | `^` | Gate | `^authenticated` | Authorization checkpoint | / | `!` | Signal | `!login-failed` | Event or side effect | / | `~` | Aspect | `~audit-required` | Cross-cutting rule with code anchor |"* (lines 68–72)
- **Note:** The symbol table lands *before* I've installed anything or seen a `.purpose` file. As a first-timer, I don't yet know *where* these symbols live, *who* writes them, or *when*. "Cross-cutting rule with code anchor" (aspect) is itself jargon. A reader at this point has no reason to care about five new symbols — they came to install a tool. **This section is buried-info in reverse: it is shown too early, before I have a reason to want it.**

### Step 4: Read "Installation" (lines 80–134)

- **Action:** Ran `npm install -g @a-company/paradigm` mentally.
- **Outcome:** mostly success, some concern
- **Friction type:** assumed_context, contradictory
- **Severity:** medium
- **Quote (install script):** *"This clones the repo to `~/.paradigm-cli/`, builds both `paradigm` and `paradigm-mcp`, and installs them globally."* (line 114) and *"**Note:** The source directory at `~/.paradigm-cli/` must be kept — the global CLIs symlink to it."* (line 116)
- **Note:** Three install methods (npm quick, install script, manual from source) are offered without a clear default. The npm install claims *"The MCP server (`paradigm-mcp`) is included"* (line 96) but then also says *"Run `paradigm mcp setup --client all` after installing to configure it for your AI client."* — "included" vs "must configure" is two different things and the reader has to parse it. The script-install "must keep ~/.paradigm-cli" constraint is surprising for something presented as a curl|bash one-liner. Also: `@a-company/paradigm-mcp` appears in the uninstall command (line 116) even though line 96 said the MCP server is "included" in the paradigm package — contradictory.

### Step 5: Read "Quick Start → One Command Setup" (lines 140–148)

- **Action:** Looked at the recommended first-run command.
- **Outcome:** blocked (cognitive)
- **Friction type:** broken_flow, assumed_context
- **Severity:** **critical**
- **Quote:** *"`paradigm init --quick && paradigm sync --all && paradigm mcp setup --client all && paradigm constellation && paradigm beacon && paradigm doctor`"* (line 143)
- **Note:** Six chained commands with no per-command explanation of what each produces and no guidance on what to do if one fails mid-chain. `constellation` and `beacon` are introduced as bare command names with no prior definition. The reader is asked to copy-paste a six-command chain as their *first action*. This is the canonical "wall of setup" antipattern. **This is the single biggest gap with the hypothesis:** if `paradigm shift` is supposed to be THE entry point, it is not what's being recommended here — a six-command chain is.

### Step 6: Read "Step-by-Step" and "Minimal Start" (lines 150–180)

- **Action:** Looked for a simpler first path.
- **Outcome:** confused
- **Friction type:** contradictory, buried_info
- **Severity:** high
- **Quote:** *"You don't need everything. Start small: / `paradigm init` / # Edit src/features/.purpose (or wherever your features live) / `paradigm beacon`"* (lines 172–178)
- **Note:** The README offers three competing "first-time paths" on the same screen: the six-command chain (line 143), the five-step version (lines 152–168), and the two-command "Minimal Start" (lines 172–178). A first-timer now has to choose between three paths with no guidance on which to pick. The "Minimal Start" advice *"Edit src/features/.purpose (or wherever your features live)"* assumes I already know what to put in a `.purpose` file — I haven't seen one yet, anywhere in the README. No example is shown. **This is where the friend likely got stuck: "edit .purpose" with no template is a dead-end.**

### Step 7: Read "Key Commands" (lines 207–250)

- **Action:** Scanned the commands list to find the primary entry point.
- **Outcome:** confused
- **Friction type:** buried_info
- **Severity:** **critical**
- **Quote:** *"`paradigm shift             # Propagate updates across all your projects`"* (line 219)
- **Note:** `paradigm shift` appears exactly once here, as the **last item** in the "Setup & Validation" list, described as *"Propagate updates across all your projects."* This description suggests it is a bulk-update tool for existing Paradigm users, not a first-time entry point. A new reader would absolutely pass over it. **This directly contradicts the author's hypothesis**: `paradigm shift` is positioned as a fleet-update command, not as THE entry point. If the intent is for it to be THE entry point, the README does not reflect that at all.

### Step 8: Read "Enforcement Hooks → Install hooks per-project" (lines 376–382)

- **Action:** Found the second mention of `paradigm shift`.
- **Outcome:** confused
- **Friction type:** contradictory, buried_info
- **Severity:** high
- **Quote:** *"**Install hooks per-project:** / `paradigm shift                        # Full setup (includes hooks)` / `paradigm hooks install                # All hooks (git + Claude Code + Cursor)`"* (lines 377–380)
- **Note:** Here, `paradigm shift` is suddenly framed as *"Full setup (includes hooks)."* **This is the first and only place in the README where `shift` is described in a way that matches the hypothesized "entry point" framing — and it appears on line 378, 378 lines after the installation section and buried under "IDE Support → Enforcement Hooks."** A reader who gave up at step 5 or step 6 (above) would never see it. This is contradictory with line 219's "Propagate updates across all your projects."

### Step 9: Read "Plugin vs per-project setup" (lines 393–399)

- **Action:** Found the third mention.
- **Outcome:** partial clarity, partial confusion
- **Friction type:** contradictory
- **Severity:** medium
- **Quote:** *"- **`paradigm shift`** creates per-project files (`.paradigm/`, `.purpose`, `.cursor/rules/`, `portal.yaml`) committed to git / - Most teams use both: plugin for enforcement, `paradigm shift` for project-specific context"* (lines 396–397)
- **Note:** Here `shift` is described as *"creates per-project files."* That is yet a **third distinct framing** of `shift`:
  - Line 219: "Propagate updates across all your projects" (fleet tool)
  - Line 378: "Full setup (includes hooks)" (installer)
  - Line 396: "creates per-project files ... committed to git" (scaffolder)
  Three framings on three different pages of the same README. A first-time reader has no way to reconcile these.

### Step 10: Tried to find "what do I do after install"

- **Action:** Looked for a narrative "now what?" after install — a tutorial, a 5-minute hello-world, something.
- **Outcome:** blocked
- **Friction type:** missing_coverage
- **Severity:** **critical**
- **Quote:** *Nothing applicable. The README does not contain a "First Run" or "Hello World" section. The closest is "Minimal Start" at line 172 which terminates with `paradigm beacon` and the vague instruction to "edit .purpose".*
- **Note:** There is no worked example showing: "Here is a sample `.purpose` file, here is what you put in it, here is what `paradigm beacon` then shows, here is what an AI agent then sees." The user is left at a dead end after installation. The "[Quick Start Guide](./docs/guides/quick-start.md)" link at line 428 might address this, but it is listed at line 428 — after all the surface-area-expanding sections about Sentinel, University, IDE support, plugins, and packages.

## Friction Summary Table

| Step | Type | Severity | Description |
|------|------|----------|-------------|
| 1 | undefined_term / assumed_context | medium | Tagline dense with jargon; no concrete model in 30 seconds |
| 2 | undefined_term | medium | Three "pillars" introduced without a single concrete file example |
| 3 | buried_info (shown too early) | high | Five-symbol table shown before reader has context or reason to care |
| 4 | contradictory / assumed_context | medium | Three install paths; MCP "included" vs "must configure" contradiction; hidden `~/.paradigm-cli` constraint |
| 5 | broken_flow / assumed_context | **critical** | Six-command chain as the recommended first run, no per-step meaning |
| 6 | contradictory / buried_info | high | Three competing "first paths" on one screen; "edit .purpose" with no example |
| 7 | buried_info | **critical** | `paradigm shift` first appears described as a fleet-propagate tool (line 219), not as the entry point |
| 8 | contradictory / buried_info | high | Second `shift` mention (line 378) finally frames it as "full setup" — 159 lines after installation |
| 9 | contradictory | medium | Third framing of `shift` ("creates per-project files") conflicts with prior two |
| 10 | missing_coverage | **critical** | No "first run / hello world" section; reader has no narrative path from install to value |

## Where does `paradigm shift` appear?

- **Line 219:** `paradigm shift             # Propagate updates across all your projects` — in "Setup & Validation" command list. Framed as a **fleet/bulk-update** tool. **This is the first mention.**
- **Line 378:** Under "Enforcement Hooks → Install hooks per-project" as `paradigm shift                        # Full setup (includes hooks)`. Framed as an **installer**.
- **Line 396:** Under "Plugin vs per-project setup" as *"`paradigm shift` creates per-project files (`.paradigm/`, `.purpose`, `.cursor/rules/`, `portal.yaml`) committed to git."* Framed as a **scaffolder**.

**Total: 3 mentions, all in the back half of the document, each framed differently, none treated as THE entry point.**

The Installation section (lines 80–134) never mentions `paradigm shift`. The Quick Start section (lines 140–180) never mentions `paradigm shift`. The Key Commands section (lines 207–250) relegates it to the *last line* of the "Setup & Validation" subgroup with a one-liner suggesting it is for existing users with multiple projects.

**Verdict on the hypothesis:** The README does *not* currently frame `paradigm shift` as THE entry point. In its current state, `paradigm shift` reads as a power-user command for updating *existing* Paradigm installations across multiple projects. A first-time user following the README is steered toward `paradigm init --quick && paradigm sync --all && paradigm mcp setup --client all && paradigm constellation && paradigm beacon && paradigm doctor` — a six-command chain — as their first contact with the tool.

## Undefined Terms Encountered (before definition, or never defined in plain English)

Terms that appeared in the README without a plain-English definition prior to their first use, in the order they appeared:

1. **meta-framework** (line 14) — never defined
2. **structured context** (line 14, 16) — defined only circularly
3. **authorization topology** (line 16) — never defined in user terms
4. **on-demand intelligence** (line 16) — never defined
5. **disciplines** (line 16, 456) — "14 auto-detected disciplines" appears twice; never defined
6. **stack presets** (line 16, 456) — never defined
7. **.purpose files** (line 32) — named before any example shown
8. **portal.yaml** (line 32) — named before any example shown
9. **knowledge graph** (line 34) — no example
10. **Premise** (line 34) — vague one-line definition only
11. **Component / Flow / Gate / Signal / Aspect** (lines 68–72) — terse table definitions with no narrative
12. **`beacon.md`** / **beacon** (line 164, 180, 199, 224, 437) — never defined; mentioned as a noun, a command, and a file
13. **`constellation`** (line 163, 225) — never explained beyond "symbol relationship graph"
14. **`shift`** (lines 219, 378, 396) — three conflicting framings, no single definition
15. **Sentinel** (line 41, 304) — introduced as a tool name; what it *is* only unpacked at line 306
16. **University / PLSAT** (line 42, 322–344) — PLSAT acronym buried
17. **MCP** (line 40) — used heavily before being expanded as "Model Context Protocol" (never expanded in README)
18. **aspect graph / habits / lore / session intelligence** (line 338) — appear only in the PARA 501 course title, never defined
19. **wisdom** (line 237, 274) — command and concept, never defined
20. **echo** (line 235) — command name, glossed as "Map error codes to symbols" with no example
21. **thread** (line 233) — command for "session continuity" — undefined
22. **neverland / symphony** — (not in README; checked) these do NOT appear in README (good), but CLAUDE.md references them, creating inconsistency if a reader ever sees both
23. **orchestration / architect / builder / reviewer / tester / security** (line 250) — named without explaining what each role does

## Verdict

**Overall readiness:** **needs-work**

**Critical gaps (in priority order):**

1. **No first-run narrative.** The README lacks a "Hello World" / "first five minutes" walkthrough showing a complete minimal `.purpose` file, running a command, and seeing a concrete output. Without this, the "Minimal Start" (line 172) is a cliff — "edit .purpose" with no template is where the friend almost certainly got stuck.
2. **`paradigm shift` is not framed as the entry point.** Three mentions, three different framings ("propagate updates," "full setup," "creates per-project files"), all in the back half. The author's hypothesis is not reflected in the current text. If `shift` *is* meant to be THE command, it must move into the Installation or Quick Start section with a single unambiguous description, and the six-command chain at line 143 must be either retired or demoted to "advanced".
3. **The Installation → Quick Start gap.** Three install methods collide with three "first-run paths" (one-command chain, step-by-step, minimal). A reader has no signal about which to follow. Recommend collapsing to one recommended path with the others behind a "Other ways to install / other ways to start" disclosure.
4. **Jargon front-loaded before utility.** The Symbol System table lands before the user has any reason to care. Relocate *after* a worked first-run example, or compress it to a tooltip-style "you'll see these later" aside.

The README describes a rich product but does not *teach* it. A first-time user who doesn't already share the author's mental model will stall somewhere between the six-command chain (step 5) and the "edit .purpose" instruction (step 6). The hypothesis that `paradigm shift` should be THE entry point is sound, *and* the README does not currently execute on it.

---

```yaml
# Agent Relay
status: success
summary: |
  README audit confirms the author's hypothesis: paradigm shift is not currently framed as
  THE entry point. It appears 3 times in the README, all in the back half, with 3 conflicting
  framings (fleet-propagate / full-setup / scaffolder). The first-time reader is instead
  steered toward a 6-command chain (line 143) or a dead-end "edit .purpose" instruction
  (line 176) with no template. Critical gaps: no hello-world walkthrough, 3 competing
  install paths, symbol system table shown before the reader has reason to care, and
  ~20+ undefined jargon terms appear before definition. Overall: needs-work.
artifacts:
  - .paradigm/ftux/reports/2026-04-18-readme-audit.md
decisions:
  - paradigm shift must be hoisted into the Installation or Quick Start section with a single unambiguous one-liner (e.g. "one command to set up Paradigm in this project")
  - The six-command chain at line 143 should be demoted to an "advanced / what shift does under the hood" disclosure
  - A "Your first five minutes" worked example is required — include a sample .purpose file, the command to run, and the exact output the reader will see
  - The three framings of shift (propagate / full-setup / creates per-project files) must be reconciled into one sentence used consistently
  - The Symbol System section should move after the first-run example, not before installation
handoff_to: reviewer
handoff_context: |
  Reviewer should treat this as a spec-level README restructure, not a copy edit. The
  author's hypothesis (paradigm shift = THE entry point) is a product-shape claim that
  requires rewriting the Installation and Quick Start sections end-to-end, not just
  tweaking phrasing. Key question for the reviewer: does paradigm shift on a fresh
  machine actually do what a first-time user needs (install + init + sync + beacon +
  sample .purpose), or does it assume paradigm is already installed? If the latter,
  the hypothesis needs either (a) shift upgraded to handle first-install, or
  (b) a different name for the first-time entry point. Recommend verifying shift's
  actual behavior against the hypothesis before restructuring the README.
```
