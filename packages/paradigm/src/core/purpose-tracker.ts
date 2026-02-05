/**
 * Purpose Tracker
 *
 * Tracks file creation during agent work and prompts for .purpose file updates.
 * Helps maintain documentation consistency across the codebase.
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface FileArtifact {
  path: string;
  action: 'created' | 'modified' | 'deleted';
}

export interface PurposePrompt {
  /** Type of prompt */
  type: 'create' | 'update';
  /** Directory that needs .purpose file */
  directory: string;
  /** Suggested symbols for the .purpose file */
  suggestedSymbols: string[];
  /** Suggested content template */
  template: string;
}

export interface PurposeCheckResult {
  /** Directories with missing .purpose files */
  missingPurpose: string[];
  /** Prompts for action */
  prompts: PurposePrompt[];
  /** Whether any new features were detected */
  hasNewFeatures: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Directories that typically contain features and should have .purpose files
 */
const FEATURE_DIRECTORIES = [
  'src/features',
  'src/routes',
  'src/api',
  'src/endpoints',
  'src/commands',
  'src/services',
  'lib',
  'packages',
];

/**
 * File patterns that indicate feature code
 */
const FEATURE_FILE_PATTERNS = [
  /\.(ts|js|tsx|jsx)$/,
  /\.py$/,
  /\.go$/,
  /\.rs$/,
  /\.rb$/,
];

/**
 * Symbol prefix based on directory type
 */
const DIRECTORY_SYMBOL_PREFIX: Record<string, string> = {
  'features': '@',
  'routes': '@',
  'api': '@',
  'endpoints': '@',
  'commands': '@',
  'components': '#',
  'lib': '#',
  'utils': '#',
  'services': '#',
  'middleware': '^',
  'auth': '^',
  'guards': '^',
  'flows': '$',
  'workflows': '$',
  'events': '!',
  'handlers': '!',
  'integrations': '&',
  'external': '&',
};

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Check if a path is within a feature directory
 */
function isFeatureDirectory(filePath: string): boolean {
  return FEATURE_DIRECTORIES.some(dir =>
    filePath.includes(`/${dir}/`) || filePath.startsWith(dir)
  );
}

/**
 * Check if a file is a feature file (vs config, test, etc.)
 */
function isFeatureFile(filePath: string): boolean {
  // Skip test files
  if (filePath.includes('.test.') || filePath.includes('.spec.') || filePath.includes('__tests__')) {
    return false;
  }

  // Skip config files
  if (filePath.includes('config') || filePath.endsWith('.json') || filePath.endsWith('.yaml')) {
    return false;
  }

  // Check if matches feature file patterns
  return FEATURE_FILE_PATTERNS.some(pattern => pattern.test(filePath));
}

/**
 * Get the nearest directory that should have a .purpose file
 */
function getPurposeDirectory(filePath: string): string {
  const parts = filePath.split('/');

  // Walk up the directory tree to find the appropriate level
  for (let i = parts.length - 2; i >= 0; i--) {
    const dir = parts.slice(0, i + 1).join('/');
    const dirName = parts[i];

    // Stop at feature directories
    if (FEATURE_DIRECTORIES.some(fd => fd.endsWith(dirName))) {
      return dir;
    }

    // Or one level below feature directories
    if (i > 0 && FEATURE_DIRECTORIES.some(fd => fd.endsWith(parts[i - 1]))) {
      return dir;
    }
  }

  // Default to parent directory
  return path.dirname(filePath);
}

/**
 * Detect symbol prefix based on directory name
 */
function detectSymbolPrefix(directory: string): string {
  const dirName = path.basename(directory).toLowerCase();

  for (const [key, prefix] of Object.entries(DIRECTORY_SYMBOL_PREFIX)) {
    if (dirName.includes(key)) {
      return prefix;
    }
  }

  // Default to feature symbol
  return '@';
}

/**
 * Generate a symbol name from file/directory name
 */
function generateSymbolName(name: string, prefix: string): string {
  // Convert to kebab-case
  const kebab = name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[._\s]/g, '-')
    .toLowerCase()
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '');

  return `${prefix}${kebab}`;
}

// ============================================================================
// Purpose File Operations
// ============================================================================

/**
 * Check if a .purpose file exists in a directory
 */
export function hasPurposeFile(directory: string): boolean {
  const purposePath = path.join(directory, '.purpose');
  return fs.existsSync(purposePath);
}

/**
 * Generate a .purpose file template
 */
