/**
 * paradigm echo - Error-to-symbol mapping
 * 
 * Looks up error codes in .paradigm/echoes.yaml to find the
 * related symbols and resolution hints.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { log } from '../utils/logger.js';

export interface EchoOptions {
  add?: boolean;
  symbol?: string;
  location?: string;
  resolution?: string;
  quiet?: boolean;
  json?: boolean;
}

interface EchoEntry {
  symbol?: string;
  signal?: string;
  location?: string;
  ripple?: string[];
  resolution?: string;
}

interface EchoesData {
  version: string;
  errors: Record<string, EchoEntry>;
}

const ECHOES_TEMPLATE = `# Echoes - Error to Symbol Mapping
# When errors occur, they echo back to their source symbol.
# Run \`paradigm echo ERROR_CODE\` to look up context.

version: "1.0"

errors:
  # Example error mapping
  AUTH_REQUIRED:
    symbol: "^authenticated"
    location: "src/middleware/auth.ts"
    ripple:
      - "@checkout"
      - "@profile"
      - "@settings"
    resolution: "Ensure user token is passed in request headers"

  # Add your error mappings below
  # ERROR_CODE:
  #   symbol: "^portal-name"       # or signal: "!signal-name"
  #   location: "path/to/file.ts"
  #   ripple:
  #     - "@feature1"
  #     - "@feature2"
  #   resolution: "How to fix this error"
`;

/**
 * Simple YAML parser for echoes.yaml
 */
function parseEchoes(content: string): EchoesData {
  const data: EchoesData = {
    version: '1.0',
    errors: {},
  };

  // Remove comments and empty lines for parsing
  const lines = content.split('\n');
  let currentError: string | null = null;
  let currentEntry: EchoEntry = {};
  let inRipple = false;
  let rippleIndent = 0;

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith('#') || line.trim() === '') continue;

    // Check for version
    const versionMatch = line.match(/^version:\s*"?([^"]+)"?/);
    if (versionMatch) {
      data.version = versionMatch[1];
      continue;
    }

    // Check for errors section
    if (line.match(/^errors:\s*$/)) continue;

    // Check for error key (2 spaces indent)
    const errorKeyMatch = line.match(/^  ([A-Z_][A-Z0-9_]*):\s*$/);
    if (errorKeyMatch) {
      // Save previous entry
      if (currentError && Object.keys(currentEntry).length > 0) {
        data.errors[currentError] = currentEntry;
      }
      currentError = errorKeyMatch[1];
      currentEntry = {};
      inRipple = false;
      continue;
    }

    // Check for error properties (4 spaces indent)
    if (currentError) {
      const symbolMatch = line.match(/^\s{4}symbol:\s*"?([^"]+)"?/);
      if (symbolMatch) {
        currentEntry.symbol = symbolMatch[1];
        inRipple = false;
        continue;
      }

      const signalMatch = line.match(/^\s{4}signal:\s*"?([^"]+)"?/);
      if (signalMatch) {
        currentEntry.signal = signalMatch[1];
        inRipple = false;
        continue;
      }

      const locationMatch = line.match(/^\s{4}location:\s*"?([^"]+)"?/);
      if (locationMatch) {
        currentEntry.location = locationMatch[1];
        inRipple = false;
        continue;
      }

      const resolutionMatch = line.match(/^\s{4}resolution:\s*"?([^"]+)"?/);
      if (resolutionMatch) {
        currentEntry.resolution = resolutionMatch[1];
        inRipple = false;
        continue;
      }

      // Check for ripple array start
      if (line.match(/^\s{4}ripple:\s*$/)) {
        currentEntry.ripple = [];
        inRipple = true;
        continue;
      }

      // Check for ripple items (6 spaces indent with -)
      if (inRipple) {
        const rippleMatch = line.match(/^\s{6}-\s*"?([^"]+)"?/);
        if (rippleMatch) {
          if (!currentEntry.ripple) currentEntry.ripple = [];
          currentEntry.ripple.push(rippleMatch[1]);
          continue;
        }
      }
    }
  }

  // Save last entry
  if (currentError && Object.keys(currentEntry).length > 0) {
    data.errors[currentError] = currentEntry;
  }

  return data;
}

/**
 * Look up an error code
 */
