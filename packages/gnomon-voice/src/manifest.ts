/**
 * @symbol #gnomon-voice
 *
 * The voice model manifest and its fetch/verify (V2c). `voice-models.manifest.json` pins each model's URL, sha256
 * and size. `gnomon-voice models fetch` downloads into `<home>/voice/models/` (0700), hashing while streaming, and
 * REFUSES (deletes the partial, throws) on a size or sha256 mismatch. Archives (tar.bz2) are verified BEFORE they are
 * extracted (system `tar`), into a staging dir that is renamed into place; a `verified.json` then records the sha256
 * of every extracted file (derived from the verified archive).
 *
 * Loading (verifiedModelPaths): every file an engine will open is RE-HASHED immediately before load — single files
 * against the manifest sha256, archive members against verified.json (whose own archive hash is checked against
 * the manifest). sherpa-onnx-node loads models by path only, so "load from verified bytes" is not possible; the
 * residual window is a same-user swap between the hash and the native open (documented, unverified risk).
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ModelRole = 'vad' | 'stt' | 'tts' | 'speaker';
export interface ModelEntry {
  id: string;
  role: ModelRole;
  kind: 'file' | 'tar.bz2';
  url: string;
  sha256: string;
  size: number;
  root?: string;
  files: Record<string, string>;
}
export interface ModelManifest {
  schemaVersion: 'voiceModels:v1';
  models: ModelEntry[];
}

export class ModelVerifyError extends Error {
  constructor(readonly modelId: string, readonly reason: 'size' | 'sha256' | 'missing' | 'manifest' | 'extract' | 'http', message: string) {
    super(message);
    this.name = 'ModelVerifyError';
  }
}

const HEX64 = /^[0-9a-f]{64}$/;

export function validateManifest(m: unknown): ModelManifest {
  const mm = m as ModelManifest;
  if (!mm || mm.schemaVersion !== 'voiceModels:v1' || !Array.isArray(mm.models)) throw new ModelVerifyError('*', 'manifest', 'not a voiceModels:v1 manifest');
  for (const e of mm.models) {
    if (typeof e.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(e.id)) throw new ModelVerifyError(String(e.id), 'manifest', 'bad model id');
    if (!HEX64.test(e.sha256) || !Number.isSafeInteger(e.size) || e.size <= 0) throw new ModelVerifyError(e.id, 'manifest', 'sha256/size missing or malformed');
    if (!/^https:\/\//.test(e.url)) throw new ModelVerifyError(e.id, 'manifest', 'model URLs are https only');
    if (e.kind !== 'file' && e.kind !== 'tar.bz2') throw new ModelVerifyError(e.id, 'manifest', 'kind is file | tar.bz2');
    for (const f of Object.values(e.files)) if (f.includes('..') || path.isAbsolute(f)) throw new ModelVerifyError(e.id, 'manifest', 'member paths are relative');
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

export interface FetchOptions {
  fetch?: FetchLike;
  progress?: (id: string, bytes: number, total: number) => void;
  /** re-download even when present and verified */
  force?: boolean;
}

/** Download, verify and (for archives) extract one model. Throws ModelVerifyError on any mismatch. */
export async function fetchModel(home: string, e: ModelEntry, o: FetchOptions = {}): Promise<'present' | 'fetched'> {
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
  const x = spawnSync('tar', ['-xjf', partial, '-C', staging], { stdio: ['ignore', 'ignore', 'pipe'] });
  fs.rmSync(partial, { force: true });
  if (x.status !== 0) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new ModelVerifyError(e.id, 'extract', `tar failed: ${String(x.stderr).slice(0, 200)}`);
  }
  const root = path.join(staging, e.root ?? '');
  const hashes: Record<string, string> = {};
  for (const rel of listFiles(root)) hashes[rel] = sha256File(path.join(root, rel));
  for (const f of Object.values(e.files)) {
    if (!Object.keys(hashes).some((k) => k === f || k.startsWith(`${f}/`))) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw new ModelVerifyError(e.id, 'missing', `the archive has no ${f}`);
    }
  }
  fs.writeFileSync(path.join(root, 'verified.json'), `${JSON.stringify({ archiveSha256: e.sha256, files: hashes })}\n`, { mode: 0o600 });
  const target = path.join(dir, e.id);
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(root, target);
  fs.rmSync(staging, { recursive: true, force: true });
  return 'fetched';
}

function listFiles(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...listFiles(root, r));
    else if (d.isFile()) out.push(r);
  }
  return out;
}

/**
 * Absolute paths of a model's files (role keys → path), each re-hashed now. Throws ModelVerifyError if anything is
 * missing or does not verify. The ONLY way an engine gets a model path.
 */
export function verifiedModelPaths(home: string, e: ModelEntry): Record<string, string> {
  const target = path.join(modelsDir(home), e.id);
  const out: Record<string, string> = {};
  if (e.kind === 'file') {
    const [key, name] = Object.entries(e.files)[0]!;
    const p = path.join(target, name);
    if (!fs.existsSync(p)) throw new ModelVerifyError(e.id, 'missing', `${e.id} is not downloaded (gnomon-voice models fetch)`);
    if (fs.statSync(p).size !== e.size || sha256File(p) !== e.sha256) throw new ModelVerifyError(e.id, 'sha256', `${p} does not verify against the manifest; refusing to load it`);
    out[key] = p;
    return out;
  }
  let v: { archiveSha256?: string; files?: Record<string, string> };
  try {
    v = JSON.parse(fs.readFileSync(path.join(target, 'verified.json'), 'utf8')) as typeof v;
  } catch {
    throw new ModelVerifyError(e.id, 'missing', `${e.id} is not downloaded (gnomon-voice models fetch)`);
  }
  if (v.archiveSha256 !== e.sha256 || !v.files) throw new ModelVerifyError(e.id, 'sha256', `${e.id} was extracted from a different archive than the manifest pins`);
  for (const [rel, sha] of Object.entries(v.files)) {
    const p = path.join(target, rel);
    if (!fs.existsSync(p) || sha256File(p) !== sha) throw new ModelVerifyError(e.id, 'sha256', `${p} changed since it was verified; refusing to load it`);
  }
  for (const [key, name] of Object.entries(e.files)) {
    if (!Object.keys(v.files).some((k) => k === name || k.startsWith(`${name}/`))) throw new ModelVerifyError(e.id, 'missing', `${e.id} has no ${name}`);
    out[key] = path.join(target, name);
  }
  return out;
}

export function modelFor(m: ModelManifest, role: ModelRole): ModelEntry {
  const e = m.models.find((x) => x.role === role);
  if (!e) throw new ModelVerifyError(role, 'manifest', `the manifest has no ${role} model`);
  return e;
}
