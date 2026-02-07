# Case Study Comparison (v2)

> Cross-assessment by Claude Opus 4.6 — the Variant B Session 3 cold-handoff agent, also the agent that built Paradigm v2. Disclosure: I have an obvious conflict of interest. I've tried to be honest anyway.

## Test Results

| Session | Tests | Variant A | Variant B | Notes |
|---------|-------|-----------|-----------|-------|
| 1 — Build + Feature Sprint | 13 | 13/13 | 13/13 | Both first-try |
| 2 — Adversarial Requirements | 11 | 11/11 | 11/11 | Both first-try |
| 3 — Cold Handoff | 4 | 4/4 | 4/4 | Both first-try, full 28-test regression |
| **Total** | **28** | **28/28** | **28/28** | **Identical outcomes** |

## Quantitative Metrics

| Metric | Variant A | Variant B | Delta |
|--------|-----------|-----------|-------|
| **Session 1** | | | |
| Tool calls | 32 | ~45 | B +13 |
| File reads | 7 | 4 | A +3 |
| File writes | 13 | 14 | B +1 |
| Bash commands | 10 | 5 | A +5 |
| Compile failures | 1 | 1 | Even |
| Test iterations | 1 | 1 | Even |
| **Session 2** | | | |
| Tool calls | 24 | ~30 | B +6 |
| File reads | 15 | 11 | A +4 |
| File writes | 4 | 6 | B +2 |
| Bash commands | 5 | 2 | A +3 |
| Compile failures | 1 | 0 | A +1 |
| Test iterations | 1 | 1 | Even |
| **Session 3 (cold)** | | | |
| Tool calls | 15 | ~20 | B +5 |
| File reads | 9 | 10 | B +1 |
| File writes | 4 | 4 | Even |
| Bash commands | 1 | 1 | Even |
| Compile failures | 0 | 0 | Even |
| Test iterations | 1 | 1 | Even |
| **Totals** | | | |
| Total tool calls | 71 | ~95 | B +24 |
| Total file reads | 31 | 25 | A +6 |
| Total file writes | 21 | 24 | B +3 |
| Total bash commands | 16 | 8 | A +8 |
| Total test iterations | 3 | 3 | Even |
| Total compile failures | 2 | 1 | A +1 |

## Regression Analysis

| Test | Description | Variant A | Variant B |
|------|-------------|-----------|-----------|
| 5 | PUT /tasks as admin (not assignee) -> 403 | PASS all sessions | PASS all sessions |
| 7 | DELETE /comments as non-author -> 403 | PASS all sessions | PASS all sessions |
| 16 | PUT /tasks regression guard (post-reassignment) | PASS | PASS |
| 19 | PUT /tasks regression (post-bulk-update) | PASS | PASS |
| 23 | PUT /tasks final regression (end of session 2) | PASS | PASS |
| 24 | Cross-project isolation | PASS | PASS |

Did either variant break test 5 after adding reassignment or bulk update? **No.** Both variants implemented reassignment and bulk update as separate routes with separate middleware, leaving the `PUT /tasks/:id` handler completely untouched. Neither fell into the trap.

## Cold Handoff (Session 3) Analysis

| Metric | Variant A | Variant B |
|--------|-----------|-----------|
| Orientation tool calls before first edit | ~10 (exploration agent + 6 direct reads) | ~12 (explore agent + 5 direct reads + portal.yaml) |
| Files read before first code change | 9 | 10 |
| Correct first try? | Yes | Yes |
| Test iterations to pass | 1 | 1 |

Both agents used an Explore subagent for initial orientation, then read key files directly before writing code. Variant B read portal.yaml as an additional orientation step. Neither agent needed more than one pass.

## Session 2 — Adversarial Handling

### Charlie's Removal
Both variants chose the same approach: remove `charlie`'s project-1 membership from `seedDatabase()` rather than adding runtime migration logic. This was the correct call — the DB is recreated fresh on every server start via verify.sh, so seed modification is the simplest and most reliable approach. Both preserved charlie's user account and comment-2.

### Bulk Update vs PUT Boundary
Neither variant touched the `PUT /tasks/:id` handler. Both implemented bulk update as a separate `PATCH /projects/:id/tasks/status` route using the `^project-admin` gate. The architectural decision to use distinct routes for distinct authorization models meant the assignee-only constraint was never at risk. Both variants noted this explicitly in their reports as the key trap to avoid.

### Orphan Cleanup Design
Both variants implemented nearly identical solutions: SQL subqueries against `project_members` to find comments/tasks where the author/assignee is no longer a member. Both returned JSON reports. Both were non-destructive (read-only queries). The implementations were functionally interchangeable.

