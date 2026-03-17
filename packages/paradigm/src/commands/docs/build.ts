/**
 * paradigm docs build — Static export of documentation
 *
 * Generates SPA bundle + pre-fetched JSON data for all pages,
 * enabling fully static hosting of documentation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import {
  buildDocsManifest,
  buildSymbolPage,
  buildFlowPage,
  buildPortalPage,
  loadCustomPages,
  loadDocsConfig,
} from '../../../../paradigm-mcp/src/utils/docs-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DocsBuildOptions {
  output?: string;
}

export async function docsBuildCommand(options: DocsBuildOptions): Promise<void> {
  // Find project root
  let rootDir = process.cwd();
  while (rootDir !== '/') {
    if (fs.existsSync(path.join(rootDir, '.paradigm'))) break;
    rootDir = path.dirname(rootDir);
  }
  if (rootDir === '/') {
    console.error(chalk.red('  Not in a Paradigm project (no .paradigm/ directory found)'));
    process.exit(1);
  }

  const config = loadDocsConfig(rootDir);
  const outputDir = options.output || config.output || '.paradigm/docs-site';
  const outputPath = path.resolve(rootDir, outputDir);
  const dataDir = path.join(outputPath, '_data');

  console.log(chalk.cyan(`\n  Building docs to ${chalk.white(outputPath)}...\n`));

  // Create output directories
  fs.mkdirSync(path.join(dataDir, 'symbols'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'flows'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'pages'), { recursive: true });

  // Build manifest
  const manifest = buildDocsManifest(rootDir, config);
  fs.writeFileSync(
    path.join(dataDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
  console.log(chalk.gray(`  manifest.json (${manifest.totalSymbols} symbols)`));

  // Build symbol pages
  let symbolCount = 0;
  for (const group of manifest.groups) {
    const items = [...group.items];
    if (group.subgroups) {
      for (const sg of group.subgroups) {
        items.push(...sg.items);
      }
    }
    for (const item of items) {
      if (['component', 'signal', 'aspect', 'gate'].includes(item.kind)) {
        const page = buildSymbolPage(rootDir, item.id);
        if (page) {
          fs.writeFileSync(
            path.join(dataDir, 'symbols', `${item.id}.json`),
            JSON.stringify(page, null, 2),
            'utf8',
          );
          symbolCount++;
        }
      } else if (item.kind === 'flow') {
        const page = buildFlowPage(rootDir, item.id);
        if (page) {
          fs.writeFileSync(
            path.join(dataDir, 'flows', `${item.id}.json`),
            JSON.stringify(page, null, 2),
            'utf8',
          );
        }
      }
    }
  }

  // Build portal page
  const portal = buildPortalPage(rootDir);
  fs.writeFileSync(
    path.join(dataDir, 'portal.json'),
    JSON.stringify(portal, null, 2),
    'utf8',
  );

  // Build custom pages
  const customPages = loadCustomPages(rootDir, config.customContent);
  for (const page of customPages) {
    fs.writeFileSync(
      path.join(dataDir, 'pages', `${page.slug}.json`),
      JSON.stringify(page, null, 2),
      'utf8',
    );
  }

  // Copy platform-ui dist if available (for SPA shell)
  let uiDistPath = path.join(__dirname, '..', '..', 'platform-ui', 'dist');
  if (!fs.existsSync(uiDistPath)) {
    uiDistPath = path.join(__dirname, '..', '..', '..', 'platform-ui', 'dist');
  }
  if (fs.existsSync(uiDistPath)) {
    copyDir(uiDistPath, outputPath);
    console.log(chalk.gray('  Copied SPA shell'));
  }

  console.log(chalk.gray(`  ${symbolCount} symbol pages`));
  console.log(chalk.gray(`  ${customPages.length} custom pages`));
  console.log(chalk.gray('  portal.json'));
  console.log(chalk.green(`\n  Docs built to ${outputPath}\n`));
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '_data') {
        // Don't overwrite our data directory
        copyDir(srcPath, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
