/**
 * paradigm ripple - Show change impact analysis for a symbol
 * 
 * Analyzes what would be affected if you modify a given symbol,
 * helping AI agents understand the blast radius of changes.
 */

import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { log } from '../utils/logger.js';
import {
  aggregateFromDirectory,
  buildSymbolIndex,
  getSymbol,
  getReferencesTo,
  getReferencesFrom,
  getSymbolsByType,
  parseSymbol,
  type SymbolEntry,
  type SymbolIndex,
} from '@a-company/premise-core';

export interface RippleOptions {
  depth?: number;
  json?: boolean;
  quiet?: boolean;
}

interface RippleResult {
  symbol: string;
  type: string;
  path: string;
  description?: string;
  
  // Direct relationships
  requires: string[];      // Symbols this requires (references)
  requiredBy: string[];    // Symbols that require this (referencedBy)
  
  // Categorized impact
  downstream: {
    components: string[];
    signals: string[];
    aspects: string[];
  };

  upstream: {
    gates: string[];
    flows: string[];
  };
  
  // Flows this is part of
  partOfFlows: { flow: string; position: number; total: number }[];
  
  // Test suggestion
  testPath?: string;
  testCommand?: string;
}

/**
 * Find which flows a symbol is part of
 */
function findFlowMembership(
  symbol: string,
  index: SymbolIndex
): { flow: string; position: number; total: number }[] {
  const flows = getSymbolsByType(index, 'flow');
  const memberships: { flow: string; position: number; total: number }[] = [];
  
  for (const flow of flows) {
    const data = flow.data as { sequence?: string[]; gates?: string[] } | undefined;
    const sequence = data?.sequence || data?.gates || flow.references;
    
    const position = sequence.indexOf(symbol);
    if (position !== -1) {
      memberships.push({
        flow: flow.symbol,
        position: position + 1, // 1-indexed for display
        total: sequence.length,
      });
    }
  }
  
  return memberships;
}

/**
 * Suggest test path based on symbol path
 */
function suggestTestPath(symbolPath: string): { testPath?: string; testCommand?: string } {
  // Common patterns
  const dir = path.dirname(symbolPath);

  // Return the test path pattern
  const testPath = `${dir}/**/*.test.{ts,tsx}`;
  const testCommand = `npm test -- --testPathPattern="${dir}"`;

  return { testPath, testCommand };
}

/**
 * Categorize symbols by type
 */
function categorize(symbols: SymbolEntry[]): {
  components: string[];
  gates: string[];
  signals: string[];
  flows: string[];
  aspects: string[];
} {
  return {
    components: symbols.filter(s => s.type === 'component').map(s => s.symbol),
    gates: symbols.filter(s => s.type === 'gate').map(s => s.symbol),
    signals: symbols.filter(s => s.type === 'signal').map(s => s.symbol),
    flows: symbols.filter(s => s.type === 'flow').map(s => s.symbol),
    aspects: symbols.filter(s => s.type === 'aspect').map(s => s.symbol),
  };
}

/**
 * Analyze ripple effects for a symbol
 */
function analyzeRipple(symbol: string, index: SymbolIndex): RippleResult | null {
  const entry = getSymbol(index, symbol);
  if (!entry) return null;
  
  // Get direct relationships
  const referencesTo = getReferencesTo(index, symbol);   // What references this
  const referencesFrom = getReferencesFrom(index, symbol); // What this references
  
  const toCategorized = categorize(referencesTo);
  const fromCategorized = categorize(referencesFrom);
  
  // Find flow memberships
  const partOfFlows = findFlowMembership(symbol, index);
  
  // Suggest test path
  const { testPath, testCommand } = suggestTestPath(entry.filePath);
  
  return {
    symbol: entry.symbol,
    type: entry.type,
    path: entry.filePath,
    description: entry.description,
    
    requires: entry.references,
    requiredBy: entry.referencedBy,
    
    downstream: {
      components: toCategorized.components,
      signals: toCategorized.signals,
      aspects: toCategorized.aspects,
    },

    upstream: {
      gates: fromCategorized.gates,
      flows: fromCategorized.flows,
    },
    
    partOfFlows,
    testPath,
    testCommand,
  };
}

