/**
 * paradigm sweep — Entropy detection and cleanup
 *
 * Scans the project for 9 categories of entropy:
 *   1. Orphaned symbols — 0 cross-references from other .purpose files
 *   2. Stale purpose — .purpose older than sibling code by >14 days
 *   3. Phantom gates — portal.yaml gates with no code implementation
 *   4. Dead signals — signals in .purpose with no handler reference
 *   5. Broken flows — flow steps referencing non-existent symbols
 *   6. Lore rot — lore entries referencing deleted symbols/files
 *   7. Tag orphans — tags in tag bank never used on any symbol
 *   8. Aspect semantic drift — anchor content changed at same line
 *   9. Coverage decay — .purpose coverage below threshold
 *
 * Default behavior: auto-fix ON. Use --dry or --skip-fix to report only.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import * as yaml from 'js-yaml';
import { glob } from 'glob';
import { log } from '../../utils/logger.js';
import { recordLore, resolveAuthor } from '../../core/lore/index.js';
import type { LoreEntry } from '../../core/lore/types.js';

// ── Types ──────────────────────────────────────────────────────────────

interface SweepResult {
  check: string;
  category: 'orphaned' | 'stale' | 'phantom' | 'dead' | 'broken' | 'lore-rot' | 'tag-orphan' | 'semantic-drift' | 'coverage-decay';
  status: 'entropy' | 'ok' | 'fixed';
  symbol?: string;
  file?: string;
  message: string;
  fixAction?: string;
}

interface SweepOptions {
  dry?: boolean;
  skipFix?: boolean;
  quiet?: boolean;
  rootDir?: string;
}

interface ScanIndexEntry {
  id: string;
  name: string;
  symbol: string;
  category: string;
  path: string;
  description?: string;
  related?: string[];
}

interface ScanIndex {
  $meta: { generatedAt: string; sources: { purposeFiles: number } };
  components: Record<string, ScanIndexEntry>;
  features: Record<string, ScanIndexEntry>;
  flows: Record<string, ScanIndexEntry>;
  state: Record<string, ScanIndexEntry>;
  gates: Record<string, ScanIndexEntry>;
  signals: Record<string, ScanIndexEntry>;
  aspects: Record<string, ScanIndexEntry>;
  symbolMap: Record<string, string>;
}

interface FlowIndex {
  version: string;
  flows: Record<string, {
    id: string;
    steps: Array<{ id: string; action: string; symbol?: string }>;
    definedIn: string;
  }>;
  symbolToFlows: Record<string, string[]>;
}

// ── Helpers ────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.next', 'build', 'coverage', '__pycache__', 'target']);
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.rb', '.ex', '.exs']);
const STALE_THRESHOLD_DAYS = 14;
const COVERAGE_THRESHOLD = 90;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function shouldFix(options: SweepOptions): boolean {
  return !options.dry && !options.skipFix;
}

/**
 * Recursively find .purpose files, skipping common non-source dirs.
 */
function findPurposeFilesSync(rootDir: string): string[] {
  const found: string[] = [];
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === '.purpose') {
        found.push(full);
      }
    }
  }
  walk(rootDir);
  return found;
}

/**
 * Recursively find source directories that contain code files.
 */
function findSourceDirs(rootDir: string): string[] {
  const dirs = new Set<string>();
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    let hasCode = false;
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (CODE_EXTS.has(path.extname(entry.name))) {
        hasCode = true;
      }
    }
    if (hasCode) {
      dirs.add(dir);
    }
  }
  walk(rootDir);
  return [...dirs];
}

/**
 * Load scan-index.json if it exists, returns null otherwise.
 */
