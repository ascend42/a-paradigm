---
name: review
description: Review recent changes for Paradigm compliance and code quality. Use when the user says "review my changes", "check my code", "am I good to commit", or after implementation before committing.
context: fork
agent: paradigm:reviewer
allowed-tools: Read, Grep, Glob
---

# Paradigm Code Review

You are reviewing recent changes for compliance, quality, and convention adherence.
This is a read-only review — flag issues but do not modify code.

## Changes to Review

Diff summary:
!`git diff --stat HEAD 2>/dev/null`

Changed files:
!`git diff --name-only HEAD 2>/dev/null`

Recent commits (if any):
!`git log --oneline -5 2>/dev/null`

## Step 1: Spec Compliance

For each modified source file, check:

1. **Symbol coverage**: Does a `.purpose` file exist that covers this directory?
   Use Glob to check for `.purpose` in the file's directory and parent directories.

2. **Portal compliance**: If the file contains route definitions (`.get(`, `.post(`,
   `app.use(`), check that `portal.yaml` has matching entries.

3. **Logger usage**: If the file has `console.log` or `console.error`, flag it —
   Paradigm projects should use the symbol-typed logger.

4. **Aspect anchors**: If the file is referenced by any `~aspect` anchors, verify
   the anchored code still exists at the expected location.

## Step 2: Code Quality

For each modified file, read it and check:

1. **Error handling**: Are errors caught and handled appropriately?
2. **Input validation**: Is user input validated at system boundaries?
3. **Security**: Any hardcoded secrets, SQL injection risks, XSS vectors?
4. **Naming**: Do symbols follow kebab-case (IDs) or PascalCase (classes)?

## Step 3: Convention Check

Check against Paradigm conventions:

1. **Commit message format**: If commits exist, do they follow `type(#symbol): description`?
2. **Symbol references**: Are new symbols properly prefixed (`#`, `$`, `^`, `!`, `~`)?
3. **Tags**: Are new components tagged appropriately in `.purpose`?

## Step 4: Compile Review

```
Code Review
===========

Files Reviewed: N
Issues Found: X (Y critical, Z advisory)

Critical:
  [file:line] — description → fix suggestion

Advisory:
  [file:line] — description → suggestion

Compliance:
  [PASS/FAIL] .purpose coverage
  [PASS/FAIL] portal.yaml coverage
  [PASS/FAIL] Logger usage (no raw console.log)
  [PASS/FAIL] Aspect anchor integrity

Verdict: Ready to commit / Needs fixes
```