export async function rippleCommand(symbolArg: string, targetPath?: string, options: RippleOptions = {}) {
  const cwd = process.cwd();
  const absolutePath = targetPath ? path.resolve(cwd, targetPath) : cwd;

  // Validate symbol format
  const parsed = parseSymbol(symbolArg);
  if (!parsed) {
    console.log(chalk.red(`\n❌ Invalid symbol format: ${symbolArg}`));
    console.log(chalk.gray('  Symbols must start with @, #, ^, !, $, %, ~, or ?'));
    console.log(chalk.gray('  Example: paradigm ripple @checkout\n'));
    process.exit(1);
  }

  if (!options.quiet && !options.json) {
    console.log(chalk.blue(`\n🌊 Ripple Analysis for ${chalk.cyan(symbolArg)}\n`));
  }

  const tracker = log.command('ripple').start('Analyzing ripple effects', { symbol: symbolArg });
  const spinner = options.json ? null : ora('Analyzing impact...').start();

  try {
    // Aggregate symbols
    const result = await aggregateFromDirectory(absolutePath);
    const index = buildSymbolIndex(result);
    log.operation('aggregate').debug('Symbols aggregated for ripple', { symbol: symbolArg });

    // Analyze ripple
    const ripple = analyzeRipple(symbolArg, index);

    if (!ripple) {
      spinner?.fail(`Symbol not found: ${symbolArg}`);
      tracker.error('Symbol not found', { symbol: symbolArg });
      console.log(chalk.gray('\n  Available symbols of this type:'));
      const sameType = getSymbolsByType(index, parsed.type).slice(0, 5);
      for (const s of sameType) {
        console.log(chalk.gray(`    ${s.symbol}`));
      }
      if (getSymbolsByType(index, parsed.type).length > 5) {
        console.log(chalk.gray(`    ... and more`));
      }
      console.log('');
      process.exit(1);
    }

    spinner?.succeed('Impact analyzed');
    tracker.success('Ripple analysis complete', { 
      symbol: symbolArg, 
      requires: ripple.requires.length, 
      requiredBy: ripple.requiredBy.length 
    });

    // Output as JSON if requested
    if (options.json) {
      console.log(JSON.stringify(ripple, null, 2));
      return ripple;
    }

    // Pretty print the ripple analysis
    console.log(chalk.white('Symbol Info'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Type:        ${chalk.cyan(ripple.type)}`);
    console.log(`  Path:        ${chalk.gray(ripple.path)}`);
    if (ripple.description) {
      console.log(`  Description: ${ripple.description}`);
    }
    console.log('');

    // Upstream (what this requires)
    if (ripple.requires.length > 0) {
      console.log(chalk.white('⬆️  Upstream (What this requires)'));
      console.log(chalk.gray('─'.repeat(50)));
      if (ripple.upstream.gates.length > 0) {
        console.log(`  Gates:    ${ripple.upstream.gates.map(p => chalk.red(p)).join(', ')}`);
      }
      if (ripple.upstream.flows.length > 0) {
        console.log(`  Flows:    ${ripple.upstream.flows.map(f => chalk.cyan(f)).join(', ')}`);
      }
      // Show other references
      const otherRefs = ripple.requires.filter(
        r => !ripple.upstream.gates.includes(r) &&
             !ripple.upstream.flows.includes(r)
      );
      if (otherRefs.length > 0) {
        console.log(`  Other:    ${otherRefs.map(r => chalk.gray(r)).join(', ')}`);
      }
      console.log('');
    }

    // Downstream (what would be affected)
    if (ripple.requiredBy.length > 0) {
      console.log(chalk.white('⬇️  Downstream (What would be affected)'));
      console.log(chalk.gray('─'.repeat(50)));
      if (ripple.downstream.components.length > 0) {
        console.log(`  Components:  ${ripple.downstream.components.map(c => chalk.green(c)).join(', ')}`);
      }
      if (ripple.downstream.signals.length > 0) {
        console.log(`  Signals:     ${ripple.downstream.signals.map(s => chalk.yellow(s)).join(', ')}`);
      }
      if (ripple.downstream.aspects.length > 0) {
        console.log(`  Aspects:     ${ripple.downstream.aspects.map(a => chalk.magenta(a)).join(', ')}`);
      }
      // Show other references
      const otherRefs = ripple.requiredBy.filter(
        r => !ripple.downstream.components.includes(r) &&
             !ripple.downstream.signals.includes(r) &&
             !ripple.downstream.aspects.includes(r)
      );
      if (otherRefs.length > 0) {
        console.log(`  Other:       ${otherRefs.map(r => chalk.gray(r)).join(', ')}`);
      }
      console.log('');
    }

    // Flow membership
    if (ripple.partOfFlows.length > 0) {
      console.log(chalk.white('🔄 Part of Flows'));
      console.log(chalk.gray('─'.repeat(50)));
      for (const { flow, position, total } of ripple.partOfFlows) {
        console.log(`  ${chalk.cyan(flow)} (step ${position} of ${total})`);
      }
      console.log('');
    }

    // Test suggestion
    if (ripple.testCommand) {
      console.log(chalk.white('🧪 Test Suggestion'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`  ${chalk.gray(ripple.testCommand)}`);
      console.log('');
    }

    // Impact summary
    const totalImpact = ripple.requiredBy.length;
    const impactLevel = totalImpact === 0 ? 'Low' : totalImpact <= 3 ? 'Medium' : 'High';
    const impactColor = totalImpact === 0 ? chalk.green : totalImpact <= 3 ? chalk.yellow : chalk.red;
    
    console.log(chalk.white('📊 Impact Summary'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Direct dependents: ${chalk.cyan(totalImpact.toString())}`);
    console.log(`  Impact level:      ${impactColor(impactLevel)}`);
    
    if (totalImpact > 0) {
      console.log(chalk.gray('\n  ⚠️  Changes to this symbol may affect the above dependents.'));
    } else {
      console.log(chalk.gray('\n  ✓  This symbol has no direct dependents (safe to modify).'));
    }
    console.log('');

    return ripple;

  } catch (error) {
    spinner?.fail('Analysis failed');
    tracker.error('Ripple analysis failed', { symbol: symbolArg, error: (error as Error).message });
    console.log(chalk.red(`Error: ${(error as Error).message}\n`));
    process.exit(1);
  }
}
