/**
 * paradigm cost - Token cost analysis for AI context
 * 
 * Analyzes token usage in .purpose files, portal.yaml, and scan-index.json
 * to help optimize AI context efficiency.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { findPurposeFiles } from '@a-company/purpose-core';
import { findGateFiles } from '@a-company/portal-core';

interface CostOptions {
  json?: boolean;
  detailed?: boolean;
}

interface FileTokens {
  path: string;
  relativePath: string;
  tokens: number;
  bytes: number;
}

interface CostAnalysis {
  static: {
    purposeFiles: FileTokens[];
    portalFiles: FileTokens[];
    scanIndex: FileTokens | null;
    cursorrules: FileTokens | null;
    total: number;
  };
  dynamic: {
    avgQueryTokens: number;
    typicalConversation: number;
  };
  savings: {
    percentage: number;
    description: string;
  };
  recommendations: string[];
}

/**
 * Estimate token count from text
 * Approximation: ~4 characters = 1 token for English text
 * This is a rough estimate; actual tokenization varies by model
 */
function estimateTokens(text: string): number {
  // More accurate estimation considering:
  // - Whitespace and newlines count
  // - YAML/JSON structure adds overhead
  // - Symbol characters
  const chars = text.length;
  return Math.ceil(chars / 3.5); // Slightly more conservative for structured content
}

/**
 * Get token count for a file
 */
function getFileTokens(filePath: string, rootDir: string): FileTokens | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const bytes = Buffer.byteLength(content, 'utf8');
    const tokens = estimateTokens(content);
    const relativePath = path.relative(rootDir, filePath);
    
    return {
      path: filePath,
      relativePath,
      tokens,
      bytes,
    };
  } catch {
    return null;
  }
}

/**
 * Format tokens for display
 */
function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString();
  return `${(tokens / 1000).toFixed(1)}k`;
}

/**
 * Main cost analysis command
 */
