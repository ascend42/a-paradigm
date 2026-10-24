/**
 * @symbol #manifest-loader
 *
 * #manifest-loader generated files + exact uninstall (spec §3.6, §10 law 4,
 * §17; G-HON-04, G-LAW-04).
 *
 * `generateRepo` writes, from a `kind: distro` manifest, the plugin files the
 * spec makes outputs of `manifest:v1` — `plugin.json`, `.mcp.json`,
 * `hooks.json` — into the ONE repo dir `.gnomon/` (`generated/`), plus the
 * `.gnomon/.gitignore` (`worktrees/`, `sessions/`) and, when absent, the
 * committed `.gnomon/project.yaml`.
 *
 * OWNERSHIP is never read from the repo (a repo is attacker-writable): every
 * generated file carries a MARKER naming the manifestHash (JSON `_gnomon`,
 * text `# gnomon:generated <hash>` first line), and the KERNEL-HELD record
 * `<home>/generated/<sha256(realpath repo)>.json` lists each file's sha256 and
 * each directory the install created. A file is ours only when the home
 * record holds its exact hash AND it carries our marker.
 *
 * CONFINEMENT (fail closed, refused GENERATED):
 *   - the only paths ever touched are the keys of renderGenerated() and the
 *     two directories `.gnomon/` and `.gnomon/generated/`; a record entry
 *     outside that fixed set (e.g. `../x`) is ignored and reported;
 *   - every component from the repo root down is lstat'd and a symlink or
 *     junction is refused before any read, write or delete, and
 *     realpath(dir) must lie inside realpath(repo)/.gnomon;
 *   - writes go to a temp file opened O_CREAT|O_EXCL|O_NOFOLLOW in the same
 *     directory, then rename over the target; reads open O_NOFOLLOW and fstat.
 * FIXED POINT (G-HON-04): output is a pure function of the manifest; a
 * regeneration writes nothing. `~/.claude` is never written (the plugin is
 * passed to Claude per session, M1.7).
 * `uninstallRepo` removes exactly the recorded, unedited, marked files and the
 * recorded directories if empty; an edited file is kept and reported. The
 * committed `project.yaml` stays (law 4). `uninstallHome` removes `~/.gnomon`
 * or, with `keep`, returns it as the export path.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalJson, ulid } from '@a-company/gnomon-contracts';
import { mcpServerName } from '@a-company/gnomon-contracts';
import { canonicalManifestHash, type ManifestV2 } from './manifest.js';
import { ManifestRefusal, noEvents, type ManifestEventSink } from './refusal.js';
import { removeTree } from './snapshot.js';

export const GNOMON_REPO_DIR = '.gnomon';
export const RECORD_SCHEMA = 'gnomon-generated-record:v1' as const;
export const TEXT_MARKER = '# gnomon:generated';
/** The only directories generateRepo may create or remove. */
export const GENERATED_DIRS = Object.freeze(['.gnomon', '.gnomon/generated']);
export const GENERATED_FILES = Object.freeze(['.gnomon/generated/plugin.json', '.gnomon/generated/.mcp.json', '.gnomon/generated/hooks.json', '.gnomon/.gitignore']);

export interface GeneratedRecord {
  schemaVersion: typeof RECORD_SCHEMA;
  repo: string;
  manifestHash: string;
  files: Array<{ path: string; sha256: string }>;
  createdDirs: string[];
}

const O_NOFOLLOW: number = fs.constants.O_NOFOLLOW ?? 0;
const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

