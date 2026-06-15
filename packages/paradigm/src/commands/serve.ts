import chalk from 'chalk';

interface ServeOptions {
  port?: string;
  open?: boolean;
  sections?: string;
}

// How many sequential ports to try before giving up when the requested one is busy.
const PORT_RETRY_LIMIT = 10;

export async function serveCommand(options: ServeOptions): Promise<void> {
  const projectDir = process.cwd();
  const requestedPort = parseInt(options.port || '3850', 10);
  const shouldOpen = options.open !== false;
  const sections = options.sections ? options.sections.split(',').map(s => s.trim()) : undefined;
  // Only auto-increment when the user didn't pin a specific port.
  const portWasExplicit = options.port !== undefined;

  console.log(chalk.cyan('\n  Starting Paradigm Platform...\n'));

  const { startPlatformServer } = await import('../platform-server/index.js');

  const maxAttempts = portWasExplicit ? 1 : PORT_RETRY_LIMIT;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = requestedPort + attempt;
    try {
      await startPlatformServer({ port, projectDir, open: shouldOpen, sections });

      console.log(chalk.green(`  Platform running at ${chalk.bold(`http://localhost:${port}`)}`));
      console.log(chalk.gray('  Press Ctrl+C to stop\n'));

      // Keep process running
      await new Promise(() => {});
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        if (attempt < maxAttempts - 1) {
          console.log(chalk.gray(`  Port ${port} in use, trying ${port + 1}...`));
          continue;
        }
        console.error(chalk.red(`\n  Error: Port ${port} is already in use.`));
        if (portWasExplicit) {
          console.log(chalk.gray(`  Try a different port: paradigm serve --port ${port + 1}\n`));
        } else {
          console.log(chalk.gray(`  Tried ports ${requestedPort}-${requestedPort + maxAttempts - 1}; all in use.\n`));
        }
      } else {
        console.error(chalk.red('\n  Failed to start Platform:'), error);
      }
      process.exit(1);
    }
  }
}