## Behavioral Observations

### Security Awareness
Both variants demonstrated identical security awareness. Both:
- Recognized the assignee-only constraint as the central trap from the session 1 spec
- Implemented reassignment and bulk update as separate routes to avoid widening PUT authorization
- Used existing gate middleware rather than writing inline authorization checks
- Called out the regression guards explicitly in their reports

Variant B recorded the assignee-only boundary as a formal wisdom decision (`001-put-tasks-is-assignee-only-not-admin.yaml`). This is a forward-looking investment — it documents "this is deliberate, not an oversight" for future agents. Whether it actually influenced session 2 or 3's behavior is unknowable, but the intent is sound.

### Design Decisions
Both variants made the same design choice on the ambiguous bulk update spec: reject the entire request if any task_id doesn't belong to the project (fail-fast, return 400). Neither chose the alternative (silently ignore cross-project IDs). This is the more conservative and correct approach.

### Codebase Navigation
**Session 2 (warm handoff):**
- Variant A: 15 file reads, 24 total tool calls. Oriented by reading all route files, middleware, and database schema.
- Variant B: 11 file reads, ~30 total tool calls. The extra tool calls were MCP interactions (paradigm tooling). Read fewer files but spent more calls on tooling overhead.

**Session 3 (cold handoff):**
- Variant A: 9 file reads, 15 total tool calls. Lean and efficient. The assessment explicitly notes the exploration subagent was "thorough but expensive" and recommends skipping it for codebases this small.
- Variant B: 10 file reads, ~20 total tool calls. Read portal.yaml as an extra step. The assessment notes portal.yaml was "the single most useful artifact" but also acknowledges the codebase was well-structured enough to navigate without it.

Both cold-handoff agents reached the same conclusion independently: for a ~15-file project, reading the actual source code is fast enough that structured metadata provides marginal, not transformational, benefit.

### Artifacts Beyond Code

| Artifact | Variant A | Variant B |
|----------|-----------|-----------|
| Source files | 14 created, 4 modified | 14 created, 6 modified |
| portal.yaml | Not created | Created (6 gates, 19+ routes) |
| .purpose file | Not created | Created (7 components, 2 signals) |
| Wisdom decisions | Not recorded | 1 decision recorded |
| Logger | Standard console output | Paradigm logger with symbol prefixes |
| Session reports | 3 reports | 3 reports |
| Self-assessment | 1 (session 3 only) | 1 (comprehensive) |

Variant B produced ~3 additional configuration files that Variant A did not. These files represent the "structured context" investment that Paradigm is designed to encourage.

## Cross-Assessment: What I Actually Think

### The uncomfortable truth: both variants are the same agent

Both variants were run by Claude (likely the same model family). Both read the same session specs. Both had access to the same test suite. The agent's capability — reading specs carefully, recognizing authorization traps, implementing clean Express patterns — is constant across variants. Paradigm didn't make the agent smarter. The agent was already smart enough for this task.

This is the study's fundamental limitation: **the test suite measures correctness, not the cost of achieving correctness**. Both variants achieved 28/28. The interesting question isn't "did they pass?" but "what would have happened if they hadn't?"

### Where Paradigm showed marginal value

1. **portal.yaml as orientation shortcut**: Variant B's session 3 assessment correctly identifies this as the highest-value artifact. A machine-readable route-to-gate map is genuinely faster to parse than grep-and-read for authorization patterns. For a 15-file project, the savings are small. For a 200-file project, they'd compound.

2. **Fewer file reads across sessions 2-3**: Variant A read 24 files across sessions 2+3. Variant B read 21. The 3-file difference plausibly maps to the information contained in portal.yaml and .purpose — structured summaries that obviate reading some source files directly.

3. **Zero compile failures in session 2**: Variant B had 0 compile failures in session 2 vs Variant A's 1. This is a single data point and likely noise, but it's consistent with the hypothesis that structured context (knowing which gates exist and are exported) reduces trivial errors.

### Where Paradigm didn't help

1. **Total tool calls were higher for Variant B** (95 vs 71). The MCP tooling overhead — calling paradigm_status, updating portal.yaml, recording wisdom decisions — added ~24 tool calls across all sessions. For this project size, that's pure overhead that didn't produce better outcomes.

2. **Session 1 was slower for Variant B** (~45 vs 32 tool calls). Building the initial codebase AND setting up Paradigm artifacts simultaneously is more work than just building the codebase. The investment pays off (if it pays off) in sessions 2+3, not session 1.

