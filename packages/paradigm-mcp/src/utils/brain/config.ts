/**
 * #brain-config — brain.yaml load/save, storage paths, hard-blocks, gate resolution.
 *
 * Storage: <homedir>/.paradigm/brains/<sha256(realpath(root))[0:16]>/
 * Never writes inside the user's root. Fail-closed everywhere.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as yaml from 'js-yaml';
import { log } from '../mcp-logger.js';
import { atomicWriteFileSync, foldPath, isInside } from './atomic.js';
import { appendEgress } from './egress.js';
import {
  DEFAULT_LIMITS,
  GATE_RANK,
  type BrainConfig,
  type BrainGate,
  type BrainOptions,
  type BrainZone,
} from './types.js';

const L = () => log.component('#brain-config');

export class BrainConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrainConfigError';
  }
}

const ROOT_HASH_RE = /^[0-9a-f]{16}$/;
const VALID_GATES = new Set<BrainGate>(Object.keys(GATE_RANK) as BrainGate[]);

// ── Paths ────────────────────────────────────────────────────────────

/**
 * Home directory that holds `.paradigm/brains`. Precedence: injected
 * `opts.homedir` → `PARADIGM_BRAIN_HOME` env (test isolation) → os.homedir().
 */
export function resolveHomedir(opts?: BrainOptions): string {
  const env = process.env.PARADIGM_BRAIN_HOME;
  return path.resolve(opts?.homedir ?? (env && env.trim() ? env : os.homedir()));
}

/** realpath via the OS (canonical on-disk spelling where the platform provides it). */
export function realpathNative(p: string): string {
  return fs.realpathSync.native(p);
}

export function brainsHome(opts?: BrainOptions): string {
  return path.join(resolveHomedir(opts), '.paradigm', 'brains');
}

export function isRootHash(s: unknown): s is string {
  return typeof s === 'string' && ROOT_HASH_RE.test(s);
}

export function rootHashOf(folder: string): string {
  const real = realpathNative(path.resolve(folder));
  return crypto.createHash('sha256').update(real).digest('hex').slice(0, 16);
}

export function brainDir(rootHash: string, opts?: BrainOptions): string {
  if (!isRootHash(rootHash)) throw new BrainConfigError('invalid brain id');
  return path.join(brainsHome(opts), rootHash);
}

export const BRAIN_FILES = Object.freeze({
  config: 'brain.yaml',
  index: 'index.json',
  declared: 'declared.yaml',
  suggestions: 'suggestions.jsonl',
  egress: 'egress.log',
  /** sha256 of the brain.yaml bytes Paradigm last wrote (tamper evidence). */
  configHash: '.config-hash',
  /** Sticky marker: set when tampering was detected; cleared only by a human access change. */
  configTampered: '.config-tampered',
  /** Hash of the brain.yaml being written right now (written BEFORE brain.yaml, renamed onto .config-hash after). */
  configHashPending: '.config-hash.pending',
  /** Snapshot of the last brain.yaml Paradigm wrote while NOT tampered — the review baseline. */
  configLastGood: '.config-lastgood.yaml',
});

export function brainFile(rootHash: string, name: keyof typeof BRAIN_FILES, opts?: BrainOptions): string {
  return path.join(brainDir(rootHash, opts), BRAIN_FILES[name]);
}

/**
 * Guard every write: target must live under brainsHome and never inside the root.
 * Throws (fail-closed).
 */
export function assertBrainWritePath(target: string, root: string, opts?: BrainOptions): void {
  const abs = path.resolve(target);
  if (!isInside(abs, brainsHome(opts))) throw new BrainConfigError('refusing write outside brain storage');
  if (root && isInside(abs, path.resolve(root))) throw new BrainConfigError('refusing write inside the user folder');
  let realRoot = root;
  try { realRoot = realpathNative(root); } catch { /* root may be gone */ }
  let realParent = path.dirname(abs);
  try { realParent = realpathNative(realParent); } catch { /* not created yet */ }
  if (realRoot && isInside(realParent, realRoot)) throw new BrainConfigError('refusing write inside the user folder');
}

