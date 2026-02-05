/**
 * paradigm team export - Export orchestration data
 *
 * Usage:
 *   paradigm team export --format json > orchestrations.json
 *   paradigm team export --format csv > orchestrations.csv
 */

import * as path from 'path';
import chalk from 'chalk';
import { AuditLogger } from '../../core/audit-logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ExportCommandOptions {
  format?: 'json' | 'csv';
  from?: string;
  to?: string;
  output?: string;
}

// ============================================================================
// Command
// ============================================================================

export async function teamExportCommand(
  targetPath: string | undefined,
  options: ExportCommandOptions
): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();

  // Parse date range
  let from: Date | undefined;
  let to: Date | undefined;

  if (options.from) {
    from = new Date(options.from);
  }

  if (options.to) {
    to = new Date(options.to);
  }

  // Load audit logs
  const auditLogger = new AuditLogger(rootDir);

  // Generate export
  const format = options.format || 'json';
  let output: string;

  if (format === 'csv') {
    output = auditLogger.exportToCsv({ from, to });
  } else {
    output = auditLogger.exportToJson({ from, to });
  }

  // Output
  if (options.output) {
    const fs = await import('fs');
    fs.writeFileSync(options.output, output);
    console.log(chalk.green(`✓ Exported to ${options.output}`));
  } else {
    console.log(output);
  }
}
