# Arky — kernel delta after Fable + ruflo (2026-10-15)

R = scratchpad/untrusted/ruflo (read-only).

## 1. No 7th primitive
- Supervisor election unnecessary: ruflo elects one (repo-supervisor.ts:159-187) only because it runs a daemon per worktree; Heddle runs one daemon per user (single-instance socket lock); the scheduler dedups timers by key.
- Budget fuse = a "metered capability" class inside the approval broker, checked by the supervisor before every spawn and turn; state in the kernel log.
  - `broker.reserve({principal, hsid, scope:[user, repo?, loop?, session], kind:"session.spawn"|"turn", model})` → `{permitId:<ulid>}` or `refusal:v1`.
  - Hierarchical limits user → repo → loop → session: concurrent sessions, launches/hour and /day, tokens per session/loop/day, notional USD. On subscriptions count tokens + launches first.
  - Usage from the adapter's stream-json `result` event (usage, total_cost_usd), never parsed from model text. Breaker opens on a typed quota error from the adapter.
  - Events `budget.reserve|deny|usage|pause|resume|ladder`; warning rungs 50/75/90/100% announced once.
  - Fail closed on any state error; resume/override is a human-only broker verb; no env-var bypass. Loop budgets are sub-scopes.
- Ruflo defects not to copy (global-ai-budget.ts): corrupt ledger starts fresh (fails open, 419-422); `RUFLO_AI_BUDGET_DISABLE` bypass any agent can set (187); receipts truncated to 200 lines (455-458); mtime lock-takeover race (390); Math.random permit ids (217).

## 2. Lift vs re-derive
MIT permits copying with notice; recommend re-deriving (small useful code; supply-chain history). Any verbatim snippet → MIT notice in a THIRD_PARTY file.
- Lift as design: #2661 invariants (check before process creation, user-global, owner-only modes, refuse symlinks, receipt per decision); mod trust (judge the host's scan not the module's claims; allowlist by provenance not name; project scope can't set policy; unjudgeable module refused under enforce — maps to manifest `requires.capabilities` + loader); honesty tests in CI; hash binding (`guidanceHash` per run → our contract hash).
- Don't lift: RunLedger (in-memory, drops old events); its "objective" evaluators grade caller-supplied `testResults` (grade claims, not behaviour); regex compiler parser; repo-supervisor (moot); workspace-lease (session registry covers it).

## 3. Shuttle
Ruflo's panes poll status files its README calls "reported by the mod, unauthenticated: any process can write those files" (ruflo-console/README.md:82), and multi-worktree spend control still needed shared cross-process state. An armada needs a kernel regardless, so C is A's display layer. What's distinctive about C is "no long-running process".
Revised Board 1:
1. **Heddle + Shuttle (recommended)** — A's kernel, daemon socket-activated on first use (not always-on); the Shuttle Mod is its first display, reading authenticated events from the socket; CC plugin a thin client.
2. **Daemonless kernel** — same contracts as a library; `pd spawn` supervises for its own lifetime; the Mod tails the log. Fallback if A's daemon falsifier trips; promotable without API change.
3. **Bolt** — kept as the backend-portability falsifier.
C standalone dropped.

## 4. Spec-as-contract
Ruflo compiles conduct (CLAUDE.md → rule shards); Fable compiles deliverables (spec → nodes). Ruflo's flaw: evaluators trust agent reports. Rule: the kernel runs each oracle and logs the result under its own principal; an agent can claim a node but never certify it.
Minimal `contract.v1`, deterministic compile (no LLM):
`{contractId, specRef:"spec:<path>@<blobsha>", hash, nodes:[{id, kind:symbol|gate|flow|test, ref:"sym:#x", oracle:{type:exists|test|gate-check|ripple-clean, arg}, deps[]}]}`
- A node with no oracle is a compile refusal. Claims are CAS events guarded by seq (`contract.claim`). Progress = exists AND passes.
- 8.0 ships two oracles: test runs + Warpline admission. Reviewer-agent oracle → 8.1 (non-deterministic; needs a non-builder principal from identity).

## 5. Tensions with Fable
1. Ledger: HOLD — fabric is a code-meaning store; session events are orders of magnitude more frequent. Concede: every PICK event carries `causes[]` to its strand.
2. F4 injection: HOLD — injecting descriptors makes F4 measure the harness. Concede: warpline skill installed and discoverable, not pushed into turn one.
3. Session id: HOLD `hsid`. Concede `cc:<uuid>` as a resolvable alias.
4. Conductor runner: CONCEDE — delete the Swift runner; Conductor becomes a socket client of the TS runner.
