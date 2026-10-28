/**
 * Learning-Stores Registry (7.12.0, D5) — a READ-ONLY facade over every place
 * Paradigm (and the host) keeps learned material. NOT a rewrite: each store
 * keeps its own loader, format and lifecycle; this module only names them,
 * classifies them, and counts them (doctor census, `paradigm migrate
 * learning-stores`).
 *
 * Store classes:
 *   ledger    — append-only record of what happened (never pruned or merged:
 *               lore, work-log, history, raw agent journals)
 *   knowledge — distilled, retrievable beliefs (decisions, antipatterns,
 *               notebooks, protocols, skills, preferences)
 *   pipeline  — the loop's moving parts + its falsifiability instruments
 *               (event stream, nominations, debates, promotion-decisions,
 *               classroom-certifications, notebook-refs, liveness probes)
 *   policy    — enforcement config, not learning (habits = hook policy, D3)
 *   native    — host-owned memory (Claude Code auto-memory); registered
 *               read-only, NEVER migrated
 *
 * Loid's must-NOT-consolidate list is encoded by keeping each of these as its
 * own row: journals ≠ notebooks, classroom-certifications / notebook-refs /
 * promotion-decisions stay separate append-only instruments, decisions ≠ antipatterns.
 */

import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { LearningHome } from '../types/knowledge-streams.js';
import { repoIdSegment, resetRepoIdCache } from './repo-id.js';

export type { LearningHome } from '../types/knowledge-streams.js';

export type StoreClass = 'ledger' | 'knowledge' | 'pipeline' | 'policy' | 'native';

export interface LearningStore {
  id: string;
  class: StoreClass;
  /** Absolute path of the store (file or directory). May not exist. */
  path: string;
  scope: 'project' | 'global';
  /** Owning component symbol. */
  owner: string;
  /** Registry default home (scoped learning). Absent on native and unscoped stores. */
  home?: LearningHome;
  /** Number of records (jsonl rows / files / yaml list items). 0 when absent. Never throws. */
  count(): number;
}

export interface LearningStoreOptions {
  /** Override the home directory (tests). Defaults to os.homedir(). */
  homeDir?: string;
}

// ── Counters (all best-effort; never throw) ──

function countJsonl(file: string): number {
  try {
    if (!fs.existsSync(file)) return 0;
    return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).length;
  } catch {
    return 0;
  }
}

/** Count files matching `match` under `dir`, optionally recursing. */
function countFiles(dir: string, match: (name: string) => boolean, recursive = false): number {
  try {
    if (!fs.existsSync(dir)) return 0;
    let n = 0;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (recursive) n += countFiles(path.join(dir, ent.name), match, true);
      } else if (match(ent.name)) {
        n++;
      }
    }
    return n;
  } catch {
    return 0;
  }
}

/** Count immediate subdirectories of `dir` that contain `marker`. */
function countDirsWith(dir: string, marker: string): number {
  try {
    if (!fs.existsSync(dir)) return 0;
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, marker))).length;
  } catch {
    return 0;
  }
}

