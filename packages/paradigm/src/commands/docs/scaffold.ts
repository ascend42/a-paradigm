import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

interface DocsScaffoldOptions {
  rootDir?: string;
  quiet?: boolean;
  dryRun?: boolean;
}

const DOCS_CLASS_DIRS = ['specs', 'implementation-guides', 'prompts', 'decisions'];

function buildStub(dirName: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `# .index.yaml
# AI navigation index — read this before reading any file in this directory
version: 1.0.0
description: TODO: Describe what .paradigm/${dirName}/ contains
updated: ${today}

documents:
  # - id: example-doc
  #   file: example.md
  #   title: Example Document
  #   summary: One-line description for quick scanning
  #   tags: []

dependencies: []

subdirs: []
`;
}

export async function docsScaffoldCommand(options: DocsScaffoldOptions = {}): Promise<void> {
  const rootDir = options.rootDir || process.cwd();
  const paradigmDir = path.join(rootDir, '.paradigm');

  if (!fs.existsSync(paradigmDir)) {
    console.log(chalk.red('No .paradigm/ directory found in current directory.'));
    return;
  }

  let created = 0;
  let skipped = 0;

  for (const dirName of DOCS_CLASS_DIRS) {
    const dirPath = path.join(paradigmDir, dirName);

    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      continue; // Directory doesn't exist — skip silently
    }

    const indexPath = path.join(dirPath, '.index.yaml');

    if (fs.existsSync(indexPath)) {
      if (!options.quiet) {
        console.log(chalk.dim(`  skip  .paradigm/${dirName}/.index.yaml — already exists`));
      }
      skipped++;
      continue;
    }

    if (options.dryRun) {
      console.log(chalk.cyan(`  would create  .paradigm/${dirName}/.index.yaml`));
      created++;
      continue;
    }

    fs.writeFileSync(indexPath, buildStub(dirName), 'utf8');
    if (!options.quiet) {
      console.log(chalk.green(`  created  .paradigm/${dirName}/.index.yaml`));
    }
    created++;
  }

  if (!options.quiet) {
    const label = options.dryRun ? 'Would create' : 'Created';
    console.log('');
    console.log(`${label} ${chalk.bold(String(created))} .index.yaml stub${created === 1 ? '' : 's'}${skipped > 0 ? `, skipped ${skipped} (already exist)` : ''}.`);
    if (created > 0 && !options.dryRun) {
      console.log(chalk.dim('Edit each stub to describe the directory contents.'));
    }
  }
}
