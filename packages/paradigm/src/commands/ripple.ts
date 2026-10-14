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
  resolveSymbol,
  sourcesOf,
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
 * The file to anchor test suggestions on. A gate's canonical entry lives in
 * portal.yaml, but the code it guards is next to the .purpose that also
 * declares (or references) it — prefer that .purpose source when one exists.
 */
export function testAnchorPath(entry: SymbolEntry): string {
  if (entry.source === 'purpose') return entry.filePath;
  const purpose = sourcesOf(entry).find((s) => s.source === 'purpose');
  return purpose?.filePath ?? entry.filePath;
}

/**
 * Suggest test path based on symbol path
 */
export function suggestTestPath(symbolPath: string): { testPath?: string; testCommand?: string } {
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
 * Analyze ripple effects for a user-typed symbol. Resolution is fuzzy (case /
 * bare-name tolerant); an ambiguous name yields `candidates`, not a result.
 */
export function analyzeRipple(
  symbol: string,
  index: SymbolIndex,
): { ripple?: RippleResult; candidates: string[] } {
  const { entry, candidates } = resolveSymbol(index, symbol);
  if (!entry) return { candidates: candidates.map((c) => c.symbol) };
  // Traverse on the canonical symbol — "Foo" / "foo" resolve to "#foo".
  const canonical = entry.symbol;
  
  // Get direct relationships
  const referencesTo = getReferencesTo(index, canonical);   // What references this
  const referencesFrom = getReferencesFrom(index, canonical); // What this references
  
  const toCategorized = categorize(referencesTo);
  const fromCategorized = categorize(referencesFrom);
  
  // Find flow memberships
  const partOfFlows = findFlowMembership(canonical, index);
  
  // Suggest test path
  const { testPath, testCommand } = suggestTestPath(testAnchorPath(entry));
  
  const ripple: RippleResult = {
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
  return { ripple, candidates: [entry.symbol] };
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
    const { ripple, candidates } = analyzeRipple(symbolArg, index);

    // Ambiguous name: list the candidates — it IS indexed, just not uniquely.
    if (!ripple && candidates.length > 1) {
      spinner?.fail(`Ambiguous symbol: ${symbolArg}`);
      tracker.error('Ambiguous symbol', { symbol: symbolArg, candidates: candidates.length });
      if (options.json) {
        console.log(JSON.stringify({ error: 'Ambiguous symbol', symbol: symbolArg, candidates }, null, 2));
      } else {
        console.log(chalk.yellow('\n  Did you mean one of:'));
        for (const c of candidates) console.log(chalk.gray(`    ${c}`));
        console.log('');
      }
      process.exit(1);
    }

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
      symbol: ripple.symbol, 
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
