/**
 * paradigm constellation - Generate symbol relationship graph
 * 
 * Creates .paradigm/constellation.json - a machine-readable symbol graph
 * that AI agents can query to understand relationships and impact.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { log } from '../utils/logger.js';
import {
  aggregateFromDirectory,
  buildSymbolIndex,
  getSymbolsByType,
  getAllSymbols,
  getSymbolCounts,
  type SymbolIndex,
} from '@a-company/premise-core';

/**
 * Constellation star - a symbol with its relationships
 */
interface ConstellationStar {
  type: string;
  path: string;
  description?: string;
  tags?: string[];
  // Relationships categorized by type
  gates?: string[];        // ^gates this requires
  signals?: string[];      // !signals this emits/consumes
  components?: string[];   // #components this uses
  flows?: string[];        // $flows this is part of
  aspects?: string[];      // ~aspects of this
  // Bidirectional references
  references: string[];    // What this symbol references
  referencedBy: string[];  // What references this symbol
}

/**
 * Constellation orbit - a flow with its sequence
 */
interface ConstellationOrbit {
  description?: string;
  sequence: string[];
}

/**
 * The full constellation structure
 */
interface Constellation {
  version: string;
  generated: string;
  project: string;
  stats: {
    components: number;
    flows: number;
    gates: number;
    signals: number;
    aspects: number;
    total: number;
  };
  stars: Record<string, ConstellationStar>;
  orbits: Record<string, ConstellationOrbit>;
}

/**
 * Categorize references by their symbol type
 */
function categorizeReferences(refs: string[]): Record<string, string[]> {
  const categories: Record<string, string[]> = {
    gates: [],
    signals: [],
    components: [],
    flows: [],
    aspects: [],
  };

  for (const ref of refs) {
    if (!ref || ref.length < 2) continue;

    const prefix = ref[0];
    switch (prefix) {
      case '^': categories.gates.push(ref); break;
      case '!': categories.signals.push(ref); break;
      case '#': categories.components.push(ref); break;
      case '$': categories.flows.push(ref); break;
      case '~': categories.aspects.push(ref); break;
    }
  }

  return categories;
}

/**
 * Build constellation from symbol index
 */
function buildConstellation(index: SymbolIndex, projectName: string): Constellation {
  const stars: Record<string, ConstellationStar> = {};
  const orbits: Record<string, ConstellationOrbit> = {};
  const counts = getSymbolCounts(index);

  // Process all symbols into stars
  const allSymbols = getAllSymbols(index);
  
  for (const entry of allSymbols) {
    const categories = categorizeReferences(entry.references);
    
    const star: ConstellationStar = {
      type: entry.type,
      path: entry.filePath,
      references: entry.references,
      referencedBy: entry.referencedBy,
    };

    // Add optional fields only if they have values
    if (entry.description) star.description = entry.description;
    if (entry.tags && entry.tags.length > 0) star.tags = entry.tags;
    
    // Add categorized references only if they have values
    if (categories.gates.length > 0) star.gates = categories.gates;
    if (categories.signals.length > 0) star.signals = categories.signals;
    if (categories.components.length > 0) star.components = categories.components;
    if (categories.flows.length > 0) star.flows = categories.flows;
    if (categories.aspects.length > 0) star.aspects = categories.aspects;

    stars[entry.symbol] = star;
  }

  // Extract flows as orbits (sequences)
  const flowSymbols = getSymbolsByType(index, 'flow');
  for (const flow of flowSymbols) {
    // A flow's sequence is its references in order
    // The data might contain the sequence, otherwise use references
    const data = flow.data as { sequence?: string[]; gates?: string[] } | undefined;
    const sequence = data?.sequence || data?.gates || flow.references;
    
    orbits[flow.symbol] = {
      description: flow.description,
      sequence,
    };
  }

  return {
    version: '1.0',
    generated: new Date().toISOString(),
    project: projectName,
    stats: {
      components: counts.component,
      flows: counts.flow,
      gates: counts.gate,
      signals: counts.signal,
      aspects: counts.aspect,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    },
    stars,
    orbits,
  };
}

export interface ConstellationOptions {
  format?: 'json' | 'yaml';
  output?: string;
  quiet?: boolean;
}

