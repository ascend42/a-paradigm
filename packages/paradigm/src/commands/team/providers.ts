/**
 * paradigm team providers - Show and configure agent providers
 *
 * Usage:
 *   paradigm team providers           # List all providers and their status
 *   paradigm team providers --set X   # Set preferred provider
 */

import * as path from 'path';
import chalk from 'chalk';
import {
  getAvailableProviders,
  getBestProvider,
  getConfiguredProvider,
  setConfiguredProvider,
} from '../../core/provider-registry.js';

// ============================================================================
// Types
// ============================================================================

export interface ProvidersCommandOptions {
  set?: string;
  json?: boolean;
}

// ============================================================================
// Command
// ============================================================================

export async function teamProvidersCommand(
  targetPath: string | undefined,
  options: ProvidersCommandOptions
): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();

  // Handle --set option
  if (options.set) {
    try {
      await setConfiguredProvider(options.set, rootDir);
      if (options.json) {
        console.log(JSON.stringify({ success: true, provider: options.set }));
      } else {
        console.log(chalk.green(`\n✓ Provider set to: ${options.set}\n`));
        if (options.set === 'auto') {
          console.log(chalk.gray('Will auto-detect best available provider.\n'));
        } else {
          console.log(chalk.gray(`Will use ${options.set} if available, otherwise fall back.\n`));
        }
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      } else {
        console.log(chalk.red(`\nError: ${error instanceof Error ? error.message : error}\n`));
      }
    }
    return;
  }

  const providers = await getAvailableProviders(rootDir);
  const configured = getConfiguredProvider(rootDir);
  const best = await getBestProvider(rootDir);

  if (options.json) {
    console.log(JSON.stringify({
      configured,
      selected: best.name,
      reason: best.reason,
      providers,
    }, null, 2));
    return;
  }

  console.log();
  console.log(chalk.blue('━'.repeat(60)));
  console.log(chalk.blue('  Agent Providers'));
  console.log(chalk.blue('━'.repeat(60)));
  console.log();

  // Show configuration
  console.log(chalk.cyan('  Configuration:'));
  if (configured === 'auto') {
    console.log(chalk.gray('    agent-provider: auto (auto-detect)'));
  } else {
    console.log(chalk.white(`    agent-provider: ${configured}`));
  }
  console.log(chalk.gray('    Set via: PARADIGM_AGENT_PROVIDER env or .paradigm/config.yaml'));
  console.log();

  // Show providers
  console.log(chalk.cyan('  Available Providers:'));
  console.log();

  for (const provider of providers) {
    const status = provider.available
      ? chalk.green('✓')
      : chalk.gray('✗');

    const selected = provider.name === best.name ? chalk.yellow(' ← active') : '';
    const isConfigured = provider.name === configured ? chalk.cyan(' (configured)') : '';

    console.log(`  ${status}  ${chalk.white(provider.name.padEnd(12))}${selected}${isConfigured}`);
    console.log(chalk.gray(`      ${provider.reason}`));

    // Features
    const features = [];
    if (provider.features.parallel) features.push('parallel');
    if (provider.features.mcp) features.push('MCP');
    features.push(
      provider.features.billing === 'api' ? 'API billing' :
      provider.features.billing === 'subscription' ? 'Max/subscription' : 'free'
    );
    console.log(chalk.gray(`      ${features.join(' · ')}`));
    console.log();
  }

  // Show active selection
  console.log(chalk.gray('─'.repeat(60)));
  console.log();
  console.log(chalk.cyan('  Active Provider:'));
  console.log(chalk.white(`    ${best.name}`));
  console.log(chalk.gray(`    ${best.reason}`));
  console.log();

  // Tips
  console.log(chalk.gray('─'.repeat(60)));
  console.log();
  console.log(chalk.cyan('  Set Provider Preference:'));
  console.log(chalk.gray('    paradigm team providers --set auto      # Auto-detect (default)'));
  console.log(chalk.gray('    paradigm team providers --set claude    # Always use API'));
  console.log(chalk.gray('    paradigm team providers --set claude-code  # Use Max subscription'));
  console.log(chalk.gray('    paradigm team providers --set manual    # Manual handoffs only'));
  console.log();
  console.log(chalk.gray('  Or set environment variable:'));
  console.log(chalk.gray('    export PARADIGM_AGENT_PROVIDER=claude-code'));
  console.log();
}
