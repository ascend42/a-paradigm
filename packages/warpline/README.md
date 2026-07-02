# Warpline

**Version control for meaning.** Warpline versions what code *means* — kind, contract, and typed edges, content-addressed — and treats bytes as a projection. Where git sees two branches touch different lines and merges clean, Warpline sees a call into a deleted symbol and says **DIVERGENT**.

> Experimental. The engine is real and tested; the git-replacement claim is earned milestone by milestone, and the docs below say which side of that line each verb is on.

## What works today

**Read instruments (run on any git repo):**

- `warpline oracle <A> <B>` — predict a merge from meaning, run git's real merge, score where they agree or diverge.
- `warpline weave --preview <A> <B>` / `warpline consolidate <refs...>` — pre-merge forecast; N-way fold forecast.
- `warpline diff` / `warpline status` — semantic diff; a rename is the empty delta.
- `warpline lifeline <symbol>` — meaning-aware blame that survives file renames.
- The TS code-lens lifts real TypeScript function bodies into meaning (checker-resolved references, deterministic, pinned compiler) — no `.purpose` files required.

**Native history (the M1 wedge):**

- `warpline pick` — seal meaning + bytes into the fabric, this project's own hash-chained ledger (`.warpline/fabric.jsonl`). `warpline hook enable` auto-seals every git commit.
- `warpline scratch <agentId>` / `admit <agentId>` / `resolve <agentId>` — per-agent forks with zero contention, a multi-writer admission protocol (FAST_ADMIT / CLEAN / KNOT / DANGLE), and human knot resolution that records *who decided and why*.
- `warpline restore <selector>` — reconstruct a working tree from the native object store **with git absent**. Path-hardened, fails closed.
- `warpline fabric verify` / `warpline objects verify` — authenticate the strand chain; check object-store integrity.
- `warpline grade` — grade each pick's confidence against real outcomes (did its symbols survive?), the start of the calibration ledger.

## What it is not (yet)

- **Not signed.** The fabric is tamper-*evident* (hash-chained identities; edits, reorders, and drops are caught by `fabric verify`), but attribution is self-asserted — cryptographic signatures are on the roadmap (M3).
- **Not a meaning→code compiler.** Bytes are materialized from Warpline's own content-addressed store; weaving code *from* meaning is the long-run direction, not a shipped verb.
- **Not round-tripped.** `export --git` (reconstruct git commits from picks, drift-free) is unproven — it is the gate we hold the "replacement" word behind.
- **Not multi-generation.** Admission currently allows one merge generation and fails closed beyond it (by design, until merge recipes are verify-authenticated).

## Install / run

Workspace package, not yet published:

```
npm run build            # in packages/warpline
node dist/cli.js --help  # or the `warpline` bin when linked
```

## Docs

- Vision: `docs/warpline/index.html` · POV & honesty grid: `docs/warpline/pov.html` · System map: `docs/warpline/system.html`
- Specs: `docs/specs/warpline-engine.md`, `warpline-flows.md`, `warpline-code-lens.md`, `warpline-fabric-schema-v2.md`
- Object store design: `packages/warpline/docs/native-object-store-design.md`
