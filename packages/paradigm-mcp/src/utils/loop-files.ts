/**
 * #loop-files — repo loop definition files (docs/specs/gnomon-loops.md §2, §5; build plan LP1).
 *
 * `.paradigm/loops/<id>.yaml` is the authored form; `.paradigm/loops/<id>.loop.json` is the compiled form the
 * Gnomon kernel reads (it never parses YAML). This module parses YAML (js-yaml, CORE schema), validates and
 * compiles through #loop-schema (`@a-company/gnomon/loops`) and writes the compiled JSON next to the YAML on
 * success. On a failed validate a stale compiled JSON is removed, so the kernel never reads a definition the
 * YAML no longer says; validate --all also removes orphan compiled JSON whose YAML is gone. Symlinks are refused
 * for the loops dir and every loop file, the dir's realpath must be the repo's `.paradigm/loops`, and writes go
 * through a temp file and a rename (Aegis LP1 review). The kernel hashes canonicalJson of the parsed
 * definition, never these file bytes. Shared by `paradigm loop new|validate|list` (#loop-cli) and the `paradigm_loop` MCP
 * family (#loop-mcp). File ops only: run, pause, trust and the rest go through the kernel later (LP7).
 *
 * The flow index (`.paradigm/flow-index.json`) resolves each flow to path globs: the directory of the
 * .purpose that defines it, plus the .purpose directory of every step symbol known to the scan index.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import {
  compileLoop,
  formatLoopIssue,
  loopFileJson,
  type CompiledLoop,
  type LoopIssue,
} from '@a-company/gnomon/loops';
import { log } from './mcp-logger.js';

export const LOOPS_DIR = path.join('.paradigm', 'loops');
const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export interface LoopFileResult {
  id: string;
  /** Repo-relative YAML path. */
  file: string;
  ok: boolean;
  errors: LoopIssue[];
  warnings: LoopIssue[];
  /** Repo-relative compiled path, when written (or fresh). */
  compiledFile?: string;
  /** True when a stale compiled JSON was removed because the YAML no longer validates. */
  removedStale?: boolean;
  /** The compiled definition's source hash (what the kernel attributes an agent's write by), when written. */
  sourceHash?: string;
}

export interface LoopListEntry {
  id: string;
  file: string;
  title?: string;
  ok: boolean;
  errorCount: number;
  /** fresh: the compiled JSON matches the YAML; stale: it differs; missing: no compiled JSON. */
  compiled: 'fresh' | 'stale' | 'missing';
  triggers: string[];
  autonomy?: string;
  /** Why the file was refused before parsing (a symlink, not a regular file). */
  refused?: string;
}

export function loopsDir(rootDir: string): string {
  return path.join(rootDir, LOOPS_DIR);
}
export function loopYamlPath(rootDir: string, id: string): string {
  return path.join(loopsDir(rootDir), `${id}.yaml`);
}
export function loopJsonPath(rootDir: string, id: string): string {
  return path.join(loopsDir(rootDir), `${id}.loop.json`);
}
const rel = (rootDir: string, p: string): string => path.relative(rootDir, p).split(path.sep).join('/');

/** True when `id` is a valid loop id (kebab-case, ≤ 64). */
export function isLoopId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= 64 && ID_RE.test(id);
}

/** Parse loop YAML (CORE schema: no timestamps or custom types). */
export function parseLoopYaml(text: string): { value?: unknown; error?: LoopIssue } {
  try {
    return { value: yaml.load(text, { schema: yaml.CORE_SCHEMA }) };
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0] ?? 'unparseable YAML';
    return { error: { path: '', code: 'YAML_PARSE', message: msg } };
  }
}

