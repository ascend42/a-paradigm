# Paradigm MCP Build Fix: Shebang Error

## Issue

The `@a-company/paradigm-mcp` package fails to run after `npm link`:

```
$ paradigm-mcp --help
file:///Users/ascend/Documents/GitHub/a-horizon/packages/paradigm-mcp/dist/index.js:2
#!/usr/bin/env node
^
SyntaxError: Invalid or unexpected token
```

## Root Cause

The shebang (`#!/usr/bin/env node`) is appearing on **line 2** instead of **line 1**. This causes Node.js to interpret it as JavaScript code (invalid syntax) instead of a shell directive.

## Likely Causes

1. **tsup banner config** - The banner might be adding the shebang after other content
2. **Source file issue** - The source `index.ts` might already have a shebang, causing duplication
3. **Output format** - ESM output might be prepending something before the shebang

## How to Debug

```bash
# Check what's on the first few lines of the built file
head -5 ~/Documents/GitHub/a-horizon/packages/paradigm-mcp/dist/index.js

# Check the source file
head -5 ~/Documents/GitHub/a-horizon/packages/paradigm-mcp/src/index.ts
```

## Likely Fixes

### Option 1: Fix tsup.config.ts

If using banner config, ensure nothing comes before it:

```typescript
// packages/paradigm-mcp/tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  // Shebang should be first - don't add if source already has it
  banner: {
    js: '#!/usr/bin/env node\n'
  },
  // OR if source has shebang, don't use banner at all
});
```

### Option 2: Remove shebang from source if using banner

If `tsup.config.ts` adds the banner, remove it from `src/index.ts`:

```typescript
// src/index.ts - NO shebang here if banner adds it
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
// ...
```

### Option 3: Use shebang in source only (no banner)

```typescript
// src/index.ts - line 1 must be shebang
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
// ...
```

And remove any banner config from tsup.

## Verification

After fixing, verify:

```bash
# Rebuild
cd ~/Documents/GitHub/a-horizon/packages/paradigm-mcp
npm run build

# Check output - line 1 should be shebang ONLY
head -3 dist/index.js
# Expected:
# #!/usr/bin/env node
# import { Server } from ...

# Re-link and test
npm link
paradigm-mcp --help
# Should show help, not syntax error
```

## For Reference

The linked binary location:
```
/Users/ascend/.nvm/versions/node/v24.12.0/bin/paradigm-mcp
```

The source dist file:
```
/Users/ascend/Documents/GitHub/a-horizon/packages/paradigm-mcp/dist/index.js
```

---

*Bug report from LeadSync MCP setup session, 2026-02-01*
