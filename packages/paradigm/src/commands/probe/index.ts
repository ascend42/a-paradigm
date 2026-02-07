/**
 * paradigm index - Generate scan index for visual discovery
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { log } from '../../utils/logger.js';
import { aggregateFromDirectory } from '@a-company/premise-core';
import { 
  generateScanIndex, 
  serializeScanIndex,
  type ScanIndex 
} from '@a-company/probe-core';
import { parseParadigmConfig } from '../../core/paradigm-config.js';

interface IndexOptions {
  output?: string;
  watch?: boolean;
  quiet?: boolean;
}

export async function indexCommand(targetPath: string | undefined, options: IndexOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const projectName = path.basename(rootDir);
  const spinner = ora();

  // Determine output path
  // Handle both .paradigm as file (legacy) and .paradigm/ as directory
  const paradigmPath = path.join(rootDir, '.paradigm');
  const paradigmIsFile = fs.existsSync(paradigmPath) && fs.statSync(paradigmPath).isFile();
  
  let outputPath: string;
  if (options.output) {
    outputPath = path.resolve(options.output);
  } else if (paradigmIsFile) {
    // Legacy: .paradigm is a config file, put scan-index alongside it
    outputPath = path.join(rootDir, '.paradigm-scan-index.json');
  } else {
    // Modern: .paradigm is a directory
    outputPath = path.join(rootDir, '.paradigm', 'scan-index.json');
    // Ensure directory exists
    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    }
  }

  if (!options.quiet) {
    console.log(chalk.blue('\n🔭 Generating Paradigm Scan Index\n'));
  }

  // Load paradigm config if exists (for custom settings)
  let scanConfig: { visualTagMappings?: Record<string, string[]>; screens?: Record<string, unknown> } | undefined;
  
  // Try both .paradigm (file) and .paradigm/config.yaml (directory)
  const configPaths = [
    path.join(rootDir, '.paradigm'),
    path.join(rootDir, '.paradigm', 'config.yaml'),
  ];
  
  for (const configPath of configPaths) {
    if (fs.existsSync(configPath) && fs.statSync(configPath).isFile()) {
      try {
        const content = fs.readFileSync(configPath, 'utf8');
        const config = parseParadigmConfig(content);
        // Extract scan config if present
        scanConfig = (config as unknown as { scan?: typeof scanConfig }).scan;
        break;
      } catch {
        // Ignore config errors, use defaults
      }
    }
  }

  // Aggregate all symbols
  spinner.start('Aggregating symbols from purpose and gate files...');
  
  let aggregation;
  try {
    aggregation = await aggregateFromDirectory(rootDir);
  } catch (err) {
    spinner.fail(chalk.red('Failed to aggregate symbols'));
    console.error(chalk.gray((err as Error).message));
    process.exit(1);
  }

  spinner.succeed(`Found ${aggregation.symbols.length} symbols`);

  // Show breakdown
  if (!options.quiet) {
    const breakdown = {
      features: aggregation.symbols.filter(s => s.type === 'feature').length,
      components: aggregation.symbols.filter(s => s.type === 'component').length,
      flows: aggregation.symbols.filter(s => s.type === 'flow').length,
      gates: aggregation.symbols.filter(s => s.type === 'gate').length,
      signals: aggregation.symbols.filter(s => s.type === 'signal').length,
      state: aggregation.symbols.filter(s => s.type === 'state').length,
    };
    
    console.log(chalk.gray('  Breakdown:'));
    for (const [type, count] of Object.entries(breakdown)) {
      if (count > 0) {
        console.log(chalk.gray(`    ${type}: ${count}`));
      }
    }
    console.log();
  }

  // Generate scan index
  spinner.start('Generating scan index...');

  const index = generateScanIndex(
    {
      symbols: aggregation.symbols,
      purposeFiles: aggregation.purposeFiles,
      portalFiles: aggregation.portalFiles,
    },
    {
      projectName,
      visualTagMappings: scanConfig?.visualTagMappings as Record<string, string[]> | undefined,
      screenDefinitions: scanConfig?.screens as Record<string, { route?: string; components?: string[]; features?: string[] }> | undefined,
    }
  );

  // Write index
  try {
    fs.writeFileSync(outputPath, serializeScanIndex(index), 'utf8');
    spinner.succeed(chalk.green('Scan index generated'));
  } catch (err) {
    spinner.fail(chalk.red('Failed to write scan index'));
    console.error(chalk.gray((err as Error).message));
    process.exit(1);
  }

  // Summary
  if (!options.quiet) {
    console.log(chalk.gray(`\n  Output: ${outputPath}`));
    console.log(chalk.gray(`  Components: ${Object.keys(index.components).length}`));
    console.log(chalk.gray(`  Features: ${Object.keys(index.features).length}`));
    console.log(chalk.gray(`  Flows: ${Object.keys(index.flows).length}`));
    console.log(chalk.gray(`  State: ${Object.keys(index.state).length}`));
    console.log(chalk.gray(`  Gates: ${Object.keys(index.gates).length}`));
    console.log(chalk.gray(`  Signals: ${Object.keys(index.signals).length}`));
    console.log();
    console.log(chalk.blue('✨ Scan index ready for "paradigm scan" queries'));
    console.log(chalk.gray('   Attach an image and say "paradigm scan" to map UI to code\n'));
  }

  return index;
}

/**
 * Get scan index path for a project (handles both .paradigm file and directory cases)
 */
export function getScanIndexPath(rootDir: string): string {
  const paradigmPath = path.join(rootDir, '.paradigm');
  const paradigmIsFile = fs.existsSync(paradigmPath) && fs.statSync(paradigmPath).isFile();
  
  return paradigmIsFile
    ? path.join(rootDir, '.paradigm-scan-index.json')
    : path.join(rootDir, '.paradigm', 'scan-index.json');
}

/**
 * Check if scan index exists
 */
export function scanIndexExists(rootDir: string): boolean {
  // Check both possible locations
  return (
    fs.existsSync(path.join(rootDir, '.paradigm', 'scan-index.json')) ||
    fs.existsSync(path.join(rootDir, '.paradigm-scan-index.json'))
  );
}

/**
 * Get scan index age in milliseconds
 */
export function getScanIndexAge(rootDir: string): number | null {
  // Try both possible locations
  const paths = [
    path.join(rootDir, '.paradigm', 'scan-index.json'),
    path.join(rootDir, '.paradigm-scan-index.json'),
  ];
  
  for (const indexPath of paths) {
    if (fs.existsSync(indexPath)) {
      try {
        const content = fs.readFileSync(indexPath, 'utf8');
        const index = JSON.parse(content) as ScanIndex;
        const generatedAt = new Date(index.$meta.generatedAt).getTime();
        return Date.now() - generatedAt;
      } catch {
        continue;
      }
    }
  }
  
  return null;
}
