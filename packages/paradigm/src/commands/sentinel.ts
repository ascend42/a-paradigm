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
    const errCode = (error as NodeJS.ErrnoException).code;
    const errMsg = (error as Error).message || '';

    if (errCode === 'ERR_MODULE_NOT_FOUND' || errCode === 'MODULE_NOT_FOUND') {
      console.error(chalk.red('\n@a-company/sentinel is not installed.'));
      console.log(chalk.gray('Install it with: npm install @a-company/sentinel\n'));
    } else if (errCode === 'EADDRINUSE') {
      console.error(chalk.red(`\nError: Port ${port} is already in use.`));
      console.log(chalk.gray(`Try a different port with: paradigm sentinel --port ${port + 1}\n`));
    } else if (errCode === 'EACCES') {
      console.error(chalk.red(`\nError: Permission denied on port ${port}.`));
      console.log(chalk.gray(`Ports below 1024 require elevated privileges. Try: paradigm sentinel --port 3838\n`));
    } else if (errCode === 'ENOENT') {
      console.error(chalk.red(`\nError: Project directory not found: ${projectDir}`));
      console.log(chalk.gray('Verify the path exists and try again.\n'));
    } else if (errMsg.includes('ECONNREFUSED') || errMsg.includes('ETIMEDOUT')) {
      console.error(chalk.red('\nError: Network connection failed.'));
      console.log(chalk.gray('Check your network configuration and try again.\n'));
    } else {
      console.error(chalk.red('\nFailed to start Sentinel.'));
      console.error(chalk.gray(`  Error: ${errMsg || 'Unknown error'}`));
      if (errCode) console.error(chalk.gray(`  Code:  ${errCode}`));
      console.log(chalk.gray('\nIf this persists, try:'));
      console.log(chalk.gray('  1. Ensure @a-company/sentinel is up to date'));
      console.log(chalk.gray('  2. Check that no other process is using the port'));
      console.log(chalk.gray('  3. Run `paradigm doctor` to check your setup\n'));
    }
    process.exit(1);
  }
}