/** Canonical pretty JSON: sorted keys at every level, 2-space indent, final newline. */
export function stableJson(v: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalJson(v)), null, 2)}\n`;
}

/** The generated file set (posix path under the repo → content), a pure function of the manifest. */
export function renderGenerated(m: ManifestV2): Map<string, string> {
  if (m.kind !== 'distro') throw new ManifestRefusal('SCHEMA', `generated plugin files come from a kind: distro manifest, not ${m.kind}`, { name: m.name });
  const mh = canonicalManifestHash(m);
  const marker = { generatedBy: 'gnomon', manifestHash: mh, doNotEdit: true };
  const p = m.provides ?? {};
  const out = new Map<string, string>();
  out.set('.gnomon/generated/plugin.json', stableJson({ _gnomon: marker, name: m.name, version: m.version, ...(m.description ? { description: m.description } : {}) }));
  const servers: Record<string, unknown> = {};
  for (const s of p.mcp ?? []) servers[mcpServerName(`${m.publisher}.${m.name}`)] = { command: s.command, args: s.args ?? [] };
  out.set('.gnomon/generated/.mcp.json', stableJson({ _gnomon: marker, mcpServers: servers }));
  const hooks: Record<string, unknown[]> = {};
  for (const h of p.hooks ?? []) (hooks[h.event] ??= []).push({ hooks: [{ type: 'command', command: h.command }] });
  out.set('.gnomon/generated/hooks.json', stableJson({ _gnomon: marker, hooks }));
  out.set('.gnomon/.gitignore', `${TEXT_MARKER} ${mh}\nworktrees/\nsessions/\n`);
  return out;
}

const PROJECT_YAML = `# .gnomon/project.yaml — committed project policy (spec §15.7), read from the base revision\nmode: none\n`;

function refuse(rel: string, why: string, emit: ManifestEventSink): never {
  emit('manifest.refuse', { code: 'GENERATED', path: rel, why });
  throw new ManifestRefusal('GENERATED', `${rel}: ${why}`, { path: rel, why });
}

/** Real repo root (the repo path itself may be a link; everything below it may not). */
function repoRoot(repo: string): string {
  return fs.realpathSync.native(repo);
}

/**
 * Confine `rel` (a fixed generated path) to <repo>/.gnomon: lstat every
 * component, refuse links, and check realpath of the existing parent.
 * Returns the absolute path and whether the leaf exists (as a regular file / dir).
 */
function confined(root: string, rel: string, emit: ManifestEventSink): { abs: string; exists: boolean } {
  if (!(GENERATED_FILES as readonly string[]).includes(rel) && !(GENERATED_DIRS as readonly string[]).includes(rel) && rel !== '.gnomon/project.yaml') {
    refuse(rel, 'not a generated path', emit);
  }
  const parts = rel.split('/');
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '..' || parts[i] === '.' || parts[i] === '') refuse(rel, 'path traversal', emit);
    cur = path.join(cur, parts[i]!);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(cur);
    } catch {
      return { abs: path.join(root, ...parts), exists: false };
    }
    if (st.isSymbolicLink()) refuse(rel, 'a symlink or junction in the generated path', emit);
    if (i < parts.length - 1 && !st.isDirectory()) refuse(rel, 'a non-directory in the generated path', emit);
    if (st.isDirectory()) {
      const within = path.relative(path.join(root, GNOMON_REPO_DIR), fs.realpathSync.native(cur));
      if (within.startsWith('..') || path.isAbsolute(within)) refuse(rel, 'resolves outside <repo>/.gnomon', emit);
    }
    if (i === parts.length - 1 && !st.isDirectory() && !st.isFile()) refuse(rel, 'not a regular file', emit);
  }
  return { abs: path.join(root, ...parts), exists: true };
}

