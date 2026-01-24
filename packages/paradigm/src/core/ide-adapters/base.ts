/**
 * Base IDE Adapter
 * Shared functionality for generating IDE instruction files
 */

import type { ParadigmConfig } from '../paradigm-config.js';
import type { ParadigmFiles, SpecFiles } from './types.js';

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
  lines.push('log.feature(\'@login\').info(\'Starting login\', { email });');
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
    '@': 'feature',
    '#': 'component',
    '^': 'gate',
    '!': 'signal',
    '%': 'state',
    '$': 'flow',
    '&': 'integration',
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
