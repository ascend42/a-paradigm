/**
 * horizon visualize - Launch the Dreamscape visualizer
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';

interface VisualizeOptions {
  port: string;
  open: boolean;
}

export async function visualizeCommand(options: VisualizeOptions) {
  const port = parseInt(options.port, 10);

  console.log(chalk.blue('\n🌌 Starting Dreamscape...\n'));

  // Find the visualizer package directory
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const rootDir = path.resolve(__dirname, '../../..');
  const visualizerDir = path.join(rootDir, 'packages/visualizer');

  // Check if visualizer exists
  if (!fs.existsSync(visualizerDir)) {
    console.error(chalk.red(`❌ Visualizer not found at ${visualizerDir}`));
    console.error(chalk.gray('   Make sure you\'re running from the Horizon repository root\n'));
    process.exit(1);
  }

  const spinner = ora('Starting visualizer server...').start();

  // Start Vite dev server with port flag
  const viteProcess = spawn('npx', ['vite', '--port', port.toString(), '--host'], {
    cwd: visualizerDir,
    shell: true,
    stdio: 'pipe',
    env: {
      ...process.env,
    },
  });

  let serverReady = false;
  let errorOutput = '';

  viteProcess.stdout.on('data', (data) => {
    const output = data.toString();
    errorOutput += output;
    
    // Check if server is ready (Vite outputs "Local: http://localhost:PORT")
    if (output.includes('Local:') || output.includes('ready in')) {
      if (!serverReady) {
        serverReady = true;
        spinner.succeed('Visualizer server started');
      }
    }
    
    // Show Vite output in dev mode (but don't spam)
    if (output.includes('error') || output.includes('Error')) {
      console.log(chalk.red(output));
    }
  });

  viteProcess.stderr.on('data', (data) => {
    const output = data.toString();
    errorOutput += output;
    
    // Vite often outputs to stderr even for normal messages
    if (output.includes('Local:') || output.includes('ready in')) {
      if (!serverReady) {
        serverReady = true;
        spinner.succeed('Visualizer server started');
      }
    } else if (output.includes('error') || output.includes('Error')) {
      console.log(chalk.red(output));
    }
  });

  viteProcess.on('error', (error) => {
    spinner.fail('Failed to start visualizer');
    console.error(chalk.red(`Error: ${error.message}\n`));
    console.log(chalk.yellow('Make sure dependencies are installed:'));
    console.log(chalk.cyan('  npm install\n'));
    process.exit(1);
  });

  // Wait a bit for server to start, then check if it's ready
  await new Promise((resolve) => setTimeout(resolve, 2000));

  if (!serverReady) {
    // Give it more time
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const url = `http://localhost:${port}`;
  
  console.log(chalk.blue(`\n✨ Dreamscape running at ${chalk.cyan(url)}\n`));
  console.log(chalk.gray('Press Ctrl+C to stop\n'));

  // Open browser
  if (options.open !== false) {
    // Wait a bit more to ensure server is fully ready
    setTimeout(async () => {
      await open(url);
    }, 1000);
  }

  // Handle process termination
  process.on('SIGINT', () => {
    console.log(chalk.gray('\n\nStopping visualizer...'));
    viteProcess.kill();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    viteProcess.kill();
    process.exit(0);
  });

  // Keep process alive
  viteProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(chalk.red(`\nVisualizer server exited with code ${code}`));
      if (errorOutput) {
        console.error(chalk.gray(errorOutput));
      }
      process.exit(code);
    }
  });
}
