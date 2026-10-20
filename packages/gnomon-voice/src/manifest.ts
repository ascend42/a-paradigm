/**
 * @symbol #gnomon-voice
 *
 * The voice model manifest and its fetch/verify (V2c; hardened V2e item 6). `voice-models.manifest.json` pins
 * each model's URL, sha256 and size, and for an archive the sha256 + size of EVERY member (`members`, relative to
 * `root`). `gnomon-voice models fetch` downloads into `<home>/voice/models/` (0700; home defaults to ~/.gnomon),
 * hashing while streaming, and REFUSES (deletes the partial, throws) on a size or sha256 mismatch. `--from <dir>`
 * installs from local files (same verification). Archives (tar.bz2):
 *   1. the archive is verified against the manifest BEFORE it is opened;
 *   2. its listing is checked: every entry is a directory or a regular file (symlinks, hard links, devices and
 *      fifos are refused) inside `root`, and every regular file is a pinned member;
 *   3. it is extracted with `tar --no-same-owner` into a 0700 staging dir; the tree is walked with lstat and any
 *      non-regular entry is refused; the member set must EQUAL the manifest's and each member must hash to its
 *      pin; only then is it renamed into place. verified.json is a record of the install, never the authority.
 *
 * Loading (verifiedModelPaths): every file an engine will open is RE-HASHED immediately before load, against the
 * MANIFEST (single files: sha256 + size; archives: every member's pin). sherpa-onnx-node loads models by path only,
 * so "load from verified bytes" is not possible; the residual window is a same-user swap between the hash and the
 * native open (documented, unverified risk).
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ModelRole = 'vad' | 'stt' | 'tts' | 'speaker';
export interface MemberPin {
  sha256: string;
  size: number;
}
export interface ModelEntry {
  id: string;
  role: ModelRole;
  kind: 'file' | 'tar.bz2';
  url: string;
  sha256: string;
  size: number;
  root?: string;
  files: Record<string, string>;
  /** tar.bz2 only: every regular file of the archive (relative to root) → its pin */
  members?: Record<string, MemberPin>;
}
export interface ModelManifest {
  schemaVersion: 'voiceModels:v1';
  models: ModelEntry[];
}

