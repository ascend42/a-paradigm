#!/usr/bin/env node
/**
 * generate-hooks.mjs — Single source of truth for hook scripts
 *
 * Reads canonical .sh files from src/commands/hooks/scripts/,
 * generates a TypeScript module with escaped template literal exports,
 * and copies scripts to both plugin directories (Claude Code + Cursor).
 *
 * Usage:
 *   node scripts/generate-hooks.mjs          # Generate + copy
 *   node scripts/generate-hooks.mjs --check  # Dry-run, exits non-zero if stale
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const SCRIPTS_DIR = join(PKG_ROOT, 'src', 'commands', 'hooks', 'scripts');
const GENERATED_PATH = join(PKG_ROOT, 'src', 'commands', 'hooks', 'generated-hooks.ts');
const PLUGIN_DIR = join(PKG_ROOT, '..', '..', 'plugins', 'paradigm', 'scripts');
const CURSOR_PLUGIN_DIR = join(PKG_ROOT, '..', '..', 'plugins', 'paradigm-cursor', 'scripts');

const isCheck = process.argv.includes('--check');

// Map: script filename → TS export name
const HOOKS = [
  { file: 'claude-code-stop.sh',       exportName: 'CLAUDE_CODE_STOP_HOOK' },
  { file: 'claude-code-postwrite.sh',  exportName: 'CLAUDE_CODE_POSTWRITE_HOOK' },
  { file: 'claude-code-precommit.sh',  exportName: 'CLAUDE_CODE_PRECOMMIT_HOOK' },
  { file: 'cursor-session-start.sh',   exportName: 'CURSOR_SESSION_START_HOOK' },
  { file: 'cursor-stop.sh',            exportName: 'CURSOR_STOP_HOOK' },
  { file: 'cursor-postwrite.sh',       exportName: 'CURSOR_POSTWRITE_HOOK' },
  { file: 'cursor-precommit.sh',       exportName: 'CURSOR_PRECOMMIT_HOOK' },
  { file: 'cursor-pretooluse.sh',      exportName: 'CURSOR_PRETOOLUSE_HOOK' },
  { file: 'cursor-posttooluse.sh',     exportName: 'CURSOR_POSTTOOLUSE_HOOK' },
];

// Map: claude-code script → Claude Code plugin destination filename
const PLUGIN_COPIES = [
  { src: 'claude-code-stop.sh',       dest: 'paradigm-stop.sh' },
  { src: 'claude-code-postwrite.sh',  dest: 'paradigm-postwrite.sh' },
  { src: 'claude-code-precommit.sh',  dest: 'paradigm-precommit.sh' },
];

// Map: cursor script → Cursor plugin destination filename
const CURSOR_PLUGIN_COPIES = [
  { src: 'cursor-session-start.sh',   dest: 'paradigm-session-start.sh' },
  { src: 'cursor-stop.sh',            dest: 'paradigm-stop.sh' },
  { src: 'cursor-postwrite.sh',       dest: 'paradigm-postwrite.sh' },
  { src: 'cursor-precommit.sh',       dest: 'paradigm-precommit.sh' },
  { src: 'cursor-pretooluse.sh',      dest: 'paradigm-pretooluse.sh' },
  { src: 'cursor-posttooluse.sh',     dest: 'paradigm-posttooluse.sh' },
];

/**
 * Escape shell script content for embedding in a TS template literal.
 * Template literals need: \ → \\, ` → \`, ${ → \${
 */
function escapeForTemplateLiteral(content) {
  return content
    .replace(/\\/g, '\\\\')     // \ → \\
    .replace(/`/g, '\\`')       // ` → \`
    .replace(/\$\{/g, '\\${');  // ${ → \${
}

// --- Read all scripts ---
const scripts = new Map();
for (const hook of HOOKS) {
  const filePath = join(SCRIPTS_DIR, hook.file);
  if (!existsSync(filePath)) {
    console.error(`Missing script: ${filePath}`);
    process.exit(1);
  }
  scripts.set(hook.file, readFileSync(filePath, 'utf8'));
}

// --- Generate TypeScript module ---
const HEADER = `// AUTO-GENERATED — DO NOT EDIT
// Source: packages/paradigm/src/commands/hooks/scripts/*.sh
// Generator: packages/paradigm/scripts/generate-hooks.mjs
//
// To update, edit the .sh files and run: node scripts/generate-hooks.mjs

`;

let tsContent = HEADER;
for (const hook of HOOKS) {
  const raw = scripts.get(hook.file);
  const escaped = escapeForTemplateLiteral(raw);
  tsContent += `export const ${hook.exportName} = \`${escaped}\`;\n\n`;
}

/**
 * Check a set of copy targets for staleness.
 */
function checkCopies(copies, destDir, label) {
  let stale = false;
  for (const copy of copies) {
    const srcContent = scripts.get(copy.src);
    const destPath = join(destDir, copy.dest);
    if (!existsSync(destPath)) {
      console.error(`STALE: ${destPath} does not exist`);
      stale = true;
    } else {
      const existing = readFileSync(destPath, 'utf8');
      if (existing !== srcContent) {
        console.error(`STALE: ${destPath} differs from ${copy.src}`);
        stale = true;
      }
    }
  }
  return stale;
}

/**
 * Copy scripts to a plugin directory.
 */
function doCopies(copies, srcDir, destDir, label) {
  mkdirSync(destDir, { recursive: true });
  for (const copy of copies) {
    const srcPath = join(srcDir, copy.src);
    const destPath = join(destDir, copy.dest);
    copyFileSync(srcPath, destPath);
    console.log(`Copied: ${copy.src} → ${label}/${copy.dest}`);
  }
}

// --- Check mode: compare and report ---
if (isCheck) {
  let stale = false;

  // Check generated-hooks.ts
  if (!existsSync(GENERATED_PATH)) {
    console.error(`STALE: ${GENERATED_PATH} does not exist`);
    stale = true;
  } else {
    const existing = readFileSync(GENERATED_PATH, 'utf8');
    if (existing !== tsContent) {
      console.error(`STALE: ${GENERATED_PATH} is out of date`);
      stale = true;
    }
  }

  // Check Claude Code plugin copies
  stale = checkCopies(PLUGIN_COPIES, PLUGIN_DIR, 'plugins/paradigm') || stale;

  // Check Cursor plugin copies
  stale = checkCopies(CURSOR_PLUGIN_COPIES, CURSOR_PLUGIN_DIR, 'plugins/paradigm-cursor') || stale;

  if (stale) {
    console.error('\nRun: node scripts/generate-hooks.mjs');
    process.exit(1);
  }

  console.log('All generated hook files are up to date.');
  process.exit(0);
}

// --- Write mode ---

// 1. Write generated-hooks.ts
writeFileSync(GENERATED_PATH, tsContent, 'utf8');
console.log(`Generated: ${GENERATED_PATH}`);

// 2. Copy Claude Code scripts to plugin directory
doCopies(PLUGIN_COPIES, SCRIPTS_DIR, PLUGIN_DIR, 'plugins/paradigm/scripts');

// 3. Copy Cursor scripts to Cursor plugin directory
doCopies(CURSOR_PLUGIN_COPIES, SCRIPTS_DIR, CURSOR_PLUGIN_DIR, 'plugins/paradigm-cursor/scripts');

console.log('Done.');