// ── Hard blocks ──────────────────────────────────────────────────────

const HOME_BLOCKED = [
  'Library',
  '.ssh',
  '.gnupg',
  '.mozilla',
  '.config/google-chrome',
  '.config/chromium',
  '.config/BraveSoftware',
];

/** Segment names blocked anywhere (case-insensitive). */
const SEGMENT_BLOCKED = new Set(['maildir', '.ssh', '.gnupg', '.mozilla']);

/** Basename patterns blocked anywhere (file or dir). */
const NAME_BLOCKED: RegExp[] = [
  /\.mbox$/i,
  /\.pst$/i,
  /\.emlx$/i,
  /\.kdbx$/i,
  /\.1pif$/i,
  /\.opvault$/i,
  /bitwarden.*export/i,
  /lastpass.*\.csv$/i,
];

/**
 * Every spelling of the home directory worth blocking under: the configured
 * brain home AND the OS home (both, fail-closed), each resolved and realpath'd.
 */
const homeVariantCache = new Map<string, string[]>();

function homeVariants(homedir: string): string[] {
  const key = `${path.resolve(homedir)}\u0000${os.homedir()}`;
  const hit = homeVariantCache.get(key);
  if (hit) return hit;
  const out: string[] = [];
  const add = (p: string) => { if (p && !out.includes(p)) out.push(p); };
  for (const h of [path.resolve(homedir), path.resolve(os.homedir())]) {
    add(h);
    try { add(realpathNative(h)); } catch { /* ignore */ }
    try { add(fs.realpathSync(h)); } catch { /* ignore */ }
  }
  homeVariantCache.set(key, out);
  return out;
}

function blockReasonFor(abs: string, homes: string[]): string | null {
  // Hard-blocks ALWAYS compare case-folded + NFC (fail closed on every
  // platform; required on darwin/win32 where `~/library` IS `~/Library`).
  for (const home of homes) {
    for (const rel of HOME_BLOCKED) {
      if (isInside(abs, path.join(home, rel), true)) return `home:${rel}`;
    }
  }
  for (const raw of abs.split(path.sep)) {
    if (!raw) continue;
    const seg = foldPath(raw, true);
    if (SEGMENT_BLOCKED.has(seg)) return `segment:${seg}`;
    for (const re of NAME_BLOCKED) if (re.test(seg)) return `name:${re.source}`;
  }
  return null;
}

/**
 * Returns a reason string when `absPath` is hard-blocked, else null.
 * Hard-blocks win over allow-lists and share globs. Checks the path as given
 * AND its OS realpath (when it exists), both case/NFC-folded.
 */
export function hardBlockReason(absPath: string, opts?: BrainOptions, check: { realpath?: boolean } = {}): string | null {
  const abs = path.resolve(absPath);
  const homes = homeVariants(resolveHomedir(opts));
  const direct = blockReasonFor(abs, homes);
  if (direct) return direct;
  if (check.realpath === false) return null;
  let real: string | null = null;
  try { real = realpathNative(abs); } catch { real = null; }
  if (real && real !== abs) return blockReasonFor(real, homes);
  return null;
}

// ── Globs ────────────────────────────────────────────────────────────

const globCache = new Map<string, RegExp>();

/** Minimal glob: `**` any depth, `*` within a segment, `?` one char. */
export function globToRegExp(glob: string, caseInsensitive: boolean): RegExp {
  const key = `${caseInsensitive ? 'i' : 's'}:${glob}`;
  const hit = globCache.get(key);
  if (hit) return hit;
  let g = glob.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        // `**/` → any number of segments; trailing `**` → anything
        if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  g = re;
  const out = new RegExp(`^${g}$`, caseInsensitive ? 'i' : '');
  globCache.set(key, out);
  return out;
}