function readNoFollow(abs: string, rel: string, emit: ManifestEventSink): Buffer {
  const fd = fs.openSync(abs, fs.constants.O_RDONLY | O_NOFOLLOW);
  try {
    if (!fs.fstatSync(fd).isFile()) refuse(rel, 'not a regular file', emit);
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeAtomic(abs: string, content: string): void {
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.gnomon-tmp-${ulid()}`);
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, 0o644);
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, abs);
}

/** Kernel-held record path for a repo. */
export function recordPath(home: string, repo: string): string {
  return path.join(home, 'generated', `${sha(repoRoot(repo))}.json`);
}

export function readRecord(home: string, repo: string): GeneratedRecord | null {
  try {
    const r = JSON.parse(fs.readFileSync(recordPath(home, repo), 'utf8')) as GeneratedRecord;
    return r.schemaVersion === RECORD_SCHEMA ? r : null;
  } catch {
    return null;
  }
}

function writeRecord(home: string, repo: string, r: GeneratedRecord): void {
  const p = recordPath(home, repo);
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, stableJson(r), { mode: 0o600 });
}

function hasMarker(content: Buffer, rel: string): boolean {
  const s = content.toString('utf8');
  if (rel.endsWith('.json')) {
    try {
      const v = JSON.parse(s) as { _gnomon?: { generatedBy?: unknown; manifestHash?: unknown } };
      return v._gnomon?.generatedBy === 'gnomon' && typeof v._gnomon.manifestHash === 'string';
    } catch {
      return false;
    }
  }
  return s.startsWith(`${TEXT_MARKER} sha256:`);
}

/**
 * T-2026-10-18-008 (M1.7): the generated plugin bytes a session may use, verified at SPAWN against the
 * kernel-held record — never the repo's bytes on trust. No record ⇒ null (the repo has no generated plugin).
 * Every recorded generated file under `.gnomon/generated/` is read (confined, O_NOFOLLOW) and must hash to
 * the record AND carry the marker, else refused GENERATED. The returned bytes are what the session gets
 * (the supervisor copies them into the kernel's own session dir); the repo files are never passed by path.
 */
export function verifiedGenerated(repo: string, opts: { home: string; emit?: ManifestEventSink }): Map<string, Buffer> | null {
  const emit = opts.emit ?? noEvents;
  const rec = readRecord(opts.home, repo);
  if (!rec) return null;
  const root = repoRoot(repo);
  const out = new Map<string, Buffer>();
  for (const f of rec.files) {
    if (!f.path.startsWith('.gnomon/generated/') || !(GENERATED_FILES as readonly string[]).includes(f.path)) continue;
    const c = confined(root, f.path, emit);
    if (!c.exists) refuse(f.path, 'a recorded generated file is missing at spawn', emit);
    const bytes = readNoFollow(c.abs, f.path, emit);
    if (sha(bytes) !== f.sha256) refuse(f.path, 'generated bytes differ from the kernel-held record at spawn', emit);
    if (!hasMarker(bytes, f.path)) refuse(f.path, 'generated file lost its marker', emit);
    out.set(f.path, bytes);
  }
  return out;
}

export interface GenerateReport {
  written: string[];
  unchanged: string[];
  manifestHash: string;
  /** record entries outside the fixed generated set (ignored, never touched) */
  ignored: string[];
}

/** Generate (or regenerate) the repo's files. Idempotent; refuses to overwrite a file that is not ours. */
export function generateRepo(repo: string, m: ManifestV2, opts: { home: string; writeProjectYaml?: boolean; emit?: ManifestEventSink }): GenerateReport {
  const emit = opts.emit ?? noEvents;
  const files = renderGenerated(m);
  const root = repoRoot(repo);
  const prior = readRecord(opts.home, repo);
  const ignored = [...(prior?.files ?? []).map((f) => f.path), ...(prior?.createdDirs ?? [])].filter((p) => !(GENERATED_FILES as readonly string[]).includes(p) && !(GENERATED_DIRS as readonly string[]).includes(p));
  const ours = new Map((prior?.files ?? []).filter((f) => (GENERATED_FILES as readonly string[]).includes(f.path)).map((f) => [f.path, f.sha256]));
  const createdDirs = new Set((prior?.createdDirs ?? []).filter((d) => (GENERATED_DIRS as readonly string[]).includes(d)));
  const report: GenerateReport = { written: [], unchanged: [], manifestHash: canonicalManifestHash(m), ignored };

  // confine + ownership check before writing anything
  for (const d of GENERATED_DIRS) confined(root, d, emit);
  for (const rel of files.keys()) {
    const c = confined(root, rel, emit);
    if (!c.exists) continue;
    const cur = readNoFollow(c.abs, rel, emit);
    if (ours.get(rel) !== sha(cur) || !hasMarker(cur, rel)) refuse(rel, 'exists and is not a gnomon-generated file; refusing to overwrite', emit);
  }
  for (const d of GENERATED_DIRS) {
    const c = confined(root, d, emit);
    if (!c.exists) {
      fs.mkdirSync(c.abs, { mode: 0o755 });
      createdDirs.add(d);
      confined(root, d, emit); // re-check after create
    }
  }
  const recFiles: GeneratedRecord['files'] = [];
  for (const [rel, content] of files) {
    const c = confined(root, rel, emit);
    const h = sha(content);
    if (c.exists && sha(readNoFollow(c.abs, rel, emit)) === h) report.unchanged.push(rel);
    else {
      writeAtomic(c.abs, content);
      report.written.push(rel);
    }
    recFiles.push({ path: rel, sha256: h });
  }
  if (opts.writeProjectYaml !== false) {
    const c = confined(root, '.gnomon/project.yaml', emit);
    if (!c.exists) {
      writeAtomic(c.abs, PROJECT_YAML);
      report.written.push('.gnomon/project.yaml');
    }
  }
  writeRecord(opts.home, repo, { schemaVersion: RECORD_SCHEMA, repo: root, manifestHash: report.manifestHash, files: recFiles.sort((a, b) => (a.path < b.path ? -1 : 1)), createdDirs: [...createdDirs].sort() });
  emit('manifest.generate', { name: m.name, manifestHash: report.manifestHash, written: report.written.length, unchanged: report.unchanged.length });
  return report;
}

export interface UninstallReport {
  removed: string[];
  /** generated files whose bytes were edited since generation: kept, never deleted */
  keptEdited: string[];
  removedDirs: string[];
  /** record entries outside the fixed generated set: ignored, never touched */
  ignored: string[];
}

export function uninstallRepo(repo: string, opts: { home: string; emit?: ManifestEventSink }): UninstallReport {
  const emit = opts.emit ?? noEvents;
  const out: UninstallReport = { removed: [], keptEdited: [], removedDirs: [], ignored: [] };
  const rec = readRecord(opts.home, repo);
  if (!rec) return out;
  const root = repoRoot(repo);
  for (const f of rec.files) {
    if (!(GENERATED_FILES as readonly string[]).includes(f.path)) {
      out.ignored.push(f.path);
      continue;
    }
    const c = confined(root, f.path, emit);
    if (!c.exists) continue;
    const cur = readNoFollow(c.abs, f.path, emit);
    if (sha(cur) === f.sha256 && hasMarker(cur, f.path)) {
      confined(root, f.path, emit); // re-check right before the delete
      fs.rmSync(c.abs);
      out.removed.push(f.path);
    } else out.keptEdited.push(f.path);
  }
  for (const d of [...rec.createdDirs].sort((a, b) => b.length - a.length)) {
    if (!(GENERATED_DIRS as readonly string[]).includes(d)) {
      out.ignored.push(d);
      continue;
    }
    const c = confined(root, d, emit);
    if (c.exists && fs.readdirSync(c.abs).length === 0) {
      fs.rmdirSync(c.abs);
      out.removedDirs.push(d);
    }
  }
  fs.rmSync(recordPath(opts.home, repo), { force: true });
  emit('manifest.uninstall', { scope: 'repo', removed: out.removed.length, keptEdited: out.keptEdited, ignored: out.ignored });
  return out;
}

export function uninstallHome(home: string, opts: { mode: 'remove' | 'keep'; emit?: ManifestEventSink }): { removed: boolean; exportPath: string | null } {
  const emit = opts.emit ?? noEvents;
  if (opts.mode === 'keep') {
    emit('manifest.uninstall', { scope: 'home', removed: false, exportPath: home });
    return { removed: false, exportPath: home };
  }
  removeTree(home);
  return { removed: true, exportPath: null };
}
