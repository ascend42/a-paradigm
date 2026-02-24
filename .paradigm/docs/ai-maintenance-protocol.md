# AI Maintenance Protocol for Paradigm Files

> When and how AI agents should update .purpose, portal.yaml, and wisdom files.

## The Core Principle

**Paradigm files are contracts, not documentation.**

They describe what a feature/component/gate *is supposed to do*, not what the code *currently does*. When code changes, the contract should be updated to reflect the new reality.

---

## When to Update .purpose Files

### MUST Update (Blocking)

These changes REQUIRE .purpose updates before the task is complete:

| Change Type | Update Required | Example |
|-------------|-----------------|---------|
| **Add new feature** | Create `.purpose` in feature directory | Adding `#user-profiles` feature |
| **Add new signal** | Add to signals section | Emitting `!payment-failed` |
| **Add new gate requirement** | Add to gates section | Route now requires `^premium-user` |
| **Add new flow** | Document the flow steps | Creating `$password-reset` flow |
| **Rename symbol** | Update symbol name everywhere | `#checkout` → `#purchase` |
| **Delete feature/component** | Remove or mark `[deprecated]` | Removing `#legacy-auth` |

### SHOULD Update (Recommended)

These changes benefit from .purpose updates but aren't blocking:

| Change Type | Update Recommended | Example |
|-------------|-------------------|---------|
| Add significant new endpoint | Update routes section | New `/api/tasks/bulk-update` |
| Change component interface | Update dependencies | `#database` now requires Redis |
| Add new integration | Add to integrations | Connecting `#slack-service` `[integration]` |
| Significant refactor | Update description | Rewriting task scheduler |

### MAY Skip (Low Priority)

These changes rarely need .purpose updates:

- Bug fixes that don't change behavior
- Performance optimizations
- Internal refactors that preserve interface
- Test additions
- Documentation updates

---

## When to Update portal.yaml

### MUST Update

| Change Type | Action |
|-------------|--------|
| New protected route | Add route with gates |
| New gate type | Define gate with description |
| Gate requirement change | Update route's gate list |
| Gate removed | Remove from routes |

### Detection Signal

If you're adding middleware like `authenticate`, `requireAdmin`, `checkOwnership` to a route, portal.yaml MUST be updated.

---

## When to Update Wisdom Files

### antipatterns.yaml - Add When:
- You discover a bug caused by a pattern
- Code review reveals a mistake to avoid
- A pattern causes performance issues
- A security vulnerability is found

### preferences.yaml - Add When:
- Team agrees on a convention
- A pattern proves successful
- Tech debt is created by inconsistency

### decisions/ - Add When:
- Making an architectural choice
- Choosing between alternatives
- Documenting why NOT to do something

---

## How to Update: Step-by-Step

### Adding a New Feature

```
1. Create directory: src/features/{feature-name}/
2. Create .purpose file:
   ```yaml
   feature: #{feature-name}
   description: |
     {What this feature does}
   tags: [feature]

   components:
     #{component}: {description}

   signals:
     !{signal}: {when emitted}

   gates:
     ^{gate}: {who can access}

   dependencies:
     - #{other-feature}
   ```
3. Update portal.yaml with routes
4. Run `paradigm scan` to index
```

### Adding a New Signal