export function globMatches(glob: string, relpath: string, caseInsensitive: boolean): boolean {
  return globToRegExp(glob, caseInsensitive).test(relpath);
}

// ── Gate resolution ──────────────────────────────────────────────────

export function stricter(a: BrainGate, b: BrainGate): BrainGate {
  return GATE_RANK[b] > GATE_RANK[a] ? b : a;
}

/**
 * Gate for a root-relative POSIX path: default_gate → share (human, lowers
 * private→open, case-sensitive) → strictest matching zone (case-insensitive).
 * Throws on malformed config — callers MUST treat a throw as 'quarantined'.
 */
export function resolveGate(relpath: string, config: BrainConfig): BrainGate {
  if (typeof relpath !== 'string') throw new BrainConfigError('bad path');
  let gate: BrainGate = 'private'; // default_gate is always private (default-deny)
  if (config.share.some((g) => globMatches(g, relpath, false))) gate = 'open';
  for (const z of config.zones) {
    if (!VALID_GATES.has(z.gate)) throw new BrainConfigError('bad zone gate');
    if (globMatches(z.glob, relpath, true)) gate = stricter(gate, z.gate);
  }
  return gate;
}

/** Fail-closed wrapper. */
export function safeResolveGate(relpath: string, config: BrainConfig): BrainGate {
  try {
    return resolveGate(relpath, config);
  } catch {
    return 'quarantined';
  }
}

/** The zone (if any) responsible for a sensitive gate — strictest, first-declared. */
export function governingZone(relpath: string, config: BrainConfig): BrainZone | null {
  let best: BrainZone | null = null;
  for (const z of config.zones) {
    if (!globMatches(z.glob, relpath, true)) continue;
    if (!best || GATE_RANK[z.gate] > GATE_RANK[best.gate]) best = z;
  }
  return best;
}

// ── Name-based zones ─────────────────────────────────────────────────

const NAME_ZONES: Record<string, BrainGate> = {
  health: 'medical',
  medical: 'medical',
  tax: 'financial',
  taxes: 'financial',
  bank: 'financial',
  banking: 'financial',
  finance: 'financial',
  passport: 'identity',
  legal: 'identity',
  ids: 'identity',
};

/**
 * Gate implied by a folder NAME: matches when any word token of the name is a
 * keyword ("Health Records", "Taxes 2024", "my-bank", "MedicalBills"),
 * case-insensitively. Strictest wins (all name gates share one rank today).
 */
export function nameZoneGate(dirName: string): BrainGate | null {
  const tokens = dirName
    .normalize('NFC')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  let best: BrainGate | null = null;
  for (const t of tokens) {
    const g = t ? NAME_ZONES[t] : undefined;
    if (g && (!best || GATE_RANK[g] > GATE_RANK[best])) best = g;
  }
  return best;
}

// ── Load / save ──────────────────────────────────────────────────────

function normalizeConfig(raw: unknown): BrainConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BrainConfigError('brain.yaml is not a mapping');
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) throw new BrainConfigError('unsupported brain.yaml version');
  if (typeof r.root !== 'string' || !path.isAbsolute(r.root)) throw new BrainConfigError('brain.yaml root missing');
  const share = Array.isArray(r.share) ? r.share.filter((s): s is string => typeof s === 'string' && isSafeGlob(s)) : [];
  const zones: BrainZone[] = [];
  if (Array.isArray(r.zones)) {
    for (const z of r.zones) {
      if (!z || typeof z !== 'object') continue;
      const zz = z as Record<string, unknown>;
      if (typeof zz.glob !== 'string') continue;
      // Unknown gate → quarantined (fail closed); 'open' zones are not allowed (use share).
      let gate: BrainGate = VALID_GATES.has(zz.gate as BrainGate) ? (zz.gate as BrainGate) : 'quarantined';
      if (gate === 'open') gate = 'private';
      const source = zz.source === 'detector' || zz.source === 'name' || zz.source === 'human' ? zz.source : 'human';
      zones.push({ glob: zz.glob, gate, source });
    }
  }
  const lim = (r.limits && typeof r.limits === 'object' ? r.limits : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, d) : d);
  return {
    version: 1,
    root: r.root,
    default_gate: 'private',
    share,
    zones,
    agent_access: r.agent_access === 'metadata' ? 'metadata' : 'off',
    ...(typeof r.workspace === 'string' ? { workspace: r.workspace } : {}),
    limits: {
      // limits may only be tightened below the defaults
      max_file_bytes: num(lim.max_file_bytes, DEFAULT_LIMITS.max_file_bytes),
      max_files: num(lim.max_files, DEFAULT_LIMITS.max_files),
      parse_ms: num(lim.parse_ms, DEFAULT_LIMITS.parse_ms),
    },
  };
}

