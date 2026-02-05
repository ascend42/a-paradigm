#!/usr/bin/env npx tsx
/**
 * Test: Solo vs Faceted Orchestration Comparison
 *
 * This script tests the cost and time differences between:
 * - Solo mode: Single Claude agent (Opus) handles everything
 * - Faceted mode: Multiple specialized agents (Opus/Sonnet/Haiku mix)
 *
 * Usage:
 *   npx tsx scripts/test-orchestration-comparison.ts
 *   npx tsx scripts/test-orchestration-comparison.ts --task "Build @feature"
 *   npx tsx scripts/test-orchestration-comparison.ts --dry-run
 */

import * as path from 'path';
import { Orchestrator } from '../packages/paradigm/src/core/orchestrator.js';
import {
  formatCost,
  formatTokens,
  MODEL_PRICING,
  AgentModel,
} from '../packages/paradigm/src/core/agent-provider.js';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_TASK = 'Build a simple @todo-list feature with add, complete, and delete operations. Include tests.';

interface TestConfig {
  task: string;
  dryRun: boolean;
  rootDir: string;
}

// ============================================================================
// Cost Estimation (for dry-run mode)
// ============================================================================

interface CostEstimate {
  mode: 'solo' | 'faceted';
  agents: Array<{
    name: string;
    model: AgentModel;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    estimatedCost: number;
  }>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
}

function estimateSoloCost(task: string): CostEstimate {
  // Solo mode uses Opus for everything
  // Estimate based on task complexity
  const isComplex = task.includes('test') || task.includes('security') || task.length > 100;
  const inputTokens = isComplex ? 15000 : 8000;
  const outputTokens = isComplex ? 50000 : 25000;

  const inputCost = (inputTokens / 1_000_000) * MODEL_PRICING.opus.input;
  const outputCost = (outputTokens / 1_000_000) * MODEL_PRICING.opus.output;

  return {
    mode: 'solo',
    agents: [{
      name: 'solo (opus)',
      model: 'opus',
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: outputTokens,
      estimatedCost: inputCost + outputCost,
    }],
    totalInputTokens: inputTokens,
    totalOutputTokens: outputTokens,
    totalCost: inputCost + outputCost,
  };
}

function estimateFacetedCost(task: string): CostEstimate {
  const taskLower = task.toLowerCase();
  const agents: CostEstimate['agents'] = [];

  // Architect (Opus) - always included for planning
  const architectInput = 5000;
  const architectOutput = 8000;
  agents.push({
    name: 'architect',
    model: 'opus',
    estimatedInputTokens: architectInput,
    estimatedOutputTokens: architectOutput,
    estimatedCost:
      (architectInput / 1_000_000) * MODEL_PRICING.opus.input +
      (architectOutput / 1_000_000) * MODEL_PRICING.opus.output,
  });

  // Builder (Haiku) - does the heavy lifting cheaply
  const builderInput = 8000;
  const builderOutput = 30000;
  agents.push({
    name: 'builder',
    model: 'haiku',
    estimatedInputTokens: builderInput,
    estimatedOutputTokens: builderOutput,
    estimatedCost:
      (builderInput / 1_000_000) * MODEL_PRICING.haiku.input +
      (builderOutput / 1_000_000) * MODEL_PRICING.haiku.output,
  });

  // Tester (Haiku) - if tests mentioned
  if (taskLower.includes('test')) {
    const testerInput = 5000;
    const testerOutput = 15000;
    agents.push({
      name: 'tester',
      model: 'haiku',
      estimatedInputTokens: testerInput,
      estimatedOutputTokens: testerOutput,
      estimatedCost:
        (testerInput / 1_000_000) * MODEL_PRICING.haiku.input +
        (testerOutput / 1_000_000) * MODEL_PRICING.haiku.output,
    });
  }

  // Security (Opus) - if auth/security mentioned
  if (taskLower.includes('auth') || taskLower.includes('security') || taskLower.includes('gate')) {
    const securityInput = 3000;
    const securityOutput = 5000;
    agents.push({
      name: 'security',
      model: 'opus',
      estimatedInputTokens: securityInput,
      estimatedOutputTokens: securityOutput,
      estimatedCost:
        (securityInput / 1_000_000) * MODEL_PRICING.opus.input +
        (securityOutput / 1_000_000) * MODEL_PRICING.opus.output,
    });
  }

  const totalInput = agents.reduce((sum, a) => sum + a.estimatedInputTokens, 0);
  const totalOutput = agents.reduce((sum, a) => sum + a.estimatedOutputTokens, 0);
  const totalCost = agents.reduce((sum, a) => sum + a.estimatedCost, 0);

  return {
    mode: 'faceted',
    agents,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCost,
  };
}

