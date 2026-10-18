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
 * committed `.gnomon/project.yaml`. Rules:
 *   - every generated file carries a MARKER (JSON: the `_gnomon` member;
 *     text: a `# gnomon:generated` first line) naming the manifestHash;
 *   - a LEDGER (`.gnomon/generated.ledger.json`, itself marked) records each
 *     generated file's path and sha256 and each directory the install created;
 *   - FIXED POINT (G-HON-04): output is a pure function of the manifest
 *     (canonical key order, `\n` line ends); regenerating writes nothing;
 *   - a target that exists and is not ours (not in the ledger with our hash)
 *     is never overwritten: refused GENERATED;
 *   - nothing outside `<repo>/.gnomon/` is written — `~/.claude` is untouched
 *     (the plugin is passed to Claude per session, M1.7).
 * `uninstallRepo` removes EXACTLY the ledger's files whose bytes still match,
 * then the ledger, then the directories the install created if they are empty;
 * an edited generated file is kept and reported, never deleted. The committed
 * `project.yaml` stays (law 4: the repo is clean except the committed file).
 * `uninstallHome` removes `~/.gnomon` or, with `keep`, leaves it intact and
 * returns it as the export path (learned state exported or left intact).
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalJson } from '@a-company/gnomon-contracts';
import { manifestHash, type ManifestV1 } from './manifest.js';
import { ManifestRefusal, noEvents, type ManifestEventSink } from './refusal.js';
import { removeTree } from './snapshot.js';

export const GNOMON_REPO_DIR = '.gnomon';
export const LEDGER_FILE = 'generated.ledger.json';
export const LEDGER_SCHEMA = 'gnomon-generated-ledger:v1' as const;
export const TEXT_MARKER = '# gnomon:generated';

export interface Ledger {
  schemaVersion: typeof LEDGER_SCHEMA;
  _gnomon: { generatedBy: 'gnomon'; doNotEdit: true };
  manifestHash: string;
  files: Array<{ path: string; sha256: string }>;
  createdDirs: string[];
}

const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

/** Canonical pretty JSON: sorted keys at every level, 2-space indent, final newline. */
export function stableJson(v: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalJson(v)), null, 2)}\n`;
}

/** The generated file set (posix path under the repo → content), a pure function of the manifest. */
export function renderGenerated(m: ManifestV1): Map<string, string> {
  if (m.kind !== 'distro') throw new ManifestRefusal('SCHEMA', `generated plugin files come from a kind: distro manifest, not ${m.kind}`, { name: m.name });
  const mh = manifestHash(m);
  const marker = { generatedBy: 'gnomon', manifestHash: mh, doNotEdit: true };
  const p = m.provides ?? {};
  const out = new Map<string, string>();
  out.set('.gnomon/generated/plugin.json', stableJson({ _gnomon: marker, name: m.name, version: m.version, ...(m.description ? { description: m.description } : {}) }));
  const servers: Record<string, unknown> = {};
  for (const s of p.mcp ?? []) servers[s.name] = { command: s.command, args: s.args ?? [] };
  out.set('.gnomon/generated/.mcp.json', stableJson({ _gnomon: marker, mcpServers: servers }));
  const hooks: Record<string, unknown[]> = {};
  for (const h of p.hooks ?? []) (hooks[h.event] ??= []).push({ hooks: [{ type: 'command', command: h.command }] });
  out.set('.gnomon/generated/hooks.json', stableJson({ _gnomon: marker, hooks }));
  out.set('.gnomon/.gitignore', `${TEXT_MARKER} ${mh}\nworktrees/\nsessions/\n`);
  return out;
}

const PROJECT_YAML = `# .gnomon/project.yaml — committed project policy (spec §15.7), read from the base revision\nmode: none\n`;

function ledgerPath(repo: string): string {
  return path.join(repo, GNOMON_REPO_DIR, LEDGER_FILE);
}

export function readLedger(repo: string): Ledger | null {
  try {
    const l = JSON.parse(fs.readFileSync(ledgerPath(repo), 'utf8')) as Ledger;
    return l.schemaVersion === LEDGER_SCHEMA ? l : null;
  } catch {
    return null;
  }
}

export interface GenerateReport {
  written: string[];
  unchanged: string[];
  manifestHash: string;
}