export function isSafeGlob(glob: string): boolean {
  return glob.length > 0 && !path.isAbsolute(glob) && !glob.split('/').includes('..') && !glob.includes('\0');
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function readTrim(file: string): string | null {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
}

/**
 * Tamper evidence: brain.yaml must hash to what Paradigm last wrote, and no
 * sticky tamper marker may be present. On a fresh mismatch: write the marker
 * and append ONE egress event {channel:'config', op:'tamper-detected'}.
 */
/** True when brain.yaml's bytes match the recorded hash OR the in-flight pending hash. */
function hashMatches(rootHash: string, text: string, opts?: BrainOptions): boolean {
  const h = sha256(text);
  return readTrim(brainFile(rootHash, 'configHash', opts)) === h || readTrim(brainFile(rootHash, 'configHashPending', opts)) === h;
}

/** Test seam: runs between the first mismatch and the ~50ms re-check. */
export const brainConfigTestHooks: { beforeTamperRecheck?: () => void } = {};

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function recordTamper(rootHash: string, cfg: BrainConfig, opts?: BrainOptions): void {
  const marker = brainFile(rootHash, 'configTampered', opts);
  if (fs.existsSync(marker)) return;
  {
    try {
      assertBrainWritePath(marker, cfg.root, opts);
      atomicWriteFileSync(marker, `${new Date().toISOString()}\n`);
      appendEgress(rootHash, { at: new Date().toISOString(), channel: 'config', op: 'tamper-detected', fileIds: [], bytes: 0, root: cfg.root }, opts);
    } catch { /* still fail closed in memory below */ }
    L().warn('brain.yaml changed outside Paradigm — agent access paused', { rootHash });
  }
}

interface RawLoad { text: string; cfg: BrainConfig }

function readConfigOnce(rootHash: string, opts?: BrainOptions): RawLoad {
  const file = brainFile(rootHash, 'config', opts);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new BrainConfigError('brain not initialised');
  }
  let raw: unknown;
  try {
    raw = yaml.load(text);
  } catch {
    throw new BrainConfigError('brain.yaml is malformed');
  }
  return { text, cfg: normalizeConfig(raw) };
}

/**
 * Load + validate brain.yaml. Throws BrainConfigError (fail-closed) on any problem.
 * A brain.yaml edited outside Paradigm loads with `tampered: true` and
 * agent_access forced to 'off' (in memory).
 */
export function loadBrainConfig(rootHash: string, opts?: BrainOptions): BrainConfig {
  let { text, cfg } = readConfigOnce(rootHash, opts);
  const sticky = () => fs.existsSync(brainFile(rootHash, 'configTampered', opts));
  let tampered = sticky() || !hashMatches(rootHash, text, opts);
  if (tampered && !sticky()) {
    // Possibly a concurrent saveBrainConfig mid-write: re-check once after ~50ms.
    brainConfigTestHooks.beforeTamperRecheck?.();
    sleepSync(50);
    ({ text, cfg } = readConfigOnce(rootHash, opts));
    tampered = !hashMatches(rootHash, text, opts);
  }
  // A tampered brain.yaml pointing at a different root is refused (the id is
  // the hash of the allow-listed root). A vanished root stays loadable so
  // status/purge still work.
  if (fs.existsSync(cfg.root)) {
    let h: string | null = null;
    try { h = rootHashOf(cfg.root); } catch { h = null; }
    if (h !== rootHash) throw new BrainConfigError('brain.yaml root does not match brain id');
  }
  if (tampered) {
    recordTamper(rootHash, cfg, opts);
    cfg.agent_access = 'off';
    cfg.tampered = true;
  }
  return cfg;
}

