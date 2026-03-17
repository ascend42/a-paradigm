/**
 * paradigm docs serve — Launch docs viewer
 *
 * Shortcut for `paradigm serve --sections docs` that opens the Platform
 * with only the docs section enabled.
 */

import chalk from 'chalk';

export interface DocsServeOptions {
  port?: string;
  open?: boolean;
}

export async function docsServeCommand(options: DocsServeOptions): Promise<void> {
  const projectDir = process.cwd();
  const port = parseInt(options.port || '3850', 10);
  const shouldOpen = options.open !== false;

  console.log(chalk.cyan('\n  Starting Paradigm Docs...\n'));

  try {
    const { startPlatformServer } = await import('../../platform-server/index.js');

    await startPlatformServer({
      projectDir,
      port,
      open: shouldOpen,
      sections: ['overview', 'docs'],
    });

    console.log(chalk.green(`  Docs running at ${chalk.bold(`http://localhost:${port}`)}`));
    console.log(chalk.gray('  Press Ctrl+C to stop\n'));

    // Keep process running
    await new Promise(() => {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(chalk.red(`\n  Error: Port ${port} is already in use.`));
      console.log(chalk.gray(`  Try: paradigm docs serve --port ${port + 1}\n`));
    } else {
      console.error(chalk.red('\n  Failed to start Paradigm Docs:'), error);
    }
    process.exit(1);
  }
}