export async function echoCommand(errorCode: string, targetPath?: string, options: EchoOptions = {}) {
  const cwd = process.cwd();
  const absolutePath = targetPath ? path.resolve(cwd, targetPath) : cwd;
  const echoesPath = path.join(absolutePath, '.paradigm', 'echoes.yaml');

  log.command('echo').debug('Looking up error code', { errorCode });

  // Check if echoes.yaml exists
  if (!fs.existsSync(echoesPath)) {
    if (options.json) {
      console.log(JSON.stringify({ found: false, error: 'No echoes.yaml found' }, null, 2));
      return;
    }
    log.command('echo').warn('No echoes.yaml found');
    console.log(chalk.yellow('\n📢 No echoes.yaml found.\n'));
    console.log(chalk.gray('  Run `paradigm echo --init` to create one.\n'));
    return;
  }

  const content = fs.readFileSync(echoesPath, 'utf8');
  const data = parseEchoes(content);
  log.component('echoes-parser').debug('Echoes file parsed', { count: Object.keys(data.errors).length });

  // Look up the error
  const entry = data.errors[errorCode.toUpperCase()];

  if (!entry) {
    log.command('echo').warn('Error code not found', { errorCode });
    if (options.json) {
      console.log(JSON.stringify({
        found: false,
        errorCode: errorCode.toUpperCase(),
        available: Object.keys(data.errors),
      }, null, 2));
      return;
    }
    console.log(chalk.yellow(`\n📢 No echo found for: ${errorCode}\n`));
    
    // Show available errors
    const available = Object.keys(data.errors);
    if (available.length > 0) {
      console.log(chalk.gray('  Available error codes:'));
      for (const code of available.slice(0, 10)) {
        const e = data.errors[code];
        const symbolInfo = e.symbol || e.signal || '';
        console.log(chalk.gray(`    ${code} → ${symbolInfo}`));
      }
      if (available.length > 10) {
        console.log(chalk.gray(`    ... and ${available.length - 10} more`));
      }
    }
    console.log('');
    return;
  }

  log.command('echo').success('Error code found', { errorCode, hasSymbol: !!entry.symbol, hasResolution: !!entry.resolution });

  // JSON output mode
  if (options.json) {
    console.log(JSON.stringify({
      found: true,
      errorCode: errorCode.toUpperCase(),
      ...entry,
    }, null, 2));
    return;
  }

  // Display the echo
  console.log(chalk.blue(`\n📢 Echo: ${chalk.cyan(errorCode)}\n`));
  console.log(chalk.gray('─'.repeat(50)));

  if (entry.symbol) {
    console.log(`  Symbol:     ${chalk.red(entry.symbol)}`);
  }
  if (entry.signal) {
    console.log(`  Signal:     ${chalk.yellow(entry.signal)}`);
  }
  if (entry.location) {
    console.log(`  Location:   ${chalk.gray(entry.location)}`);
  }
  
  if (entry.ripple && entry.ripple.length > 0) {
    console.log(`  Ripple:     ${entry.ripple.map(r => {
      if (r.startsWith('@')) return chalk.blue(r);
      if (r.startsWith('#')) return chalk.green(r);
      if (r.startsWith('^')) return chalk.red(r);
      return chalk.gray(r);
    }).join(', ')}`);
  }

  console.log('');

  if (entry.resolution) {
    console.log(chalk.white('Resolution:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.green(`  ${entry.resolution}`));
    console.log('');
  }

  // Tip
  console.log(chalk.gray('Tip: Run `paradigm ripple ' + (entry.symbol || entry.signal || '') + '` for full impact analysis.\n'));
}

/**
 * Initialize echoes.yaml
 */
export async function echoInitCommand(targetPath?: string, options: EchoOptions = {}) {
  const cwd = process.cwd();
  const absolutePath = targetPath ? path.resolve(cwd, targetPath) : cwd;
  const paradigmDir = path.join(absolutePath, '.paradigm');
  const echoesPath = path.join(paradigmDir, 'echoes.yaml');

  // Ensure .paradigm directory exists
  if (!fs.existsSync(paradigmDir)) {
    fs.mkdirSync(paradigmDir, { recursive: true });
  }

  if (fs.existsSync(echoesPath) && !options.quiet) {
    console.log(chalk.yellow('\n⚠️  echoes.yaml already exists.\n'));
    console.log(chalk.gray(`  Path: ${echoesPath}\n`));
    return;
  }

  fs.writeFileSync(echoesPath, ECHOES_TEMPLATE, 'utf8');

  if (!options.quiet) {
    console.log(chalk.green('\n✓ Created .paradigm/echoes.yaml\n'));
    console.log(chalk.gray('  Edit this file to add error-to-symbol mappings.'));
    console.log(chalk.gray('  Then use `paradigm echo ERROR_CODE` to look them up.\n'));
  }
}

/**
 * List all echoes
 */
export async function echoListCommand(targetPath?: string, options: EchoOptions = {}) {
  const cwd = process.cwd();
  const absolutePath = targetPath ? path.resolve(cwd, targetPath) : cwd;
  const echoesPath = path.join(absolutePath, '.paradigm', 'echoes.yaml');

  if (!fs.existsSync(echoesPath)) {
    console.log(chalk.yellow('\n📢 No echoes.yaml found.\n'));
    console.log(chalk.gray('  Run `paradigm echo --init` to create one.\n'));
    return;
  }

  const content = fs.readFileSync(echoesPath, 'utf8');
  const data = parseEchoes(content);

  console.log(chalk.blue('\n📢 All Echoes\n'));
  console.log(chalk.gray('─'.repeat(50)));

  const codes = Object.keys(data.errors);
  if (codes.length === 0) {
    console.log(chalk.gray('  No error mappings defined yet.\n'));
    return;
  }

  for (const code of codes) {
    const entry = data.errors[code];
    const symbol = entry.symbol || entry.signal || '';
    const location = entry.location ? chalk.gray(` @ ${entry.location}`) : '';
    console.log(`  ${chalk.cyan(code.padEnd(20))} → ${symbol}${location}`);
  }

  console.log(chalk.gray(`\n  Total: ${codes.length} error mappings\n`));
}