/** The config exactly as written on disk (no tamper forcing) — for owner review only. */
function readRawConfig(rootHash: string, opts?: BrainOptions): BrainConfig | null {
  try { return readConfigOnce(rootHash, opts).cfg; } catch { return null; }
}

export interface ConfigReview {
  tampered: boolean;
  /** Last brain.yaml Paradigm wrote while trusted; null when none is on record. */
  lastGood: BrainConfig | null;
  current: BrainConfig | null;
  /** Plain-language lines: what differs in share / zones / workspace / agent_access. */
  changes: string[];
}

/** Owner review of an out-of-band brain.yaml change (last-good vs current). */
export function reviewBrainConfig(rootHash: string, opts?: BrainOptions): ConfigReview {
  const tampered = loadBrainConfig(rootHash, opts).tampered === true;
  const current = readRawConfig(rootHash, opts);
  let lastGood: BrainConfig | null = null;
  try { lastGood = normalizeConfig(yaml.load(fs.readFileSync(brainFile(rootHash, 'configLastGood', opts), 'utf8'))); } catch { lastGood = null; }
  const changes: string[] = [];
  if (!current) return { tampered, lastGood, current, changes: ['brain.yaml could not be read'] };
  if (!lastGood) changes.push('No earlier Paradigm-written settings are on record — review everything below.');
  const base: BrainConfig = lastGood ?? { ...current, share: [], zones: [], agent_access: 'off', workspace: undefined };
  const zoneKey = (z: BrainZone) => `${z.glob} → ${z.gate} (${z.source})`;
  for (const g of current.share) if (!base.share.includes(g)) changes.push(`+ shared: ${g}`);
  for (const g of base.share) if (!current.share.includes(g)) changes.push(`- shared: ${g}`);
  const cz = current.zones.map(zoneKey);
  const bz = base.zones.map(zoneKey);
  for (const z of cz) if (!bz.includes(z)) changes.push(`+ zone: ${z}`);
  for (const z of bz) if (!cz.includes(z)) changes.push(`- zone: ${z}`);
  if ((base.workspace ?? '') !== (current.workspace ?? '')) changes.push(`~ workspace: ${base.workspace ?? '(none)'} → ${current.workspace ?? '(none)'}`);
  if (base.agent_access !== current.agent_access) changes.push(`~ agent access: ${base.agent_access} → ${current.agent_access}`);
  return { tampered, lastGood, current, changes };
}

/**
 * The ONLY brain.yaml writer. Records sha256(bytes) in `.config-hash` so an
 * out-of-band edit is detectable. Does NOT clear a sticky tamper marker.
 */
export function saveBrainConfig(rootHash: string, config: BrainConfig, opts?: BrainOptions): void {
  const file = brainFile(rootHash, 'config', opts);
  const hashFile = brainFile(rootHash, 'configHash', opts);
  const pending = brainFile(rootHash, 'configHashPending', opts);
  const lastGood = brainFile(rootHash, 'configLastGood', opts);
  for (const f of [file, hashFile, pending, lastGood]) assertBrainWritePath(f, config.root, opts);
  const doc = normalizeConfig(config);
  const text = yaml.dump(doc, { lineWidth: 120, noRefs: true });
  // Race-free ordering: a concurrent loader always sees brain.yaml matching
  // either .config-hash (old or new) or the pending hash.
  atomicWriteFileSync(pending, `${sha256(text)}\n`);
  atomicWriteFileSync(file, text);
  fs.renameSync(pending, hashFile);
  // Snapshot the review baseline — only while the brain is trusted.
  if (!fs.existsSync(brainFile(rootHash, 'configTampered', opts)) && config.tampered !== true) atomicWriteFileSync(lastGood, text);
  listCache = null;
}

