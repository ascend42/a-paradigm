/**
 * paradigm watch - Watch for changes and auto-sync
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { loadParadigmFiles, detectIDE, syncToIDE } from '../core/ide-adapters/index.js';
import { out, header, dim, error as cliError } from '../utils/cli-output.js';

interface WatchState {
  lastConfigMtime: number;
  lastSpecsMtime: number;
}

export async function watchCommand() {
  const cwd = process.cwd();
  
  header('👀 Paradigm Watch');
  out('');

  // Check if .paradigm exists
  const paradigmDir = path.join(cwd, '.paradigm');
  if (!fs.existsSync(paradigmDir) || !fs.statSync(paradigmDir).isDirectory()) {
    cliError('No .paradigm/ directory found.');
    dim('   Run `paradigm init` first.\n');
    process.exit(1);
  }

  // Detect IDE
  const detection = detectIDE(cwd);
  const targetIDE = detection.detected || 'cursor';

  dim('Watching for changes...\n');
  dim(`  [config] .paradigm/config.yaml`);
  dim(`  [specs]  .paradigm/specs/*.md`);
  dim(`  [target] ${targetIDE}\n`);
  dim('Press Ctrl+C to stop.\n');

  // Track file modification times
  const state: WatchState = {
    lastConfigMtime: 0,
    lastSpecsMtime: 0,
  };

  // Get initial mtimes
  const configPath = path.join(paradigmDir, 'config.yaml');
  const specsDir = path.join(paradigmDir, 'specs');
  
  if (fs.existsSync(configPath)) {
    state.lastConfigMtime = fs.statSync(configPath).mtime.getTime();
  }
  
  if (fs.existsSync(specsDir)) {
    state.lastSpecsMtime = getLatestMtime(specsDir);
  }

  // Watch function
  const checkForChanges = () => {
    let needsSync = false;
    let changeType = '';
    
    // Check config
    if (fs.existsSync(configPath)) {
      const mtime = fs.statSync(configPath).mtime.getTime();
      if (mtime > state.lastConfigMtime) {
        state.lastConfigMtime = mtime;
        needsSync = true;
        changeType = 'config';
      }
    }
    
    // Check specs
    if (fs.existsSync(specsDir)) {
      const mtime = getLatestMtime(specsDir);
      if (mtime > state.lastSpecsMtime) {
        state.lastSpecsMtime = mtime;
        needsSync = true;
        changeType = changeType ? 'config+specs' : 'specs';
      }
    }
    
    if (needsSync) {
      const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
      out(chalk.cyan(`${timestamp}`) + chalk.gray(` [${changeType}]`) + ' Changed → syncing...');

      // Reload and sync
      const files = loadParadigmFiles(cwd);
      if (files) {
        const result = syncToIDE(cwd, targetIDE, files, true);
        if (result.success) {
          out(chalk.green(`${timestamp}`) + chalk.gray(` [sync]`) + ` ${result.outputPath} updated`);
        } else {
          out(chalk.red(`${timestamp}`) + chalk.gray(` [sync]`) + ` Failed: ${result.message}`);
        }
      } else {
        out(chalk.red(`${timestamp}`) + chalk.gray(` [error]`) + ' Failed to load .paradigm/ files');
      }
    }
  };

  // Poll every second
  const interval = setInterval(checkForChanges, 1000);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(interval);
    dim('\n\nStopped watching.\n');
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

/**
 * Get the latest modification time from a directory
 */
function getLatestMtime(dir: string): number {
  let latest = 0;
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isFile()) {
        const mtime = fs.statSync(fullPath).mtime.getTime();
        if (mtime > latest) {
          latest = mtime;
        }
      } else if (entry.isDirectory()) {
        const subMtime = getLatestMtime(fullPath);
        if (subMtime > latest) {
          latest = subMtime;
        }
      }
    }
  } catch {
    // Ignore errors
  }
  
  return latest;
}
