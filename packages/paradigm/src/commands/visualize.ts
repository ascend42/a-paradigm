/**
 * paradigm visualize - Launch the Dreamscape visualizer
 * 
 * Serves the built visualizer and aggregates symbols from the current project directory
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import sirv from 'sirv';
import { aggregateFromDirectory, type AggregationResult } from '@a-company/premise-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface VisualizeOptions {
  port: string;
  open: boolean;
}

let currentAggregation: AggregationResult | null = null;
let projectDir: string = process.cwd();

/**
 * Find the visualizer dist directory
 */
function findVisualizerDist(): string {
  const possiblePaths = [
    // Bundled with CLI package (npm install -g scenario)
    path.resolve(__dirname, '..', 'visualizer-dist'),
    // When running from CLI dist in monorepo (packages/cli/dist -> packages/visualizer/dist)
    path.resolve(__dirname, '..', '..', 'visualizer', 'dist'),
    // Alternative: from packages/cli/dist with explicit path
    path.resolve(__dirname, '..', '..', '..', 'packages', 'visualizer', 'dist'),
    // Fallback: check in node_modules of current project
    path.resolve(process.cwd(), 'node_modules', '@paradigm', 'visualizer', 'dist'),
  ];

  for (const p of possiblePaths) {
    const indexPath = path.join(p, 'index.html');
    if (fs.existsSync(indexPath)) {
      return p;
    }
  }

  const triedPaths = possiblePaths.map(p => `  - ${p}`).join('\n');
  throw new Error(
    `Could not find visualizer build.\n\nTried:\n${triedPaths}\n\nRun \`npm run build\` in the a-paradigm root directory.`
  );
}

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  while (port < startPort + 100) {
    if (await isPortAvailable(port)) {
      return port;
    }
    port++;
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + 100}`);
}

/**
 * Parse request body as JSON
 */
function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Handle API requests
 */
async function handleApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string
): Promise<boolean> {
  // Set CORS and JSON headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  // GET /api/info - Project information
  if (pathname === '/api/info' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({
      projectPath: projectDir,
      projectName: path.basename(projectDir),
      timestamp: Date.now(),
      symbolCount: currentAggregation?.symbols.length ?? 0,
    }));
    return true;
  }

  // GET /api/symbols - Get all aggregated symbols from CURRENT project directory
  if (pathname === '/api/symbols' && req.method === 'GET') {
    try {
      // Always aggregate from the current project directory
      currentAggregation = await aggregateFromDirectory(projectDir);
      res.writeHead(200);
      res.end(JSON.stringify({
        symbols: currentAggregation.symbols,
        purposeFiles: currentAggregation.purposeFiles,
        gateFiles: currentAggregation.gateFiles,
        errors: currentAggregation.errors,
        timestamp: currentAggregation.timestamp,
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return true;
  }

  return false;
}

export async function visualizeCommand(options: VisualizeOptions) {
  const requestedPort = parseInt(options.port, 10);
  projectDir = process.cwd(); // Always use the directory where the command was run

  console.log(chalk.blue('\n🌌 Starting Dreamscape...\n'));

  // Find visualizer dist
  const spinner = ora('Locating visualizer build...').start();
  let visualizerDist: string;
  try {
    visualizerDist = findVisualizerDist();
    spinner.succeed(`Found visualizer at ${chalk.gray(visualizerDist)}`);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }

  // Aggregate symbols from CURRENT project directory
  spinner.start(`Aggregating symbols from ${chalk.gray(path.basename(projectDir))}...`);
  try {
    currentAggregation = await aggregateFromDirectory(projectDir);
    const symbolCount = currentAggregation.symbols.length;
    const errorCount = currentAggregation.errors.length;
    
    if (errorCount > 0) {
      spinner.warn(`Aggregated ${symbolCount} symbols (${errorCount} errors)`);
    } else {
      spinner.succeed(`Aggregated ${symbolCount} symbols`);
    }
  } catch (error) {
    spinner.fail(`Aggregation failed: ${(error as Error).message}`);
    process.exit(1);
  }

  // Find available port
  spinner.start(`Finding available port (starting at ${requestedPort})...`);
  let port: number;
  try {
    port = await findAvailablePort(requestedPort);
    if (port !== requestedPort) {
      spinner.warn(`Port ${requestedPort} in use, using ${port}`);
    } else {
      spinner.succeed(`Using port ${port}`);
    }
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }

  // Create static file handler
  const serve = sirv(visualizerDist, {
    dev: true,
    single: true, // SPA mode - serve index.html for all routes
  });

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const pathname = url.pathname;

    // Handle API requests - these aggregate from projectDir
    if (pathname.startsWith('/api/')) {
      const handled = await handleApiRequest(req, res, pathname);
      if (handled) return;
      
      // Unknown API endpoint
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Serve static files
    serve(req, res, () => {
      res.writeHead(404);
      res.end('Not found');
    });
  });

  // Start server
  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    
    console.log('');
    console.log(chalk.blue(`✨ Dreamscape running at ${chalk.cyan.bold(url)}`));
    console.log('');
    console.log(chalk.gray(`   Project: ${projectDir}`));
    console.log(chalk.gray(`   Symbols: ${currentAggregation?.symbols.length ?? 0}`));
    console.log('');
    console.log(chalk.gray('   Press Ctrl+C to stop'));
    console.log('');

    // Open browser
    if (options.open !== false) {
      open(url);
    }
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\n👋 Shutting down Dreamscape...\n'));
    server.close(() => {
      process.exit(0);
    });
  });

  // Keep the process alive
  await new Promise(() => {}); // Never resolves - keeps server running
}
