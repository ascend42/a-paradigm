/**
 * paradigm portal check — Portal gate implementation compliance checker
 *
 * Wraps the existing checkPortalCompliance() to provide CLI access.
 * Validates that gates declared in portal.yaml are used in code and vice versa.
 */

import chalk from 'chalk';
import {
  checkPortalCompliance,
  formatComplianceReport,
} from '../core/portal-compliance.js';

export async function portalCheckCommand(options: {
  json?: boolean;
}): Promise<void> {
  const rootDir = process.cwd();
  const report = await checkPortalCompliance(rootDir);

  if (options.json) {
    const realUndeclared = report.usedButUndeclared.filter(g => g !== '__portal_unparseable__');
    console.log(JSON.stringify({
      status: report.status,
      declaredButUnusedCount: report.declaredButUnused.length,
      usedButUndeclaredCount: realUndeclared.length,
      properlyDeclaredCount: report.properlyDeclared.length,
      declaredButUnused: report.declaredButUnused,
      usedButUndeclared: realUndeclared,
      properlyDeclared: report.properlyDeclared,
      ...(report.portalError ? { portalError: report.portalError } : {}),
    }));
  } else {
    const formatted = formatComplianceReport(report);
    // Colorize based on status
    if (report.status === 'compliant') {
      console.log(chalk.green(`\n${formatted}\n`));
    } else if (report.status === 'warnings') {
      console.log(chalk.yellow(`\n${formatted}\n`));
    } else {
      console.log(chalk.red(`\n${formatted}\n`));
    }
  }
}
