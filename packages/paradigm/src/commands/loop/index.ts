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

/** The builtins a loop check node may name (#loop-schema LOOP_BUILTINS); Gnomon runs them through this command. */
export const LOOP_BUILTIN_NAMES = [
  'paradigm.flow-check', 'paradigm.flow-affected', 'paradigm.ripple', 'paradigm.purpose-validate',
  'paradigm.drift', 'paradigm.reindex', 'git.clean',
] as const;
export type LoopBuiltinName = (typeof LOOP_BUILTIN_NAMES)[number];

export interface LoopBuiltinResult {
  builtin: string;
  ok: boolean;
  passed: number;
  failed: number;
  error?: string;
  result?: unknown;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Run one builtin against `root` through the existing MCP handlers (never reimplemented) and count pass/fail. */
export async function runLoopBuiltin(name: string, root: string, args: Record<string, unknown> = {}): Promise<LoopBuiltinResult> {
  if (!(LOOP_BUILTIN_NAMES as readonly string[]).includes(name)) {
    return { builtin: name, ok: false, passed: 0, failed: 0, error: `unknown builtin (one of: ${LOOP_BUILTIN_NAMES.join(', ')})` };
  }
  const done = (passed: number, failed: number, result: unknown): LoopBuiltinResult => ({ builtin: name, ok: failed === 0, passed, failed, result });
  const errorOf = (r: unknown): string | null => (r && typeof r === 'object' && typeof (r as { error?: unknown }).error === 'string' ? (r as { error: string }).error : null);
  try {
    if (name === 'git.clean') {
      const { spawnSync } = await import('child_process');
      const g = spawnSync('git', ['-c', 'core.fsmonitor=false', 'status', '--porcelain'], { cwd: root, encoding: 'utf8' });
      if (g.status !== 0) return { builtin: name, ok: false, passed: 0, failed: 0, error: `git status failed: ${(g.stderr || String(g.error ?? '')).trim().slice(0, 300)}` };
      const lines = g.stdout.split('\n').filter(Boolean);
      return done(lines.length ? 0 : 1, lines.length, { dirty: lines });
    }
    const { loadProjectContext } = await import('../../../../paradigm-mcp/src/utils/index-loader.js');
    const ctx = await loadProjectContext(root);
    let text: string;
    switch (name as LoopBuiltinName) {
      case 'paradigm.flow-check':
      case 'paradigm.flow-affected': {
        const { handleFlowTool } = await import('../../../../paradigm-mcp/src/tools/flows.js');
        text = (await handleFlowTool(name === 'paradigm.flow-check' ? 'paradigm_flow_check' : 'paradigm_flows_affected', args, ctx)).text;
        break;
      }
      case 'paradigm.ripple': {
        const { handleRippleTool } = await import('../../../../paradigm-mcp/src/tools/ripple.js');
        text = (await handleRippleTool('paradigm_ripple', args, ctx)).text;
        break;
      }
      case 'paradigm.purpose-validate': {
        const { handlePurposePortalTool } = await import('../../../../paradigm-mcp/src/tools/purpose-portal.js');
        text = (await handlePurposePortalTool('paradigm_purpose_validate', args, ctx, async () => {})).text;
        break;
      }
      case 'paradigm.drift': {
        const { handleAspectGraphTool } = await import('../../../../paradigm-mcp/src/tools/aspect-graph.js');
        // a check never heals: report drift, write nothing
        text = (await handleAspectGraphTool('paradigm_aspect_drift', { ...args, autoHeal: false }, ctx)).text;
        break;
      }
      default: {
        const { handleReindexTool } = await import('../../../../paradigm-mcp/src/tools/reindex.js');
        text = (await handleReindexTool('paradigm_reindex', args, ctx, () => loadProjectContext(root))).text;
      }
    }
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { builtin: name, ok: false, passed: 0, failed: 0, error: text.slice(0, 300) };
    }
    const e = errorOf(r);
    if (e) return { builtin: name, ok: false, passed: 0, failed: 0, error: e, result: r };
    switch (name as LoopBuiltinName) {
      case 'paradigm.flow-check':
        return done(num(r.validFlows), num(r.invalidFlows), r);
      case 'paradigm.flow-affected':
        return done(num(r.totalFlows), 0, r);
      case 'paradigm.ripple':
        return done(num((r.summary as Record<string, unknown> | undefined)?.totalAffected), 0, r);
      case 'paradigm.purpose-validate': {
        const files = Array.isArray(r.results) ? (r.results as Array<{ valid?: boolean }>) : [];
        return done(files.filter((f) => f.valid !== false).length, files.filter((f) => f.valid === false).length, r);
      }
      case 'paradigm.drift':
        return done(num(r.clean) + num(r.cosmetic) + num(r.shifted), num(r.modified) + num(r.missing), r);
      default:
        return done(num(r.symbolCount), num(r.issues), r);
    }
  } catch (err) {
    return { builtin: name, ok: false, passed: 0, failed: 0, error: (err as Error).message };
  }
}

/**
 * paradigm loop builtin <name> --json [--args <json>] — the thin wrapper Gnomon's #loop-check runs as
 * `node <pinned paradigm cli> loop builtin <name> --json` inside the loop-check sandbox (gnomon-loops.md §2).
 * Prints one JSON object {builtin, ok, passed, failed, error?, result}; exit 0 pass, 1 fail, 2 error.
 */
export async function loopBuiltinCommand(name: string, options: LoopCliOptions & { args?: string } = {}): Promise<void> {
  quiet();
  const root = options.root ?? process.cwd();
  let args: Record<string, unknown> = {};
  if (options.args !== undefined) {
    try {
      const parsed = JSON.parse(options.args) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      args = parsed as Record<string, unknown>;
    } catch {
      const r: LoopBuiltinResult = { builtin: name, ok: false, passed: 0, failed: 0, error: '--args must be a JSON object' };
      if (options.json) json(r);
      else error(r.error!);
      process.exitCode = 2;
      return;
    }
  }
  const r = await runLoopBuiltin(name, root, args);
  process.exitCode = r.error ? 2 : r.ok ? 0 : 1;
  if (options.json) {
    json(r);
    return;
  }
  if (r.error) {
    error(`${name}: ${r.error}`);
    return;
  }
  (r.ok ? success : warn)(`${name}: ${r.passed} passed, ${r.failed} failed`);
}
