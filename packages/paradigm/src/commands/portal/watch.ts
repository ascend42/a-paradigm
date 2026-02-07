/**
 * paradigm portal watch - Launch the Portal Viewer
 *
 * Starts a real-time visualization dashboard for portal activations.
 */

import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';

interface WatchOptions {
  port?: string;
  uiPort?: string;
  config?: string;
  open?: boolean;
}

export async function portalWatchCommand(targetPath?: string, options: WatchOptions = {}) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const port = parseInt(options.port || '42196', 10);   // Marathon + 1 (WebSocket)
  const uiPort = parseInt(options.uiPort || '42195', 10); // Marathon distance: 42.195km
  const configPath = options.config || path.join(rootDir, 'portal.yaml');

  console.log(chalk.magenta('\n🚪 Portal Viewer\n'));

  const spinner = ora('Starting Portal Viewer...').start();

  try {
    // Check if portal.yaml exists
    if (!fs.existsSync(configPath)) {
      spinner.warn(`No portal.yaml found at ${chalk.gray(configPath)}`);
      console.log(chalk.gray('   The viewer will start but won\'t have any predefined gates.\n'));
    }

    // Dynamically import the viewer server
    let ViewerServer: any;
    try {
      // @ts-expect-error - optional dependency, handled with try/catch
      const viewerModule = await import('@a-company/portal-viewer');
      ViewerServer = viewerModule.ViewerServer;
    } catch (err) {
      spinner.fail('Portal Viewer package not found');
      console.log('');
      console.log(chalk.yellow('To use the Portal Viewer, install the package:'));
      console.log(chalk.cyan('  npm install @a-company/portal-viewer'));
      console.log('');
      console.log(chalk.gray('Or build from source in the monorepo:'));
      console.log(chalk.gray('  cd packages/portal/viewer && npm run build'));
      process.exit(1);
    }

    // Start the server
    const server = new ViewerServer({
      port,
      uiPort,
      configPath,
    });

    await server.start();

    spinner.succeed('Portal Viewer started');
    console.log('');
    console.log(chalk.blue('   🌐 UI:        ') + chalk.cyan.bold(`http://localhost:${uiPort}`));
    console.log(chalk.blue('   🔌 WebSocket: ') + chalk.cyan(`ws://localhost:${port}`));
    console.log(chalk.blue('   📋 Config:    ') + chalk.gray(configPath));
    console.log('');
    console.log(chalk.gray('   Connect your app\'s Portal SDK to the WebSocket URL above.'));
    console.log(chalk.gray('   Press Ctrl+C to stop.'));
    console.log('');

    // Open browser
    if (options.open !== false) {
      await open(`http://localhost:${uiPort}`);
    }

    // Keep process alive
    await new Promise(() => {});
  } catch (error) {
    spinner.fail('Failed to start Portal Viewer');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

/**
 * paradigm portal report - Generate a report from a session file
 */
export async function portalReportCommand(sessionPath?: string, options: { format?: string; output?: string } = {}) {
  if (!sessionPath) {
    console.log(chalk.red('Error: Session path required'));
    console.log('');
    console.log('Usage: paradigm portal report <session.json> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --format <format>  Output format: json, markdown, slack, discord');
    console.log('  --output <path>    Output file path');
    process.exit(1);
  }

  const format = options.format || 'markdown';
  const outputPath = options.output;

  console.log(chalk.magenta('\n📊 Portal Report Generator\n'));

  const spinner = ora('Generating report...').start();

  try {
    // Read session file
    const sessionData = fs.readFileSync(sessionPath, 'utf-8');
    const session = JSON.parse(sessionData);

    // Import reporter
    let reporter: any;
    try {
      // @ts-expect-error - optional dependency, handled with try/catch
      reporter = await import('@a-company/portal-viewer/session');
    } catch {
      spinner.fail('Portal Viewer package not found');
      console.log(chalk.yellow('Install @a-company/portal-viewer to use the reporter.'));
      process.exit(1);
    }

    // Generate report
    const report = reporter.generateReport(session, []);

    let output: string;
    switch (format) {
      case 'json':
        output = JSON.stringify(report, null, 2);
        break;
      case 'markdown':
        output = reporter.formatMarkdown(report);
        break;
      case 'slack':
        output = JSON.stringify(reporter.formatSlack(report), null, 2);
        break;
      case 'discord':
        output = JSON.stringify(reporter.formatDiscord(report), null, 2);
        break;
      default:
        output = reporter.formatMarkdown(report);
    }

    if (outputPath) {
      fs.writeFileSync(outputPath, output, 'utf-8');
      spinner.succeed(`Report saved to ${chalk.cyan(outputPath)}`);
    } else {
      spinner.succeed('Report generated');
      console.log('');
      console.log(output);
    }
  } catch (error) {
    spinner.fail('Failed to generate report');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}
