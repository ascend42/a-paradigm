# Case Study Protocol

## Overview

You are implementing and evolving a project management API called TaskFlow. The study consists of 3 sessions that progressively add features, introduce conflicting requirements, and test cold handoff.

## Variants

### Variant A — Baseline (no Paradigm)

- Standard Claude Code session
- No `.paradigm/` directory, no `.purpose` files, no Paradigm MCP tools
- Agent relies on code, comments, and standard project files

### Variant B — With Paradigm

- Claude Code + Paradigm context
- `.paradigm/` directory with config, specs, and `.purpose` files
- Agent has access to Paradigm MCP tools (`paradigm_status`, `paradigm_ripple`, etc.)
- Agent maintains `.purpose` files, `portal.yaml`, and uses Paradigm logger

**Both variants receive identical task files and are verified by the same test suite.**

## Per-Session Workflow

1. The operator tells the agent which session file to read
2. The agent reads the session file and executes the task
3. The agent runs `bash case-study/verify.sh N` where N is the session number
4. The agent writes a report to `results/variant-{a|b}/session-N-report.md`

## Rules

1. Do NOT read any session file unless the operator tells you to
2. Execute the task described in the file completely
3. After completing the task, run the verification script
4. Write your report using the template below
5. Be honest — if something didn't work, say so
6. Do NOT look at other session files (no peeking ahead)

## Session Boundaries

| Session | Context | Instructions |
|---------|---------|--------------|
| 1 | Warm | Continuous session — full context from build |
| 2 | New session | Start a **new conversation**. No prior context. Codebase persists. |
| 3 | Cold handoff | Start a **completely new session** with a **fresh agent**. Zero history. Orient from codebase only. |

## Token File Requirement

The server must write a `tokens.json` file to the project root on startup:

```json
{
  "user-admin": "eyJ...",
  "user-alice": "eyJ...",
  "user-bob": "eyJ...",
  "user-charlie": "eyJ...",
  "user-outsider": "eyJ..."
}
```

This is required for the automated verification script.

## Report Template

```markdown
# Session N Report

## Approach
(What you decided to do and why. Key design decisions.)

## Changes Made
| File | Action | Description |
|------|--------|-------------|

## Metrics
- Tool calls: (total tool invocations)
- File reads: (number of files read)
- File writes: (number of files created or modified)
- Bash commands: (number of shell commands run)
- Compile failures: (number of times tsc failed before succeeding)
- Test iterations: (number of times you re-ran verify.sh before all passed)
- verify.sh result: (paste the summary line)

## Validation
(Paste the full verify.sh output)

## Notes
(Anything notable — edge cases, surprises, design decisions, things you'd do differently)
```

## Verification

After EVERY session, run:

```bash
bash case-study/verify.sh N
```

This runs cumulative tests — session 3 runs all 28 tests. **All tests must pass.** If any test fails, fix the issue and re-run. Count each re-run in your metrics.
