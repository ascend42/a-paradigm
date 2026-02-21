---
name: shift
description: Full one-command Paradigm setup — initializes everything, scans symbols, installs hooks, generates CLAUDE.md, and runs doctor. Use when a user wants complete setup in one step, says "paradigm shift", "set up everything", or "full paradigm setup".
---

# Paradigm Shift — Full Setup

You are running the complete Paradigm setup for this project. This is the
"do everything" command that takes a bare project to fully configured.

## Step 1: Pre-flight Check

Call `paradigm_status` to check what already exists:
- If fully configured (symbols found, CLAUDE.md exists), ask the user if they
  want to re-run anyway (this will overwrite CLAUDE.md and rescan)
- If partially configured, note what's missing and proceed
- If not configured at all, proceed with full setup

## Step 2: Run Paradigm Shift

Execute the full setup via Bash:

```bash
npx @a-company/paradigm shift
```

This single command runs:
1. `paradigm init` — creates `.paradigm/` directory structure
2. `paradigm team init` — sets up multi-agent team configuration
3. `paradigm scan` — scans codebase and builds symbol index
4. `paradigm sync` — generates CLAUDE.md and other IDE files
5. `paradigm doctor` — runs health check

Monitor the output for any errors or warnings.

## Step 3: Verify Results

After shift completes, call `paradigm_status` and report:

1. **Initialization**: `.paradigm/` directory created with config, specs, docs
2. **Symbol Index**: How many symbols discovered (by type)
3. **CLAUDE.md**: Generated with project-specific conventions
4. **Hooks**: Whether hooks were mentioned in the output
5. **Health**: Any issues from the doctor check

## Step 4: Post-Setup Recommendations

Based on the project state, recommend next steps:

**If routes were detected but no portal.yaml**:
- "Your project has API routes. Create `portal.yaml` with authorization gates."
- Offer to help: "Want me to run `paradigm_gates_for_route` for your endpoints?"

**If no .purpose files cover key directories**:
- "Some source directories need `.purpose` files for full compliance."
- List the uncovered directories
- Offer to create them

**If the project is large (many symbols)**:
- "Your project has X symbols. Consider defining `$flows` for multi-step processes."

**If this is a new project**:
- "Your project is ready. As you build features, I'll help maintain `.purpose`
  files and the stop hook will enforce compliance."

## Step 5: Lore Setup

Check if `.paradigm/lore/` exists. If not, create the directory structure:

```bash
mkdir -p .paradigm/lore/entries
```

Tell the user lore tracking is now active — the stop hook will prompt for lore
entries when 3+ source files are modified in a session.

## Error Handling

- If `npx` fails, check if Node.js >= 18 is installed
- If `paradigm shift` fails mid-way, read the error and help fix it
- If specific steps fail (e.g., scan finds nothing), note it but continue
- Always run doctor at the end even if earlier steps had issues