/** Human acknowledgement (CLI `access`, TTY-confirmed): clears the sticky tamper marker. */
export function acknowledgeBrainConfig(rootHash: string, opts?: BrainOptions): void {
  try { fs.unlinkSync(brainFile(rootHash, 'configTampered', opts)); } catch { /* none */ }
  listCache = null;
}

export interface InitResult {
  rootHash: string;
  config: BrainConfig;
  created: boolean;
}

/**
 * Allow-list a root and write brain.yaml (idempotent). Does NOT scan.
 * Refuses: missing/non-dir, filesystem root, the home directory itself,
 * hard-blocked paths, roots that contain the brain storage, roots inside it.
 */
export function initBrain(folder: string, opts?: BrainOptions): InitResult {
  let real: string;
  try {
    real = realpathNative(path.resolve(folder));
  } catch {
    throw new BrainConfigError('folder does not exist');
  }
  if (!fs.statSync(real).isDirectory()) throw new BrainConfigError('not a folder');
  if (path.parse(real).root === real) throw new BrainConfigError('refusing the filesystem root');
  const homes = homeVariants(resolveHomedir(opts));
  if (homes.some((h) => foldPath(h) === foldPath(real))) throw new BrainConfigError('refusing the whole home folder — pick a subfolder');
  const blocked = hardBlockReason(real, opts);
  if (blocked) throw new BrainConfigError('this folder is protected and cannot be indexed');
  const store = brainsHome(opts);
  if (isInside(store, real) || isInside(real, store)) throw new BrainConfigError('folder overlaps Paradigm storage');
  for (const h of homes) {
    if (isInside(real, path.join(h, '.paradigm'))) throw new BrainConfigError('folder overlaps Paradigm storage');
  }

  const rootHash = crypto.createHash('sha256').update(real).digest('hex').slice(0, 16);
  const file = brainFile(rootHash, 'config', opts);
  if (fs.existsSync(file)) {
    return { rootHash, config: loadBrainConfig(rootHash, opts), created: false };
  }
  const config: BrainConfig = {
    version: 1,
    root: real,
    default_gate: 'private',
    share: [],
    zones: [],
    agent_access: 'off',
    limits: { ...DEFAULT_LIMITS },
  };
  saveBrainConfig(rootHash, config, opts);
  L().info('Brain initialised', { rootHash });
  return { rootHash, config, created: true };
}

/**
 * Code path for adding zones — only sensitive gates may be appended (tighten-only).
 * Returns the zones actually added.
 */
export function appendZones(rootHash: string, zones: BrainZone[], opts?: BrainOptions): BrainZone[] {
  if (zones.length === 0) return [];
  const cfg = loadBrainConfig(rootHash, opts);
  const added: BrainZone[] = [];
  for (const z of zones) {
    if (GATE_RANK[z.gate] <= GATE_RANK.private) continue;
    if (!isSafeGlob(z.glob)) continue;
    if (cfg.zones.some((e) => e.glob.toLowerCase() === z.glob.toLowerCase() && GATE_RANK[e.gate] >= GATE_RANK[z.gate])) continue;
    cfg.zones.push(z);
    added.push(z);
  }
  if (added.length) saveBrainConfig(rootHash, cfg, opts);
  return added;
}

/** Human-only (CLI must confirm on TTY). Hard-blocked and sensitive zones still win. */
export function addShare(rootHash: string, glob: string, opts?: BrainOptions): BrainConfig {
  if (!isSafeGlob(glob)) throw new BrainConfigError('invalid share pattern');
  const cfg = loadBrainConfig(rootHash, opts);
  if (!cfg.share.includes(glob)) cfg.share.push(glob);
  saveBrainConfig(rootHash, cfg, opts);
  return cfg;
}

