/**
 * paradigm cost - sizes of a project's Paradigm files, in estimated tokens.
 *
 * Reports only what it reads from disk: the size of each `.purpose` file,
 * each portal file, `scan-index.json` and the Cursor rules file. Every figure
 * is a SIZE, estimated from the character count. Nothing here measures what an
 * agent loads in a session, so the command makes no savings or reduction claim.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { findPurposeFiles } from '@a-company/purpose-core';
import { findGateFiles } from '@a-company/portal-core';
import { out, dim, header, json as printJson } from '../utils/cli-output.js';

interface CostOptions {
  json?: boolean;
  detailed?: boolean;
}

export interface FileTokens {
  path: string;
  relativePath: string;
  tokens: number;
  bytes: number;
}

/** Characters per token used by the estimate. Stated in the output. */
export const CHARS_PER_TOKEN = 3.5;

/** How every figure in this command is counted. Printed and returned in --json. */
export const COST_METHOD =
  `Estimated from file size: characters / ${CHARS_PER_TOKEN}, rounded up. ` +
  'Not a tokenizer count; real counts vary by model.';

/** What the figures are not. Printed and returned in --json. */
export const COST_SCOPE =
  'These are file sizes. They are not what an agent loads in a session: ' +
  'which files or tool results a session reads is not measured here.';

export interface CostAnalysis {
  method: string;
  scope: string;
  sizes: {
    purposeFiles: FileTokens[];
    portalFiles: FileTokens[];
    scanIndex: FileTokens | null;
    cursorRules: FileTokens | null;
    purposeTotal: number;
    portalTotal: number;
    total: number;
  };
  mcpConfigured: boolean;
  notes: string[];
}

/**
 * Estimate a token count from text: characters / 3.5, rounded up.
 * An approximation, not a tokenizer; actual tokenization varies by model.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function getFileTokens(filePath: string, rootDir: string): FileTokens | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return {
      path: filePath,
      relativePath: path.relative(rootDir, filePath),
      tokens: estimateTokens(content),
      bytes: Buffer.byteLength(content, 'utf8'),
    };
  } catch {
    return null;
  }
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString();
  return `${(tokens / 1000).toFixed(1)}k`;
}

/** Read the project's Paradigm files and size each one. Prints nothing. */
export async function analyzeCost(rootDir: string): Promise<CostAnalysis> {
  const purposeFiles: FileTokens[] = [];
  for (const filePath of await findPurposeFiles(rootDir)) {
    const tokens = getFileTokens(filePath, rootDir);
    if (tokens) purposeFiles.push(tokens);
  }

  const portalFiles: FileTokens[] = [];
  for (const filePath of await findGateFiles(rootDir)) {
    const tokens = getFileTokens(filePath, rootDir);
    if (tokens) portalFiles.push(tokens);
  }

  const scanIndex = getFileTokens(path.join(rootDir, '.paradigm', 'scan-index.json'), rootDir);
  const cursorRules =
    getFileTokens(path.join(rootDir, '.cursorrules'), rootDir) ??
    getFileTokens(path.join(rootDir, '.cursor', 'rules', 'paradigm.mdc'), rootDir);

  const purposeTotal = purposeFiles.reduce((sum, f) => sum + f.tokens, 0);
  const portalTotal = portalFiles.reduce((sum, f) => sum + f.tokens, 0);
  const total = purposeTotal + portalTotal + (scanIndex?.tokens ?? 0) + (cursorRules?.tokens ?? 0);

  const mcpConfigured =
    fs.existsSync(path.join(rootDir, '.mcp.json')) ||
    fs.existsSync(path.join(rootDir, '.cursor', 'mcp.json'));

  const notes: string[] = [];
  const largeFiles = purposeFiles.filter(f => f.tokens > 500);
  if (largeFiles.length > 0) {
    notes.push(`${largeFiles.length} .purpose file(s) are larger than 500 estimated tokens.`);
  }
  if (!scanIndex) {
    notes.push('No .paradigm/scan-index.json found. Run `paradigm reindex` to build it.');
  }
  if (!mcpConfigured) {
    notes.push('No MCP config found (.mcp.json or .cursor/mcp.json). Run `paradigm mcp setup` to add one.');
  }

  return {
    method: COST_METHOD,
    scope: COST_SCOPE,
    sizes: { purposeFiles, portalFiles, scanIndex, cursorRules, purposeTotal, portalTotal, total },
    mcpConfigured,
    notes,
  };
}

export async function costCommand(targetPath: string | undefined, options: CostOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const analysis = await analyzeCost(rootDir);

  if (options.json) {
    printJson(analysis);
    return;
  }

  const { sizes } = analysis;
  const posix = (p: string) => p.split(path.sep).join('/');
  const row = (label: string, tokens: number) =>
    out(`  ${label}`.padEnd(38) + " " + chalk.yellow(`~${formatTokens(tokens)} tokens`));

  header('Paradigm file sizes (estimated tokens)');
  dim('─'.repeat(54));
  row(`.purpose files (${sizes.purposeFiles.length})`, sizes.purposeTotal);
  row(`portal files (${sizes.portalFiles.length})`, sizes.portalTotal);
  if (sizes.scanIndex) row('.paradigm/scan-index.json', sizes.scanIndex.tokens);
  if (sizes.cursorRules) row(posix(sizes.cursorRules.relativePath), sizes.cursorRules.tokens);
  dim('─'.repeat(54));
  row('Total size on disk', sizes.total);

  if (options.detailed && sizes.purposeFiles.length > 0) {
    header('Largest .purpose files');
    const sorted = [...sizes.purposeFiles].sort((a, b) => b.tokens - a.tokens).slice(0, 5);
    for (const file of sorted) {
      row(posix(file.relativePath), file.tokens);
    }
  }

  if (analysis.notes.length > 0) {
    header('Notes');
    for (const note of analysis.notes) out(`  - ${note}`);
  }

  out('');
  dim(`How counted: ${analysis.method}`);
  dim(analysis.scope);
  dim('Token usage recorded from real orchestration runs is a separate command: `paradigm calibrate`.');
  out('');
}
