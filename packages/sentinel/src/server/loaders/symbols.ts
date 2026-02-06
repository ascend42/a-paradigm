/**
 * Symbol index loader for the server
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SymbolEntry {
  id: string;
  symbol: string;
  type: 'feature' | 'component' | 'flow' | 'state' | 'aspect' | 'portal' | 'signal' | 'idea';
  source: 'purpose' | 'portal' | 'premise';
  filePath: string;
  data: Record<string, unknown>;
  description?: string;
  references: string[];
  referencedBy: string[];
  tags?: string[];
}

export interface ParadigmConfig {
  name?: string;
  discipline?: string;
  version?: string;
  conventions?: Record<string, unknown>;
}

/**
 * Load Paradigm configuration from .paradigm/config.yaml
 */
export async function loadParadigmConfig(projectDir: string): Promise<ParadigmConfig> {
  const configPath = path.join(projectDir, '.paradigm', 'config.yaml');

  if (!fs.existsSync(configPath)) {
    // Try to extract name from package.json
    const packagePath = path.join(projectDir, 'package.json');
    if (fs.existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
        return { name: pkg.name };
      } catch {
        // Ignore parse errors
      }
    }
    return {};
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    // Simple YAML parsing for common fields
    const config: ParadigmConfig = {};

    const nameMatch = content.match(/^name:\s*(.+)$/m);
    if (nameMatch) config.name = nameMatch[1].trim().replace(/^["']|["']$/g, '');

    const disciplineMatch = content.match(/^discipline:\s*(.+)$/m);
    if (disciplineMatch) config.discipline = disciplineMatch[1].trim();

    const versionMatch = content.match(/^version:\s*(.+)$/m);
    if (versionMatch) config.version = versionMatch[1].trim();

    return config;
  } catch (error) {
    console.error('Failed to load Paradigm config:', error);
    return {};
  }
}

/**
 * Load symbol index from .paradigm/index.json or scan .purpose files
 */
export async function loadSymbolIndex(projectDir: string): Promise<SymbolEntry[]> {
  // First try to load from cached index
  const indexPath = path.join(projectDir, '.paradigm', 'index.json');

  if (fs.existsSync(indexPath)) {
    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      const index = JSON.parse(content);
      if (Array.isArray(index.entries)) {
        return index.entries;
      }
      if (Array.isArray(index)) {
        return index;
      }
    } catch (error) {
      console.error('Failed to load symbol index:', error);
    }
  }

  // Fall back to scanning .purpose files
  return scanPurposeFiles(projectDir);
}

/**
 * Scan project for .purpose files and extract symbols
 */
async function scanPurposeFiles(projectDir: string): Promise<SymbolEntry[]> {
  const symbols: SymbolEntry[] = [];
  const seenIds = new Set<string>();

  // Common directories to scan
  const scanDirs = ['src', 'lib', 'packages', 'apps', '.'];

  for (const dir of scanDirs) {
    const fullPath = path.join(projectDir, dir);
    if (fs.existsSync(fullPath)) {
      await scanDirectory(fullPath, symbols, seenIds, projectDir);
    }
  }

  // Also check for portal.yaml
  const portalPath = path.join(projectDir, 'portal.yaml');
  if (fs.existsSync(portalPath)) {
    try {
      const content = fs.readFileSync(portalPath, 'utf-8');
      // Extract gates from portal.yaml
      const gateMatches = content.matchAll(/^\s*\^([a-z-]+):/gm);
      for (const match of gateMatches) {
        const gateName = match[1];
        const id = `portal-${gateName}`;
        if (!seenIds.has(id)) {
          seenIds.add(id);
          symbols.push({
            id,
            symbol: `^${gateName}`,
            type: 'portal',
            source: 'portal',
            filePath: 'portal.yaml',
            data: {},
            references: [],
            referencedBy: [],
          });
        }
      }
    } catch {
      // Ignore errors
    }
  }

  return symbols;
}

/**
 * Recursively scan a directory for .purpose files
 */