export class ModelVerifyError extends Error {
  constructor(readonly modelId: string, readonly reason: 'size' | 'sha256' | 'missing' | 'manifest' | 'extract' | 'http' | 'member', message: string) {
    super(message);
    this.name = 'ModelVerifyError';
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const VERIFIED_RECORD = 'verified.json';

function safeRel(f: string): boolean {
  return f.length > 0 && !path.isAbsolute(f) && !f.split('/').some((seg) => seg === '..' || seg === '.' || seg === '') && !f.includes('\\');
}

export function validateManifest(m: unknown): ModelManifest {
  const mm = m as ModelManifest;
  if (!mm || mm.schemaVersion !== 'voiceModels:v1' || !Array.isArray(mm.models)) throw new ModelVerifyError('*', 'manifest', 'not a voiceModels:v1 manifest');
  for (const e of mm.models) {
    if (typeof e.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(e.id)) throw new ModelVerifyError(String(e.id), 'manifest', 'bad model id');
    if (!HEX64.test(e.sha256) || !Number.isSafeInteger(e.size) || e.size <= 0) throw new ModelVerifyError(e.id, 'manifest', 'sha256/size missing or malformed');
    if (!/^https:\/\//.test(e.url)) throw new ModelVerifyError(e.id, 'manifest', 'model URLs are https only');
    if (e.kind !== 'file' && e.kind !== 'tar.bz2') throw new ModelVerifyError(e.id, 'manifest', 'kind is file | tar.bz2');
    for (const f of Object.values(e.files)) if (!safeRel(f)) throw new ModelVerifyError(e.id, 'manifest', 'member paths are relative');
    if (e.kind === 'tar.bz2') {
      if (typeof e.root !== 'string' || !safeRel(e.root) || e.root.includes('/')) throw new ModelVerifyError(e.id, 'manifest', 'an archive needs a single-segment root');
      if (!e.members || typeof e.members !== 'object' || Object.keys(e.members).length === 0) throw new ModelVerifyError(e.id, 'manifest', 'an archive must pin every member (members)');
      for (const [rel, pin] of Object.entries(e.members)) {
        if (!safeRel(rel) || rel === VERIFIED_RECORD) throw new ModelVerifyError(e.id, 'manifest', `bad member path ${rel}`);
        if (!pin || !HEX64.test(pin.sha256) || !Number.isSafeInteger(pin.size) || pin.size < 0) throw new ModelVerifyError(e.id, 'manifest', `member ${rel} has no sha256/size pin`);
      }
      for (const f of Object.values(e.files)) {
        if (!Object.keys(e.members).some((k) => k === f || k.startsWith(`${f}/`))) throw new ModelVerifyError(e.id, 'manifest', `file ${f} is not a pinned member`);
      }
    }
  }
  return mm;
}

export function loadManifest(file?: string): ModelManifest {
  const p = file ?? fileURLToPath(new URL('../voice-models.manifest.json', import.meta.url));
  return validateManifest(JSON.parse(fs.readFileSync(p, 'utf8')));
}

export function modelsDir(home: string): string {
  return path.join(home, 'voice', 'models');
}

function ensureDir0700(d: string): void {
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.chmodSync(d, 0o700);
}

export function sha256File(file: string): string {
  const h = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    let n: number;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; body: AsyncIterable<Uint8Array> | null }>;

const defaultFetch: FetchLike = async (url) => {
  const r = await fetch(url, { redirect: 'follow' });
  return { ok: r.ok, status: r.status, body: r.body as unknown as AsyncIterable<Uint8Array> | null };
};

/** `models fetch --from <dir>`: read each model's asset (the URL's basename) from a local directory. */
export function localFetch(dir: string): FetchLike {
  return async (url) => {
    const name = path.basename(new URL(url).pathname);
    const p = path.join(dir, name);
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return { ok: false, status: 404, body: null };
    return { ok: true, status: 200, body: fs.createReadStream(p, { highWaterMark: 1 << 20 }) as AsyncIterable<Uint8Array> };
  };
}

export interface FetchOptions {
  fetch?: FetchLike;
  progress?: (id: string, bytes: number, total: number) => void;
  /** re-download even when present and verified */
  force?: boolean;
}

/** Download, verify and (for archives) extract one model. Throws ModelVerifyError on any mismatch. */
export async function fetchModel(home: string, e: ModelEntry, o: FetchOptions = {}): Promise<'present' | 'fetched'> {
  ensureDir0700(path.join(home, 'voice'));
  const dir = modelsDir(home);
  ensureDir0700(dir);
  if (!o.force) {
    try {
      verifiedModelPaths(home, e);
      return 'present';
    } catch {
      // fetch below
    }
  }
  const partial = path.join(dir, `.${e.id}.partial`);
  fs.rmSync(partial, { force: true });
  const r = await (o.fetch ?? defaultFetch)(e.url);
  if (!r.ok || !r.body) throw new ModelVerifyError(e.id, 'http', `download failed (HTTP ${r.status})`);
  const h = createHash('sha256');
  const fd = fs.openSync(partial, 'wx', 0o600);
  let bytes = 0;
  try {
    for await (const chunk of r.body) {
      bytes += chunk.length;
      if (bytes > e.size) throw new ModelVerifyError(e.id, 'size', `larger than the manifest's ${e.size} bytes`);
      h.update(chunk);
      fs.writeSync(fd, chunk);
      o.progress?.(e.id, bytes, e.size);
    }
  } catch (err) {
    fs.closeSync(fd);
    fs.rmSync(partial, { force: true });
    throw err;
  }
  fs.closeSync(fd);
  const digest = h.digest('hex');
  if (bytes !== e.size) {
    fs.rmSync(partial, { force: true });
    throw new ModelVerifyError(e.id, 'size', `got ${bytes} bytes, the manifest pins ${e.size}`);
  }
  if (digest !== e.sha256) {
    fs.rmSync(partial, { force: true });
    throw new ModelVerifyError(e.id, 'sha256', `sha256 ${digest} does not match the manifest's ${e.sha256}; refusing it`);
  }
  if (e.kind === 'file') {
    const target = path.join(dir, e.id);
    ensureDir0700(target);
    fs.renameSync(partial, path.join(target, Object.values(e.files)[0]!));
    return 'fetched';
  }
  const staging = path.join(dir, `.${e.id}.staging`);
  fs.rmSync(staging, { recursive: true, force: true });
  ensureDir0700(staging);
  const fail = (reason: ModelVerifyError['reason'], msg: string): never => {
    fs.rmSync(partial, { force: true });
    fs.rmSync(staging, { recursive: true, force: true });
    throw new ModelVerifyError(e.id, reason, msg);
  };
  // 2. the listing, before anything is written: directories and regular files inside root, every file pinned
  const list = spawnSync('tar', ['-tvjf', partial], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  if (list.status !== 0) fail('extract', `tar could not list the archive: ${String(list.stderr).slice(0, 200)}`);
  for (const line of String(list.stdout).split('\n')) {
    if (!line.trim()) continue;
    const t = line[0];
    if (t !== '-' && t !== 'd') fail('member', `the archive has a non-regular member (${t === 'l' ? 'symlink' : t === 'h' ? 'hard link' : `type ${t}`}): ${line.slice(0, 160)}`);
  }
  const names = spawnSync('tar', ['-tjf', partial], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  for (const raw of String(names.stdout).split('\n')) {
    const n = raw.replace(/\/$/, '');
    if (!n) continue;
    if (n !== e.root && !n.startsWith(`${e.root}/`)) fail('member', `the archive has an entry outside ${e.root}: ${n}`);
    if (raw.endsWith('/')) continue;
    const rel = n.slice(e.root!.length + 1);
    if (!e.members![rel]) fail('member', `the archive has an unpinned member: ${rel}`);
  }
  // 3. extract (never as the archive's owner), then walk with lstat and check the set and every pin
  const x = spawnSync('tar', ['--no-same-owner', '-xjf', partial, '-C', staging], { stdio: ['ignore', 'ignore', 'pipe'] });
  fs.rmSync(partial, { force: true });
  if (x.status !== 0) fail('extract', `tar failed: ${String(x.stderr).slice(0, 200)}`);
  const root = path.join(staging, e.root!);
  let got: string[];
  try {
    got = regularFiles(root);
  } catch (err) {
    return fail('member', err instanceof Error ? err.message : String(err));
  }
  checkMembers(e, root, got, fail);
  fs.writeFileSync(path.join(root, VERIFIED_RECORD), `${JSON.stringify({ archiveSha256: e.sha256, members: Object.keys(e.members!).length, verifiedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  const target = path.join(dir, e.id);
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(root, target);
  fs.rmSync(staging, { recursive: true, force: true });
  return 'fetched';
}

/** Every regular file under root (relative); throws on a symlink or any other non-regular entry. */
export function regularFiles(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(path.join(root, rel))) {
    const r = rel ? `${rel}/${name}` : name;
    const st = fs.lstatSync(path.join(root, r));
    if (st.isSymbolicLink()) throw new Error(`${r} is a symlink; refusing it`);
    if (st.isDirectory()) out.push(...regularFiles(root, r));
    else if (st.isFile()) out.push(r);
    else throw new Error(`${r} is not a regular file; refusing it`);
  }
  return out;
}

function checkMembers(e: ModelEntry, root: string, got: string[], fail: (r: ModelVerifyError['reason'], m: string) => never): void {
  const pins = e.members!;
  const have = new Set(got.filter((g) => g !== VERIFIED_RECORD));
  for (const rel of have) if (!pins[rel]) fail('member', `${rel} is not a pinned member of ${e.id}`);
  for (const [rel, pin] of Object.entries(pins)) {
    if (!have.has(rel)) fail('missing', `${e.id} has no ${rel}`);
    const p = path.join(root, rel);
    if (fs.statSync(p).size !== pin.size || sha256File(p) !== pin.sha256) fail('sha256', `${p} does not match its manifest pin; refusing it`);
  }
}

/**
 * Absolute paths of a model's files (role keys → path), each re-hashed now against the MANIFEST. Throws
 * ModelVerifyError if anything is missing, extra, a symlink, or does not verify. The ONLY way an engine gets a
 * model path.
 */
export function verifiedModelPaths(home: string, e: ModelEntry): Record<string, string> {
  const target = path.join(modelsDir(home), e.id);
  const out: Record<string, string> = {};
  if (e.kind === 'file') {
    const [key, name] = Object.entries(e.files)[0]!;
    const p = path.join(target, name);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch {
      throw new ModelVerifyError(e.id, 'missing', `${e.id} is not downloaded (gnomon-voice models fetch)`);
    }
    if (!st.isFile()) throw new ModelVerifyError(e.id, 'member', `${p} is not a regular file; refusing to load it`);
    if (st.size !== e.size || sha256File(p) !== e.sha256) throw new ModelVerifyError(e.id, 'sha256', `${p} does not verify against the manifest; refusing to load it`);
    out[key] = p;
    return out;
  }
  if (!fs.existsSync(target)) throw new ModelVerifyError(e.id, 'missing', `${e.id} is not downloaded (gnomon-voice models fetch)`);
  let got: string[];
  try {
    got = regularFiles(target);
  } catch (err) {
    throw new ModelVerifyError(e.id, 'member', err instanceof Error ? err.message : String(err));
  }
  checkMembers(e, target, got, (reason, m) => {
    throw new ModelVerifyError(e.id, reason, m.replace('refusing it', 'refusing to load it'));
  });
  for (const [key, name] of Object.entries(e.files)) out[key] = path.join(target, name);
  return out;
}

export function modelFor(m: ModelManifest, role: ModelRole): ModelEntry {
  const e = m.models.find((x) => x.role === role);
  if (!e) throw new ModelVerifyError(role, 'manifest', `the manifest has no ${role} model`);
  return e;
}