/** Generate (or regenerate) the repo's files. Idempotent; refuses to overwrite a file that is not ours. */
export function generateRepo(repo: string, m: ManifestV1, opts: { writeProjectYaml?: boolean; emit?: ManifestEventSink } = {}): GenerateReport {
  const emit = opts.emit ?? noEvents;
  const files = renderGenerated(m);
  const prior = readLedger(repo);
  const ours = new Map((prior?.files ?? []).map((f) => [f.path, f.sha256]));
  const createdDirs = new Set(prior?.createdDirs ?? []);
  const report: GenerateReport = { written: [], unchanged: [], manifestHash: manifestHash(m) };

  // refuse before writing anything
  for (const rel of files.keys()) {
    const abs = path.join(repo, ...rel.split('/'));
    if (!fs.existsSync(abs)) continue;
    const cur = sha(fs.readFileSync(abs));
    if (ours.get(rel) !== cur) {
      emit('manifest.refuse', { name: m.name, code: 'GENERATED', path: rel });
      throw new ManifestRefusal('GENERATED', `${rel} exists and is not a gnomon-generated file; refusing to overwrite`, { path: rel });
    }
  }
  const ensureDir = (relDir: string): void => {
    const parts = relDir.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const r = parts.slice(0, i).join('/');
      const abs = path.join(repo, ...parts.slice(0, i));
      if (!fs.existsSync(abs)) {
        fs.mkdirSync(abs, { mode: 0o755 });
        createdDirs.add(r);
      }
    }
  };
  const ledgerFiles: Ledger['files'] = [];
  for (const [rel, content] of files) {
    const abs = path.join(repo, ...rel.split('/'));
    ensureDir(path.posix.dirname(rel));
    const h = sha(content);
    if (fs.existsSync(abs) && sha(fs.readFileSync(abs)) === h) report.unchanged.push(rel);
    else {
      fs.writeFileSync(abs, content, { mode: 0o644 });
      report.written.push(rel);
    }
    ledgerFiles.push({ path: rel, sha256: h });
  }
  // project.yaml: committed and never generated over; written only when absent, never in the ledger
  if (opts.writeProjectYaml !== false) {
    const py = path.join(repo, GNOMON_REPO_DIR, 'project.yaml');
    if (!fs.existsSync(py)) {
      fs.writeFileSync(py, PROJECT_YAML, { mode: 0o644 });
      report.written.push('.gnomon/project.yaml');
    }
  }
  const ledger: Ledger = {
    schemaVersion: LEDGER_SCHEMA,
    _gnomon: { generatedBy: 'gnomon', doNotEdit: true },
    manifestHash: report.manifestHash,
    files: ledgerFiles.sort((a, b) => (a.path < b.path ? -1 : 1)),
    createdDirs: [...createdDirs].sort(),
  };
  const text = stableJson(ledger);
  const lp = ledgerPath(repo);
  if (fs.existsSync(lp) && fs.readFileSync(lp, 'utf8') === text) report.unchanged.push(`.gnomon/${LEDGER_FILE}`);
  else {
    fs.writeFileSync(lp, text, { mode: 0o644 });
    report.written.push(`.gnomon/${LEDGER_FILE}`);
  }
  emit('manifest.generate', { name: m.name, manifestHash: report.manifestHash, written: report.written.length, unchanged: report.unchanged.length });
  return report;
}

export interface UninstallReport {
  removed: string[];
  /** generated files whose bytes were edited since generation: kept, never deleted */
  keptEdited: string[];
  removedDirs: string[];
}

export function uninstallRepo(repo: string, opts: { emit?: ManifestEventSink } = {}): UninstallReport {
  const emit = opts.emit ?? noEvents;
  const out: UninstallReport = { removed: [], keptEdited: [], removedDirs: [] };
  const ledger = readLedger(repo);
  if (!ledger) return out;
  for (const f of ledger.files) {
    const abs = path.join(repo, ...f.path.split('/'));
    if (!fs.existsSync(abs)) continue;
    if (sha(fs.readFileSync(abs)) === f.sha256) {
      fs.rmSync(abs);
      out.removed.push(f.path);
    } else out.keptEdited.push(f.path);
  }
  fs.rmSync(ledgerPath(repo));
  out.removed.push(`.gnomon/${LEDGER_FILE}`);
  for (const d of [...ledger.createdDirs].sort((a, b) => b.length - a.length)) {
    const abs = path.join(repo, ...d.split('/'));
    try {
      if (fs.readdirSync(abs).length === 0) {
        fs.rmdirSync(abs);
        out.removedDirs.push(d);
      }
    } catch {
      /* already gone */
    }
  }
  emit('manifest.uninstall', { scope: 'repo', removed: out.removed.length, keptEdited: out.keptEdited });
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
