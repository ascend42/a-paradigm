# Paradigm Troubleshooting

Common issues and their solutions.

---

## IDE Instructions Not Working

### Symptoms
- AI agent doesn't recognize Paradigm symbols
- Agent uses raw `console.log` instead of Paradigm logger
- Agent doesn't follow conventions

### Solutions

1. **Regenerate IDE files:**
   ```bash
   paradigm sync
   ```

2. **Check if file exists:**
   - Cursor: `.cursorrules`
   - Copilot: `.github/copilot-instructions.md`
   - Windsurf: `.windsurfrules`

3. **Run doctor to check sync status:**
   ```bash
   paradigm doctor
   ```

4. **Force regenerate:**
   ```bash
   paradigm sync --force
   ```

---

## Probe Not Finding Elements

### Symptoms
- `paradigm probe` returns empty results
- Components/features not showing up
- "Uncovered elements" for everything

### Solutions

1. **Regenerate probe index:**
   ```bash
   paradigm index
   ```

2. **Check if .purpose files exist:**
   ```bash
   find . -name "*.purpose" -o -name ".purpose"
   ```

3. **Check probe index location:**
   - New setup: `.paradigm/probe-index.json`
   - Legacy setup: `.paradigm-probe-index.json`

4. **Verify .purpose file format:**
   ```yaml
   # Record format (recommended)
   features:
     my-feature:
       description: What it does
       gates: [^authenticated]      # Optional
       flows: [$checkout-flow]      # Optional
       signals: ["!success", "!failed"] # Optional
   
   # Array format (also valid)
   features:
     - id: my-feature
       description: What it does
       gates: [^authenticated]
   
   components:
     MyComponent:
       description: What it is
   
   # Optional: explicit symbols
   gates:
     my-gate:
       description: Authorization check
   
   signals:
     my-signal:
       description: Event fired
       category: auth
   
   states:
     user.preference:
       description: User preference state
   ```

---

## Logger Not Filtering

### Symptoms
- All logs showing regardless of filter
- `PARADIGM_SYMBOLS` not working
- `LOG_LEVEL` ignored

### Solutions

1. **Check environment variable format:**
   ```bash
   # Correct
   LOG_LEVEL=debug
   PARADIGM_SYMBOLS=!,@
   
   # Wrong (spaces)
   PARADIGM_SYMBOLS=!, @
   ```

2. **Verify variable is exported:**
   ```bash
   export LOG_LEVEL=debug
   export PARADIGM_SYMBOLS='!,@'
   ```

3. **Browser: Check localStorage:**
   ```javascript
   localStorage.getItem('LOG_LEVEL')
   localStorage.getItem('PARADIGM_SYMBOLS')
   ```

4. **Browser: Check URL params:**
   ```
   ?logLevel=debug&symbols=!,@
   ```

5. **Clear and reset:**
   ```javascript
   // Browser
   localStorage.removeItem('LOG_LEVEL')
   localStorage.removeItem('PARADIGM_SYMBOLS')
   location.reload()
   ```

---

## Legacy .paradigm File vs Directory

### Symptoms
- Error: "ENOTDIR" when running commands
- Commands looking for wrong location
- Old setup not compatible

### Solutions

1. **Run upgrade to migrate:**
   ```bash
   paradigm upgrade --all
   ```

2. **Manual migration:**
   ```bash
   # Backup old file
   cp .paradigm .paradigm.backup
   
   # Remove old file
   rm .paradigm
   
   # Reinitialize
   paradigm init
   
   # Copy old config values manually
   ```

3. **Check current structure:**
   ```bash
   ls -la .paradigm*
   # File = legacy
   # Directory = current
   ```

---

## Config YAML Errors

### Symptoms
- "Failed to parse .paradigm/config.yaml"
- YAML syntax errors
- Commands failing to read config

### Solutions

1. **Validate YAML syntax:**
   ```bash
   # Use a YAML linter
   yamllint .paradigm/config.yaml
   ```

2. **Common YAML issues:**
   ```yaml
   # Wrong - missing quotes on special chars
   description: Use @ for features

   # Correct
   description: "Use @ for features"

   # Wrong - ! is a YAML tag indicator, breaks parsing in arrays
   signals: [!success, !failed]
   steps:
     - !payment-completed

   # Correct - always quote ! signals in YAML
   signals: ["!success", "!failed"]
   steps:
     - "!payment-completed"

   # Wrong - tabs instead of spaces
   	key: value

   # Correct - 2 spaces
     key: value
   ```

3. **Reset to default config:**
   ```bash
   paradigm init --force
   ```

---

## Missing Specs or Docs

### Symptoms
- `.paradigm/specs/` is empty
- Missing `logger.md`, `probe.md`, etc.
- IDE instructions incomplete

### Solutions

1. **Run upgrade to add missing files:**
   ```bash
   paradigm upgrade --all
   ```

