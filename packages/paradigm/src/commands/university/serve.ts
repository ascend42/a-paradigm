/**
 * University serve command - Launch the Paradigm University learning platform.
 * v6.0: honors pack selectors; when a non-default pack is requested, mounts
 * its content directory instead of the bundled first-party content.
 */

import chalk from 'chalk';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { resolvePackContext, readPackSections, type SelectorOptions } from './selectors.js';
import { resolveContentBase } from '../../core/university/index.js';
import { out } from '../../utils/cli-output.js';

// v6.5: Module-local guard so the implicit-default advisory fires at most once
// per process, regardless of how many serve calls or pack-context resolutions
// happen. Re-imports get a fresh module → fresh guard, which is fine.
let implicitDefaultAdvisoryEmitted = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface UniversityServeOptions extends SelectorOptions {
  port?: string;
  open?: boolean;
}

export async function universityServeCommand(_path: string | undefined, options: UniversityServeOptions): Promise<void> {
  const port = parseInt(options.port || '3839', 10);
  const shouldOpen = options.open !== false;

  const rootDir = process.cwd();
  const hasSelector = Boolean(options.pack || options.project || options.discipline);
  const ctx = hasSelector ? resolvePackContext(rootDir, options) : null;

  // v6.5: If the resolved pack has no user-authored sections, the paradigm-mcp
  // loader synthesizes a default `main` section. Surface this once per process
  // so authors know custom sections are available. We only probe when a pack
  // context is resolved — bare `paradigm university serve` (bundled first-party
  // content) skips the advisory.
  if (ctx && !implicitDefaultAdvisoryEmitted) {
    const probeRoot = ctx.subPackRoot ?? ctx.packRoot;
    const declared = readPackSections(probeRoot);
    if (declared.length === 0) {
      out('Using implicit default section. v6.5 supports custom sections — see docs.');
      implicitDefaultAdvisoryEmitted = true;
    }
  }

  console.log(chalk.cyan('\nOpening the campus gates...\n'));

  try {
    const { startServer } = await import('@a-company/university/server');

    // v6.0: when a selector targets a non-default pack, mount its content dir.
    // The sub-pack root wins over the primary pack root when --discipline is
    // set. Default (no selector) uses the bundled first-party content.
    const defaultContentDir = path.resolve(__dirname, 'university-content');
    let contentDir = defaultContentDir;
    if (ctx) {
      // A1b: dual-base probe (content/ → src/content/, contains-content rule)
      // so a first-party / src/content-layout pack doesn't mount an empty dir.
      // Fall back to bundled content when the pack has no resolvable content.
      const packRoot = ctx.subPackRoot ?? ctx.packRoot;
      const resolvedBase = resolveContentBase(packRoot);
      contentDir = resolvedBase ?? path.join(packRoot, 'content');
    }
    const uiDistPath = path.resolve(__dirname, 'university-ui');

    console.log(chalk.gray(`Port: ${port}`));
    if (ctx) {
      console.log(chalk.gray(`Pack: ${ctx.subPackId ?? ctx.packId}`));
    }
    console.log();

    await startServer({
      port,
      open: shouldOpen,
      contentDir,
      uiDistPath,
      projectDir: process.cwd(),
      // A1: forward the resolved pack so the server detects mode/branding/
      // sections from the SELECTED pack, not the project default.
      packRoot: ctx ? (ctx.subPackRoot ?? ctx.packRoot) : undefined,
      packId: ctx ? (ctx.subPackId ?? ctx.packId) : undefined,
    });

    console.log(chalk.green(`\nParadigm University is running at http://localhost:${port}`));
    console.log(chalk.gray('\nPress Ctrl+C to stop\n'));

    // Keep the process running
    await new Promise(() => {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND' ||
        (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      console.error(chalk.red('\n@a-company/university is not installed.'));
      console.log(chalk.gray('Install it with: npm install @a-company/university\n'));
    } else if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(chalk.red(`\nError: Port ${port} is already in use.`));
      console.log(chalk.gray(`Try a different port with: paradigm university serve --port ${port + 1}\n`));
    } else {
      console.error(chalk.red('\nFailed to start Paradigm University:'), error);
    }
    process.exit(1);
  }
}
