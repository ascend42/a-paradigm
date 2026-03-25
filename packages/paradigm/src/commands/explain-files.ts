/**
 * paradigm explain-files - Explain all Paradigm config and generated files
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

interface FileEntry {
  path: string;
  description: string;
  isDirectory?: boolean;
}

interface FileCategory {
  title: string;
  color: (text: string) => string;
  entries: FileEntry[];
}

export async function explainFilesCommand() {
  const cwd = process.cwd();

  const categories: FileCategory[] = [
    {
      title: 'Required (you create and maintain these):',
      color: chalk.yellow,
      entries: [
        { path: '.paradigm/config.yaml', description: 'Project configuration — discipline, conventions, AI settings' },
        { path: 'portal.yaml', description: 'Security gates and route protection' },
        { path: '.purpose', description: 'Component/flow/gate declarations (one per directory)' },
      ],
    },
    {
      title: 'Optional (you can create these):',
      color: chalk.cyan,
      entries: [
        { path: '.paradigm/agents.yaml', description: 'Custom agent definitions for this project' },
        { path: '.paradigm/roster.yaml', description: 'Which agents are active on this project' },
        { path: '.paradigm/habits.yaml', description: 'Behavioral compliance rules' },
      ],
    },
    {
      title: 'Auto-generated (do not edit manually):',
      color: chalk.magenta,
      entries: [
        { path: '.paradigm/scan-index.json', description: 'Symbol index — rebuilt by paradigm scan / pre-commit hook' },
        { path: '.paradigm/flow-index.json', description: 'Flow index — rebuilt by paradigm scan' },
        { path: '.paradigm/navigator.yaml', description: 'Navigation index — rebuilt automatically' },
        { path: '.paradigm/team-state.yaml', description: 'Orchestration state — managed by Maestro' },
        { path: '.paradigm/history/', description: 'Implementation history — recorded by hooks', isDirectory: true },
        { path: '.paradigm/events/', description: 'Event stream — written by hooks and tools', isDirectory: true },
        { path: '.paradigm/lore/', description: 'Session history — recorded via paradigm_lore_record', isDirectory: true },
        { path: '.paradigm/notebooks/', description: 'Agent knowledge — managed via paradigm_notebook_add', isDirectory: true },
      ],
    },
    {
      title: 'IDE Integration:',
      color: chalk.blue,
      entries: [
        { path: '.cursorrules', description: 'Cursor IDE instructions (auto-generated)' },
        { path: '.cursor/rules/', description: 'Cursor rule files (auto-generated)', isDirectory: true },
        { path: '.cursor/hooks/', description: 'Cursor hook scripts (auto-generated)', isDirectory: true },
        { path: 'CLAUDE.md', description: 'Claude Code context file' },
        { path: 'AGENTS.md', description: 'Agent definitions for Claude Code' },
        { path: 'plugins/paradigm/', description: 'Claude Code plugin (skills, hooks, agents)', isDirectory: true },
      ],
    },
  ];

  console.log(chalk.bold('\nParadigm Project Files\n'));

  for (const category of categories) {
    console.log(`  ${category.color(category.title)}`);

    // Find the longest path for alignment
    const maxPathLen = Math.max(...category.entries.map(e => e.path.length));

    for (const entry of category.entries) {
      const fullPath = path.join(cwd, entry.path);
      const exists = entry.isDirectory
        ? fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()
        : fs.existsSync(fullPath);

      const indicator = exists ? chalk.green('\u2713') : chalk.gray('\u2013');
      const padding = ' '.repeat(maxPathLen - entry.path.length + 2);
      const filePath = exists ? chalk.white(entry.path) : chalk.gray(entry.path);
      const desc = chalk.gray(entry.description);

      console.log(`    ${indicator} ${filePath}${padding}${desc}`);
    }

    console.log('');
  }
}