/** Flow id → path globs from `.paradigm/flow-index.json` (undefined when there is no flow index). */
export function loadFlowIndex(rootDir: string): Record<string, string[]> | undefined {
  const file = path.join(rootDir, '.paradigm', 'flow-index.json');
  if (!fs.existsSync(file)) return undefined;
  let idx: { flows?: Record<string, { definedIn?: string; steps?: Array<{ symbol?: string }> }> };
  try {
    idx = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
  const symbolDirs = loadSymbolDirs(rootDir);
  const toGlob = (raw: string): string | null => {
    // the index may be written on Windows (`packages\\x\\.purpose`): its separators are normalized first, or a
    // POSIX reader would take the whole path as one file name in the root and widen the flow to `**`
    const p = raw.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(p) && process.platform !== 'win32') return null; // another machine's absolute path
    const abs = path.isAbsolute(p) ? p : path.join(rootDir, p);
    const r = path.relative(rootDir, abs);
    if (r.startsWith('..') || path.isAbsolute(r)) return null;
    const dir = path.dirname(r).split(path.sep).join('/');
    return dir === '.' || dir === '' ? '**' : `${dir}/**`;
  };
  const out: Record<string, string[]> = {};
  for (const [id, flow] of Object.entries(idx.flows ?? {})) {
    const globs = new Set<string>();
    if (flow.definedIn) {
      const g = toGlob(flow.definedIn);
      if (g) globs.add(g);
    }
    for (const step of flow.steps ?? []) {
      const p = step.symbol ? symbolDirs.get(step.symbol) : undefined;
      const g = p ? toGlob(p) : null;
      if (g) globs.add(g);
    }
    out[id] = [...globs].sort();
  }
  return out;
}

/** Symbol → its .purpose path, from `.paradigm/scan-index.json` (empty when absent). */
function loadSymbolDirs(rootDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const file = path.join(rootDir, '.paradigm', 'scan-index.json');
  if (!fs.existsSync(file)) return out;
  try {
    const idx = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    for (const [section, entries] of Object.entries(idx)) {
      if (section.startsWith('$') || section === 'symbolMap' || !entries || typeof entries !== 'object') continue;
      for (const e of Object.values(entries as Record<string, { symbol?: string; path?: string }>)) {
        if (e && typeof e.symbol === 'string' && typeof e.path === 'string') out.set(e.symbol, e.path);
      }
    }
  } catch {
    /* no scan index: flows resolve to their defining .purpose only */
  }
  return out;
}

/** A refused filesystem shape (symlink, outside the repo, not a regular file). */
export class LoopFsError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const lstatOrNull = (p: string): fs.Stats | null => {
  try { return fs.lstatSync(p); } catch { return null; }
};

/**
 * The loops directory, checked (Aegis LP1 #5): neither `.paradigm` nor `.paradigm/loops` is a symlink, the
 * loops dir is a directory, and its realpath is under the repo root's realpath. null when absent (unless
 * `create`, which makes it).
 */
export function checkedLoopsDir(rootDir: string, create = false): string | null {
  const dir = loopsDir(rootDir);
  for (const p of [path.join(rootDir, '.paradigm'), dir]) {
    const st = lstatOrNull(p);
    if (st?.isSymbolicLink()) throw new LoopFsError('SYMLINK', `${rel(rootDir, p)} is a symlink; loops live in a real directory`);
    if (st && !st.isDirectory()) throw new LoopFsError('NOT_A_DIRECTORY', `${rel(rootDir, p)} is not a directory`);
  }
  if (!fs.existsSync(dir)) {
    if (!create) return null;
    fs.mkdirSync(dir, { recursive: true });
  }
  const realRoot = fs.realpathSync(rootDir);
  const realDir = fs.realpathSync(dir);
  if (realDir !== path.join(realRoot, LOOPS_DIR)) throw new LoopFsError('OUTSIDE_REPO', `${rel(rootDir, dir)} resolves outside the repo`);
  return dir;
}

/** null when `p` is absent; throws unless it is a regular file (never a symlink). */
function regularFile(rootDir: string, p: string): fs.Stats | null {
  const st = lstatOrNull(p);
  if (!st) return null;
  if (st.isSymbolicLink()) throw new LoopFsError('SYMLINK', `${rel(rootDir, p)} is a symlink; loop files are regular files`);
  if (!st.isFile()) throw new LoopFsError('NOT_A_FILE', `${rel(rootDir, p)} is not a regular file`);
  return st;
}