/** Count `- ` list items under a top-level key in a yaml file (cheap, no parse). */
function countYamlListItems(file: string, key: string): number {
  try {
    if (!fs.existsSync(file)) return 0;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    let inKey = false;
    let n = 0;
    for (const line of lines) {
      if (/^\S/.test(line)) inKey = line.startsWith(`${key}:`);
      else if (inKey && /^ {0,2}- /.test(line)) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/** Count journal yaml files across every agent under ~/.paradigm/agents/<id>/journal. */
function countJournals(agentsDir: string): number {
  try {
    if (!fs.existsSync(agentsDir)) return 0;
    let n = 0;
    for (const ent of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      n += countFiles(path.join(agentsDir, ent.name, 'journal'), f => f.endsWith('.yaml'));
    }
    return n;
  } catch {
    return 0;
  }
}

const isYaml = (f: string) => f.endsWith('.yaml') || f.endsWith('.yml');

/**
 * Claude Code's project key: the absolute path with every character other than A-Z a-z 0-9 → `-` (`/`, `.`,
 * `_`, spaces; on Windows `:` and `\`, so C:\Users\me\repo → C--Users-me-repo). Same rule as the Stop hook's
 * memory nudge (paradigm-common.sh Check 15).
 */
export function nativeMemorySlug(rootDir: string): string {
  return path.resolve(rootDir).replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * Enumerate every learning store for a project (plus the global stores it
 * reads). Pure enumeration — paths are computed, nothing is created.
 */
export function listLearningStores(rootDir: string, opts: LearningStoreOptions = {}): LearningStore[] {
  const root = path.resolve(rootDir);
  const home = safeHomeDir(opts);
  const p = (...parts: string[]) => path.join(root, '.paradigm', ...parts);
  const g = (...parts: string[]) => path.join(home, '.paradigm', ...parts);
  const ev = (f: string) => p('events', f);

  const stores: LearningStore[] = [
    // Three conceptual stores (D5): ledger = append-only record of what
    // happened (lore, work-log, history, raw journals); knowledge = distilled,
    // retrievable beliefs (decisions, antipatterns, notebooks, protocols,
    // skills); pipeline = the loop's moving parts and its falsifiability
    // instruments (events, nominations, debates, promotion/cert/refs, probes).

    // ── ledger ──
    { id: 'lore', class: 'ledger', path: p('lore'), scope: 'project', owner: '#lore-loader',
      // Entries live under lore/entries/<date>/ as .lore (legacy .yaml); timeline.yaml is an index.
      count: () => countFiles(p('lore', 'entries'), f => f.endsWith('.lore') || isYaml(f), true) },
    { id: 'work-log', class: 'ledger', path: p('work-log'), scope: 'project', owner: '#work-log-loader',
      count: () => countFiles(p('work-log'), isYaml, true) },
    { id: 'history', class: 'ledger', path: p('history', 'log.jsonl'), scope: 'project', owner: '#history-handler',
      count: () => countJsonl(p('history', 'log.jsonl')) },
    { id: 'journals', class: 'ledger', path: g('agents'), scope: 'global', owner: '#journal-loader',
      count: () => countJournals(g('agents')) },

    // ── knowledge ──
    { id: 'decisions', class: 'knowledge', path: p('decisions'), scope: 'project', owner: '#decision-loader',
      count: () => countFiles(p('decisions'), isYaml) },
    { id: 'antipatterns', class: 'knowledge', path: p('wisdom', 'antipatterns.yaml'), scope: 'project', owner: '#wisdom-loader',
      count: () => countYamlListItems(p('wisdom', 'antipatterns.yaml'), 'antipatterns') },
    { id: 'antipatterns-global', class: 'knowledge', path: g('wisdom', 'antipatterns.yaml'), scope: 'global', owner: '#global-store',
      count: () => countYamlListItems(g('wisdom', 'antipatterns.yaml'), 'antipatterns') },
    { id: 'notebooks', class: 'knowledge', path: p('notebooks'), scope: 'project', owner: '#notebook-loader',
      count: () => countFiles(p('notebooks'), isYaml, true) },
    { id: 'notebooks-global', class: 'knowledge', path: g('notebooks'), scope: 'global', owner: '#notebook-loader',
      count: () => countFiles(g('notebooks'), isYaml, true) },
    { id: 'protocols', class: 'knowledge', path: p('protocols'), scope: 'project', owner: '#protocol-loader',
      count: () => countFiles(p('protocols'), f => f.endsWith('.protocol')) },
    { id: 'skills', class: 'knowledge', path: p('skills'), scope: 'project', owner: '#skill-loader',
      count: () => countDirsWith(p('skills'), 'SKILL.md') },
    { id: 'skills-global', class: 'knowledge', path: g('skills'), scope: 'global', owner: '#skill-loader',
      count: () => countDirsWith(g('skills'), 'SKILL.md') },
    { id: 'preferences', class: 'knowledge', path: p('wisdom', 'preferences.yaml'), scope: 'project', owner: '#wisdom-loader',
      count: () => (fs.existsSync(p('wisdom', 'preferences.yaml')) ? 1 : 0) },

    // ── pipeline ──
    { id: 'event-stream', class: 'pipeline', path: ev('stream.jsonl'), scope: 'project', owner: '#event-stream',
      count: () => countJsonl(ev('stream.jsonl')) },
    { id: 'nominations', class: 'pipeline', path: ev('nominations.jsonl'), scope: 'project', owner: '#nomination-engine',
      count: () => countJsonl(ev('nominations.jsonl')) },
    { id: 'debates', class: 'pipeline', path: ev('debates.jsonl'), scope: 'project', owner: '#nomination-engine',
      count: () => countJsonl(ev('debates.jsonl')) },
    { id: 'promotion-decisions', class: 'pipeline', path: ev('promotion-decisions.jsonl'), scope: 'project', owner: '#nomination-engine',
      count: () => countJsonl(ev('promotion-decisions.jsonl')) },
    { id: 'classroom-certifications', class: 'pipeline', path: ev('classroom-certifications.jsonl'), scope: 'project', owner: '#field-failures',
      count: () => countJsonl(ev('classroom-certifications.jsonl')) },
    { id: 'notebook-refs', class: 'pipeline', path: ev('notebook-refs.jsonl'), scope: 'project', owner: '#notebook-loader',
      count: () => countJsonl(ev('notebook-refs.jsonl')) },
    { id: 'settlement-liveness', class: 'pipeline', path: ev('settlement-liveness.jsonl'), scope: 'project', owner: '#task-settlement',
      count: () => countJsonl(ev('settlement-liveness.jsonl')) },
    { id: 'postflight-liveness', class: 'pipeline', path: ev('postflight-liveness.jsonl'), scope: 'project', owner: '#ambient-tools',
      count: () => countJsonl(ev('postflight-liveness.jsonl')) },

    // Registered for scoped learning S0 (TD-2026-10-28-820). Paths are the
    // legacy repo locations; homeOf/pathFor give the scoped location.
    { id: 'verdicts', class: 'pipeline', path: ev('verdicts.jsonl'), scope: 'project', owner: '#session-work-log',
      count: () => countJsonl(ev('verdicts.jsonl')) },
    { id: 'overrides', class: 'pipeline', path: ev('overrides.jsonl'), scope: 'project', owner: '#override-command',
      count: () => countJsonl(ev('overrides.jsonl')) },
    { id: 'provisional-mined', class: 'pipeline', path: ev('provisional-mined.jsonl'), scope: 'project', owner: '#provisional-intake',
      count: () => countJsonl(ev('provisional-mined.jsonl')) },
    { id: 'estimate-actuals', class: 'pipeline', path: ev('estimate-actuals.jsonl'), scope: 'project', owner: '#calibration',
      count: () => countJsonl(ev('estimate-actuals.jsonl')) },
    { id: 'team-funnel', class: 'pipeline', path: ev('team-funnel.jsonl'), scope: 'project', owner: '#team-funnel',
      count: () => countJsonl(ev('team-funnel.jsonl')) },
    { id: 'compliance-history', class: 'pipeline', path: ev('compliance-history.jsonl'), scope: 'project', owner: '#compliance-checker',
      count: () => countJsonl(ev('compliance-history.jsonl')) },

    // ── policy (D3: habits are hook policy, not a learning store) ──
    { id: 'habits', class: 'policy', path: p('habits'), scope: 'project', owner: '#habits',
      count: () => countFiles(p('habits'), f => f.endsWith('.habit')) },

    // ── native (read-only, never migrated) ──
    { id: 'claude-memory', class: 'native',
      path: path.join(home, '.claude', 'projects', nativeMemorySlug(root), 'memory'), scope: 'project', owner: 'claude-code',
      count: () => countFiles(path.join(home, '.claude', 'projects', nativeMemorySlug(root), 'memory'), f => f.endsWith('.md')) },
  ];

  for (const st of stores) {
    const a = REGISTRY_ARTIFACT[st.id];
    if (a) st.home = st.scope === 'global' ? 'user' : ARTIFACTS[a].defaultHome;
  }
  return stores;
}

/** Legacy stores the registry knows about only so migration/doctor can report them. */
export function legacyStorePaths(rootDir: string, opts: LearningStoreOptions = {}): {
  projectWisdomDecisions: string;
  globalWisdomDecisions: string;
} {
  const home = safeHomeDir(opts);
  return {
    projectWisdomDecisions: path.join(path.resolve(rootDir), '.paradigm', 'wisdom', 'decisions'),
    globalWisdomDecisions: path.join(home, '.paradigm', 'wisdom', 'decisions'),
  };
}

// ════════════════════════════════════════════════════════════════════════
// Scoped learning (S0, TD-2026-10-28-820): homeOf / pathFor / the guard, and
// the union JSONL helpers every S1 writer and reader goes through.
//
// Rule (Loid): an instrument lives in the same home as the thing it measures.
// Precedence: entry home > config `learning.default_home.<artifact>` > registry.
// Readers take the union of repo and user (and machine), dedupe by id, and the
// repo row wins on the same id (notebook-loader's rule).
// ════════════════════════════════════════════════════════════════════════

export const LEARNING_HOMES: readonly LearningHome[] = ['repo', 'user', 'machine'];

export type LearningArtifact =
  // repo by default
  | 'notebooks' | 'decisions' | 'wisdom' | 'habits' | 'agent-state' | 'overrides'
  | 'classroom-certifications' | 'notebook-refs'
  // user by default
  | 'journals' | 'verdicts' | 'provisional-mined' | 'nominations' | 'debates'
  | 'promotion-decisions' | 'estimate-actuals' | 'learned-token-estimates'
  // machine by default
  | 'hook-timings' | 'settlement-liveness' | 'postflight-liveness' | 'team-funnel' | 'compliance-history';

interface ArtifactSpec {
  defaultHome: LearningHome;
  /** Path parts under the `.paradigm` folder of the home. */
  rel: string[];
  /**
   * The user home is the person's cross-project store (~/.paradigm/<rel>), not
   * the per-repo one (~/.paradigm/projects/<repoId>/<rel>). True for the stores
   * that already followed the person before scoping: journals, global
   * notebooks, global wisdom.
   */
  userShared?: boolean;
}

/** Founder defaults (TD-2026-10-28-820). */
export const ARTIFACTS: Readonly<Record<LearningArtifact, ArtifactSpec>> = {
  'notebooks': { defaultHome: 'repo', rel: ['notebooks'], userShared: true },
  'decisions': { defaultHome: 'repo', rel: ['decisions'] },
  'wisdom': { defaultHome: 'repo', rel: ['wisdom'], userShared: true },
  'habits': { defaultHome: 'repo', rel: ['habits'] },
  'agent-state': { defaultHome: 'repo', rel: ['agent-state'] },
  'overrides': { defaultHome: 'repo', rel: ['events', 'overrides.jsonl'] },
  'classroom-certifications': { defaultHome: 'repo', rel: ['events', 'classroom-certifications.jsonl'] },
  'notebook-refs': { defaultHome: 'repo', rel: ['events', 'notebook-refs.jsonl'] },
  'journals': { defaultHome: 'user', rel: ['agents'], userShared: true },
  'verdicts': { defaultHome: 'user', rel: ['events', 'verdicts.jsonl'] },
  'provisional-mined': { defaultHome: 'user', rel: ['events', 'provisional-mined.jsonl'] },
  'nominations': { defaultHome: 'user', rel: ['events', 'nominations.jsonl'] },
  'debates': { defaultHome: 'user', rel: ['events', 'debates.jsonl'] },
  'promotion-decisions': { defaultHome: 'user', rel: ['events', 'promotion-decisions.jsonl'] },
  'estimate-actuals': { defaultHome: 'user', rel: ['events', 'estimate-actuals.jsonl'] },
  // Derived from estimate-actuals; lives in the same home as the actuals it measures.
  'learned-token-estimates': { defaultHome: 'user', rel: ['learned', 'token-estimates.json'] },
  'hook-timings': { defaultHome: 'machine', rel: ['events', 'hook-timings.jsonl'] },
  'settlement-liveness': { defaultHome: 'machine', rel: ['events', 'settlement-liveness.jsonl'] },
  'postflight-liveness': { defaultHome: 'machine', rel: ['events', 'postflight-liveness.jsonl'] },
  'team-funnel': { defaultHome: 'machine', rel: ['events', 'team-funnel.jsonl'] },
  'compliance-history': { defaultHome: 'machine', rel: ['events', 'compliance-history.jsonl'] },
};

/** Registry row id → artifact, for the `home` column of listLearningStores. */
const REGISTRY_ARTIFACT: Record<string, LearningArtifact> = {
  'journals': 'journals', 'decisions': 'decisions', 'antipatterns': 'wisdom', 'preferences': 'wisdom',
  'notebooks': 'notebooks', 'notebooks-global': 'notebooks', 'antipatterns-global': 'wisdom', 'nominations': 'nominations', 'debates': 'debates',
  'promotion-decisions': 'promotion-decisions', 'classroom-certifications': 'classroom-certifications',
  'notebook-refs': 'notebook-refs', 'settlement-liveness': 'settlement-liveness',
  'postflight-liveness': 'postflight-liveness', 'habits': 'habits', 'verdicts': 'verdicts',
  'overrides': 'overrides', 'provisional-mined': 'provisional-mined', 'estimate-actuals': 'estimate-actuals',
  'team-funnel': 'team-funnel', 'compliance-history': 'compliance-history',
};

export function isLearningHome(v: unknown): v is LearningHome {
  return v === 'repo' || v === 'user' || v === 'machine';
}

/** The slice of .paradigm/config.yaml the resolver reads. */
export interface LearningHomeConfig {
  learning?: { default_home?: Partial<Record<string, unknown>> };
}

let _configCache: { file: string; mtimeMs: number; config: LearningHomeConfig | null } | null = null;

/** Read `learning.default_home` from <root>/.paradigm/config.yaml (mtime-cached). Never throws. */
export function readLearningHomeConfig(root: string): LearningHomeConfig | null {
  const file = path.join(path.resolve(root), '.paradigm', 'config.yaml');
  try {
    const st = fs.statSync(file);
    if (_configCache && _configCache.file === file && _configCache.mtimeMs === st.mtimeMs) return _configCache.config;
    const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as LearningHomeConfig | null;
    const config = parsed && typeof parsed === 'object' ? parsed : null;
    _configCache = { file, mtimeMs: st.mtimeMs, config };
    return config;
  } catch {
    return null;
  }
}

/**
 * The home a record of `artifact` lives in. Precedence: the entry's own `home`
 * > config `learning.default_home.<artifact>` > the registry default. Invalid
 * values at any level fall through to the next.
 */
export function homeOf(
  artifact: LearningArtifact,
  entry?: { home?: unknown } | null,
  config?: LearningHomeConfig | null,
): LearningHome {
  if (entry && isLearningHome(entry.home)) return entry.home;
  const configured = config?.learning?.default_home?.[artifact];
  if (isLearningHome(configured)) return configured;
  return ARTIFACTS[artifact].defaultHome;
}

export interface PathForOptions {
  /** Override the home directory (tests). Defaults to os.homedir(). */
  homeDir?: string;
  /**
   * Root of the per-repo user and machine stores. Defaults to
   * $PARADIGM_LEARNING_HOME, else <homeDir>/.paradigm.
   */
  learningHome?: string;
}

/** Thrown when a record would land in the wrong home (the write-side guard). */
export class LearningHomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LearningHomeError';
  }
}

/** Resolve the longest existing prefix through realpath (macOS /tmp → /private/tmp). */
function realOrResolved(p: string): string {
  const abs = path.resolve(p);
  let head = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(head), ...tail.reverse());
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return abs;
      tail.push(path.basename(head));
      head = parent;
    }
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(realOrResolved(parent), realOrResolved(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * The write-side guard: user and machine data never go under the repo root,
 * and repo data never goes outside it. Throws LearningHomeError on a mismatch.
 */
export function assertHomePlacement(home: LearningHome, filePath: string, root: string): void {
  const inside = isInside(filePath, root);
  if (home !== 'repo' && inside) {
    throw new LearningHomeError(`refusing to write ${home}-home learning data under the repo root: ${filePath}`);
  }
  if (home === 'repo' && !inside) {
    throw new LearningHomeError(`repo-home learning data must live under the repo root: ${filePath}`);
  }
}

/**
 * The home directory, never empty (S2: the hook shell may run with no HOME).
 * opts.homeDir > os.homedir() (HOME, else the passwd entry / USERPROFILE) >
 * os.userInfo().homedir. Throws LearningHomeError when none can be found, so
 * a caller never writes relative to the cwd (which may be the repo).
 */
export function safeHomeDir(opts: { homeDir?: string } = {}): string {
  if (opts.homeDir) return opts.homeDir;
  const candidates: Array<() => string> = [() => os.homedir(), () => os.userInfo().homedir];
  for (const c of candidates) {
    try {
      const h = c();
      if (h && path.isAbsolute(h)) return h;
    } catch {
      /* try the next */
    }
  }
  throw new LearningHomeError('no home directory: set HOME or PARADIGM_LEARNING_HOME');
}

function learningBase(opts: PathForOptions): string {
  return opts.learningHome
    ?? process.env.PARADIGM_LEARNING_HOME
    ?? path.join(safeHomeDir(opts), '.paradigm');
}

export interface MachineStateOptions {
  homeDir?: string;
  /** Defaults to process.platform (tests pass 'win32' / 'linux' / 'darwin'). */
  platform?: NodeJS.Platform;
  /** Defaults to process.env (XDG_STATE_HOME, LOCALAPPDATA). */
  env?: NodeJS.ProcessEnv;
}

/**
 * The OS state directory machine-home stores live under (S2), before the
 * repo id segment:
 *   macOS   ~/Library/Application Support/paradigm/state
 *   Linux   $XDG_STATE_HOME/paradigm, else ~/.local/state/paradigm
 *   Windows %LOCALAPPDATA%\paradigm\state, else ~\AppData\Local\paradigm\state
 * A relative XDG_STATE_HOME or LOCALAPPDATA is ignored (the XDG spec says so).
 */
export function machineStateDir(opts: MachineStateOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  if (platform === 'win32') {
    const w = path.win32;
    const local = env.LOCALAPPDATA && w.isAbsolute(env.LOCALAPPDATA)
      ? env.LOCALAPPDATA
      : w.join(safeHomeDir(opts), 'AppData', 'Local');
    return w.join(local, 'paradigm', 'state');
  }
  const p = path.posix;
  if (platform === 'darwin') return p.join(safeHomeDir(opts), 'Library', 'Application Support', 'paradigm', 'state');
  const xdg = env.XDG_STATE_HOME && p.isAbsolute(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : p.join(safeHomeDir(opts), '.local', 'state');
  return p.join(xdg, 'paradigm');
}

/** The per-repo machine home: <learning home>/machine/<repoId> when overridden, else <OS state dir>/<repoId>. */
function machineBase(r: string, opts: PathForOptions): string {
  const override = opts.learningHome ?? process.env.PARADIGM_LEARNING_HOME;
  if (override) return path.join(override, 'machine', repoIdSegment(r));
  return path.join(machineStateDir(opts), repoIdSegment(r));
}

/** The raw location of `artifact` in `home` (no guard, no mapping). */
function locate(artifact: LearningArtifact, home: LearningHome, r: string, opts: PathForOptions): string {
  const spec = ARTIFACTS[artifact];
  if (home === 'repo') return path.join(r, '.paradigm', ...spec.rel);
  if (home === 'user' && spec.userShared) return path.join(safeHomeDir(opts), '.paradigm', ...spec.rel);
  if (home === 'machine') return path.join(machineBase(r, opts), ...spec.rel);
  return path.join(learningBase(opts), 'projects', repoIdSegment(r), ...spec.rel);
}

function hasGitAncestor(dir: string): boolean {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    if (path.dirname(d) === d) return false;
  }
}

/**
 * Whether `root` has a repo home at all (review F4). There is none when the
 * root IS the home directory (or an ancestor of it: user stores would sit
 * inside it), or when the root is not inside a git repository (nothing is
 * committed or shared). Then every record is user-home and the guard is
 * skipped. $PARADIGM_LEARNING_ASSUME_REPO=1 skips the git check only; the test
 * setups set it because their temp roots are not git repositories.
 */
export function hasRepoHome(root: string, opts: PathForOptions = {}): boolean {
  const r = realOrResolved(root);
  let homeRaw: string;
  try {
    homeRaw = safeHomeDir(opts);
  } catch {
    homeRaw = '';
  }
  const assume = process.env.PARADIGM_LEARNING_ASSUME_REPO === '1';
  // S2: cached per root for the life of the process (every pathFor and union
  // read asks; the answer only changes on `git init`, which a migration run
  // handles in its own process).
  const key = `${r}\0${homeRaw}\0${assume ? 1 : 0}`;
  const hit = _hasRepoHomeCache.get(key);
  if (hit !== undefined) return hit;
  let result: boolean;
  if (homeRaw && isInside(realOrResolved(homeRaw), r)) result = false;
  else if (assume) result = true;
  else result = hasGitAncestor(r);
  _hasRepoHomeCache.set(key, result);
  return result;
}

const _hasRepoHomeCache = new Map<string, boolean>();

/** Test hook: forget the per-process caches (hasRepoHome, repo ids, author). */
export function resetLearningStoreCaches(): void {
  _hasRepoHomeCache.clear();
  _authorCache.clear();
  resetRepoIdCache();
}

/** The home a write actually uses: repo becomes user when the root has no repo home. */
export function effectiveHome(home: LearningHome, root: string, opts: PathForOptions = {}): LearningHome {
  return home === 'repo' && !hasRepoHome(root, opts) ? 'user' : home;
}

/**
 * Absolute path of `artifact` in `home` for the repo at `root`:
 *   repo    → <root>/.paradigm/<rel>
 *   user    → <learningHome>/projects/<repoId>/<rel>  (userShared: ~/.paradigm/<rel>)
 *   machine → <learningHome>/machine/<repoId>/<rel>
 * When the root has no repo home (hasRepoHome), 'repo' maps to 'user' and the
 * guard is skipped. Otherwise runs the guard, so it throws LearningHomeError
 * rather than return a path in the wrong home. Computes only; creates nothing.
 */
export function pathFor(
  artifact: LearningArtifact,
  home: LearningHome,
  root: string,
  opts: PathForOptions = {},
): string {
  const r = path.resolve(root);
  if (!hasRepoHome(r, opts)) return locate(artifact, home === 'repo' ? 'user' : home, r, opts);
  const p = locate(artifact, home, r, opts);
  assertHomePlacement(home, p, r);
  return p;
}

/**
 * Every existing physical location of `artifact` for this repo, repo first.
 * Reads the raw locations (a legacy repo file is still read when the root has
 * no repo home). Never throws.
 */
function existingLocations(artifact: LearningArtifact, root: string, opts: PathForOptions): Array<{ home: LearningHome; file: string }> {
  const r = path.resolve(root);
  const guarded = hasRepoHome(r, opts);
  const out: Array<{ home: LearningHome; file: string }> = [];
  const seen = new Set<string>();
  for (const h of LEARNING_HOMES) {
    try {
      const file = locate(artifact, h, r, opts);
      if (guarded) assertHomePlacement(h, file, r);
      if (!seen.has(file) && fs.existsSync(file)) {
        seen.add(file);
        out.push({ home: h, file });
      }
    } catch {
      /* a misplaced home is skipped on read; writers still throw */
    }
  }
  return out;
}

function parseJsonl<T>(file: string): T[] {
  try {
    return fs.readFileSync(file, 'utf8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) as T; } catch { return null; } })
      .filter((r): r is T => r !== null && typeof r === 'object');
  } catch {
    return [];
  }
}

/** Trim a JSONL file to its last `maxLines` rows. Non-fatal. */
export function pruneJsonl(file: string, maxLines: number): void {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
    if (lines.length > maxLines) fs.writeFileSync(file, lines.slice(-maxLines).join('\n') + '\n', 'utf8');
  } catch {
    /* non-fatal */
  }
}

export interface AppendLearningOptions extends PathForOptions {
  /** Explicit home for these rows (beats row.home and config). */
  home?: LearningHome;
  /** Trim the file to this many rows after the append. */
  maxLines?: number;
  config?: LearningHomeConfig | null;
}

/**
 * Append rows to `artifact` in their resolved home (opts.home > the first
 * row's home > config > registry). Each row is stamped with `home`. Throws
 * LearningHomeError when the path is in the wrong home (best-effort callers
 * catch it). Returns the file written.
 */
export function appendLearningRows<T extends object>(
  artifact: LearningArtifact,
  root: string,
  rows: T[],
  opts: AppendLearningOptions = {},
): string {
  const config = opts.config !== undefined ? opts.config : readLearningHomeConfig(root);
  const first = rows[0] as { home?: unknown } | undefined;
  const home = effectiveHome(homeOf(artifact, { home: opts.home ?? first?.home }, config), root, opts);
  const file = pathFor(artifact, home, root, opts);
  if (rows.length === 0) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, rows.map(r => JSON.stringify({ ...r, home })).join('\n') + '\n', 'utf8');
  if (opts.maxLines) pruneJsonl(file, opts.maxLines);
  return file;
}

/** Tags readLearningRows adds. `legacy` marks a pre-scoping row whose home was inferred from its file. */
export interface LearningRowTags {
  home: LearningHome;
  legacy?: true;
}

export interface ReadLearningOptions<T> extends PathForOptions {
  /** Dedupe key; rows without one are all kept. Repo wins on the same id. */
  idOf?: (row: T) => string | undefined;
  /** Per-file filter; `at` is the physical home the row was read from. */
  filter?: (row: T, at: LearningHome) => boolean;
  config?: LearningHomeConfig | null;
}

/**
 * Union read of `artifact` across repo, user and machine. Each row is tagged
 * with `home`: its own field; else, for a legacy row with no home and no
 * author, the home it was READ FROM, flagged `legacy: true` (a separate
 * population; review F2); else homeOf's default. Writes still use the type
 * default. Deduped by `idOf`, repo wins on the same id.
 * Order: user, machine, then repo rows, each in file order. Never throws.
 */
export function readLearningRows<T extends object>(
  artifact: LearningArtifact,
  root: string,
  opts: ReadLearningOptions<T> = {},
): Array<T & LearningRowTags> {
  const config = opts.config !== undefined ? opts.config : readLearningHomeConfig(root);
  const fallback = homeOf(artifact, null, config);
  const locs = existingLocations(artifact, root, opts);
  const ordered = [...locs.filter(l => l.home !== 'repo'), ...locs.filter(l => l.home === 'repo')];
  const byId = new Map<string, number>();
  const out: Array<T & LearningRowTags> = [];
  for (const loc of ordered) {
    for (const row of parseJsonl<T>(loc.file)) {
      // S2: a repo row a migration copied into its owner's home is frozen and
      // never read again (the copy is), so it neither double-counts nor wins.
      if ((row as { migrated?: unknown }).migrated === true) continue;
      if (opts.filter && !opts.filter(row, loc.home)) continue;
      const { home: own, author } = row as { home?: unknown; author?: unknown };
      const tagged = (isLearningHome(own)
        ? { ...row, home: own }
        : author === undefined
          ? { ...row, home: loc.home, legacy: true }
          : { ...row, home: fallback }) as T & LearningRowTags;
      const id = opts.idOf?.(row);
      if (id !== undefined && byId.has(id)) {
        out[byId.get(id)!] = tagged;
        continue;
      }
      if (id !== undefined) byId.set(id, out.length);
      out.push(tagged);
    }
  }
  return out;
}

/**
 * Rewrite every existing physical file of `artifact` in place. `fn` returns the
 * replacement row, or undefined to keep the line byte-identical. `at` is the
 * physical home. Returns the number of rows changed. Non-fatal per file.
 */
export function rewriteLearningRows<T extends object>(
  artifact: LearningArtifact,
  root: string,
  fn: (row: T, at: LearningHome) => T | undefined,
  opts: PathForOptions = {},
): number {
  let changed = 0;
  for (const loc of existingLocations(artifact, root, opts)) {
    try {
      let fileChanged = false;
      const lines = fs.readFileSync(loc.file, 'utf8').split('\n').filter(l => l.trim());
      const updated = lines.map(line => {
        try {
          const next = fn(JSON.parse(line) as T, loc.home);
          if (next === undefined) return line;
          fileChanged = true;
          changed++;
          return JSON.stringify(next);
        } catch {
          return line;
        }
      });
      if (fileChanged) fs.writeFileSync(loc.file, updated.join('\n') + '\n', 'utf8');
    } catch {
      /* non-fatal */
    }
  }
  return changed;
}

/**
 * Where a journal entry's promotion lands, and so where its notebook entry,
 * classroom certification and promotion-decision row live (Loid's rule).
 * Explicit `home` wins; else transferable:false → repo, true/absent → user.
 */
export function promotionHomeOf(journal: { home?: unknown; transferable?: boolean }): LearningHome {
  if (isLearningHome(journal.home)) return journal.home;
  return journal.transferable === false ? 'repo' : 'user';
}

/** Group samples by home: calibration never pools populations silently. */
export function groupByHome<T extends { home?: LearningHome }>(rows: T[], fallback: LearningHome): Record<LearningHome, T[]> {
  const out: Record<LearningHome, T[]> = { repo: [], user: [], machine: [] };
  for (const r of rows) out[isLearningHome(r.home) ? r.home : fallback].push(r);
  return out;
}

const _authorCache = new Map<string, string>();

const hash12 = (v: string): string => createHash('sha256').update(v).digest('hex').slice(0, 12);

function gitUserEmail(cwd: string | undefined): string | null {
  try {
    const out = execFileSync('git', ['config', '--get', 'user.email'], {
      cwd: cwd ?? process.cwd(),
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: false,
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function osUsername(): string | null {
  try {
    return os.userInfo().username || null;
  } catch {
    return process.env.USER || process.env.USERNAME || null;
  }
}

/**
 * Who wrote a row (verdict authorship, S2). Never a raw email or username:
 *   $PARADIGM_AUTHOR (used as given),
 *   else `ue:` + 12 hex of sha256(lowercased, trimmed git user.email),
 *   else `uh:` + 12 hex of sha256(the OS username),
 *   else `unknown`.
 * Cached per root for the life of the process.
 */
export function currentAuthor(root?: string): string {
  if (process.env.PARADIGM_AUTHOR) return process.env.PARADIGM_AUTHOR;
  const key = root ? path.resolve(root) : '';
  const hit = _authorCache.get(key);
  if (hit) return hit;
  const email = gitUserEmail(root);
  const user = email ? null : osUsername();
  const id = email ? `ue:${hash12(email.toLowerCase())}` : user ? `uh:${hash12(user)}` : 'unknown';
  _authorCache.set(key, id);
  return id;
}

/**
 * Whether `author` is the current user: the hashed identity, or the raw OS
 * username S1 stamped before hashing (matched on read only, never written).
 */
export function isOwnAuthor(author: unknown, root?: string): boolean {
  if (typeof author !== 'string') return false;
  if (author === currentAuthor(root)) return true;
  return !process.env.PARADIGM_AUTHOR && author === osUsername();
}
