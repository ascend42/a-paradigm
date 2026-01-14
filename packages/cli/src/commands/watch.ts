/**
 * horizon watch - Watch for changes and auto-sync
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { loadHorizonFiles, detectIDE, syncToIDE } from '../core/ide-adapters/index.js';

interface WatchState {
  lastConfigMtime: number;
  lastSpecsMtime: number;
}

export async function watchCommand() {
  const cwd = process.cwd();
  
  console.log(chalk.blue('\n👀 Horizon Watch\n'));

  // Check if .horizon exists
  const horizonDir = path.join(cwd, '.horizon');
  if (!fs.existsSync(horizonDir) || !fs.statSync(horizonDir).isDirectory()) {
    console.log(chalk.red('❌ No .horizon/ directory found.'));
    console.log(chalk.gray('   Run `horizon init` first.\n'));
    process.exit(1);
  }

  // Detect IDE
  const detection = detectIDE(cwd);
  const targetIDE = detection.detected || 'cursor';
  
  console.log(chalk.gray('Watching for changes...\n'));
  console.log(chalk.gray(`  [config] .horizon/config.yaml`));
  console.log(chalk.gray(`  [specs]  .horizon/specs/*.md`));
  console.log(chalk.gray(`  [target] ${targetIDE}\n`));
  console.log(chalk.gray('Press Ctrl+C to stop.\n'));

  // Track file modification times
  const state: WatchState = {
    lastConfigMtime: 0,
    lastSpecsMtime: 0,
  };

  // Get initial mtimes
  const configPath = path.join(horizonDir, 'config.yaml');
  const specsDir = path.join(horizonDir, 'specs');
  
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
      console.log(chalk.cyan(`${timestamp}`) + chalk.gray(` [${changeType}]`) + ' Changed → syncing...');
      
      // Reload and sync
      const files = loadHorizonFiles(cwd);
      if (files) {
        const result = syncToIDE(cwd, targetIDE, files, true);
        if (result.success) {
          console.log(chalk.green(`${timestamp}`) + chalk.gray(` [sync]`) + ` ${result.outputPath} updated`);
        } else {
          console.log(chalk.red(`${timestamp}`) + chalk.gray(` [sync]`) + ` Failed: ${result.message}`);
        }
      } else {
        console.log(chalk.red(`${timestamp}`) + chalk.gray(` [error]`) + ' Failed to load .horizon/ files');
      }
    }
  };

  // Poll every second
  const interval = setInterval(checkForChanges, 1000);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log(chalk.gray('\n\nStopped watching.\n'));
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