/** Write via a temp file and rename (never through a symlink at the target). */
function atomicWrite(rootDir: string, p: string, text: string): void {
  regularFile(rootDir, p);
  const tmp = `${p}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, text, { flag: 'wx' });
  try {
    fs.renameSync(tmp, p);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** Remove a file or a symlink itself (unlink never follows the link). */
function removeEntry(p: string): boolean {
  if (!lstatOrNull(p)) return false;
  fs.unlinkSync(p);
  return true;
}

const readText = (rootDir: string, p: string): string | null => (regularFile(rootDir, p) ? fs.readFileSync(p, 'utf8') : null);

/** The YAML loop files in `.paradigm/loops/` (any entry type; validate refuses non-regular ones), sorted. */
export function listLoopFiles(rootDir: string): string[] {
  const dir = checkedLoopsDir(rootDir);
  if (!dir) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => path.join(dir, f));
}

/** Compiled `<id>.loop.json` files whose `<id>.yaml` is gone (repo-relative). */
export function orphanLoopJson(rootDir: string): string[] {
  const dir = checkedLoopsDir(rootDir);
  if (!dir) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.loop.json') && !lstatOrNull(path.join(dir, f.replace(/\.loop\.json$/, '.yaml'))))
    .sort()
    .map((f) => rel(rootDir, path.join(dir, f)));
}

/** Every parseable regular loop file in the repo by id (for call-graph checks), except `exceptId`. */
export function loadKnownLoops(rootDir: string, exceptId?: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const f of listLoopFiles(rootDir)) {
    const id = path.basename(f, '.yaml');
    if (id === exceptId) continue;
    let text: string | null = null;
    try { text = readText(rootDir, f); } catch { text = null; }
    if (text === null) continue;
    const { value } = parseLoopYaml(text);
    if (value !== undefined) out.set(id, value);
  }
  return out;
}

/** The shebang line (without `#!`) of a run argv0 that names a file by path, else null. */
export function readShebangAt(rootDir: string, argv0: string): string | null {
  if (!argv0.includes('/') && !argv0.includes('\\')) return null; // a PATH lookup: the kernel resolves it at hash time (LP2)
  const p = path.isAbsolute(argv0) ? argv0 : path.join(rootDir, argv0);
  let fd: number | null = null;
  try {
    fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(256);
    const n = fs.readSync(fd, buf, 0, 256, 0);
    const head = buf.subarray(0, n).toString('utf8');
    if (!head.startsWith('#!')) return null;
    return head.slice(2).split(/\r?\n/)[0]!.trim() || null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

interface CompileOutcome {
  ok: boolean;
  errors: LoopIssue[];
  warnings: LoopIssue[];
  compiled?: CompiledLoop;
  json?: string;
}

/**
 * Parse, validate and compile YAML text for a repo loop whose file name says `fileId`. The kernel hashes
 * canonicalJson of the PARSED definition (loopContentHash), never the YAML or JSON file bytes.
 */
export function compileLoopText(rootDir: string, text: string, fileId: string): CompileOutcome {
  const parsed = parseLoopYaml(text);
  if (parsed.error) return { ok: false, errors: [parsed.error], warnings: [] };
  const r = compileLoop(parsed.value, {
    scope: 'repo',
    knownLoops: loadKnownLoops(rootDir, fileId),
    flowIndex: loadFlowIndex(rootDir),
    readShebang: (a0) => readShebangAt(rootDir, a0),
  });
  const errors = [...r.errors];
  const parsedId = (parsed.value as { id?: unknown } | null)?.id;
  if (typeof parsedId === 'string' && parsedId !== fileId) {
    errors.push({ path: 'id', code: 'FILE_ID_MISMATCH', message: `id "${parsedId}" must match the file name (${fileId}.yaml)` });
  }
  if (errors.length || !r.compiled) return { ok: false, errors, warnings: r.warnings };
  return { ok: true, errors: [], warnings: r.warnings, compiled: r.compiled, json: loopFileJson(r.compiled) };
}

/**
 * Validate one YAML file directly inside `.paradigm/loops/`. On success write `<id>.loop.json` next to it
 * (unless `write: false`); on failure remove a stale one (always, even with `write: false`).
 */
export function validateLoopFile(rootDir: string, file: string, opts: { write?: boolean } = {}): LoopFileResult {
  const abs = path.isAbsolute(file) ? file : path.resolve(rootDir, file);
  const base = path.basename(abs);
  const id = base.replace(/\.ya?ml$/, '');
  const result: LoopFileResult = { id, file: rel(rootDir, abs), ok: false, errors: [], warnings: [] };
  const fail = (code: string, message: string): LoopFileResult => {
    result.errors.push({ path: '', code, message });
    return result;
  };
  if (path.dirname(abs) !== path.resolve(loopsDir(rootDir))) return fail('NOT_IN_LOOPS_DIR', `loop files live directly in ${LOOPS_DIR.split(path.sep).join('/')}/`);
  if (!base.endsWith('.yaml')) return fail('BAD_FILE', 'a loop definition is a .yaml file');
  let text: string | null;
  try {
    checkedLoopsDir(rootDir);
    text = readText(rootDir, abs);
  } catch (e) {
    return fail((e as LoopFsError).code ?? 'FS_ERROR', (e as Error).message);
  }
  if (text === null) return fail('NOT_FOUND', `no loop file at ${result.file}`);
  const out = compileLoopText(rootDir, text, id);
  result.ok = out.ok;
  result.errors = out.errors;
  result.warnings = out.warnings;
  const jsonPath = path.join(path.dirname(abs), `${id}.loop.json`);
  if (out.ok && out.json !== undefined) {
    if (opts.write !== false) {
      const st = lstatOrNull(jsonPath);
      if (st && !st.isFile()) removeEntry(jsonPath); // a symlink or other entry at the target is replaced, never followed
      const prior = lstatOrNull(jsonPath) ? fs.readFileSync(jsonPath, 'utf8') : null;
      if (prior !== out.json) atomicWrite(rootDir, jsonPath, out.json);
    }
    result.compiledFile = rel(rootDir, jsonPath);
  } else if (removeEntry(jsonPath)) {
    result.removedStale = true;
  }
  log.component('#loop-files').info('Loop validated', { id, ok: result.ok, errors: result.errors.length });
  return result;
}

export interface LoopValidateAllResult {
  results: LoopFileResult[];
  /** Orphan compiled JSON (YAML gone) found; removed unless `write: false`. */
  orphans: string[];
  removedOrphans: string[];
}

/** Validate every repo loop (writing their compiled JSON) and remove orphan compiled JSON. */
export function validateAllLoops(rootDir: string, opts: { write?: boolean } = {}): LoopValidateAllResult {
  const results = listLoopFiles(rootDir).map((f) => validateLoopFile(rootDir, f, opts));
  const orphans = orphanLoopJson(rootDir);
  const removedOrphans = opts.write === false ? [] : orphans.filter((o) => removeEntry(path.join(rootDir, o)));
  return { results, orphans, removedOrphans };
}

/** A summary row per repo loop, without writing anything. */
export function listLoops(rootDir: string): LoopListEntry[] {
  return listLoopFiles(rootDir).map((f) => {
    const id = path.basename(f, '.yaml');
    const base = { id, file: rel(rootDir, f) };
    let text: string | null;
    try {
      text = readText(rootDir, f);
    } catch (e) {
      return { ...base, ok: false, errorCount: 1, compiled: 'missing' as const, triggers: [], refused: (e as Error).message };
    }
    const out = compileLoopText(rootDir, text ?? '', id);
    const parsed = parseLoopYaml(text ?? '').value as { title?: unknown } | undefined;
    const jsonPath = loopJsonPath(rootDir, id);
    const st = lstatOrNull(jsonPath);
    const onDisk = st?.isFile() ? fs.readFileSync(jsonPath, 'utf8') : null;
    const compiled: LoopListEntry['compiled'] = !st ? 'missing' : out.ok && onDisk === out.json ? 'fresh' : 'stale';
    return {
      ...base,
      ...(parsed && typeof parsed.title === 'string' ? { title: parsed.title } : {}),
      ok: out.ok,
      errorCount: out.errors.length,
      compiled,
      triggers: out.compiled ? out.compiled.triggers.map(describeTrigger) : [],
      ...(out.compiled ? { autonomy: out.compiled.autonomy } : {}),
    };
  });
}

function describeTrigger(t: CompiledLoop['triggers'][number]): string {
  if (t.type === 'schedule') return t.every !== undefined ? `every ${t.every}s` : t.daily !== undefined ? `daily ${t.daily}` : `weekly ${t.weekly!.day} ${t.weekly!.at}`;
  if (t.type === 'event') return t.flow ? `${t.kind} ${t.flow}` : t.kind;
  return `continuous ${t.cooldownSec}s`;
}

/** One loop: its YAML, its validation and its compiled JSON (null when absent). */
export function getLoop(rootDir: string, id: string): { id: string; file: string; yaml: string; ok: boolean; errors: LoopIssue[]; warnings: LoopIssue[]; compiled: unknown } | { error: string } {
  if (!isLoopId(id)) return { error: 'id must be kebab-case, ≤ 64 characters' };
  const f = loopYamlPath(rootDir, id);
  let text: string | null;
  let json: string | null;
  try {
    checkedLoopsDir(rootDir);
    text = readText(rootDir, f);
    json = readText(rootDir, loopJsonPath(rootDir, id));
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (text === null) return { error: `no loop "${id}" in ${LOOPS_DIR.split(path.sep).join('/')}` };
  const out = compileLoopText(rootDir, text, id);
  return { id, file: rel(rootDir, f), yaml: text, ok: out.ok, errors: out.errors, warnings: out.warnings, compiled: json === null ? null : JSON.parse(json) };
}

/**
 * Write a loop definition (create refuses an existing id; update refuses a missing one). The YAML is validated
 * first: an invalid definition is never written. `definition` (an object) is dumped to YAML; `yaml` is kept as
 * written. Both files are written via temp + rename, never through a symlink.
 */
export function writeLoop(
  rootDir: string,
  mode: 'create' | 'update',
  input: { id?: string; yaml?: string; definition?: unknown },
): LoopFileResult | { error: string } {
  let text: string;
  if (typeof input.yaml === 'string') text = input.yaml;
  else if (input.definition !== undefined && input.definition !== null) text = yaml.dump(input.definition, { lineWidth: 120, noRefs: true });
  else return { error: 'give yaml (text) or definition (object)' };
  const parsed = parseLoopYaml(text);
  const parsedId = (parsed.value as { id?: unknown } | null | undefined)?.id;
  const id = input.id ?? (typeof parsedId === 'string' ? parsedId : undefined);
  if (!isLoopId(id)) return { error: 'id must be kebab-case, ≤ 64 characters (give id, or set it in the definition)' };
  const f = loopYamlPath(rootDir, id);
  try {
    checkedLoopsDir(rootDir);
    const exists = regularFile(rootDir, f) !== null;
    if (mode === 'create' && exists) return { error: `loop "${id}" already exists; use update` };
    if (mode === 'update' && !exists) return { error: `no loop "${id}"; use create` };
    const out = compileLoopText(rootDir, text, id);
    const result: LoopFileResult = { id, file: rel(rootDir, f), ok: out.ok, errors: out.errors, warnings: out.warnings };
    if (!out.ok) return result;
    checkedLoopsDir(rootDir, true);
    const jsonPath = loopJsonPath(rootDir, id);
    regularFile(rootDir, jsonPath);
    atomicWrite(rootDir, f, text.endsWith('\n') ? text : `${text}\n`);
    atomicWrite(rootDir, jsonPath, out.json!);
    result.compiledFile = rel(rootDir, jsonPath);
    const sourceHash = (JSON.parse(out.json!) as { compiled?: { sourceHash?: unknown } }).compiled?.sourceHash;
    if (typeof sourceHash === 'string') result.sourceHash = sourceHash;
    log.component('#loop-files').info('Loop written', { id, mode });
    return result;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ── Templates live in #loop-templates (loop-templates.ts) ────────────────────

/** The first flow in the flow index, for templates (or the placeholder). */
export function defaultTemplateFlow(rootDir: string): string {
  const idx = loadFlowIndex(rootDir);
  const first = idx ? Object.keys(idx).sort()[0] : undefined;
  return first ?? '$example-flow';
}

/** Render a result's issues as lines. */
export function issueLines(issues: LoopIssue[]): string[] {
  return issues.map(formatLoopIssue);
}
