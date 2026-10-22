/**
 * #loop-cli — `paradigm loop new|validate|list` (docs/specs/gnomon-loops.md §5; build plan LP1).
 *
 * Authoring side of Gnomon loops: `.paradigm/loops/<id>.yaml` is validated and compiled by #loop-schema
 * (`@a-company/gnomon/loops`, through #loop-files) into `<id>.loop.json`, the only form the kernel reads.
 * Writing or validating a file never makes a loop run: Gnomon runs a loop only after a human trusts its exact
 * content hash (`gnomon loop trust`, LP2).
 */
import * as path from 'path';
import { out, success, warn, error, dim, header, kv, json } from '../../utils/cli-output.js';
import {
  defaultTemplateFlow,
  issueLines,
  listLoops,
  orphanLoopJson,
  loopTemplate,
  validateAllLoops,
  validateLoopFile,
  writeLoop,
  isLoopId,
  loopYamlPath,
  LOOP_EXAMPLE_NAMES,
  type LoopExampleName,
  type LoopFileResult,
} from '../../../../paradigm-mcp/src/utils/loop-files.js';
import { log as libraryLog } from '../../../../paradigm-mcp/src/utils/mcp-logger.js';

export interface LoopCliOptions {
  json?: boolean;
  /** Project root (default: cwd). */
  root?: string;
}

const TRUST_HINT = 'Nothing runs until you trust this exact definition in Gnomon.';

/** Library INFO lines (#loop-files) go to stderr for MCP use; on the CLI only cli-output lines show (as #brain-cli). */
function quiet(): void {
  if (process.env.LOG_LEVEL) return;
  (libraryLog as unknown as { level: string }).level = 'warn';
}

function printResult(r: LoopFileResult): void {
  if (r.ok) {
    success(`${r.file} is valid${r.compiledFile ? ` → ${r.compiledFile}` : ''}`);
  } else {
    error(`${r.file}: ${r.errors.length} problem${r.errors.length === 1 ? '' : 's'}`);
    for (const line of issueLines(r.errors)) out(`  ${line}`);
    if (r.removedStale) dim(`  removed the stale ${r.id}.loop.json (the kernel never reads a definition the YAML no longer says)`);
  }
  for (const line of issueLines(r.warnings)) warn(`  ${line}`);
}

/** paradigm loop new <id> [--example flow-health|green|watch|tidy] [--flow $id] */
export async function loopNewCommand(id: string, options: LoopCliOptions & { example?: string; flow?: string } = {}): Promise<void> {
  quiet();
  const root = options.root ?? process.cwd();
  if (!isLoopId(id)) {
    error('A loop id is kebab-case, 64 characters at most (for example: nightly-typecheck).');
    process.exitCode = 1;
    return;
  }
  if (options.example !== undefined && !(LOOP_EXAMPLE_NAMES as readonly string[]).includes(options.example)) {
    error(`--example is one of: ${LOOP_EXAMPLE_NAMES.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const flow = options.flow ?? defaultTemplateFlow(root);
  const text = loopTemplate(id, options.example as LoopExampleName | undefined, flow);
  const r = writeLoop(root, 'create', { id, yaml: text });
  if (options.json) {
    json(r);
    if ('error' in r || !r.ok) process.exitCode = 1;
    return;
  }
  if ('error' in r) {
    error(r.error);
    process.exitCode = 1;
    return;
  }
  if (!r.ok) {
    printResult(r);
    process.exitCode = 1;
    return;
  }
  success(`Created ${r.file}${options.example ? ` from the ${options.example} example` : ''}`);
  kv('compiled', r.compiledFile ?? '');
  for (const line of issueLines(r.warnings)) warn(line);
  dim(TRUST_HINT);
}

/**
 * paradigm loop validate [file|id] [--all] — writes each compiled .loop.json on success. A file must sit directly
 * in .paradigm/loops/ (Aegis LP1 #6); --all (the default with no file) also removes orphan compiled JSON.
 */
export async function loopValidateCommand(file: string | undefined, options: LoopCliOptions & { all?: boolean } = {}): Promise<void> {
  quiet();
  const root = options.root ?? process.cwd();
  let results: LoopFileResult[];
  let removedOrphans: string[] = [];
  try {
    if (file && !options.all) {
      const target = isLoopId(file) ? loopYamlPath(root, file) : path.resolve(root, file);
      results = [validateLoopFile(root, target)];
    } else {
      const all = validateAllLoops(root);
      results = all.results;
      removedOrphans = all.removedOrphans;
    }
  } catch (e) {
    error((e as Error).message);
    process.exitCode = 1;
    return;
  }
  const ok = results.every((r) => r.ok);
  if (!ok) process.exitCode = 1;
  if (options.json) {
    json({ ok, results, removedOrphans });
    return;
  }
  for (const o of removedOrphans) dim(`removed ${o} (its YAML is gone)`);
  if (results.length === 0) {
    dim('No loops in .paradigm/loops/. Create one with: paradigm loop new <id> --example green');
    return;
  }
  header('Loops');
  for (const r of results) printResult(r);
  if (ok) dim(TRUST_HINT);
}

/** paradigm loop list */
export async function loopListCommand(options: LoopCliOptions = {}): Promise<void> {
  quiet();
  const root = options.root ?? process.cwd();
  let loops: ReturnType<typeof listLoops>;
  let orphans: string[];
  try {
    loops = listLoops(root);
    orphans = orphanLoopJson(root);
  } catch (e) {
    error((e as Error).message);
    process.exitCode = 1;
    return;
  }
  if (options.json) {
    json({ loops, orphans });
    return;
  }
  for (const o of orphans) warn(`${o} has no YAML (run paradigm loop validate --all to remove it)`);
  if (loops.length === 0) {
    dim('No loops in .paradigm/loops/. Create one with: paradigm loop new <id> --example green');
    return;
  }
  header(`Loops (${loops.length})`);
  for (const l of loops) {
    const state = l.refused ? `refused: ${l.refused}` : !l.ok ? `invalid (${l.errorCount})` : l.compiled === 'fresh' ? 'valid' : l.compiled === 'stale' ? 'valid, compiled JSON stale' : 'valid, not compiled';
    out(`  ${l.id}${l.title ? ` — ${l.title}` : ''}`);
    kv('  state', state);
    if (l.autonomy) kv('  autonomy', l.autonomy);
    kv('  triggers', l.triggers.length ? l.triggers.join(', ') : 'manual');
  }
  if (loops.some((l) => l.compiled !== 'fresh' && l.ok)) dim('Run paradigm loop validate --all to refresh the compiled JSON.');
}