2. **Reinitialize (keeps config):**
   ```bash
   paradigm init --force
   ```

3. **Manually check what's missing:**
   ```bash
   ls -la .paradigm/specs/
   ls -la .paradigm/docs/
   ls -la .paradigm/prompts/
   ```

---

## Correlation IDs Not Working (Node.js)

### Symptoms
- Logs don't include correlationId
- Requests not traceable
- `getCorrelationId()` returns undefined

### Solutions

1. **Ensure middleware is applied:**
   ```typescript
   // Must be early in middleware chain
   app.use(correlationMiddleware())
   ```

2. **Use withCorrelation for async:**
   ```typescript
   await withCorrelation(id, async () => {
     // All async code here will have correlation
   })
   ```

3. **Check AsyncLocalStorage support:**
   - Requires Node.js 12.17+ or 14+
   - Must be within async context

---

## Watch Command Not Detecting Changes

### Symptoms
- `paradigm watch` not reacting to file saves
- Manual sync still required
- Changes not reflected

### Solutions

1. **Check file patterns:**
   - Config: `.paradigm/config.yaml`
   - Specs: `.paradigm/specs/*.md`
   - Purpose: `**/.purpose`
   - Portal: `**/portal.yaml`

2. **Restart watch:**
   ```bash
   # Ctrl+C to stop, then:
   paradigm watch
   ```

3. **Check for file system issues:**
   - Some editors save to temp files first
   - Network drives may not trigger watchers

---

## Performance Issues

### Symptoms
- Logger slowing down application
- Too many logs in production
- Large log files

### Solutions

1. **Set appropriate log level:**
   ```bash
   # Development
   LOG_LEVEL=debug
   
   # Production
   LOG_LEVEL=info  # or warn
   ```

2. **Filter symbols in production:**
   ```bash
   # Only errors and signals
   PARADIGM_SYMBOLS=!
   LOG_LEVEL=warn
   ```

3. **Ensure logger short-circuits:**
   - Logger should check level before formatting
   - Debug logs should not execute in production

---

## Migrating from Horizon

### Symptoms
- Have old Horizon project
- Want to use new Paradigm naming

### Solutions

1. **Run automatic migration:**
   ```bash
   paradigm upgrade --from-horizon
   ```

2. **Preview changes first:**
   ```bash
   paradigm upgrade --from-horizon --dry-run
   ```

This will:
- Rename `.paradigm/` to `.paradigm/`
- Rename `gate.yaml` to `portal.yaml`
- Rename `.dream` files to `.premise`
- Update IDE instruction files

---

## Context Bloat / Token Costs

### Symptoms
- AI chats feel slow or sluggish
- Context limit reached quickly
- Same information repeated every chat
- `.cursorrules` file is hundreds of lines

### Problem

The `.cursorrules` file is loaded on **every single chat**. A 600-line file costs ~4,000+ tokens before you even type — that's 2% of a 200K context window wasted on repeated instructions.

### Solutions

1. **Keep `.cursorrules` slim (~80 lines, ~700 tokens):**

   Include only essentials:
   - Symbol quick reference table
   - Logger method mapping
   - Key file locations
   - Critical conventions
   - Team handoff summary (3 lines)
   - Pointers to full specs

2. **Move details to `.paradigm/specs/`:**

   ```markdown
   # In .cursorrules (slim)
   ## Detailed Specs
   | Spec | What It Covers |
   |------|----------------|
   | `.paradigm/specs/symbols.md` | Full symbol reference |
   | `.paradigm/specs/logger.md` | Logging patterns |
   | `paradigm team --help` | Context handoff commands |
   ```

3. **Use on-demand loading:**

   Instead of embedding everything, prompt AI to read specs when needed:
   > "Read `.paradigm/specs/logger.md` before implementing this"

4. **Measure your costs:**
   ```bash
   # Check current size
   wc -c .cursorrules
   
   # Estimate tokens (chars / 4)
   echo "Tokens: $(( $(wc -c < .cursorrules) / 4 ))"
   ```

### Target Metrics

| Metric | Bloated | Slim | Target |
|--------|---------|------|--------|
| Lines | 500+ | ~80 | <100 |
| Characters | 15,000+ | ~3,000 | <4,000 |
| Est. Tokens | 4,000+ | ~750 | <1,000 |

### Slim `.cursorrules` Template

```markdown
# project-name - Paradigm Context

## Symbol System
| Symbol | Name | Use For |
|--------|------|---------|
| `@` | Feature | User-facing capabilities |
| `#` | Component | Reusable modules |
| `^` | Portal | Access control |
| `!` | Signal | Events/side effects |
| `$` | Flow | Multi-step processes |
| `%` | State | App state |

## Paradigm Logger
**NEVER use console.log. ALWAYS use Paradigm logger.**

| Directory | Method |
|-----------|--------|
| `features/` | `log.feature()` |
| `components/` | `log.component()` |
| `middleware/` | `log.gate()` |