export async function costCommand(targetPath: string | undefined, options: CostOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const spinner = ora();
  
  if (!options.json) {
    console.log(chalk.blue('\n💰 Paradigm Cost Analysis\n'));
  }
  
  // Collect all context files
  spinner.start('Analyzing context files...');
  
  // Purpose files
  const purposeFilePaths = await findPurposeFiles(rootDir);
  const purposeFiles: FileTokens[] = [];
  for (const filePath of purposeFilePaths) {
    const tokens = getFileTokens(filePath, rootDir);
    if (tokens) purposeFiles.push(tokens);
  }
  
  // Portal/Gate files
  const portalFilePaths = await findGateFiles(rootDir);
  const portalFiles: FileTokens[] = [];
  for (const filePath of portalFilePaths) {
    const tokens = getFileTokens(filePath, rootDir);
    if (tokens) portalFiles.push(tokens);
  }
  
  // Scan index
  const scanIndexPath = path.join(rootDir, '.paradigm', 'scan-index.json');
  const scanIndex = getFileTokens(scanIndexPath, rootDir);
  
  // Cursorrules (if exists)
  const cursorrrulesPath = path.join(rootDir, '.cursorrules');
  const cursorrulesNew = path.join(rootDir, '.cursor', 'rules', 'paradigm.mdc');
  let cursorrules = getFileTokens(cursorrrulesPath, rootDir);
  if (!cursorrules) {
    cursorrules = getFileTokens(cursorrulesNew, rootDir);
  }
  
  spinner.stop();
  
  // Calculate totals
  const purposeTotal = purposeFiles.reduce((sum, f) => sum + f.tokens, 0);
  const portalTotal = portalFiles.reduce((sum, f) => sum + f.tokens, 0);
  const scanTotal = scanIndex?.tokens || 0;
  const cursorrulesTotal = cursorrules?.tokens || 0;
  
  const staticTotal = purposeTotal + portalTotal + scanTotal;
  const staticWithRules = staticTotal + cursorrulesTotal;
  
  // Estimate dynamic MCP usage
  // Typical MCP query returns ~100-300 tokens of relevant context
  const avgQueryTokens = 150;
  // Typical conversation might need 5-10 context queries
  const typicalConversation = avgQueryTokens * 7;
  
  // Calculate savings
  const savingsPercent = staticWithRules > 0 
    ? Math.round((1 - typicalConversation / staticWithRules) * 100)
    : 0;
  
  // Generate recommendations
  const recommendations: string[] = [];
  
  // Check for large files
  const largeFiles = purposeFiles.filter(f => f.tokens > 500);
  if (largeFiles.length > 0) {
    recommendations.push(
      `${largeFiles.length} .purpose file(s) exceed 500 tokens. Consider splitting large features.`
    );
  }
  
  // Check if using MCP
  const mcpConfigPath = path.join(rootDir, '.cursor', 'mcp.json');
  const hasMcp = fs.existsSync(mcpConfigPath);
  if (!hasMcp) {
    recommendations.push(
      'MCP not configured. Run `paradigm mcp setup` to enable dynamic context (80%+ savings).'
    );
  }
  
  // Check for scan index
  if (!scanIndex) {
    recommendations.push(
      'No scan-index.json found. Run `paradigm index` for visual discovery support.'
    );
  }
  
  // Check purpose file count
  if (purposeFiles.length < 3) {
    recommendations.push(
      'Few .purpose files found. Add more context for better AI understanding.'
    );
  }
  
  // Build analysis object
  const analysis: CostAnalysis = {
    static: {
      purposeFiles,
      portalFiles,
      scanIndex,
      cursorrules,
      total: staticWithRules,
    },
    dynamic: {
      avgQueryTokens,
      typicalConversation,
    },
    savings: {
      percentage: Math.max(0, savingsPercent),
      description: savingsPercent > 0 
        ? `${savingsPercent}% fewer tokens with MCP vs static context`
        : 'MCP provides on-demand context loading',
    },
    recommendations,
  };
  
  // JSON output
  if (options.json) {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }
  
  // Display results
  console.log(chalk.white('Context Token Analysis'));
  console.log(chalk.gray('─'.repeat(50)));
  
  // Static context breakdown
  console.log(chalk.cyan('\nStatic Context (loaded every conversation):'));
  console.log(`  .purpose files (${purposeFiles.length}):`.padEnd(35) + chalk.yellow(formatTokens(purposeTotal) + ' tokens'));
  console.log(`  portal.yaml (${portalFiles.length}):`.padEnd(35) + chalk.yellow(formatTokens(portalTotal) + ' tokens'));
  if (scanIndex) {
    console.log('  scan-index.json:'.padEnd(35) + chalk.yellow(formatTokens(scanTotal) + ' tokens'));
  }
  if (cursorrules) {
    console.log('  .cursorrules:'.padEnd(35) + chalk.yellow(formatTokens(cursorrulesTotal) + ' tokens'));
  }
  console.log(chalk.gray('─'.repeat(50)));
  console.log('  Static Total:'.padEnd(35) + chalk.yellow.bold(formatTokens(staticWithRules) + ' tokens'));
  
  // Dynamic context
  console.log(chalk.cyan('\nDynamic Context (MCP on-demand):'));
  console.log('  Avg query response:'.padEnd(35) + chalk.green(formatTokens(avgQueryTokens) + ' tokens'));
  console.log('  Typical conversation (~7 queries):'.padEnd(35) + chalk.green(formatTokens(typicalConversation) + ' tokens'));
  
  // Savings
  console.log(chalk.cyan('\nPotential Savings:'));
  if (savingsPercent > 0) {
    const savingsColor = savingsPercent > 70 ? chalk.green : savingsPercent > 40 ? chalk.yellow : chalk.white;
    console.log(`  MCP vs Static:`.padEnd(35) + savingsColor.bold(`${savingsPercent}% reduction`));
    
    // Cost estimate (assuming $0.01 per 1k tokens for input)
    const staticCost = (staticWithRules / 1000) * 0.01;
    const dynamicCost = (typicalConversation / 1000) * 0.01;
    const savedCost = staticCost - dynamicCost;
    if (savedCost > 0.001) {
      console.log(`  Est. savings per conversation:`.padEnd(35) + chalk.green(`~$${savedCost.toFixed(4)}`));
    }
  }
  
  // Top consumers (if detailed)
  if (options.detailed && purposeFiles.length > 0) {
    console.log(chalk.cyan('\nTop Token Consumers:'));
    const sorted = [...purposeFiles].sort((a, b) => b.tokens - a.tokens).slice(0, 5);
    for (const file of sorted) {
      const percentage = Math.round((file.tokens / staticTotal) * 100);
      console.log(`  ${file.relativePath}`.padEnd(40) + chalk.gray(`${formatTokens(file.tokens)} (${percentage}%)`));
    }
  }
  
  // Recommendations
  if (recommendations.length > 0) {
    console.log(chalk.cyan('\nRecommendations:'));
    for (const rec of recommendations) {
      console.log(chalk.yellow(`  • ${rec}`));
    }
  }
  
  // MCP status
  console.log(chalk.cyan('\nMCP Status:'));
  if (hasMcp) {
    console.log(chalk.green('  ✓ MCP configured - using dynamic context loading'));
  } else {
    console.log(chalk.yellow('  ○ MCP not configured'));
    console.log(chalk.gray('    Run `paradigm mcp setup` to enable token-efficient queries'));
  }
  
  console.log('');
}