// ============================================================================
// Display Functions
// ============================================================================

function displayEstimates(solo: CostEstimate, faceted: CostEstimate): void {
  console.log('\n' + '='.repeat(70));
  console.log('  COST ESTIMATION: Solo vs Faceted Orchestration');
  console.log('='.repeat(70) + '\n');

  console.log(`Task: "${solo.mode === 'solo' ? DEFAULT_TASK.slice(0, 60) : DEFAULT_TASK.slice(0, 60)}..."\n`);

  // Model pricing reference
  console.log('Model Pricing (per 1M tokens):');
  console.log('  Opus:   Input $15.00 / Output $75.00');
  console.log('  Sonnet: Input $3.00  / Output $15.00');
  console.log('  Haiku:  Input $0.25  / Output $1.25');
  console.log();

  // Solo estimate
  console.log('-'.repeat(70));
  console.log('SOLO MODE (Single Opus Agent)');
  console.log('-'.repeat(70));
  for (const agent of solo.agents) {
    console.log(`  ${agent.name}:`);
    console.log(`    Input:  ${formatTokens(agent.estimatedInputTokens).padStart(8)} tokens`);
    console.log(`    Output: ${formatTokens(agent.estimatedOutputTokens).padStart(8)} tokens`);
    console.log(`    Cost:   ${formatCost(agent.estimatedCost)}`);
  }
  console.log();
  console.log(`  TOTAL: ${formatTokens(solo.totalInputTokens + solo.totalOutputTokens)} tokens = ${formatCost(solo.totalCost)}`);
  console.log();

  // Faceted estimate
  console.log('-'.repeat(70));
  console.log('FACETED MODE (Specialized Agents)');
  console.log('-'.repeat(70));
  for (const agent of faceted.agents) {
    console.log(`  ${agent.name} (${agent.model}):`);
    console.log(`    Input:  ${formatTokens(agent.estimatedInputTokens).padStart(8)} tokens`);
    console.log(`    Output: ${formatTokens(agent.estimatedOutputTokens).padStart(8)} tokens`);
    console.log(`    Cost:   ${formatCost(agent.estimatedCost)}`);
  }
  console.log();
  console.log(`  TOTAL: ${formatTokens(faceted.totalInputTokens + faceted.totalOutputTokens)} tokens = ${formatCost(faceted.totalCost)}`);
  console.log();

  // Comparison
  console.log('='.repeat(70));
  console.log('COMPARISON');
  console.log('='.repeat(70));
  console.log();

  const tokenDiff = solo.totalInputTokens + solo.totalOutputTokens -
                    faceted.totalInputTokens - faceted.totalOutputTokens;
  const costDiff = solo.totalCost - faceted.totalCost;
  const savingsPercent = ((costDiff / solo.totalCost) * 100).toFixed(1);

  console.log('  ┌────────────────┬──────────────┬──────────────┐');
  console.log('  │                │     Solo     │   Faceted    │');
  console.log('  ├────────────────┼──────────────┼──────────────┤');
  console.log(`  │ Total Tokens   │ ${formatTokens(solo.totalInputTokens + solo.totalOutputTokens).padStart(12)} │ ${formatTokens(faceted.totalInputTokens + faceted.totalOutputTokens).padStart(12)} │`);
  console.log(`  │ Estimated Cost │ ${formatCost(solo.totalCost).padStart(12)} │ ${formatCost(faceted.totalCost).padStart(12)} │`);
  console.log(`  │ Agents Used    │ ${String(solo.agents.length).padStart(12)} │ ${String(faceted.agents.length).padStart(12)} │`);
  console.log('  └────────────────┴──────────────┴──────────────┘');
  console.log();

  if (costDiff > 0) {
    console.log(`  💰 FACETED SAVES: ${formatCost(costDiff)} (${savingsPercent}% reduction)`);
    console.log();
    console.log('  Why faceted is cheaper:');
    console.log('    • Builder uses Haiku ($1.25/1M output) instead of Opus ($75/1M)');
    console.log('    • Tester uses Haiku for validation');
    console.log('    • Only Architect/Security need expensive Opus reasoning');
  } else {
    console.log(`  ⚖️ SIMILAR COST (difference: ${formatCost(Math.abs(costDiff))})`);
  }

  console.log('\n' + '='.repeat(70) + '\n');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  // Parse args
  const args = process.argv.slice(2);
  const config: TestConfig = {
    task: DEFAULT_TASK,
    dryRun: args.includes('--dry-run'),
    rootDir: process.cwd(),
  };

  // Check for custom task
  const taskIndex = args.indexOf('--task');
  if (taskIndex !== -1 && args[taskIndex + 1]) {
    config.task = args[taskIndex + 1];
  }

  console.log('\n🔬 Paradigm Orchestration Comparison Test\n');

  if (config.dryRun) {
    // Dry run - just show estimates
    console.log('Mode: DRY RUN (showing cost estimates only)\n');

    const soloEstimate = estimateSoloCost(config.task);
    const facetedEstimate = estimateFacetedCost(config.task);

    displayEstimates(soloEstimate, facetedEstimate);
    return;
  }

  // Live run - actually execute both modes
  console.log('Mode: LIVE EXECUTION (running both solo and faceted)\n');
  console.log('⚠️  This will spawn real agents and incur API costs.\n');

  const orchestrator = new Orchestrator(config.rootDir);

  try {
    await orchestrator.initialize();
  } catch (error) {
    console.error('Failed to initialize orchestrator:', error);
    console.log('\nTip: Make sure you have a provider available:');
    console.log('  - ANTHROPIC_API_KEY for claude provider');
    console.log('  - Running inside Claude Code for claude-code provider');
    console.log('  - Claude CLI installed for claude-cli provider');
    return;
  }

  console.log('Running comparison...\n');

  const comparison = await orchestrator.compare(config.task, {
    onAgentStart: (agent, subtask) => {
      console.log(`  ▶ ${agent}: ${subtask.slice(0, 50)}...`);
    },
    onAgentComplete: (agent, result) => {
      const status = result.success ? '✓' : '✗';
      const tokens = result.relay ? formatTokens(result.relay.metrics.tokens_used.total) : '0';
      console.log(`  ${status} ${agent} completed (${tokens})`);
    },
  });

  // Display results
  console.log('\n' + '='.repeat(70));
  console.log('  LIVE COMPARISON RESULTS');
  console.log('='.repeat(70) + '\n');

  console.log('  ┌────────────────┬──────────────┬──────────────┐');
  console.log('  │                │     Solo     │   Faceted    │');
  console.log('  ├────────────────┼──────────────┼──────────────┤');
  console.log(`  │ Status         │ ${(comparison.solo.success ? '✓ Success' : '✗ Failed').padStart(12)} │ ${(comparison.faceted.success ? '✓ Success' : '✗ Failed').padStart(12)} │`);
  console.log(`  │ Total Tokens   │ ${formatTokens(comparison.solo.totalTokens.total).padStart(12)} │ ${formatTokens(comparison.faceted.totalTokens.total).padStart(12)} │`);
  console.log(`  │ Total Cost     │ ${formatCost(comparison.solo.totalCost).padStart(12)} │ ${formatCost(comparison.faceted.totalCost).padStart(12)} │`);
  console.log(`  │ Duration       │ ${((comparison.solo.duration_ms / 1000).toFixed(1) + 's').padStart(12)} │ ${((comparison.faceted.duration_ms / 1000).toFixed(1) + 's').padStart(12)} │`);
  console.log(`  │ Agents         │ ${String(comparison.solo.agentsSpawned).padStart(12)} │ ${String(comparison.faceted.agentsSpawned).padStart(12)} │`);
  console.log('  └────────────────┴──────────────┴──────────────┘');
  console.log();

  const { winner, costDiff, tokensSaved } = comparison.comparison;
  if (winner === 'faceted') {
    console.log(`  🏆 WINNER: Faceted (saved ${formatCost(costDiff)}, ${formatTokens(Math.abs(tokensSaved))} tokens)`);
  } else if (winner === 'solo') {
    console.log(`  🏆 WINNER: Solo (saved ${formatCost(Math.abs(costDiff))}, ${formatTokens(Math.abs(tokensSaved))} tokens)`);
  } else {
    console.log('  ⚖️  TIE: Both approaches performed similarly');
  }

  console.log('\n' + '='.repeat(70) + '\n');
}

main().catch(console.error);
