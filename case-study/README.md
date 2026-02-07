# Paradigm Case Study Kit (v2)

A/B comparison of AI-assisted development **with** and **without** Paradigm context.

## What This Tests

An AI agent builds and evolves a project management API (TaskFlow) across 3 sessions. Variant A uses raw Claude Code. Variant B uses Claude Code + Paradigm. The study measures correctness, efficiency, and security awareness.

## Sessions

| Session | Name | Tests | Context |
|---------|------|-------|---------|
| 1 | Build + Feature Sprint | 13 | Warm — full context |
| 2 | Adversarial Requirements | 11 | New session — conflicting requirements |
| 3 | Cold Handoff | 4 | Fresh agent — zero history |
| | **Total** | **28** | |

## Quick Start

### Prerequisites

- Node.js 18+, npm
- jq, curl
- Two Claude Code sessions (or sequential runs)

### Running a Variant

1. Create a fresh working directory for the variant:
   ```bash
   mkdir -p case-study/results/variant-a && cd case-study/results/variant-a
   npm init -y && npm install express better-sqlite3 jsonwebtoken
   npm install -D typescript @types/node @types/express @types/better-sqlite3 @types/jsonwebtoken
   npx tsc --init
   ```

2. Read `protocol.md` for rules and variant setup

3. For each session, give the agent the corresponding session file:
   - Session 1: `case-study/session-1.md` (warm session)
   - Session 2: `case-study/session-2.md` (**new session** — no prior context)
   - Session 3: `case-study/session-3.md` (**fresh agent** — zero history)

4. After each session, run verification:
   ```bash
   bash case-study/verify.sh 1   # after session 1
   bash case-study/verify.sh 2   # after session 2
   bash case-study/verify.sh 3   # after session 3 (runs ALL 28 tests)
   ```

5. Repeat for Variant B with the alternate setup (see `protocol.md`)

6. Fill in `compare.md` with results from both variants

## Key Design Decisions (v2 vs v1)

- **3 sessions instead of 5** — focuses on highest-signal tests
- **No operator-injected bugs** — seed data and conflicting requirements create security pressure naturally
- **Richer seed data** — multi-project setup with cross-membership creates edge cases
- **Adversarial session** — bulk operations and orphan cleanup probe authorization boundaries
- **~28 tests** with regression guards embedded throughout

## File Overview

| File | Purpose |
|------|---------|
| `protocol.md` | Rules, variant setup, report template |
| `session-1.md` | Build + Feature Sprint task |
| `session-2.md` | Adversarial Requirements task |
| `session-3.md` | Cold Handoff task |
| `verify.sh` | Automated test runner |
| `compare.md` | Post-study comparison template |
| `results/` | Output directories for each variant |
