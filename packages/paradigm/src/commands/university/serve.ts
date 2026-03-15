/**
 * University serve command - Launch the Paradigm University learning platform
 */

import chalk from 'chalk';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface UniversityServeOptions {
  port?: string;
  open?: boolean;
}

export async function universityServeCommand(_path: string | undefined, options: UniversityServeOptions): Promise<void> {
  const port = parseInt(options.port || '3839', 10);
  const shouldOpen = options.open !== false;

  console.log(chalk.cyan('\nOpening the campus gates...\n'));

  try {
    const { startServer } = await import('@a-company/university/server');

    // Resolve asset paths relative to this file (works when bundled)
    const contentDir = path.resolve(__dirname, '../university-content');
    const uiDistPath = path.resolve(__dirname, '../university-ui');

    console.log(chalk.gray(`Port: ${port}`));
    console.log();

    await startServer({
      port,
      open: shouldOpen,
      contentDir,
      uiDistPath,
      projectDir: process.cwd(),
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