export async function constellationCommand(targetPath?: string, options: ConstellationOptions = {}) {
  const cwd = process.cwd();
  const absolutePath = targetPath ? path.resolve(cwd, targetPath) : cwd;
  const projectName = path.basename(absolutePath);
  const format = options.format || 'json';

  if (!options.quiet) {
    console.log(chalk.blue('\n✨ Building Constellation...\n'));
  }

  const spinner = ora('Aggregating symbols...').start();
  const tracker = log.command('constellation').start('Building constellation', { project: projectName });

  try {
    // Aggregate all symbols
    const result = await aggregateFromDirectory(absolutePath);
    const index = buildSymbolIndex(result);
    log.operation('aggregate').debug('Symbols aggregated', { count: getAllSymbols(index).length });

    spinner.text = 'Building constellation...';

    // Build the constellation
    const constellation = buildConstellation(index, projectName);

    // Determine output path
    const paradigmDir = path.join(absolutePath, '.paradigm');
    if (!fs.existsSync(paradigmDir)) {
      fs.mkdirSync(paradigmDir, { recursive: true });
    }

    const outputPath = options.output || path.join(paradigmDir, `constellation.${format}`);

    // Write the constellation
    let content: string;
    if (format === 'yaml') {
      // Simple YAML serialization (no dependency needed for basic structure)
      content = serializeToYaml(constellation);
    } else {
      content = JSON.stringify(constellation, null, 2);
    }

    fs.writeFileSync(outputPath, content, 'utf8');
    log.component('constellation-file').success('Constellation written', { path: outputPath, format });

    spinner.succeed('Constellation built');
    tracker.success('Constellation built', { path: outputPath, stars: Object.keys(constellation.stars).length });

    if (!options.quiet) {
      // Display stats
      console.log(chalk.white('\nConstellation Stats'));
      console.log(chalk.gray('─'.repeat(40)));
      
      const stats = constellation.stats;
      const statLines = [
        { symbol: '#', name: 'Components', count: stats.components, color: chalk.green },
        { symbol: '$', name: 'Flows', count: stats.flows, color: chalk.yellow },
        { symbol: '^', name: 'Gates', count: stats.gates, color: chalk.red },
        { symbol: '!', name: 'Signals', count: stats.signals, color: chalk.cyan },
        { symbol: '~', name: 'Aspects', count: stats.aspects, color: chalk.magenta },
      ];

      for (const { symbol, name, count, color } of statLines) {
        if (count > 0) {
          console.log(`  ${color(symbol)} ${name.padEnd(12)} ${chalk.cyan(count.toString())}`);
        }
      }

      console.log(chalk.gray('─'.repeat(40)));
      console.log(`  Total stars:    ${chalk.cyan(stats.total.toString())}`);
      console.log(`  Total orbits:   ${chalk.cyan(Object.keys(constellation.orbits).length.toString())}`);

      console.log(chalk.gray(`\n  Output: ${outputPath}\n`));

      // Show sample relationships if any
      const sampleStar = Object.entries(constellation.stars).find(
        ([, star]) => star.references.length > 0 || star.referencedBy.length > 0
      );

      if (sampleStar) {
        console.log(chalk.white('Sample Star'));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(chalk.cyan(`  ${sampleStar[0]}`));
        const star = sampleStar[1];
        if (star.gates?.length) console.log(chalk.gray(`    gates: ${star.gates.join(', ')}`));
        if (star.components?.length) console.log(chalk.gray(`    components: ${star.components.join(', ')}`));
        if (star.signals?.length) console.log(chalk.gray(`    signals: ${star.signals.join(', ')}`));
        if (star.referencedBy.length) console.log(chalk.gray(`    referencedBy: ${star.referencedBy.join(', ')}`));
        console.log('');
      }
    }

    // Show errors if any
    if (result.errors.length > 0 && !options.quiet) {
      console.log(chalk.yellow('Warnings'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const error of result.errors.slice(0, 5)) {
        console.log(chalk.yellow(`  ⚠ ${error.filePath}: ${error.message}`));
      }
      if (result.errors.length > 5) {
        console.log(chalk.gray(`  ... and ${result.errors.length - 5} more`));
      }
      console.log('');
    }

    return constellation;

  } catch (error) {
    spinner.fail('Failed to build constellation');
    tracker.error('Constellation build failed', { error: (error as Error).message });
    console.log(chalk.red(`Error: ${(error as Error).message}\n`));
    process.exit(1);
  }
}

/**
 * Simple YAML serialization (avoids extra dependency)
 */
function serializeToYaml(obj: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent);
  
  if (obj === null || obj === undefined) {
    return 'null';
  }
  
  if (typeof obj === 'string') {
    // Quote strings that might need it
    if (obj.includes(':') || obj.includes('#') || obj.includes('\n') || obj.startsWith('@') || obj.startsWith('^')) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }
  
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj);
  }
  
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map(item => `${spaces}- ${serializeToYaml(item, indent)}`).join('\n');
  }
  
  if (typeof obj === 'object') {
    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';
    
    return entries
      .map(([key, value]) => {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          return `${spaces}${key}:\n${serializeToYaml(value, indent + 1)}`;
        }
        if (Array.isArray(value)) {
          if (value.length === 0) return `${spaces}${key}: []`;
          return `${spaces}${key}:\n${serializeToYaml(value, indent + 1)}`;
        }
        return `${spaces}${key}: ${serializeToYaml(value, indent)}`;
      })
      .join('\n');
  }
  
  return String(obj);
}
