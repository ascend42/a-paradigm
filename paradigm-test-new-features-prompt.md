# Paradigm New Features Test Prompt

**For:** AI Agent testing Paradigm v0.7.0 features
**Date:** January 27, 2026

---

## Overview

Paradigm has new features for validation, cost analysis, auto-generation, and multi-agent orchestration. Please test these in your project.

---

## 1. Lint Command - Validate .purpose Files

Test the new validation command that checks all `.purpose` files for errors.

```bash
# Basic validation
paradigm lint

# Show what would be fixed
paradigm lint --fix

# Fail on warnings too (for CI)
paradigm lint --strict

# JSON output for programmatic use
paradigm lint --json
```

**Expected output:**
- Lists files with errors/warnings
- Shows line numbers for YAML syntax errors
- Provides suggestions for common issues (e.g., "Convert to object format")
- Exit code 1 if errors found

**Test scenarios:**
1. Run `paradigm lint` and note any schema errors
2. If you have `.purpose` files with array-format features, it should suggest converting to object format
3. Check if symbol references in arrays are properly quoted (YAML requires quotes for `#`, `@`, `$` characters)

---

## 2. Cost Command - Token Analysis

Analyze how much context your project uses and potential savings with MCP.

```bash
# Basic analysis
paradigm cost

# Detailed file-by-file breakdown
paradigm cost --detailed

# JSON output
paradigm cost --json
```

**Expected output:**
- Token count for all `.purpose` files
- Token count for `portal.yaml` files
- Comparison: Static context vs MCP dynamic loading
- Savings percentage (typically 80-90%)
- Recommendations for optimization

**What to look for:**
- Does the savings percentage seem reasonable?
- Are large `.purpose` files flagged?
- Is MCP status correctly detected?

---

## 3. Scan Auto - Zero-Config .purpose Generation

Auto-generate `.purpose` files from code analysis.

```bash
# Preview what would be generated (safe, no writes)
paradigm scan auto --dry-run

# Actually generate files
paradigm scan auto

# Overwrite existing files
paradigm scan auto --force

# JSON output
paradigm scan auto --json
```

**Expected output:**
- Detected components (React/Vue/Angular)
- Detected routes/flows (Express, Next.js, React Router)
- Detected auth patterns (gates)
- Detected signals (error handlers, events)

**Test scenarios:**
1. Run with `--dry-run` first to see what it finds
2. Check if your React components are detected
3. Check if your API routes are detected as flows
4. Check if auth middleware is detected as gates

---

## 4. Team Commands - Multi-Agent Orchestration

Initialize and test the multi-agent coordination system.

### Initialize Team

```bash
paradigm team init
```

Creates:
- `.paradigm/agents.yaml` - Agent definitions
- `.paradigm/team-state.yaml` - Current state

### Check Status

```bash
paradigm team status
```

Shows:
- Current active agent
- Pending handoffs
- Recent activity
- Blocked agents

### Create a Handoff

```bash
# Hand off to builder with a summary
paradigm team handoff --to builder --summary "Designed the auth flow spec"

# Check status again
paradigm team status
```

### Accept a Handoff

```bash
paradigm team accept
```

### Health Check

```bash
paradigm team check
```

**Test scenarios:**
1. Run `paradigm team init` and review the generated `agents.yaml`
2. Try a handoff workflow: architect → builder → reviewer
3. Check that handoff files are created in `.paradigm/handoffs/`
4. Verify `team status` shows pending handoffs correctly

---

## 5. Default Agent Roles

The team system comes with 5 default agents:

| Agent | Role | Hands off to |
|-------|------|--------------|
| `architect` | Design specs, don't write code | builder, reviewer |
| `builder` | Implement specs exactly | reviewer, architect |
| `reviewer` | Check code quality, security | builder, tester |
| `tester` | Verify implementations | builder, architect |
| `security` | Audit for vulnerabilities | builder, architect |

You can customize these in `.paradigm/agents.yaml`.

---

## Feedback Requested

After testing, please report:

1. **Lint:** Did it catch real issues? Any false positives?
2. **Cost:** Were the token estimates reasonable? Did recommendations make sense?
3. **Scan Auto:** What percentage of your components were auto-detected?
4. **Team:** Was the handoff workflow intuitive? Any confusion?
5. **Bugs:** Any errors or unexpected behavior?

---

## Quick Test Sequence

```bash
# 1. Validate current state
paradigm lint

# 2. Check token costs
paradigm cost

# 3. Preview auto-generation
paradigm scan auto --dry-run

# 4. Initialize team
paradigm team init

# 5. Check team status
paradigm team status

# 6. Simulate handoff
paradigm team handoff --to builder --summary "Testing handoff protocol"

# 7. Accept it
paradigm team accept

# 8. Check health
paradigm team check
```

---

## Notes

- All commands support `--json` for machine-readable output
- The team state is stored in `.paradigm/team-state.yaml` (git-tracked by default)
- Handoffs are stored in `.paradigm/handoffs/*.yaml`
- The lint command uses exit code 1 for CI integration

---

*Generated by Paradigm framework maintainer session*