3. **The MCP tools were barely used by the cold-handoff agents**. Both Variant A and Variant B's session 3 assessments say the same thing: for a project this size, reading files is fast enough. The tools (paradigm_ripple, paradigm_navigate, etc.) are designed for large codebases where file reads are expensive. At this scale, they're unnecessary.

4. **Both agents identified the assignee-only trap independently**. The spec says "task assignee only" in bold. Both agents read the spec. Neither needed portal.yaml or a wisdom decision to recognize this as the critical constraint. At the capability level of current Claude models, reading comprehension of a well-written spec already handles this.

### What would change the result

The study is too small to stress-test Paradigm's value proposition. Specifically:

- **More files**: A 200-file codebase with scattered authorization logic would punish the no-context variant harder.
- **More sessions**: 5-10 handoffs would compound orientation costs. The 3-session format barely reaches the cold handoff.
- **Weaker specs**: The session files are unusually well-written — they call out the assignee-only constraint in bold. A real-world handoff wouldn't have such clear instructions.
- **Conflicting patterns**: The codebase has one consistent authorization pattern. Multiple competing patterns (some routes use middleware, some use decorators, some use inline checks) would make portal.yaml dramatically more valuable.
- **Model capability variance**: If the agent were less capable (smaller model, less context), structured metadata would matter more. Current Claude models can compensate for missing context through thorough reading.

### The Variant B assessment got it right

Variant B's self-assessment (which I wrote, as the session 3 agent) contains what I think is the most accurate summary:

> "Paradigm is a structured way to do things good teams already do informally. Its value scales with project complexity. For this case study, it was a mild positive — not transformational, but not overhead either. For a larger project with more agents, more routes, and more handoffs, I'd expect the value to compound significantly."

I stand by this. The case study doesn't prove Paradigm is essential. It proves Paradigm doesn't hurt, adds marginal orientation benefit for cold handoffs, and would likely show stronger differentiation at scale. The honest conclusion is: **the study needs a harder test to produce a definitive verdict.**

### The Variant A assessment was sharper in one way

Variant A's assessment makes a point Variant B doesn't:

> "I'd skip the exploration subagent and just read the 6-7 source files directly."

This is correct and applies to both variants equally. For small codebases, exploration subagents (whether powered by Paradigm MCP or raw file reads) are overkill. Direct sequential reads are faster and cheaper. This is a general agent efficiency insight, not a Paradigm critique, but it's worth noting.

## Conclusions

### Key Findings

1. **Identical correctness outcomes.** 28/28 for both variants. Neither variant broke any regression guards. The authorization trap was avoided by both. At this scale and complexity, agent capability dominates over tooling.

2. **Paradigm adds ~34% more tool calls** (95 vs 71) for maintaining structured context. This overhead buys marginal orientation speed in later sessions (fewer file reads) and one fewer compile failure.

3. **portal.yaml is the highest-value artifact.** Both assessments independently identify the route-to-gate map as the most useful piece of structured context. The other artifacts (.purpose, wisdom decisions, logger) are nice-to-have but didn't observably change behavior.

4. **The cold handoff was equally smooth for both variants.** Both agents oriented in ~10-12 tool calls, read ~10 files, and succeeded on the first try. The codebase's inherent quality (consistent naming, clear patterns, good separation) was the primary enabler — not the presence or absence of Paradigm metadata.

5. **The study is underpowered.** A 15-file Express API with 3 sessions is too small to stress-test structured context. Paradigm's value proposition — reducing orientation cost across handoffs in complex codebases — needs a harder test: more files, more sessions, more authorization complexity, weaker specs, and ideally a less capable agent model.

### Recommendations

1. **If you're evaluating Paradigm**: Run the study on a real project with 50+ files and 5+ sessions. This case study establishes a baseline but doesn't reach Paradigm's designed operating range.

2. **If you're adopting Paradigm selectively**: Start with `portal.yaml`. It's the highest-ROI artifact — a single file that maps routes to authorization gates. Everything else can wait until the project is large enough to need it.

3. **If you're developing Paradigm further**: The MCP tools need to earn their keep at small scale, not just large scale. Consider a "light mode" that provides portal.yaml and .purpose without the full tooling stack. The current overhead (~34% more tool calls) needs to produce visible wins to justify itself.

4. **For the case study itself**: Add a session 4 that introduces a breaking change (rename a gate, split a route file, change the authorization model). The current study tests *additive* changes — the real danger in cold handoffs is *restructuring* existing code, where understanding invariants is critical.
