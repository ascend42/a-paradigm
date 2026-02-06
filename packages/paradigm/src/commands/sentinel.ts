/**
 * Sentinel command - Launch the unified codebase intelligence UI
 */

import chalk from 'chalk';

interface SentinelOptions {
  port?: string;
  open?: boolean;
}

export async function sentinelCommand(path: string | undefined, options: SentinelOptions): Promise<void> {
  const projectDir = path || process.cwd();
  const port = parseInt(options.port || '3838', 10);
  const shouldOpen = options.open !== false;

  console.log(chalk.cyan('\nStarting Sentinel...\n'));

  try {
    // Dynamic import to avoid loading all of sentinel at CLI startup
    const { startServer } = await import('@a-company/sentinel/server');

    console.log(chalk.gray(`Project: ${projectDir}`));
    console.log(chalk.gray(`Port: ${port}`));
    console.log();

    await startServer({
      port,
      projectDir,
      open: shouldOpen,
    });

    console.log(chalk.green(`\nSentinel is running at http://localhost:${port}`));
    console.log(chalk.gray('\nPress Ctrl+C to stop\n'));

    // Keep the process running
    await new Promise(() => {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(chalk.red(`\nError: Port ${port} is already in use.`));
      console.log(chalk.gray(`Try a different port with: paradigm sentinel --port ${port + 1}\n`));
    } else {
      console.error(chalk.red('\nFailed to start Sentinel:'), error);
    }
    process.exit(1);
  }
}
