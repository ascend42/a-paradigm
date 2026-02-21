import chalk from 'chalk';

interface LoreServeOptions {
  port?: string;
  open?: boolean;
}

export async function loreServeCommand(path: string | undefined, options: LoreServeOptions): Promise<void> {
  const projectDir = path || process.cwd();
  const port = parseInt(options.port || '3840', 10);
  const shouldOpen = options.open !== false;

  console.log(chalk.cyan('\nStarting Lore Timeline...\n'));

  try {
    const { startLoreServer } = await import('../../lore-server/index.js');

    console.log(chalk.gray(`Project: ${projectDir}`));
    console.log(chalk.gray(`Port: ${port}`));
    console.log();

    await startLoreServer({ port, projectDir, open: shouldOpen });

    console.log(chalk.green(`\nLore Timeline is running at http://localhost:${port}`));
    console.log(chalk.gray('\nPress Ctrl+C to stop\n'));

    // Keep process running
    await new Promise(() => {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(chalk.red(`\nError: Port ${port} is already in use.`));
      console.log(chalk.gray(`Try: paradigm lore --port ${port + 1}\n`));
    } else {
      console.error(chalk.red('\nFailed to start Lore Timeline:'), error);
    }
    process.exit(1);
  }
}