export function removeShare(rootHash: string, glob: string, opts?: BrainOptions): BrainConfig {
  const cfg = loadBrainConfig(rootHash, opts);
  cfg.share = cfg.share.filter((g) => g !== glob);
  saveBrainConfig(rootHash, cfg, opts);
  return cfg;
}

/**
 * Human-only (CLI confirms metadata on a TTY). Setting access is also the
 * owner's acknowledgement of the current brain.yaml: it re-records the hash
 * and clears a tamper pause.
 */
export function setAgentAccess(
  rootHash: string,
  access: 'off' | 'metadata',
  opts?: BrainOptions & { acknowledgeTamper?: boolean },
): BrainConfig {
  const cfg = loadBrainConfig(rootHash, opts);
  if (cfg.tampered && opts?.acknowledgeTamper !== true) {
    // Never rubber-stamp an out-of-band edit: the owner must review the diff
    // (reviewBrainConfig) and confirm on a terminal first.
    throw new BrainConfigError('settings changed outside Paradigm — review them with `paradigm brain access` on a terminal');
  }
  cfg.agent_access = access;
  delete cfg.tampered;
  acknowledgeBrainConfig(rootHash, opts);
  saveBrainConfig(rootHash, cfg, opts);
  return cfg;
}

export interface BrainListEntry {
  rootHash: string;
  root: string;
  agentAccess: 'off' | 'metadata';
  tampered: boolean;
}

/**
 * listBrains cache — keyed by the brains directory (path + mtime) plus a stat
 * signature of every brain's brain.yaml / .config-hash / tamper marker, so an
 * in-place brain.yaml rewrite (which does not bump the parent dir mtime) still
 * invalidates. Writers also drop it explicitly.
 */
let listCache: { key: string; value: BrainListEntry[] } | null = null;

function statSig(file: string): string {
  try {
    const st = fs.statSync(file);
    return `${st.ino}:${st.size}:${st.mtimeMs}`;
  } catch {
    return '-';
  }
}

/** Brains with a readable brain.yaml. */
export function listBrains(opts?: BrainOptions): BrainListEntry[] {
  const home = brainsHome(opts);
  let names: string[] = [];
  let dirSig: string;
  try {
    dirSig = statSig(home);
    names = fs.readdirSync(home).filter(isRootHash).sort();
  } catch { return []; }
  const parts = [home, dirSig];
  for (const n of names) {
    const d = path.join(home, n);
    parts.push(n, statSig(path.join(d, BRAIN_FILES.config)), statSig(path.join(d, BRAIN_FILES.configHash)), statSig(path.join(d, BRAIN_FILES.configTampered)));
  }
  const key = parts.join('|');
  if (listCache && listCache.key === key) return listCache.value.map((b) => ({ ...b }));
  const out: BrainListEntry[] = [];
  for (const n of names) {
    try {
      const c = loadBrainConfig(n, opts);
      out.push({ rootHash: n, root: c.root, agentAccess: c.agent_access, tampered: c.tampered === true });
    } catch { /* unreadable brain → skip (fail closed) */ }
  }
  // Loading may have written a tamper marker; key on the post-load state.
  const after = [home, statSig(home)];
  for (const n of names) {
    const d = path.join(home, n);
    after.push(n, statSig(path.join(d, BRAIN_FILES.config)), statSig(path.join(d, BRAIN_FILES.configHash)), statSig(path.join(d, BRAIN_FILES.configTampered)));
  }
  listCache = { key: after.join('|'), value: out };
  return out.map((b) => ({ ...b }));
}

/** True when any brain opted into agent metadata access (gates MCP tool listing). */
export function anyBrainAgentEnabled(opts?: BrainOptions): boolean {
  return listBrains(opts).some((b) => b.agentAccess === 'metadata');
}