## Key Files
| File | Purpose |
|------|---------|
| `.premise` | Entity graph |
| `.purpose` | Features/flows |
| `.index.yaml` | Doc index — READ FIRST |

## Context Handoff
At ~80% context: `paradigm team handoff --to <agent>`, start new session.

## Full Specs
Read on-demand: `.paradigm/specs/`
```

---

## MCP Server Connection Issues

### Symptoms
- Cursor logs show "Handling DeleteClient action"
- MCP tools not available in Cursor/Claude
- MCP server immediately disconnects
- "command not found: paradigm-mcp"

### Solutions

1. **Check if paradigm-mcp is installed:**
   ```bash
   which paradigm-mcp
   # Should return a path like:
   # /Users/you/.nvm/versions/node/vXX/bin/paradigm-mcp
   ```

2. **Broken npm link (most common):**
   
   The symlink exists but points to nothing. Re-link:
   ```bash
   cd path/to/a-paradigm/packages/paradigm-mcp
   npm link
   ```

3. **Verify the link target exists:**
   ```bash
   # Check if the binary symlink target exists
   ls -la $(which paradigm-mcp)
   
   # Follow the symlink and check if dist/index.js exists
   ls -la $(npm root -g)/@a-company/paradigm-mcp/dist/index.js
   ```

4. **Alternative: Use direct path in mcp.json:**
   
   If linking is problematic, bypass it:
   ```json
   {
     "mcpServers": {
       "my-project": {
         "command": "node",
         "args": ["/full/path/to/paradigm-mcp/dist/index.js", "."],
         "cwd": "/path/to/your/project"
       }
     }
   }
   ```

5. **Check if package is built:**
   ```bash
   ls path/to/paradigm-mcp/dist/
   # Should contain index.js
   
   # If not, build it:
   cd path/to/paradigm-mcp
   npm run build
   ```

6. **Shebang issues:**
   
   The dist/index.js should start with:
   ```
   #!/usr/bin/env node
   ```
   
   If missing, rebuild the package.

7. **nvm/node version mismatch:**
   
   If using nvm, ensure Cursor is using the same node version:
   ```bash
   # Check current node
   node --version
   
   # Check where paradigm-mcp is linked
   which paradigm-mcp
   
   # These should match the same nvm version
   ```

### Debugging MCP Startup

Run the MCP server directly to see any errors:
```bash
cd /path/to/your/project
node /path/to/paradigm-mcp/dist/index.js . 2>&1
```

If it hangs waiting for input, the server is working (MCP servers wait for stdio).
If it throws an error, that's your problem.

### Common DeleteClient Causes

| Cause | Fix |
|-------|-----|
| Broken symlink | `npm link` in paradigm-mcp |
| Package not built | `npm run build` |
| Missing dependencies | `npm install` in paradigm-mcp |
| Wrong cwd in mcp.json | Use absolute path |
| No .paradigm/ in project | Run `paradigm init` |
| nvm/PATH not available | Use full paths (see below) |

### nvm Users: Cursor Doesn't Inherit Shell PATH

**Problem:** Cursor's MCP spawner doesn't load your shell profile, so nvm-managed `node` and globally linked commands like `paradigm-mcp` aren't found.

**Symptoms:**
- MCP works in terminal but not in Cursor
- "command not found" even though `which paradigm-mcp` works
- Server starts when run manually but Cursor shows "DeleteClient"

**Solution:** Use absolute paths in your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "paradigm": {
      "command": "/Users/YOU/.nvm/versions/node/vXX.XX.X/bin/node",
      "args": ["/path/to/paradigm-mcp/dist/index.js", "."],
      "cwd": "/path/to/your/project"
    }
  }
}
```

**Find your paths:**
```bash
# Get your node path
which node
# Example: /Users/you/.nvm/versions/node/v24.12.0/bin/node

# Get paradigm-mcp location
ls $(npm root -g)/../bin/paradigm-mcp
# Or use the source directly:
# /path/to/a-paradigm/packages/paradigm-mcp/dist/index.js
```

**Template for multiple projects:**

Each project's `.cursor/mcp.json` should look like:
```json
{
  "mcpServers": {
    "my-project": {
      "command": "/Users/ascend/.nvm/versions/node/v24.12.0/bin/node",
      "args": ["/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-mcp/dist/index.js", "."],
      "cwd": "/Users/ascend/Documents/GitHub/my-project"
    }
  }
}
```

Only the `cwd` needs to change per project.

---

## Getting Help

If none of these solutions work:

1. **Run doctor for diagnostics:**
   ```bash
   paradigm doctor
   ```

2. **Check Paradigm version:**
   ```bash
   paradigm --version
   ```

3. **Review full config:**
   ```bash
   cat .paradigm/config.yaml
   ```

4. **Check generated IDE file:**
   ```bash
   cat .cursorrules  # or equivalent
   ```