function loadScanIndex(rootDir: string): ScanIndex | null {
  const indexPath = path.join(rootDir, '.paradigm', 'scan-index.json');
  if (!fs.existsSync(indexPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8')) as ScanIndex;
  } catch {
    return null;
  }
}

/**
 * Load flow-index.json if it exists, returns null otherwise.
 */
function loadFlowIndex(rootDir: string): FlowIndex | null {
  const indexPath = path.join(rootDir, '.paradigm', 'flow-index.json');
  if (!fs.existsSync(indexPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8')) as FlowIndex;
  } catch {
    return null;
  }
}

/**
 * Extract all symbols (with prefix) from a scan index.
 */
function extractAllSymbols(index: ScanIndex): Map<string, ScanIndexEntry> {
  const map = new Map<string, ScanIndexEntry>();
  const categories: (keyof ScanIndex)[] = ['components', 'features', 'flows', 'state', 'gates', 'signals', 'aspects'];
  for (const cat of categories) {
    const bucket = index[cat] as Record<string, ScanIndexEntry> | undefined;
    if (!bucket || typeof bucket !== 'object') continue;
    for (const entry of Object.values(bucket)) {
      if (entry.symbol) {
        map.set(entry.symbol, entry);
      }
    }
  }
  return map;
}

/**
 * Grep all .purpose files for references to a symbol string.
 * Returns the count of distinct files referencing it (excluding the definition file).
 */
function countCrossReferences(symbol: string, purposeFiles: string[], definitionFile: string): number {
  let count = 0;
  for (const pf of purposeFiles) {
    if (pf === definitionFile) continue;
    try {
      const content = fs.readFileSync(pf, 'utf8');
      if (content.includes(symbol)) {
        count++;
      }
    } catch {
      // skip
    }
  }
  return count;
}

// ── Check 1: Orphaned Symbols ──────────────────────────────────────────

function checkOrphanedSymbols(
  _rootDir: string,
  index: ScanIndex | null,
  purposeFiles: string[],
  options: SweepOptions,
): SweepResult[] {
  const results: SweepResult[] = [];
  if (!index) {
    results.push({ check: 'orphaned-symbols', category: 'orphaned', status: 'ok', message: 'Skipped — no scan-index.json' });
    return results;
  }

  const allSymbols = extractAllSymbols(index);
  let orphanCount = 0;
  let fixedCount = 0;

  for (const [symbol, entry] of allSymbols) {
    const refs = countCrossReferences(symbol, purposeFiles, entry.path);
    if (refs === 0) {
      orphanCount++;
      if (shouldFix(options)) {
        // Add deprecated tag + comment to the .purpose file
        const purposePath = entry.path.endsWith('.purpose') ? entry.path : path.join(entry.path, '.purpose');
        if (fs.existsSync(purposePath)) {
          try {
            let content = fs.readFileSync(purposePath, 'utf8');
            // Only add marker if not already present
            if (!content.includes(`# orphan-detected:`) || !content.includes(symbol)) {
              content += `\n# orphan-detected: ${todayISO()} — ${symbol} has 0 cross-references\n`;
              fs.writeFileSync(purposePath, content, 'utf8');
              fixedCount++;
              results.push({
                check: 'orphaned-symbols', category: 'orphaned', status: 'fixed',
                symbol, file: purposePath,
                message: `${symbol} — 0 cross-references, marked orphan`,
                fixAction: 'Added orphan-detected comment',
              });
              continue;
            }
          } catch {
            // fall through to entropy report
          }
        }
      }
      results.push({
        check: 'orphaned-symbols', category: 'orphaned', status: 'entropy',
        symbol, file: entry.path,
        message: `${symbol} — 0 cross-references from other .purpose files`,
      });
    }
  }

  if (orphanCount === 0) {
    results.push({ check: 'orphaned-symbols', category: 'orphaned', status: 'ok', message: `All ${allSymbols.size} symbols have cross-references` });
  }

  return results;
}

// ── Check 2: Stale Purpose ─────────────────────────────────────────────

function checkStalePurpose(
  rootDir: string,
  purposeFiles: string[],
  options: SweepOptions,
): SweepResult[] {
  const results: SweepResult[] = [];
  let staleCount = 0;

  for (const pf of purposeFiles) {
    const dir = path.dirname(pf);
    let purposeMtime: number;
    try {
      purposeMtime = fs.statSync(pf).mtime.getTime();
    } catch {
      continue;
    }

    // Find the most recently modified code file in the same directory
    let newestCodeMtime = 0;
    let newestCodeFile = '';
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!CODE_EXTS.has(path.extname(entry.name))) continue;
        const stat = fs.statSync(path.join(dir, entry.name));
        if (stat.mtime.getTime() > newestCodeMtime) {
          newestCodeMtime = stat.mtime.getTime();
          newestCodeFile = entry.name;
        }
      }
    } catch {
      continue;
    }

    if (newestCodeMtime === 0) continue; // No code files in this directory

    const diffDays = (newestCodeMtime - purposeMtime) / (1000 * 60 * 60 * 24);
    if (diffDays > STALE_THRESHOLD_DAYS) {
      staleCount++;
      const relPath = path.relative(rootDir, pf);
      const staleDays = Math.floor(diffDays);

      if (shouldFix(options)) {
        try {
          let content = fs.readFileSync(pf, 'utf8');
          if (!content.includes('# stale-since:')) {
            content += `\n# stale-since: ${todayISO()} — code in ${newestCodeFile} is ${staleDays} days newer\n`;
            fs.writeFileSync(pf, content, 'utf8');
            results.push({
              check: 'stale-purpose', category: 'stale', status: 'fixed',
              file: relPath,
              message: `${relPath} — ${staleDays} days behind ${newestCodeFile}`,
              fixAction: 'Added stale-since marker',
            });
            continue;
          }
        } catch {
          // fall through
        }
      }

      results.push({
        check: 'stale-purpose', category: 'stale', status: 'entropy',
        file: relPath,
        message: `${relPath} — ${staleDays} days behind ${newestCodeFile}`,
      });
    }
  }

  if (staleCount === 0) {
    results.push({ check: 'stale-purpose', category: 'stale', status: 'ok', message: `All ${purposeFiles.length} .purpose files are fresh (within ${STALE_THRESHOLD_DAYS} days)` });
  }

  return results;
}

