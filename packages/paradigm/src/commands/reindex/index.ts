/**
 * paradigm reindex [path] — rebuild the symbol index from the command line.
 *
 * The CLI form of the MCP tool `paradigm_reindex`: it calls the same
 * `rebuildStaticFiles` (paradigm-mcp tools/reindex.ts) and prints the same
 * compact summary (`summarizeRebuild`). Nothing is reimplemented here.
 *
 * Writes `.paradigm/scan-index.json`, `navigator.yaml`, the flow index and the
 * other generated indexes. Refuses to run outside a Paradigm project, so it
 * never scaffolds a `.paradigm/` directory by accident.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../../utils/logger.js';
import { out, success, warn, error, dim, kv, json as jsonOut } from '../../utils/cli-output.js';
import { rebuildStaticFiles, summarizeRebuild } from '../../../../paradigm-mcp/src/tools/reindex.js';

export interface ReindexOptions {
  /** Print the rebuild summary as JSON (the MCP tool's summary shape). */
  json?: boolean;
  /** Print nothing on success. */
  quiet?: boolean;
}

/**
 * Rebuild the index for the project at `targetPath` (default: cwd).
 * Returns true when the index was rebuilt.
 */
export async function reindexCommand(targetPath: string | undefined, options: ReindexOptions = {}): Promise<boolean> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  // --json and --quiet print nothing but their own output (the JSON must be
  // parseable on its own), so the operation tracker is skipped for them.
  const tracker = options.json || options.quiet ? null : log.command('reindex').start('Rebuilding symbol index');

  const paradigmDir = path.join(rootDir, '.paradigm');
  if (!fs.existsSync(paradigmDir) || !fs.statSync(paradigmDir).isDirectory()) {
    if (options.json) {
      jsonOut({ success: false, error: 'not-a-paradigm-project', fix: 'paradigm shift' });
    } else {
      error('This directory is not a Paradigm project (no .paradigm/ directory).');
      dim('  Set it up first: paradigm shift');
    }
    process.exitCode = 1;
    tracker?.error('Not a Paradigm project');
    return false;
  }

  try {
    const result = await rebuildStaticFiles(rootDir);
    const summary = summarizeRebuild(result);

    if (options.json) {
      jsonOut(summary);
    } else if (!options.quiet) {
      success(`Symbol index rebuilt: ${result.symbolCount} symbol${result.symbolCount === 1 ? '' : 's'}`);
      const breakdown = Object.entries(result.breakdown)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => `${count} ${kind}`)
        .join(', ');
      if (breakdown) kv('Symbols', breakdown);
      kv('Flows', String(result.flowCount));
      kv('Files written', String(result.filesWritten.length));
      for (const file of result.filesWritten) {
        dim('    ' + file);
      }
      const issues = typeof summary.issues === 'number' ? summary.issues : 0;
      const dangling = typeof summary.danglingCount === 'number' ? summary.danglingCount : 0;
      if (issues > 0) warn(`${issues} integrity issue${issues === 1 ? '' : 's'} found. See them with: paradigm doctor`);
      if (dangling > 0) dim(`  ${dangling} reference${dangling === 1 ? '' : 's'} to symbols no .purpose file declares`);
      out('');
    }

    tracker?.success('Symbol index rebuilt', { symbols: result.symbolCount, files: result.filesWritten.length });
    return true;
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    if (options.json) {
      jsonOut({ success: false, error: message });
    } else {
      error(`Reindex failed: ${message}`);
    }
    process.exitCode = 1;
    tracker?.error('Reindex failed', { error: message });
    return false;
  }
}
