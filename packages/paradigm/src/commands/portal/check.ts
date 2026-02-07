/**
 * paradigm portal check - Check portal.yaml compliance
 *
 * Validates that gates defined in portal.yaml are actually used in the codebase
 * and that gate references in code are properly declared.
 */

import chalk from 'chalk';
import { log } from '../../utils/logger.js';
import {
  checkPortalCompliance,
  formatComplianceReport,
  loadPortalConfig,
} from '../../core/portal-compliance.js';

export interface PortalCheckOptions {
  /** Show detailed reference information */
  verbose?: boolean;
  /** Output as JSON */
  json?: boolean;
  /** Only show summary */
  quiet?: boolean;
}

export async function portalCheckCommand(options: PortalCheckOptions = {}): Promise<boolean> {
  const cwd = process.cwd();
  const tracker = log.command('portal-check').start('Checking portal compliance');

  try {
    // Check for portal.yaml first
    const config = loadPortalConfig(cwd);

    if (!options.json && !options.quiet) {
      console.log(chalk.blue('\n🔐 Portal Compliance Check\n'));

      if (!config) {
        console.log(chalk.gray('No portal.yaml found in project root.'));
        console.log(chalk.gray('Checking for gate references in code...\n'));
      }
    }

    // Run compliance check
    const report = await checkPortalCompliance(cwd);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      tracker.success('Compliance check complete', { status: report.status });
      return report.status === 'compliant';
    }

    // Quiet mode - just status
    if (options.quiet) {
      const statusSymbol = report.status === 'compliant' ? '✓' :
        report.status === 'warnings' ? '⚠' : '✗';
      console.log(`${statusSymbol} Portal: ${report.status}`);
      tracker.success('Compliance check complete', { status: report.status });
      return report.status === 'compliant';
    }

    // Standard output
    const formatted = formatComplianceReport(report);

    // Colorize output
    const lines = formatted.split('\n').map(line => {
      if (line.includes('✓')) return chalk.green(line);
      if (line.includes('⚠')) return chalk.yellow(line);
      if (line.includes('✗')) return chalk.red(line);
      if (line.startsWith('  at ')) return chalk.gray(line);
      if (line.startsWith('Portal Compliance:')) {
        if (report.status === 'compliant') return chalk.green(line);
        if (report.status === 'warnings') return chalk.yellow(line);
        return chalk.red(line);
      }
      return line;
    });

    console.log(lines.join('\n'));

    // Verbose mode - show all references
    if (options.verbose && report.references.length > 0) {
      console.log(chalk.blue('\nAll Gate References:'));
      console.log('');

      const byFile = new Map<string, typeof report.references>();
      for (const ref of report.references) {
        const existing = byFile.get(ref.file) || [];
        existing.push(ref);
        byFile.set(ref.file, existing);
      }

      for (const [file, refs] of byFile) {
        console.log(chalk.white(`  ${file}`));
        for (const ref of refs.sort((a, b) => a.line - b.line)) {
          const icon = report.properlyDeclared.includes(ref.gate) ? chalk.green('✓') :
            report.usedButUndeclared.includes(ref.gate) ? chalk.red('✗') : chalk.gray('○');
          console.log(`    ${icon} Line ${ref.line}: ^${ref.gate} (${ref.matchType})`);
        }
        console.log('');
      }
    }

    console.log('');

    // Return success status
    tracker.success('Compliance check complete', {
      status: report.status,
      declared: report.properlyDeclared.length,
      unused: report.declaredButUnused.length,
      undeclared: report.usedButUndeclared.length,
    });

    return report.status === 'compliant';
  } catch (error) {
    tracker.error('Compliance check failed', { error: String(error) });
    console.error(chalk.red(`\nError: ${(error as Error).message}\n`));
    return false;
  }
}

/**
 * List all declared gates
 */
export async function portalListCommand(options: { json?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();
  const config = loadPortalConfig(cwd);

  if (!config) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'No portal.yaml found', gates: [] }, null, 2));
    } else {
      console.log(chalk.yellow('\nNo portal.yaml found in project root.\n'));
      console.log(chalk.gray('Run `paradigm portal init` to create one.\n'));
    }
    return;
  }

  // Extract gates with their routes
  const gates = new Map<string, { routes: string[]; description?: string }>();

  if (config.gates) {
    for (const [key, value] of Object.entries(config.gates)) {
      const gateName = key.startsWith('^') ? key.slice(1) : key;
      const description = typeof value === 'string' ? value : value?.description;
      gates.set(gateName, { routes: [], description });
    }
  }

  if (config.routes) {
    for (const [route, routeConfig] of Object.entries(config.routes)) {
      const gateList = Array.isArray(routeConfig) ? routeConfig : routeConfig.gates || [];
      for (const gate of gateList) {
        const gateName = gate.startsWith('^') ? gate.slice(1) : gate;
        if (!gates.has(gateName)) {
          gates.set(gateName, { routes: [] });
        }
        gates.get(gateName)!.routes.push(route);
      }
    }
  }

  if (options.json) {
    const result = Array.from(gates.entries()).map(([name, data]) => ({
      name,
      symbol: `^${name}`,
      ...data,
    }));
    console.log(JSON.stringify({ gates: result }, null, 2));
    return;
  }

  console.log(chalk.blue('\n🔐 Declared Gates\n'));

  if (gates.size === 0) {
    console.log(chalk.gray('No gates declared.\n'));
    return;
  }

  for (const [name, data] of gates) {
    console.log(chalk.white(`  ^${name}`));
    if (data.description) {
      console.log(chalk.gray(`    ${data.description}`));
    }
    if (data.routes.length > 0) {
      console.log(chalk.gray(`    Routes: ${data.routes.slice(0, 3).join(', ')}${data.routes.length > 3 ? '...' : ''}`));
    }
    console.log('');
  }

  console.log(chalk.gray(`Total: ${gates.size} gates\n`));
}