// ── Check 3: Phantom Gates ─────────────────────────────────────────────

async function checkPhantomGates(
  rootDir: string,
  options: SweepOptions,
): Promise<SweepResult[]> {
  const results: SweepResult[] = [];
  const portalPath = path.join(rootDir, 'portal.yaml');

  if (!fs.existsSync(portalPath)) {
    results.push({ check: 'phantom-gates', category: 'phantom', status: 'ok', message: 'No portal.yaml — skipped' });
    return results;
  }

  let portalContent: string;
  try {
    portalContent = fs.readFileSync(portalPath, 'utf8');
  } catch {
    results.push({ check: 'phantom-gates', category: 'phantom', status: 'ok', message: 'Could not read portal.yaml — skipped' });
    return results;
  }

  const portal = yaml.load(portalContent) as { gates?: Record<string, unknown>; routes?: Record<string, unknown> } | null;
  if (!portal?.gates) {
    results.push({ check: 'phantom-gates', category: 'phantom', status: 'ok', message: 'No gates defined in portal.yaml' });
    return results;
  }

  const gateNames = Object.keys(portal.gates);
  let phantomCount = 0;

  // Search code files for gate name references (without ^ prefix)
  const codeFiles = await glob('**/*.{ts,tsx,js,jsx,py,rs,go,java,rb}', {
    cwd: rootDir,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/build/**', '**/coverage/**'],
  });

  for (const gateName of gateNames) {
    // Strip ^ prefix if present
    const bareGate = gateName.startsWith('^') ? gateName.slice(1) : gateName;
    let found = false;

    for (const codeFile of codeFiles) {
      try {
        const content = fs.readFileSync(codeFile, 'utf8');
        if (content.includes(bareGate)) {
          found = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!found) {
      phantomCount++;
      const symbol = gateName.startsWith('^') ? gateName : `^${gateName}`;

      if (shouldFix(options)) {
        // Remove gate from portal.yaml
        try {
          const freshContent = fs.readFileSync(portalPath, 'utf8');
          const freshPortal = yaml.load(freshContent) as Record<string, Record<string, unknown>>;

          if (freshPortal.gates && freshPortal.gates[gateName]) {
            delete freshPortal.gates[gateName];
          }
          // Also remove routes that reference this gate
          if (freshPortal.routes) {
            for (const [route, gates] of Object.entries(freshPortal.routes)) {
              if (Array.isArray(gates) && gates.includes(symbol)) {
                const filtered = gates.filter((g: string) => g !== symbol);
                if (filtered.length === 0) {
                  delete freshPortal.routes[route];
                } else {
                  freshPortal.routes[route] = filtered;
                }
              }
            }
          }

          fs.writeFileSync(portalPath, yaml.dump(freshPortal, { lineWidth: -1, noRefs: true }), 'utf8');
          results.push({
            check: 'phantom-gates', category: 'phantom', status: 'fixed',
            symbol, file: 'portal.yaml',
            message: `${symbol} — no code implementation found`,
            fixAction: 'Removed from portal.yaml',
          });
          continue;
        } catch {
          // fall through
        }
      }

      results.push({
        check: 'phantom-gates', category: 'phantom', status: 'entropy',
        symbol, file: 'portal.yaml',
        message: `${symbol} — defined in portal.yaml but no code references "${bareGate}"`,
      });
    }
  }

  if (phantomCount === 0) {
    results.push({ check: 'phantom-gates', category: 'phantom', status: 'ok', message: `All ${gateNames.length} gates have code references` });
  }

  return results;
}

// ── Check 4: Dead Signals ──────────────────────────────────────────────

async function checkDeadSignals(
  rootDir: string,
  index: ScanIndex | null,
  _purposeFiles: string[],
  options: SweepOptions,
): Promise<SweepResult[]> {
  const results: SweepResult[] = [];
  if (!index) {
    results.push({ check: 'dead-signals', category: 'dead', status: 'ok', message: 'Skipped — no scan-index.json' });
    return results;
  }

  const signals = index.signals || {};
  const signalEntries = Object.values(signals);
  if (signalEntries.length === 0) {
    results.push({ check: 'dead-signals', category: 'dead', status: 'ok', message: 'No signals defined' });
    return results;
  }

  // Search code files for signal references
  const codeFiles = await glob('**/*.{ts,tsx,js,jsx,py,rs,go,java,rb}', {
    cwd: rootDir,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/build/**', '**/coverage/**'],
  });

  let deadCount = 0;

  for (const signal of signalEntries) {
    const bareSignal = signal.id; // e.g., "login-success"
    let found = false;

    for (const codeFile of codeFiles) {
      try {
        const content = fs.readFileSync(codeFile, 'utf8');
        if (content.includes(bareSignal)) {
          found = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!found) {
      deadCount++;
      const symbol = signal.symbol; // e.g., "!login-success"

      if (shouldFix(options)) {
        // Add deprecated tag to the .purpose file
        const purposePath = signal.path.endsWith('.purpose') ? signal.path : path.join(signal.path, '.purpose');
        if (fs.existsSync(purposePath)) {
          try {
            let content = fs.readFileSync(purposePath, 'utf8');
            if (!content.includes(`# dead-signal: ${symbol}`)) {
              content += `\n# dead-signal: ${symbol} — no handler/listener found (${todayISO()})\n`;
              fs.writeFileSync(purposePath, content, 'utf8');
              results.push({
                check: 'dead-signals', category: 'dead', status: 'fixed',
                symbol, file: purposePath,
                message: `${symbol} — no handler or listener in codebase`,
                fixAction: 'Added dead-signal marker',
              });
              continue;
            }
          } catch {
            // fall through
          }
        }
      }

      results.push({
        check: 'dead-signals', category: 'dead', status: 'entropy',
        symbol, file: signal.path,
        message: `${symbol} — no handler or listener references in codebase`,
      });
    }
  }

  if (deadCount === 0) {
    results.push({ check: 'dead-signals', category: 'dead', status: 'ok', message: `All ${signalEntries.length} signals have code references` });
  }

  return results;
}

// ── Check 5: Broken Flows ──────────────────────────────────────────────

function checkBrokenFlows(
  rootDir: string,
  index: ScanIndex | null,
  flowIndex: FlowIndex | null,
  options: SweepOptions,
): SweepResult[] {
  const results: SweepResult[] = [];
  if (!flowIndex) {
    results.push({ check: 'broken-flows', category: 'broken', status: 'ok', message: 'No flow-index.json — skipped' });
    return results;
  }
  if (!index) {
    results.push({ check: 'broken-flows', category: 'broken', status: 'ok', message: 'No scan-index.json — skipped' });
    return results;
  }

  const allSymbols = extractAllSymbols(index);
  let brokenCount = 0;

  for (const [flowId, flow] of Object.entries(flowIndex.flows)) {
    for (const step of flow.steps) {
      if (!step.symbol) continue;

      // Check if the symbol exists in the scan index
      if (!allSymbols.has(step.symbol)) {
        brokenCount++;

        if (shouldFix(options)) {
          // Comment out the broken step in the .purpose file
          const purposePath = path.join(rootDir, flow.definedIn);
          if (fs.existsSync(purposePath)) {
            try {
              let content = fs.readFileSync(purposePath, 'utf8');
              if (!content.includes(`# broken: ${step.symbol}`)) {
                content += `\n# broken: ${step.symbol} not found — ${flowId} step ${step.id} (${todayISO()})\n`;
                fs.writeFileSync(purposePath, content, 'utf8');
                results.push({
                  check: 'broken-flows', category: 'broken', status: 'fixed',
                  symbol: step.symbol, file: flow.definedIn,
                  message: `${flowId} step ${step.id} references ${step.symbol} — not found`,
                  fixAction: 'Added broken step comment',
                });
                continue;
              }
            } catch {
              // fall through
            }
          }
        }

        results.push({
          check: 'broken-flows', category: 'broken', status: 'entropy',
          symbol: step.symbol, file: flow.definedIn,
          message: `${flowId} step ${step.id} references ${step.symbol} — symbol not in scan-index`,
        });
      }
    }
  }

  if (brokenCount === 0) {
    results.push({ check: 'broken-flows', category: 'broken', status: 'ok', message: `All flow steps reference valid symbols (${Object.keys(flowIndex.flows).length} flows)` });
  }

  return results;
}

// ── Check 6: Lore Rot ──────────────────────────────────────────────────

function checkLoreRot(
  rootDir: string,
  index: ScanIndex | null,
  options: SweepOptions,
): SweepResult[] {
  const results: SweepResult[] = [];
  const loreDir = path.join(rootDir, '.paradigm', 'lore', 'entries');

  if (!fs.existsSync(loreDir)) {
    results.push({ check: 'lore-rot', category: 'lore-rot', status: 'ok', message: 'No lore entries — skipped' });
    return results;
  }

  const allSymbols = index ? extractAllSymbols(index) : new Map<string, ScanIndexEntry>();
  let rotCount = 0;

  // Walk date directories
  let dateDirs: string[];
  try {
    dateDirs = fs.readdirSync(loreDir).filter(d => {
      const full = path.join(loreDir, d);
      return fs.statSync(full).isDirectory();
    });
  } catch {
    results.push({ check: 'lore-rot', category: 'lore-rot', status: 'ok', message: 'Could not read lore directory — skipped' });
    return results;
  }

  let entryCount = 0;

  for (const dateDir of dateDirs) {
    const datePath = path.join(loreDir, dateDir);
    let files: string[];
    try {
      files = fs.readdirSync(datePath).filter(f => f.endsWith('.yaml') || f.endsWith('.lore'));
    } catch {
      continue;
    }

    for (const file of files) {
      entryCount++;
      const filePath = path.join(datePath, file);
      let entry: Record<string, unknown>;
      try {
        entry = yaml.load(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
      } catch {
        continue;
      }

      const symbolsTouched = (entry.symbols_touched as string[]) || [];
      const filesModified = (entry.files_modified as string[]) || [];
      const filesCreated = (entry.files_created as string[]) || [];
      const tags = (entry.tags as string[]) || [];

      // Check symbols still exist
      const deadSymbols: string[] = [];
      if (index) {
        for (const sym of symbolsTouched) {
          if (!allSymbols.has(sym)) {
            deadSymbols.push(sym);
          }
        }
      }

      // Check files still exist
      const deadFiles: string[] = [];
      for (const f of [...filesModified, ...filesCreated]) {
        const absFile = path.isAbsolute(f) ? f : path.join(rootDir, f);
        if (!fs.existsSync(absFile)) {
          deadFiles.push(f);
        }
      }

      if (deadSymbols.length > 0 || deadFiles.length > 0) {
        rotCount++;
        const entryId = (entry.id as string) || file;
        const details = [
          ...(deadSymbols.length > 0 ? [`dead symbols: ${deadSymbols.join(', ')}`] : []),
          ...(deadFiles.length > 0 ? [`missing files: ${deadFiles.length}`] : []),
        ].join('; ');

        if (shouldFix(options)) {
          // Add stale tag to lore entry
          try {
            if (!tags.includes('stale')) {
              const updatedTags = [...tags, 'stale'];
              entry.tags = updatedTags;
              fs.writeFileSync(filePath, yaml.dump(entry, { lineWidth: -1, noRefs: true }), 'utf8');
              results.push({
                check: 'lore-rot', category: 'lore-rot', status: 'fixed',
                symbol: entryId, file: filePath,
                message: `${entryId} — ${details}`,
                fixAction: 'Added stale tag',
              });
              continue;
            }
          } catch {
            // fall through
          }
        }

        results.push({
          check: 'lore-rot', category: 'lore-rot', status: 'entropy',
          symbol: entryId, file: filePath,
          message: `${entryId} — ${details}`,
        });
      }
    }
  }

  if (rotCount === 0) {
    results.push({ check: 'lore-rot', category: 'lore-rot', status: 'ok', message: `All ${entryCount} lore entries have valid references` });
  }

  return results;
}

// ── Check 7: Tag Orphans ───────────────────────────────────────────────

function checkTagOrphans(
  rootDir: string,
  purposeFiles: string[],
  options: SweepOptions,
): SweepResult[] {
  const results: SweepResult[] = [];
  const tagsPath = path.join(rootDir, '.paradigm', 'tags.yaml');

  if (!fs.existsSync(tagsPath)) {
    results.push({ check: 'tag-orphans', category: 'tag-orphan', status: 'ok', message: 'No tags.yaml — skipped' });
    return results;
  }

  let tagsData: Record<string, unknown>;
  try {
    tagsData = yaml.load(fs.readFileSync(tagsPath, 'utf8')) as Record<string, unknown>;
  } catch {
    results.push({ check: 'tag-orphans', category: 'tag-orphan', status: 'ok', message: 'Could not parse tags.yaml — skipped' });
    return results;
  }

  // Collect all defined tags from core and project sections
  const definedTags = new Set<string>();
  for (const section of ['core', 'project'] as const) {
    const bucket = tagsData[section] as Record<string, unknown> | undefined;
    if (bucket && typeof bucket === 'object') {
      for (const tag of Object.keys(bucket)) {
        definedTags.add(tag);
      }
    }
  }

  if (definedTags.size === 0) {
    results.push({ check: 'tag-orphans', category: 'tag-orphan', status: 'ok', message: 'No tags defined' });
    return results;
  }

  // Gather all tags used in .purpose files
  const usedTags = new Set<string>();
  for (const pf of purposeFiles) {
    try {
      const content = fs.readFileSync(pf, 'utf8');
      // Match tags: [...] in purpose files
      const tagMatches = content.matchAll(/tags:\s*\[([^\]]*)\]/g);
      for (const match of tagMatches) {
        const tagList = match[1].split(',').map(t => t.trim().replace(/['"]/g, '')).filter(Boolean);
        for (const tag of tagList) {
          usedTags.add(tag);
        }
      }
      // Also match YAML array format
      const yamlData = yaml.load(content) as Record<string, unknown> | null;
      if (yamlData) {
        function collectTags(obj: unknown): void {
          if (Array.isArray(obj)) {
            for (const item of obj) collectTags(item);
          } else if (obj && typeof obj === 'object') {
            const rec = obj as Record<string, unknown>;
            if (Array.isArray(rec.tags)) {
              for (const t of rec.tags) {
                if (typeof t === 'string') usedTags.add(t);
              }
            }
            for (const v of Object.values(rec)) collectTags(v);
          }
        }
        collectTags(yamlData);
      }
    } catch {
      continue;
    }
  }

  let orphanCount = 0;

  for (const tag of definedTags) {
    if (!usedTags.has(tag)) {
      orphanCount++;

      if (shouldFix(options)) {
        // Remove unused tag from tags.yaml
        try {
          const freshData = yaml.load(fs.readFileSync(tagsPath, 'utf8')) as Record<string, Record<string, unknown>>;
          let removed = false;
          for (const section of ['core', 'project']) {
            if (freshData[section] && freshData[section][tag]) {
              delete freshData[section][tag];
              removed = true;
            }
          }
          if (removed) {
            fs.writeFileSync(tagsPath, yaml.dump(freshData, { lineWidth: -1, noRefs: true }), 'utf8');
            results.push({
              check: 'tag-orphans', category: 'tag-orphan', status: 'fixed',
              symbol: tag, file: 'tags.yaml',
              message: `Tag "${tag}" — not used in any .purpose file`,
              fixAction: 'Removed from tags.yaml',
            });
            continue;
          }
        } catch {
          // fall through
        }
      }

      results.push({
        check: 'tag-orphans', category: 'tag-orphan', status: 'entropy',
        symbol: tag, file: '.paradigm/tags.yaml',
        message: `Tag "${tag}" — defined in tag bank but not used in any .purpose file`,
      });
    }
  }

  if (orphanCount === 0) {
    results.push({ check: 'tag-orphans', category: 'tag-orphan', status: 'ok', message: `All ${definedTags.size} tags are in use` });
  }

  return results;
}

// ── Check 8: Aspect Semantic Drift ─────────────────────────────────────

function checkAspectSemanticDrift(
  rootDir: string,
  index: ScanIndex | null,
  _options: SweepOptions,
): SweepResult[] {
  const results: SweepResult[] = [];
  const dbPath = path.join(rootDir, '.paradigm', 'aspect-graph.db');

  if (!fs.existsSync(dbPath)) {
    results.push({ check: 'aspect-semantic-drift', category: 'semantic-drift', status: 'ok', message: 'No aspect-graph.db — skipped' });
    return results;
  }

  // We check aspects in the scan index for anchor references instead
  // since loading sql.js would be heavyweight. Check .purpose aspect anchors.
  if (!index || !index.aspects) {
    results.push({ check: 'aspect-semantic-drift', category: 'semantic-drift', status: 'ok', message: 'No aspects in scan-index — skipped' });
    return results;
  }

  // For aspect semantic drift, we look for anchors defined in .purpose files
  // that have file:line format and check if content at those lines changed
  const aspects = index.aspects;
  let driftCount = 0;

  for (const [, aspect] of Object.entries(aspects)) {
    const purposePath = aspect.path.endsWith('.purpose') ? aspect.path : path.join(aspect.path, '.purpose');
    if (!fs.existsSync(purposePath)) continue;

    try {
      const content = fs.readFileSync(purposePath, 'utf8');
      // Look for anchor patterns like "file.ts:42" or "file.ts:42-50"
      const anchorPattern = /anchors?:\s*\n((?:\s+-\s+.+\n?)*)/g;
      const anchorMatch = anchorPattern.exec(content);
      if (!anchorMatch) continue;

      const anchorLines = anchorMatch[1].split('\n').filter(l => l.trim().startsWith('-'));
      for (const line of anchorLines) {
        const match = line.match(/- (.+):(\d+)(?:-(\d+))?/);
        if (!match) continue;

        const anchorFile = match[1].trim();
        const startLine = parseInt(match[2], 10);
        const endLine = match[3] ? parseInt(match[3], 10) : startLine;

        const absAnchorFile = path.isAbsolute(anchorFile) ? anchorFile : path.join(rootDir, anchorFile);
        if (!fs.existsSync(absAnchorFile)) continue;

        // Verify the anchor file is readable and lines exist
        // Full content-hash comparison requires aspect-graph.db
        // which is handled by `paradigm drift check`
        try {
          const fileContent = fs.readFileSync(absAnchorFile, 'utf8');
          const lineCount = fileContent.split('\n').length;
          if (startLine > lineCount || endLine > lineCount) {
            driftCount++;
          }
        } catch {
          // skip
        }
      }
    } catch {
      continue;
    }
  }

  if (driftCount > 0) {
    results.push({
      check: 'aspect-semantic-drift', category: 'semantic-drift', status: 'entropy',
      message: `${driftCount} aspect anchor(s) reference lines beyond file bounds — run "paradigm drift check" to repair`,
    });
  } else {
    results.push({ check: 'aspect-semantic-drift', category: 'semantic-drift', status: 'ok', message: `Aspect anchors stable (use "paradigm drift check" for deep analysis)` });
  }

  return results;
}

// ── Check 9: Coverage Decay ────────────────────────────────────────────

function checkCoverageDecay(
  rootDir: string,
  purposeFiles: string[],
  options: SweepOptions,
): SweepResult[] {
  const results: SweepResult[] = [];

  const sourceDirs = findSourceDirs(rootDir);
  if (sourceDirs.length === 0) {
    results.push({ check: 'coverage-decay', category: 'coverage-decay', status: 'ok', message: 'No source directories found' });
    return results;
  }

  // A directory is "covered" if it has a .purpose file or an ancestor has one
  const purposeDirs = new Set(purposeFiles.map(pf => path.dirname(pf)));
  const uncoveredDirs: string[] = [];

  for (const dir of sourceDirs) {
    let covered = false;
    let current = dir;
    // Walk up checking each level for a .purpose
    while (current.startsWith(rootDir)) {
      if (purposeDirs.has(current)) {
        covered = true;
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (!covered) {
      uncoveredDirs.push(dir);
    }
  }

  const coveragePct = sourceDirs.length > 0
    ? Math.round(((sourceDirs.length - uncoveredDirs.length) / sourceDirs.length) * 100)
    : 100;

  if (coveragePct < COVERAGE_THRESHOLD) {
    if (shouldFix(options)) {
      let generatedCount = 0;
      for (const dir of uncoveredDirs) {
        const purposePath = path.join(dir, '.purpose');
        if (!fs.existsSync(purposePath)) {
          try {
            const dirName = path.basename(dir);
            const relDir = path.relative(rootDir, dir);
            const skeleton = [
              `# ${dirName}`,
              `# Auto-generated by paradigm sweep — ${todayISO()}`,
              `# TODO: Add component descriptions and symbol declarations`,
              ``,
              `#${dirName}:`,
              `  description: "${relDir}"`,
              `  tags: []`,
              ``,
            ].join('\n');
            fs.writeFileSync(purposePath, skeleton, 'utf8');
            generatedCount++;
          } catch {
            // skip directories we can't write to
          }
        }
      }

      if (generatedCount > 0) {
        results.push({
          check: 'coverage-decay', category: 'coverage-decay', status: 'fixed',
          message: `Coverage at ${coveragePct}% (threshold: ${COVERAGE_THRESHOLD}%) — generated ${generatedCount} skeleton .purpose files`,
          fixAction: `Generated ${generatedCount} skeleton .purpose files`,
        });
        return results;
      }
    }

    results.push({
      check: 'coverage-decay', category: 'coverage-decay', status: 'entropy',
      message: `Coverage at ${coveragePct}% — below ${COVERAGE_THRESHOLD}% threshold (${uncoveredDirs.length} directories uncovered)`,
    });
  } else {
    results.push({
      check: 'coverage-decay', category: 'coverage-decay', status: 'ok',
      message: `Coverage at ${coveragePct}% (${sourceDirs.length} source dirs, ${purposeFiles.length} .purpose files)`,
    });
  }

  return results;
}

// ── Lore Recording ─────────────────────────────────────────────────────

async function recordSweepLore(
  rootDir: string,
  allResults: SweepResult[],
): Promise<string | null> {
  const entropyResults = allResults.filter(r => r.status === 'entropy');
  const fixedResults = allResults.filter(r => r.status === 'fixed');
  const okResults = allResults.filter(r => r.status === 'ok');

  const categories = new Set(allResults.map(r => r.category));
  const symbolsTouched = allResults
    .filter(r => r.symbol)
    .map(r => r.symbol!)
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .slice(0, 20); // Cap at 20

  const summary = [
    `Sweep completed: ${categories.size} categories checked.`,
    entropyResults.length > 0 ? `${entropyResults.length} entropy issue(s) found.` : '',
    fixedResults.length > 0 ? `${fixedResults.length} issue(s) auto-resolved.` : '',
    `${okResults.length} categories healthy.`,
  ].filter(Boolean).join(' ');

  const entry: LoreEntry = {
    id: '',
    type: 'insight',
    timestamp: new Date().toISOString(),
    author: resolveAuthor(),
    title: `Sweep: ${entropyResults.length + fixedResults.length} issues, ${fixedResults.length} fixed`,
    summary,
    symbols_touched: symbolsTouched,
    tags: ['arc:sweep', 'automated'],
  };

  try {
    await recordLore(rootDir, entry);
    return entry.id;
  } catch {
    return null;
  }
}

// ── Main Command ───────────────────────────────────────────────────────

export async function sweepCommand(options: SweepOptions): Promise<void> {
  const rootDir = options.rootDir || process.cwd();
  const quiet = options.quiet;
  const spinner = ora();
  const tracker = log.command('sweep').start('Running entropy detection');

  if (!quiet) {
    console.log(chalk.blue('\nParadigm Sweep Report') + chalk.gray(` — ${todayISO()}`));
    console.log(chalk.gray('==================================='));
    if (options.dry || options.skipFix) {
      console.log(chalk.yellow('  Mode: dry run (no fixes applied)\n'));
    }
  }

  // Load shared data
  spinner.start('Loading project data...');
  const purposeFiles = findPurposeFilesSync(rootDir);
  const scanIndex = loadScanIndex(rootDir);
  const flowIndex = loadFlowIndex(rootDir);
  spinner.succeed(`Loaded: ${purposeFiles.length} .purpose files, scan-index ${scanIndex ? 'present' : 'absent'}`);

  const allResults: SweepResult[] = [];

  // Run all 9 checks
  const checks: Array<{ name: string; run: () => SweepResult[] | Promise<SweepResult[]> }> = [
    { name: 'Orphaned symbols', run: () => checkOrphanedSymbols(rootDir, scanIndex, purposeFiles, options) },
    { name: 'Stale purpose files', run: () => checkStalePurpose(rootDir, purposeFiles, options) },
    { name: 'Phantom gates', run: () => checkPhantomGates(rootDir, options) },
    { name: 'Dead signals', run: () => checkDeadSignals(rootDir, scanIndex, purposeFiles, options) },
    { name: 'Broken flows', run: () => checkBrokenFlows(rootDir, scanIndex, flowIndex, options) },
    { name: 'Lore rot', run: () => checkLoreRot(rootDir, scanIndex, options) },
    { name: 'Tag orphans', run: () => checkTagOrphans(rootDir, purposeFiles, options) },
    { name: 'Aspect semantic drift', run: () => checkAspectSemanticDrift(rootDir, scanIndex, options) },
    { name: 'Coverage decay', run: () => checkCoverageDecay(rootDir, purposeFiles, options) },
  ];

  for (const check of checks) {
    spinner.start(`Checking: ${check.name}...`);
    const checkResults = await check.run();
    allResults.push(...checkResults);
    const hasEntropy = checkResults.some(r => r.status === 'entropy');
    const hasFixed = checkResults.some(r => r.status === 'fixed');
    if (hasEntropy) {
      spinner.warn(chalk.yellow(`${check.name}`));
    } else if (hasFixed) {
      spinner.succeed(chalk.green(`${check.name} (auto-fixed)`));
    } else {
      spinner.succeed(chalk.green(check.name));
    }
  }

  // ── Report ─────────────────────────────────────────────────────────

  if (!quiet) {
    const symbolCount = scanIndex ? extractAllSymbols(scanIndex).size : 0;
    console.log(chalk.gray(`\nChecked: 9 categories, ${symbolCount} symbols, ${purposeFiles.length} .purpose files\n`));

    // Entropy
    const entropyResults = allResults.filter(r => r.status === 'entropy');
    if (entropyResults.length > 0) {
      console.log(chalk.red.bold('ENTROPY FOUND:'));
      for (const r of entropyResults) {
        console.log(`  ${chalk.red(`[${r.category}]`)}  ${r.message}`);
      }
      console.log();
    }

    // Healthy
    const okResults = allResults.filter(r => r.status === 'ok');
    if (okResults.length > 0) {
      console.log(chalk.green.bold('HEALTHY:'));
      for (const r of okResults) {
        console.log(`  ${chalk.green('[ok]')} ${r.check} — ${r.message}`);
      }
      console.log();
    }

    // Fixed
    const fixedResults = allResults.filter(r => r.status === 'fixed');
    if (fixedResults.length > 0) {
      console.log(chalk.cyan.bold('RESOLVED (auto-fixed):'));
      for (const r of fixedResults) {
        console.log(`  ${chalk.cyan('[fixed]')}  ${r.message}`);
        if (r.fixAction) {
          console.log(chalk.gray(`           ${r.fixAction}`));
        }
      }
      console.log();
    }

    // Record lore
    const loreId = await recordSweepLore(rootDir, allResults);

    // Summary line
    const issueCount = entropyResults.length + fixedResults.length;
    const parts = [
      `${issueCount} issue${issueCount !== 1 ? 's' : ''} found`,
      fixedResults.length > 0 ? `${fixedResults.length} auto-resolved` : null,
      loreId ? `Lore recorded: ${loreId}` : null,
    ].filter(Boolean).join(', ');

    console.log(chalk.gray(`Summary: ${parts}`));
    console.log();
  }

  const hasEntropy = allResults.some(r => r.status === 'entropy');
  if (hasEntropy) {
    tracker.error('Entropy detected', {
      entropy: allResults.filter(r => r.status === 'entropy').length,
      fixed: allResults.filter(r => r.status === 'fixed').length,
    });
  } else {
    tracker.success('Clean sweep', {
      fixed: allResults.filter(r => r.status === 'fixed').length,
      ok: allResults.filter(r => r.status === 'ok').length,
    });
  }
}