async function scanDirectory(
  dir: string,
  symbols: SymbolEntry[],
  seenIds: Set<string>,
  projectDir: string
): Promise<void> {
  // Skip common non-source directories
  const skipDirs = ['node_modules', '.git', 'dist', 'build', '.paradigm', 'coverage', '.next'];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!skipDirs.includes(entry.name)) {
        await scanDirectory(fullPath, symbols, seenIds, projectDir);
      }
    } else if (entry.name === '.purpose') {
      // Parse .purpose file
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const parsed = parsePurposeFile(content, fullPath, projectDir);
        for (const symbol of parsed) {
          if (!seenIds.has(symbol.id)) {
            seenIds.add(symbol.id);
            symbols.push(symbol);
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }
}

/**
 * Parse a .purpose file and extract symbols
 */
function parsePurposeFile(content: string, filePath: string, projectDir: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = [];
  const relativePath = path.relative(projectDir, filePath);

  // Extract feature (@)
  const featureMatch = content.match(/^@([a-z0-9-]+)/m);
  if (featureMatch) {
    const name = featureMatch[1];
    symbols.push({
      id: `feature-${name}`,
      symbol: `@${name}`,
      type: 'feature',
      source: 'purpose',
      filePath: relativePath,
      data: {},
      description: extractDescription(content, `@${name}`),
      references: extractReferences(content),
      referencedBy: [],
      tags: extractTags(content),
    });
  }

  // Extract components (#)
  const componentMatches = content.matchAll(/^#([a-z0-9-]+)/gm);
  for (const match of componentMatches) {
    const name = match[1];
    symbols.push({
      id: `component-${name}`,
      symbol: `#${name}`,
      type: 'component',
      source: 'purpose',
      filePath: relativePath,
      data: {},
      description: extractDescription(content, `#${name}`),
      references: extractReferences(content),
      referencedBy: [],
      tags: extractTags(content),
    });
  }

  // Extract flows ($)
  const flowMatches = content.matchAll(/\$([a-z0-9-]+)/gm);
  for (const match of flowMatches) {
    const name = match[1];
    if (!symbols.find((s) => s.symbol === `$${name}`)) {
      symbols.push({
        id: `flow-${name}`,
        symbol: `$${name}`,
        type: 'flow',
        source: 'purpose',
        filePath: relativePath,
        data: {},
        references: [],
        referencedBy: [],
      });
    }
  }

  // Extract signals (!)
  const signalMatches = content.matchAll(/!([a-z0-9-]+)/gm);
  for (const match of signalMatches) {
    const name = match[1];
    if (!symbols.find((s) => s.symbol === `!${name}`)) {
      symbols.push({
        id: `signal-${name}`,
        symbol: `!${name}`,
        type: 'signal',
        source: 'purpose',
        filePath: relativePath,
        data: {},
        references: [],
        referencedBy: [],
      });
    }
  }

  // Extract gates/portals (^)
  const gateMatches = content.matchAll(/\^([a-z0-9-]+)/gm);
  for (const match of gateMatches) {
    const name = match[1];
    if (!symbols.find((s) => s.symbol === `^${name}`)) {
      symbols.push({
        id: `portal-${name}`,
        symbol: `^${name}`,
        type: 'portal',
        source: 'purpose',
        filePath: relativePath,
        data: {},
        references: [],
        referencedBy: [],
      });
    }
  }

  return symbols;
}

/**
 * Extract description for a symbol from .purpose content
 */
function extractDescription(content: string, symbol: string): string | undefined {
  // Look for description after the symbol
  const regex = new RegExp(`${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-:]?\\s*(.+)`, 'm');
  const match = content.match(regex);
  if (match && match[1]) {
    return match[1].trim();
  }
  return undefined;
}

/**
 * Extract references to other symbols
 */
function extractReferences(content: string): string[] {
  const refs: Set<string> = new Set();
  const refMatches = content.matchAll(/[@#$!^%]([a-z0-9-]+)/g);
  for (const match of refMatches) {
    refs.add(match[0]);
  }
  return Array.from(refs);
}

/**
 * Extract tags from content
 */
function extractTags(content: string): string[] {
  const tagMatch = content.match(/tags:\s*\[([^\]]+)\]/);
  if (tagMatch) {
    return tagMatch[1].split(',').map((t) => t.trim().replace(/^["']|["']$/g, ''));
  }
  return [];
}

/**
 * Get total symbol count for a project
 */
export async function getSymbolCount(projectDir: string): Promise<number> {
  const symbols = await loadSymbolIndex(projectDir);
  return symbols.length;
}

/**
 * Update a symbol's metadata in its .purpose file
 */
export interface SymbolUpdate {
  description?: string;
  tags?: string[];
}

export async function updateSymbol(
  projectDir: string,
  symbolId: string,
  updates: SymbolUpdate
): Promise<{ success: boolean; error?: string }> {
  // Load current symbols to find the target
  const symbols = await loadSymbolIndex(projectDir);
  const symbol = symbols.find((s) => s.id === symbolId);

  if (!symbol) {
    return { success: false, error: 'Symbol not found' };
  }

  // Get the full file path
  const filePath = path.join(projectDir, symbol.filePath);

  if (!fs.existsSync(filePath)) {
    return { success: false, error: 'Source file not found' };
  }

  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    let modified = false;

    // Update description
    if (updates.description !== undefined) {
      const symbolPattern = symbol.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Try to find and update existing description
      const descRegex = new RegExp(`(${symbolPattern})\\s*[-:]?\\s*(.*)`, 'm');
      const match = content.match(descRegex);

      if (match) {
        // Update existing description line
        const newLine = updates.description
          ? `${symbol.symbol}: ${updates.description}`
          : symbol.symbol;
        content = content.replace(descRegex, newLine);
        modified = true;
      }
    }

    // Update tags
    if (updates.tags !== undefined) {
      const tagsStr = updates.tags.length > 0
        ? `tags: [${updates.tags.map(t => `"${t}"`).join(', ')}]`
        : '';

      // Check if tags line exists
      const tagsRegex = /^tags:\s*\[[^\]]*\]\s*$/m;
      if (tagsRegex.test(content)) {
        // Update existing tags line
        if (tagsStr) {
          content = content.replace(tagsRegex, tagsStr);
        } else {
          // Remove tags line if empty
          content = content.replace(tagsRegex, '');
        }
        modified = true;
      } else if (tagsStr) {
        // Add tags line after the symbol definition
        const symbolPattern = symbol.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const symbolLineRegex = new RegExp(`(${symbolPattern}[^\\n]*\\n)`, 'm');
        const symbolMatch = content.match(symbolLineRegex);

        if (symbolMatch) {
          content = content.replace(symbolLineRegex, `$1${tagsStr}\n`);
          modified = true;
        }
      }
    }

    if (modified) {
      // Clean up any double newlines
      content = content.replace(/\n{3,}/g, '\n\n');

      // Write the file
      fs.writeFileSync(filePath, content, 'utf-8');

      // Update the cached index if it exists
      const indexPath = path.join(projectDir, '.paradigm', 'index.json');
      if (fs.existsSync(indexPath)) {
        try {
          const indexContent = fs.readFileSync(indexPath, 'utf-8');
          const index = JSON.parse(indexContent);
          const entries = Array.isArray(index.entries) ? index.entries : index;

          const entryIndex = entries.findIndex((e: SymbolEntry) => e.id === symbolId);
          if (entryIndex >= 0) {
            if (updates.description !== undefined) {
              entries[entryIndex].description = updates.description;
            }
            if (updates.tags !== undefined) {
              entries[entryIndex].tags = updates.tags;
            }

            // Write updated index
            if (Array.isArray(index.entries)) {
              index.entries = entries;
              fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
            } else {
              fs.writeFileSync(indexPath, JSON.stringify(entries, null, 2), 'utf-8');
            }
          }
        } catch {
          // Ignore index update errors
        }
      }

      return { success: true };
    }

    return { success: true }; // No changes needed
  } catch (error) {
    console.error('Failed to update symbol:', error);
    return { success: false, error: 'Failed to write file' };
  }
}
