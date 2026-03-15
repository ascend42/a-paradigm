import chalk from 'chalk';

interface ServeOptions {
  port?: string;
  open?: boolean;
  sections?: string;
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const projectDir = process.cwd();
  const port = parseInt(options.port || '3850', 10);
  const shouldOpen = options.open !== false;
  const sections = options.sections ? options.sections.split(',').map(s => s.trim()) : undefined;

  console.log(chalk.cyan('\n  Starting Paradigm Platform...\n'));

  try {
    const { startPlatformServer } = await import('../platform-server/index.js');

    await startPlatformServer({ port, projectDir, open: shouldOpen, sections });

    console.log(chalk.green(`  Platform running at ${chalk.bold(`http://localhost:${port}`)}`));
    console.log(chalk.gray('  Press Ctrl+C to stop\n'));

    // Keep process running
    await new Promise(() => {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(chalk.red(`\n  Error: Port ${port} is already in use.`));
      console.log(chalk.gray(`  Try: paradigm serve --port ${port + 1}\n`));
    } else {
      console.error(chalk.red('\n  Failed to start Platform:'), error);
    }
    process.exit(1);
  }
}