export function generatePurposeTemplate(
  directory: string,
  suggestedSymbols: string[]
): string {
  const dirName = path.basename(directory);
  const lines: string[] = [];

  lines.push(`# ${dirName}`);
  lines.push('');
  lines.push('## Purpose');
  lines.push('');
  lines.push('<!-- Describe what this directory/feature is responsible for -->');
  lines.push('');

  if (suggestedSymbols.length > 0) {
    lines.push('## Symbols');
    lines.push('');
    for (const symbol of suggestedSymbols) {
      lines.push(`- \`${symbol}\`: <!-- Description -->`);
    }
    lines.push('');
  }

  lines.push('## Files');
  lines.push('');
  lines.push('<!-- Key files in this directory -->');
  lines.push('');
  lines.push('## Signals');
  lines.push('');
  lines.push('<!-- Events emitted by this feature -->');
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// Main Tracking Functions
// ============================================================================

/**
 * Detect new files that need .purpose documentation
 *
 * @param artifacts - File artifacts from agent work
 * @param rootDir - Project root directory
 * @returns Check result with prompts for missing .purpose files
 */
export function detectNewFiles(
  artifacts: FileArtifact[],
  rootDir: string
): PurposeCheckResult {
  const createdFiles = artifacts
    .filter(a => a.action === 'created')
    .map(a => a.path);

  const missingPurpose: Set<string> = new Set();
  const directorySymbols: Map<string, string[]> = new Map();

  for (const file of createdFiles) {
    // Skip if not a feature file
    if (!isFeatureFile(file)) continue;

    // Get the purpose directory
    const purposeDir = getPurposeDirectory(file);
    const fullPurposeDir = path.isAbsolute(purposeDir) ? purposeDir : path.join(rootDir, purposeDir);

    // Check if .purpose exists
    if (!hasPurposeFile(fullPurposeDir)) {
      missingPurpose.add(purposeDir);

      // Suggest symbols
      const prefix = detectSymbolPrefix(purposeDir);
      const fileName = path.basename(file, path.extname(file));
      const symbol = generateSymbolName(fileName, prefix);

      const existing = directorySymbols.get(purposeDir) || [];
      if (!existing.includes(symbol)) {
        existing.push(symbol);
        directorySymbols.set(purposeDir, existing);
      }
    }
  }

  // Generate prompts
  const prompts: PurposePrompt[] = [];

  for (const dir of missingPurpose) {
    const symbols = directorySymbols.get(dir) || [];
    const template = generatePurposeTemplate(dir, symbols);

    prompts.push({
      type: 'create',
      directory: dir,
      suggestedSymbols: symbols,
      template,
    });
  }

  return {
    missingPurpose: Array.from(missingPurpose),
    prompts,
    hasNewFeatures: prompts.length > 0,
  };
}

/**
 * Check if symbols in task are documented
 *
 * @param symbols - Symbols mentioned in task
 * @param rootDir - Project root directory
 * @returns List of undocumented symbols
 */
export function findUndocumentedSymbols(
  symbols: string[],
  rootDir: string
): string[] {
  // This would integrate with the scan index
  // For now, return empty (would need index integration)
  return [];
}

/**
 * Format purpose check result for display
 */
export function formatPurposeCheck(result: PurposeCheckResult): string {
  const lines: string[] = [];

  if (!result.hasNewFeatures) {
    lines.push('No new features detected that need .purpose documentation.');
    return lines.join('\n');
  }

  lines.push('## .purpose Files Needed\n');

  for (const prompt of result.prompts) {
    lines.push(`### ${prompt.directory}\n`);
    lines.push(`Create a .purpose file with:\n`);

    if (prompt.suggestedSymbols.length > 0) {
      lines.push('Suggested symbols:');
      for (const symbol of prompt.suggestedSymbols) {
        lines.push(`- ${symbol}`);
      }
      lines.push('');
    }

    lines.push('Template:');
    lines.push('```markdown');
    lines.push(prompt.template);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Create a callback for onAgentComplete that checks for purpose files
 */
export function createPurposeCallback(
  rootDir: string,
  onPrompt: (result: PurposeCheckResult) => void
): (agentName: string, result: { relay?: { outputs: { artifacts: FileArtifact[] } } }) => void {
  return (agentName, result) => {
    if (agentName === 'builder' && result.relay?.outputs.artifacts) {
      const checkResult = detectNewFiles(result.relay.outputs.artifacts, rootDir);
      if (checkResult.hasNewFeatures) {
        onPrompt(checkResult);
      }
    }
  };
}
