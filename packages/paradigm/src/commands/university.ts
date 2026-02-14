/**
 * University command - Launch the Paradigm University learning platform
 */

import chalk from 'chalk';

interface UniversityOptions {
  port?: string;
  open?: boolean;
}

export async function universityCommand(_path: string | undefined, options: UniversityOptions): Promise<void> {
  const port = parseInt(options.port || '3839', 10);
  const shouldOpen = options.open !== false;

  console.log(chalk.cyan('\nOpening the campus gates...\n'));

  try {
    const { startServer } = await import('@a-company/university/server');

    console.log(chalk.gray(`Port: ${port}`));
    console.log();

    await startServer({
      port,
      open: shouldOpen,
    });

    console.log(chalk.green(`\nParadigm University is running at http://localhost:${port}`));
    console.log(chalk.gray('\nPress Ctrl+C to stop\n'));

    // Keep the process running
    await new Promise(() => {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(chalk.red(`\nError: Port ${port} is already in use.`));
      console.log(chalk.gray(`Try a different port with: paradigm university --port ${port + 1}\n`));
    } else {
      console.error(chalk.red('\nFailed to start Paradigm University:'), error);
    }
    process.exit(1);
  }
}
