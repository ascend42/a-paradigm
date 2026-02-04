/**
 * paradigm thread - Session continuity management
 * 
 * Creates and manages .paradigm/thread.md - a file that helps pass
 * context between AI agent sessions.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { log } from '../utils/logger.js';

export interface ThreadOptions {
  quiet?: boolean;
  json?: boolean;
}

export interface ThreadEntry {
  timestamp: string;
  message: string;
  symbols?: string[];
  files?: string[];
}

interface ThreadData {
  lastSession?: string;
  trail: ThreadEntry[];
  looseEnds: string[];
  breadcrumbs: string[];
}

const THREAD_TEMPLATE = `# Thread - Session Continuity

> Pass context between AI agent sessions. Updated by \`paradigm thread save\`.

## Last Session: {timestamp}

### Trail (What was done)
{trail}

### Loose Ends (Unfinished)
{looseEnds}

### Breadcrumbs (Notes for next agent)
{breadcrumbs}

---
*Run \`paradigm thread save "message"\` to update*
*Run \`paradigm thread clear\` to reset*
`;

/**
 * Parse existing thread.md file
 */
function parseThread(content: string): ThreadData {
  const data: ThreadData = {
    trail: [],
    looseEnds: [],
    breadcrumbs: [],
  };

  // Extract last session timestamp
  const sessionMatch = content.match(/## Last Session: (.+)/);
  if (sessionMatch) {
    data.lastSession = sessionMatch[1].trim();
  }

  // Extract trail items
  const trailSection = content.match(/### Trail \(What was done\)\n([\s\S]*?)(?=\n### |$)/);
  if (trailSection) {
    const lines = trailSection[1].split('\n').filter(l => l.startsWith('- '));
    for (const line of lines) {
      const text = line.replace(/^- /, '').trim();
      if (text && text !== '_No activity recorded yet_') {
        // Extract symbols from the text (anything starting with @, #, ^, etc.)
        const symbols = text.match(/[@#^!$%~?][\w-]+/g) || [];
        data.trail.push({
          timestamp: data.lastSession || new Date().toISOString(),
          message: text,
          symbols: symbols.length > 0 ? symbols : undefined,
        });
      }
    }
  }

  // Extract loose ends
  const looseEndsSection = content.match(/### Loose Ends \(Unfinished\)\n([\s\S]*?)(?=\n### |$)/);
  if (looseEndsSection) {
    const lines = looseEndsSection[1].split('\n').filter(l => l.startsWith('- '));
    for (const line of lines) {
      const text = line.replace(/^- \[[ x]\] /, '').replace(/^- /, '').trim();
      if (text && text !== '_No pending tasks_') {
        data.looseEnds.push(text);
      }
    }
  }

  // Extract breadcrumbs
  const breadcrumbsSection = content.match(/### Breadcrumbs \(Notes for next agent\)\n([\s\S]*?)(?=\n---|$)/);
  if (breadcrumbsSection) {
    const lines = breadcrumbsSection[1].split('\n').filter(l => l.startsWith('- '));
    for (const line of lines) {
      const text = line.replace(/^- /, '').trim();
      if (text && text !== '_No notes yet_') {
        data.breadcrumbs.push(text);
      }
    }
  }

  return data;
}

/**
 * Generate thread.md content from data
 */
function generateThread(data: ThreadData): string {
  const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
  
  // Format trail
  let trailContent = '_No activity recorded yet_';
  if (data.trail.length > 0) {
    trailContent = data.trail
      .slice(-10) // Keep last 10 entries
      .map(entry => `- ${entry.message}`)
      .join('\n');
  }

  // Format loose ends
  let looseEndsContent = '_No pending tasks_';
  if (data.looseEnds.length > 0) {
    looseEndsContent = data.looseEnds
      .map(item => `- [ ] ${item}`)
      .join('\n');
  }

  // Format breadcrumbs
  let breadcrumbsContent = '_No notes yet_';
  if (data.breadcrumbs.length > 0) {
    breadcrumbsContent = data.breadcrumbs
      .slice(-10) // Keep last 10 breadcrumbs
      .map(item => `- ${item}`)
      .join('\n');
  }

  return THREAD_TEMPLATE
    .replace('{timestamp}', timestamp)
    .replace('{trail}', trailContent)
    .replace('{looseEnds}', looseEndsContent)
    .replace('{breadcrumbs}', breadcrumbsContent);
}

/**
 * Show the current thread
 */
export async function threadShowCommand(targetPath?: string, options: ThreadOptions = {}) {
  const cwd = process.cwd();
  const absolutePath = targetPath ? path.resolve(cwd, targetPath) : cwd;
  const threadPath = path.join(absolutePath, '.paradigm', 'thread.md');

  if (!fs.existsSync(threadPath)) {
    if (options.json) {
      console.log(JSON.stringify({ exists: false, trail: [], looseEnds: [], breadcrumbs: [] }, null, 2));
      return;
    }
    console.log(chalk.yellow('\n📜 No thread found.\n'));
    console.log(chalk.gray('  Run `paradigm thread save "message"` to start a thread.\n'));
    return;
  }

  const content = fs.readFileSync(threadPath, 'utf8');
  const data = parseThread(content);

  // JSON output mode
  if (options.json) {
    console.log(JSON.stringify({
      exists: true,
      lastSession: data.lastSession,
      trail: data.trail,
      looseEnds: data.looseEnds,
      breadcrumbs: data.breadcrumbs,
    }, null, 2));
    return;
  }

  console.log(chalk.blue('\n📜 Current Thread\n'));
  console.log(chalk.gray('─'.repeat(50)));

  if (data.lastSession) {
    console.log(chalk.white(`Last Session: ${chalk.cyan(data.lastSession)}`));
    console.log('');
  }

  if (data.trail.length > 0) {
    console.log(chalk.white('Trail (What was done):'));
    for (const entry of data.trail.slice(-5)) {
      console.log(chalk.gray(`  - ${entry.message}`));
    }
    if (data.trail.length > 5) {
      console.log(chalk.gray(`  ... and ${data.trail.length - 5} more`));
    }
    console.log('');
  }

  if (data.looseEnds.length > 0) {
    console.log(chalk.white('Loose Ends (Unfinished):'));
    for (const item of data.looseEnds) {
      console.log(chalk.yellow(`  □ ${item}`));
    }
    console.log('');
  }

  if (data.breadcrumbs.length > 0) {
    console.log(chalk.white('Breadcrumbs (Notes):'));
    for (const item of data.breadcrumbs.slice(-5)) {
      console.log(chalk.gray(`  - ${item}`));
    }
    console.log('');
  }

  console.log(chalk.gray(`Path: ${threadPath}\n`));
}

/**
 * Save a message to the thread
 */
export async function threadSaveCommand(message: string, targetPath?: string, options: ThreadOptions = {}) {
  const cwd = process.cwd();
  const absolutePath = targetPath ? path.resolve(cwd, targetPath) : cwd;
  const paradigmDir = path.join(absolutePath, '.paradigm');
  const threadPath = path.join(paradigmDir, 'thread.md');

  // Ensure .paradigm directory exists
  if (!fs.existsSync(paradigmDir)) {
    fs.mkdirSync(paradigmDir, { recursive: true });
  }

  // Load existing thread or create new
  let data: ThreadData = {
    trail: [],
    looseEnds: [],
    breadcrumbs: [],
  };

  if (fs.existsSync(threadPath)) {
    const content = fs.readFileSync(threadPath, 'utf8');
    data = parseThread(content);
  }

  // Add new trail entry
  const symbols = message.match(/[@#^!$%~?][\w-]+/g) || [];
  data.trail.push({
    timestamp: new Date().toISOString(),
    message,
    symbols: symbols.length > 0 ? symbols : undefined,
  });

  // Generate and save
  const newContent = generateThread(data);
  fs.writeFileSync(threadPath, newContent, 'utf8');

  if (!options.quiet) {
    console.log(chalk.green(`\n✓ Thread updated: ${message}\n`));
  }
}

/**
 * Add a loose end (unfinished task)
 */
export async function threadTodoCommand(task: string, targetPath?: string, options: ThreadOptions = {}) {
  const cwd = process.cwd();
  const absolutePath = targetPath ? path.resolve(cwd, targetPath) : cwd;
  const paradigmDir = path.join(absolutePath, '.paradigm');
  const threadPath = path.join(paradigmDir, 'thread.md');

  // Ensure .paradigm directory exists
  if (!fs.existsSync(paradigmDir)) {
    fs.mkdirSync(paradigmDir, { recursive: true });
  }

  // Load existing thread or create new
  let data: ThreadData = {
    trail: [],
    looseEnds: [],
    breadcrumbs: [],
  };

  if (fs.existsSync(threadPath)) {
    const content = fs.readFileSync(threadPath, 'utf8');
    data = parseThread(content);
  }

  // Add loose end
  data.looseEnds.push(task);

  // Generate and save
  const newContent = generateThread(data);
  fs.writeFileSync(threadPath, newContent, 'utf8');

  if (!options.quiet) {
    console.log(chalk.yellow(`\n□ Loose end added: ${task}\n`));
  }
}

/**
 * Add a breadcrumb (note for next agent)
 */
export async function threadNoteCommand(note: string, targetPath?: string, options: ThreadOptions = {}) {
  const cwd = process.cwd();
  const absolutePath = targetPath ? path.resolve(cwd, targetPath) : cwd;
  const paradigmDir = path.join(absolutePath, '.paradigm');
  const threadPath = path.join(paradigmDir, 'thread.md');

  // Ensure .paradigm directory exists
  if (!fs.existsSync(paradigmDir)) {
    fs.mkdirSync(paradigmDir, { recursive: true });
  }

  // Load existing thread or create new
  let data: ThreadData = {
    trail: [],
    looseEnds: [],
    breadcrumbs: [],
  };

  if (fs.existsSync(threadPath)) {
    const content = fs.readFileSync(threadPath, 'utf8');
    data = parseThread(content);
  }

  // Add breadcrumb
  data.breadcrumbs.push(note);

  // Generate and save
  const newContent = generateThread(data);
  fs.writeFileSync(threadPath, newContent, 'utf8');

  if (!options.quiet) {
    console.log(chalk.cyan(`\n📌 Breadcrumb added: ${note}\n`));
  }
}

/**
 * Clear the thread
 */
export async function threadClearCommand(targetPath?: string, options: ThreadOptions = {}) {
  const cwd = process.cwd();
  const absolutePath = targetPath ? path.resolve(cwd, targetPath) : cwd;
  const threadPath = path.join(absolutePath, '.paradigm', 'thread.md');

  if (fs.existsSync(threadPath)) {
    // Create empty thread
    const data: ThreadData = {
      trail: [],
      looseEnds: [],
      breadcrumbs: [],
    };
    const newContent = generateThread(data);
    fs.writeFileSync(threadPath, newContent, 'utf8');

    if (!options.quiet) {
      console.log(chalk.green('\n✓ Thread cleared.\n'));
    }
  } else {
    if (!options.quiet) {
      console.log(chalk.gray('\n  No thread to clear.\n'));
    }
  }
}