```
1. Find the .purpose file for the emitting feature
2. Add to signals section:
   ```yaml
   signals:
     !{new-signal}:
       description: Emitted when {event}
       payload: {type}
       consumers: [#{feature1}, #{feature2}]
   ```
3. Update consuming features' .purpose files with dependency
```

### Adding a New Gate

```
1. Add to portal.yaml:
   ```yaml
   gates:
     ^{new-gate}:
       description: {who this gate allows}
       requires: [^{parent-gate}]  # if inherits
       implementation: src/middleware/{file}.ts
   ```
2. Add to routes section:
   ```yaml
   routes:
     /api/{resource}:
       gates: [^authenticated, ^{new-gate}]
   ```
3. Update relevant .purpose files with gate reference
```

### Deprecating a Symbol

```
1. Add `[deprecated]` tag to the symbol:
   - #old-feature gets `tags: [deprecated]`
2. Add deprecation note:
   ```yaml
   feature: #old-feature
   status: deprecated
   tags: [deprecated]
   deprecated:
     since: "2024-01-15"
     reason: "Replaced by #new-feature"
     migration: "See docs/migrations/old-to-new.md"
   ```
3. Update all references to note deprecation
```

### Adding a Multi-Step Flow (Flow-First Development)

For features that involve multiple steps, gates, and signals, **define the flow first**:

```
1. Create/update .paradigm/flows.yaml:
   ```yaml
   version: "1.0"
   flows:
     $task-assignment:
       name: Task Assignment Flow
       description: Assign a task to a team member
       trigger: "PUT /api/tasks/:id/assign"
       steps:
         - type: gate
           symbol: ^authenticated
           description: User must be logged in
         - type: gate
           symbol: ^project-member
           description: User must be project member
         - type: action
           symbol: #assign-task
           description: Update task assignee
         - type: signal
           symbol: "!task-assigned"
           description: Notify assignee
       successSignal: "!task-assigned"
   ```

2. Validate flow before implementing:
   ```bash
   paradigm flow validate $task-assignment
   ```

3. Implement each step:
   - Gates → middleware/auth checks
   - Actions → business logic
   - Signals → events/notifications

4. Validate flow after implementing:
   ```bash
   paradigm flow validate $task-assignment --check-implementation
   ```
```

**Why Flow-First?**
- Ensures all auth gates are defined in portal.yaml
- Documents the expected sequence of operations
- Makes testing easier (test each step)
- Provides clear handoff points for multi-agent work

---

## AI Agent Checklist

Before completing any task, ask yourself:

```
□ Did I add a new feature?           → Create .purpose
□ Did I add a new route?             → Update portal.yaml
□ Did I add authorization?           → Update portal.yaml + .purpose
□ Did I emit a new event/signal?     → Update .purpose
□ Did I create a multi-step flow?    → Document as $flow
□ Did I learn something to avoid?    → Add to antipatterns.yaml
□ Did I delete or rename something?  → Update all references
```

---

## Decision Trees

### Should I Record Lore?

```
Did I modify 3+ source files?
  YES → Record lore (type: agent-session)
  NO  → Did I make an architectural decision?
          YES → Record lore (type: decision)
          NO  → Did I complete a significant milestone?
                  YES → Record lore (type: milestone)
                  NO  → Did I resolve a production incident?
                          YES → Record lore (type: incident)
                          NO  → Skip lore recording
```

### Should I Create a Flow?

```
Does the feature have 3+ ordered steps?
  YES → Does it involve authorization gates?
          YES → Definitely create a $flow
          NO  → Does it span multiple components?
                  YES → Create a $flow
                  NO  → Probably not needed
  NO  → Is there a defined sequence of gate → action → signal?
          YES → Create a $flow (even short flows benefit)
          NO  → Skip — use .purpose components instead
```

### New Feature Compliance Checklist

```
Starting a new feature:
1. □ Run paradigm_pm_preflight with task description
2. □ Run paradigm_ripple for symbols you'll modify
3. □ Run paradigm_gates_for_route for any new API endpoints
4. □ Run paradigm_habits_check({ trigger: "preflight" })

During implementation:
5. □ Create .purpose file in feature directory
6. □ Update portal.yaml for any protected routes
7. □ Define $flow in flows.yaml if feature spans 3+ steps
8. □ Save paradigm_session_checkpoint at phase transitions

After implementation:
9.  □ Run paradigm_habits_check({ trigger: "postflight" })
10. □ Run paradigm_pm_postflight with modified files and symbols
11. □ Run paradigm_reindex to rebuild static index
12. □ Record lore if 3+ files were modified
13. □ Run paradigm_flow_validate if flows were affected
```

---

## Automated Reminders

### In CLAUDE.md / .cursorrules

The IDE instructions should include:

```markdown
## After Code Changes

When you modify code, check if Paradigm files need updates:

1. **New feature/component**: Create `.purpose` file
2. **New route**: Update `portal.yaml`
3. **New signal**: Add to emitting feature's `.purpose`
4. **Pattern learned**: Add to `wisdom/antipatterns.yaml`

Run `paradigm doctor` to check for inconsistencies.
```

### Post-Task Validation

After completing a task, run:

```bash
paradigm doctor          # Check for issues
paradigm scan            # Rebuild index
paradigm beacon          # See updated symbols
```

---

## Common Mistakes to Avoid

### 1. Forgetting to Update After Rename

**Bad**: Rename `#checkout` to `#purchase` in code but not in .purpose files
**Fix**: Use find-replace across all .purpose and portal.yaml files

### 2. Adding Gates in Code but Not portal.yaml

**Bad**: Add `requireAdmin` middleware without updating portal.yaml
**Fix**: Always update portal.yaml when adding authorization

### 3. Orphaned Signals

**Bad**: Emit `!order-shipped` but don't document who consumes it
**Fix**: Add consumers list to signal definition

### 4. Stale Flow Documentation

**Bad**: Change flow steps in code but leave old $flow documentation
**Fix**: Update flow steps when implementation changes

---

## Integration with Development Workflow

### Pre-Commit Hook (Optional)

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Check if .purpose files are updated when features change
changed_features=$(git diff --cached --name-only | grep "src/features/")
if [ -n "$changed_features" ]; then
  for feature_file in $changed_features; do
    feature_dir=$(dirname "$feature_file")
    purpose_file="$feature_dir/.purpose"
    if [ -f "$purpose_file" ]; then
      if ! git diff --cached --name-only | grep -q "$purpose_file"; then
        echo "Warning: Changed $feature_dir but .purpose not updated"
        echo "Consider updating: $purpose_file"
      fi
    fi
  done
fi
```

### CI/CD Check

```yaml
# .github/workflows/paradigm.yml
- name: Validate Paradigm Files
  run: |
    paradigm doctor --strict
    paradigm scan --verify
```

---

## Summary

| File Type | Update Frequency | Primary Trigger |
|-----------|-----------------|-----------------|
| `.purpose` | Per feature change | Adding/modifying features, signals, flows |
| `portal.yaml` | Per auth change | Adding routes, gates, permissions |
| `antipatterns.yaml` | Per lesson learned | Bugs, code review findings |
| `preferences.yaml` | Per team decision | Conventions, patterns |
| `decisions/*.yaml` | Per architecture choice | Major technical decisions |

**Remember**: Paradigm files are the source of truth for AI agents. Keeping them updated ensures every new session starts with accurate context.
