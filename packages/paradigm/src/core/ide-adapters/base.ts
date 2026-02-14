/**
 * Base IDE Adapter
 * Shared functionality for generating IDE instruction files
 */

import * as os from 'os';
import type { ParadigmConfig } from '../paradigm-config.js';

/**
 * Generate the header section
 */
export function generateHeader(projectName: string, ideName: string): string {
  const lines: string[] = [];
  lines.push(`# ${projectName} - Paradigm Context`);
  lines.push('');
  lines.push(`Generated for ${ideName} by Paradigm.`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Generate overview section from config
 */
export function generateOverview(config: ParadigmConfig): string {
  const lines: string[] = [];
  
  if (config['agent-guidelines']?.overview) {
    lines.push('## Overview');
    lines.push('');
    lines.push(config['agent-guidelines'].overview);
    lines.push('');
  }
  
  if (config['agent-guidelines']?.['how-to-use']?.length) {
    lines.push('## How to Use Paradigm');
    lines.push('');
    for (const instruction of config['agent-guidelines']['how-to-use']) {
      lines.push(`- ${instruction}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Generate symbol system section
 */
export function generateSymbolSystem(config: ParadigmConfig): string {
  const lines: string[] = [];
  
  lines.push('## Symbol System');
  lines.push('');
  lines.push('Use these prefixes to reference project elements:');
  lines.push('');
  lines.push('| Symbol | Name | Description |');
  lines.push('|--------|------|-------------|');
  
  const symbolSystem = config['symbol-system'];
  if (symbolSystem) {
    for (const [prefix, def] of Object.entries(symbolSystem)) {
      lines.push(`| \`${prefix}\` | ${def.name} | ${def.description} |`);
    }
  }
  lines.push('');
  
  lines.push('See `.paradigm/specs/symbols.md` for complete reference.');
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Generate logging rules section
 */
export function generateLoggingRules(config: ParadigmConfig): string {
  const lines: string[] = [];
  
  if (!config.logging?.enforce) {
    return '';
  }
  
  lines.push('## Paradigm Logging');
  lines.push('');
  lines.push('**IMPORTANT:** Use the Paradigm logger instead of raw console.log/print.');
  lines.push('');
  lines.push('```');
  lines.push('// Use this pattern:');
  lines.push('log.component(\'#login-handler\').info(\'Starting login\', { email });');
  lines.push('log.component(\'#database\').debug(\'Query executed\', { duration });');
  lines.push('log.gate(\'^authenticated\').warn(\'Access denied\', { userId });');
  lines.push('log.signal(\'!login-success\').info(\'User authenticated\');');
  lines.push('```');
  lines.push('');
  
  if (config.logging['symbol-mapping']) {
    lines.push('### Symbol Mapping by Directory');
    lines.push('');
    lines.push('| Directory | Symbol | Logger Method |');
    lines.push('|-----------|--------|---------------|');
    for (const [pattern, symbol] of Object.entries(config.logging['symbol-mapping'])) {
      const method = getLogMethodForSymbol(symbol);
      lines.push(`| \`${pattern}\` | \`${symbol}\` | \`log.${method}()\` |`);
    }
    lines.push('');
  }
  
  lines.push('See `.paradigm/specs/logger.md` for full specification.');
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Get logger method for symbol type
 */
function getLogMethodForSymbol(symbol: string): string {
  const mapping: Record<string, string> = {
    '#': 'component',
    '^': 'gate',
    '!': 'signal',
    '$': 'flow',
    '~': 'aspect',
    // v1 backwards compat — all map to component() in v2
    '@': 'component',
    '%': 'component',
    '&': 'component',
  };
  return mapping[symbol] || 'raw';
}

/**
 * Generate scan protocol section
 */
export function generateScanProtocol(config: ParadigmConfig): string {
  if (!config.scan?.enabled) {
    return '';
  }
  
  const lines: string[] = [];
  
  lines.push('## Paradigm Scan');
  lines.push('');
  lines.push('When the user says "**paradigm scan**" with an image:');
  lines.push('');
  lines.push('1. Analyze the image for UI elements');
  lines.push('2. Cross-reference with `.paradigm/scan-index.json`');
  lines.push('3. Return structured mapping of visual elements to code');
  lines.push('');
  lines.push('| Mode | Use Case |');
  lines.push('|------|----------|');
  lines.push('| `paradigm scan` | Map any image to code |');
  lines.push('| `paradigm scan ui` | Screenshot of running app |');
  lines.push('| `paradigm scan design` | Mockup - gap analysis |');
  lines.push('| `paradigm scan error` | Error screenshot |');
  lines.push('');
  lines.push('See `.paradigm/specs/scan.md` for full protocol.');
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Generate conventions section
 */
export function generateConventions(config: ParadigmConfig): string {
  if (!config.conventions?.length) {
    return '';
  }
  
  const lines: string[] = [];
  
  lines.push('## Conventions');
  lines.push('');
  for (const convention of config.conventions) {
    lines.push(`- ${convention}`);
  }
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Generate update rules section
 */
export function generateUpdateRules(config: ParadigmConfig): string {
  if (!config['agent-guidelines']?.['update-rules']?.length) {
    return '';
  }
  
  const lines: string[] = [];
  
  lines.push('## When to Update Paradigm Files');
  lines.push('');
  for (const rule of config['agent-guidelines']['update-rules']) {
    lines.push(`- ${rule}`);
  }
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Generate commands reference section
 */
export function generateCommandsReference(): string {
  const lines: string[] = [];
  
  lines.push('## Paradigm Commands');
  lines.push('');
  lines.push('| Command | Description |');
  lines.push('|---------|-------------|');
  lines.push('| `paradigm init` | Initialize Paradigm in a project |');
  lines.push('| `paradigm sync` | Regenerate IDE instruction files |');
  lines.push('| `paradigm index` | Generate scan index |');
  lines.push('| `paradigm doctor` | Health check |');
  lines.push('| `paradigm status` | Show project status |');
  lines.push('| `paradigm watch` | Auto-sync on changes |');
  lines.push('');
  lines.push('See `.paradigm/docs/commands.md` for full reference.');
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Generate navigation section for AI exploration
 */
export function generateNavigationSection(_config: ParadigmConfig): string {
  const lines: string[] = [];

  lines.push('## Paradigm Navigation');
  lines.push('');
  lines.push('Before exploring this codebase:');
  lines.push('');
  lines.push('1. Read `.paradigm/navigator.yaml` for structure map');
  lines.push('2. Query by symbol - lookup paths directly');
  lines.push('3. Respect skip patterns (node_modules, dist, etc.)');
  lines.push('');
  lines.push('### Exploration Protocol');
  lines.push('');
  lines.push('**INSTEAD OF:** Broad exploration (expensive token usage)');
  lines.push('');
  lines.push('**DO THIS:**');
  lines.push('1. Read `.paradigm/navigator.yaml` for structure map');
  lines.push('2. Find relevant symbol → go to path');
  lines.push('3. Read only needed files');
  lines.push('');
  lines.push('### Task Recipes');
  lines.push('');
  lines.push('**Adding a feature:**');
  lines.push('1. Check `navigator.yaml` → `structure.features.paths`');
  lines.push('2. Read existing feature as template');
  lines.push('3. Create in same location');
  lines.push('');
  lines.push('**Modifying a component:**');
  lines.push('1. Look up symbol in `navigator.yaml` → `symbols`');
  lines.push('2. Go directly to the path');
  lines.push('3. Check `paradigm_ripple` for impact');
  lines.push('');
  lines.push('**Using MCP Tools:**');
  lines.push('- `paradigm_navigate({ intent: "find", target: "#checkout" })` - locate symbol');
  lines.push('- `paradigm_navigate({ intent: "explore", target: "auth" })` - browse area');
  lines.push('- `paradigm_navigate({ intent: "context", task: "add login" })` - task context');
  lines.push('');
  lines.push('### PM Governance (Before/After Tasks)');
  lines.push('');
  lines.push('| When | Tool | Purpose |');
  lines.push('|------|------|---------|');
  lines.push('| Starting any task | `paradigm_pm_preflight` | Get compliance plan, affected symbols, required checks |');
  lines.push('| Finishing any task | `paradigm_pm_postflight` | Check for violations: missing .purpose, missing gates |');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate terminal syntax guidance based on OS
 */
export function generateTerminalGuidance(): string {
  const platform = os.platform();
  const isWindows = platform === 'win32';
  const lines: string[] = [];

  lines.push('## Terminal Syntax');
  lines.push('');

  if (isWindows) {
    lines.push('This project runs on **Windows**. Use appropriate syntax:');
    lines.push('');
    lines.push('| Operation | Windows Syntax |');
    lines.push('|-----------|----------------|');
    lines.push('| Chain commands | `cmd1 ; cmd2` or `cmd1 && cmd2` (PowerShell) |');
    lines.push('| Path separator | `\\` (backslash) |');
    lines.push('| Environment vars | `$env:VAR` (PowerShell) or `%VAR%` (CMD) |');
    lines.push('| Null device | `$null` (PowerShell) or `NUL` (CMD) |');
    lines.push('| List files | `dir` or `Get-ChildItem` |');
    lines.push('| Remove files | `del` or `Remove-Item` |');
    lines.push('');
    lines.push('**IMPORTANT:** Do NOT use Unix-style commands like `rm`, `cat`, `grep` directly.');
  } else {
    const osName = platform === 'darwin' ? 'macOS' : 'Linux';
    lines.push(`This project runs on **${osName}**. Use appropriate syntax:`);
    lines.push('');
    lines.push('| Operation | Unix Syntax |');
    lines.push('|-----------|-------------|');
    lines.push('| Chain commands | `cmd1 && cmd2` (stop on error) or `cmd1 ; cmd2` (always continue) |');
    lines.push('| Path separator | `/` (forward slash) |');
    lines.push('| Environment vars | `$VAR` or `${VAR}` |');
    lines.push('| Null device | `/dev/null` |');
    lines.push('| List files | `ls` |');
    lines.push('| Remove files | `rm` |');
    lines.push('');
    lines.push('**IMPORTANT:** Do NOT use Windows-style commands like `dir`, `del`, or `%VAR%`.');
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Get OS information for agents
 */
export function getOsInfo(): { platform: string; isWindows: boolean; shell: string } {
  const platform = os.platform();
  const isWindows = platform === 'win32';
  const shell = isWindows ? 'PowerShell/CMD' : (platform === 'darwin' ? 'zsh/bash' : 'bash');
  return { platform, isWindows, shell };
}

/**
 * Generate commit convention section with Symbols: trailer protocol
 */
export function generateCommitConvention(): string {
  const lines: string[] = [];

  lines.push('## Commit Messages');
  lines.push('');
  lines.push('Use v2 symbols in commits for history tracking:');
  lines.push('');
  lines.push('### Format');
  lines.push('```');
  lines.push('type(#primary-symbol): short description');
  lines.push('');
  lines.push('- Detail with #component references');
  lines.push('- Gate changes: ^gate-name');
  lines.push('- Signals emitted: !signal-name');
  lines.push('');
  lines.push('Symbols: #symbol-a, #symbol-b, !signal-c');
  lines.push('```');
  lines.push('');
  lines.push('### Convention');
  lines.push('- **Subject**: `type(#symbol): description` — primary symbol in parens');
  lines.push('- **Body**: Reference affected symbols with prefixes (# $ ^ ! ~)');
  lines.push('- **Trailer**: `Symbols: #a, #b, !c` — machine-readable list of ALL affected symbols');
  lines.push('- The `Symbols:` trailer is parsed by the post-commit hook for automatic history capture');
  lines.push('');
  lines.push('### Examples');
  lines.push('```');
  lines.push('feat(#payment-form): add Apple Pay support');
  lines.push('');
  lines.push('- Add #apple-pay-button component');
  lines.push('- Update $checkout-flow with new payment step');
  lines.push('- Emit !payment-method-added signal');
  lines.push('- Gate: ^authenticated required');
  lines.push('');
  lines.push('Symbols: #payment-form, #apple-pay-button, $checkout-flow, !payment-method-added');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate MCP tool reference table (IDE-agnostic)
 */
export function generateMcpToolReference(): string {
  const lines: string[] = [];

  lines.push('## MCP Tools');
  lines.push('');
  lines.push('Paradigm provides MCP tools for token-efficient, always-fresh data. Prefer these over reading files directly.');
  lines.push('');
  lines.push('| Tool | Description | When to Use |');
  lines.push('|------|-------------|-------------|');
  lines.push('| `paradigm_status` | Project overview and symbol counts | Starting a session |');
  lines.push('| `paradigm_search` | Find symbols by name, description, or tags | Looking for symbols |');
  lines.push('| `paradigm_navigate` | Find code locations, explore areas, get task context | Locating code |');
  lines.push('| `paradigm_ripple` | Dependency and impact analysis | Before modifying symbols |');
  lines.push('| `paradigm_related` | Direct relationships for a symbol | Understanding connections |');
  lines.push('| `paradigm_gates_for_route` | Suggest gates for an API endpoint | Adding API routes |');
  lines.push('| `paradigm_wisdom_context` | Team preferences and antipatterns | Before implementing |');
  lines.push('| `paradigm_history_fragility` | Stability warnings for symbols | Before modifying fragile areas |');
  lines.push('| `paradigm_flow_validate` | Validate flow definitions | Before/after implementing flows |');
  lines.push('| `paradigm_flows_affected` | Flows impacted by symbol changes | After modifying symbols |');
  lines.push('| `paradigm_test_fixtures` | Get test data for validation | Writing tests |');
  lines.push('| `paradigm_orchestrate_inline` | Multi-agent task planning | Complex tasks (3+ files) |');
  lines.push('| `paradigm_pm_preflight` | Pre-task compliance check | Starting any task |');
  lines.push('| `paradigm_pm_postflight` | Post-task violation detection | Finishing any task |');
  lines.push('| `paradigm_session_recover` | Load previous session breadcrumbs | Starting a new session |');
  lines.push('| `paradigm_context_check` | Check context window usage | Every 10-15 tool calls |');
  lines.push('| `paradigm_handoff_prepare` | Prepare session handoff summary | When context is high |');
  lines.push('| `paradigm_reindex` | Rebuild static index files | After modifying .purpose files |');
  lines.push('| `paradigm_session_stats` | Current session token usage | Checking budget |');
  lines.push('');
  lines.push('**Rule**: Use MCP tools for discovery and validation, file reads for implementation.');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate before/after task workflow protocol
 */
export function generateWorkflowProtocol(): string {
  const lines: string[] = [];

  lines.push('## Workflow Protocol');
  lines.push('');
  lines.push('### Before Each Task');
  lines.push('');
  lines.push('1. **Preflight**: Call `paradigm_pm_preflight` with your task description');
  lines.push('   - Returns affected symbols, ripple analysis, required agents');
  lines.push('2. **Impact check**: Call `paradigm_ripple` for any symbols you\'ll modify');
  lines.push('3. **Gate check**: Call `paradigm_gates_for_route` before adding API endpoints');
  lines.push('4. **Complex tasks** (3+ files, security + implementation): Call `paradigm_orchestrate_inline` with mode="plan"');
  lines.push('');
  lines.push('### After Each Task');
  lines.push('');
  lines.push('1. **Postflight**: Call `paradigm_pm_postflight` with modified files and symbols');
  lines.push('   - Checks for missing .purpose files, unregistered routes, uncaptured wisdom');
  lines.push('2. **Reindex**: Call `paradigm_reindex` to rebuild static index files');
  lines.push('3. **Validate flows**: Call `paradigm_flow_validate` if you touched flow-related symbols');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate session recovery and handoff protocol
 */
export function generateHandoffProtocol(): string {
  const lines: string[] = [];

  lines.push('## Session Recovery & Handoff');
  lines.push('');
  lines.push('### Session Start (EVERY new session)');
  lines.push('');
  lines.push('Call `paradigm_session_recover` to load previous session breadcrumbs.');
  lines.push('Returns: symbols modified, files explored, recent actions, and suggestions.');
  lines.push('');
  lines.push('### Context Monitoring');
  lines.push('');
  lines.push('Call `paradigm_context_check` every 10-15 tool calls to track context usage.');
  lines.push('');
  lines.push('| Usage | Recommendation | Action |');
  lines.push('|-------|----------------|--------|');
  lines.push('| <50% | continue | Keep working |');
  lines.push('| 50-70% | consider-handoff | Plan a stopping point |');
  lines.push('| 70-85% | handoff-recommended | Prepare handoff soon |');
  lines.push('| >85% | handoff-urgent | Handoff after current task |');
  lines.push('');
  lines.push('### Handoff Process');
  lines.push('');
  lines.push('1. Call `paradigm_handoff_prepare` with summary, next steps, and target agent');
  lines.push('2. User runs: `paradigm team handoff --to <agent> --summary "..."`');
  lines.push('3. New session accepts: `paradigm team accept <handoff-id>`');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate footer section
 */
export function generateFooter(): string {
  const lines: string[] = [];
  
  lines.push('---');
  lines.push('');
  lines.push('## Reference Files');
  lines.push('');
  lines.push('- `.paradigm/specs/symbols.md` - Symbol system reference');
  lines.push('- `.paradigm/specs/logger.md` - Logging specification');
  lines.push('- `.paradigm/specs/scan.md` - Scan protocol');
  lines.push('- `.paradigm/docs/commands.md` - CLI reference');
  lines.push('- `.paradigm/docs/patterns.md` - Coding patterns');
  lines.push('- `.paradigm/docs/troubleshooting.md` - Common issues');
  lines.push('- `.paradigm/prompts/` - Pre-written task prompts');
  lines.push('');
  lines.push('*Generated by Paradigm. Run `paradigm sync` to regenerate.*');
  
  return lines.join('\n');
}
