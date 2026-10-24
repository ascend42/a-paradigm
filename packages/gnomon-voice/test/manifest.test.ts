import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchModel, loadManifest, mirrorUrlFor, ModelVerifyError, modelsDir, validateManifest, verifiedModelPaths, type FetchLike, type ModelEntry } from '../src/manifest.js';

const GOOD = Buffer.from('a pretend onnx model');
const entry = (over: Partial<ModelEntry> = {}): ModelEntry => ({ id: 'tiny', role: 'vad', kind: 'file', url: 'https://example.invalid/tiny.onnx', sha256: createHash('sha256').update(GOOD).digest('hex'), size: GOOD.length, files: { model: 'tiny.onnx' }, ...over });
const serve = (bytes: Buffer): FetchLike => async () => ({
  ok: true,
  status: 200,
  body: (async function* () {
    yield bytes;
  })(),
});

let homes: string[] = [];
const home = (): string => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-models-'));
  homes.push(h);
  return h;
};
afterEach(() => {
  for (const h of homes) fs.rmSync(h, { recursive: true, force: true });
  homes = [];
});

describe('voice model manifest', () => {
  it('the shipped manifest validates and pins all four roles', () => {
    const m = loadManifest();
    expect(m.models.map((x) => x.role).sort()).toEqual(['speaker', 'stt', 'tts', 'vad']);
    for (const e of m.models) expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a model whose sha256 does not match, leaving nothing behind', async () => {
    const h = home();
    await expect(fetchModel(h, entry(), { fetch: serve(Buffer.from('a pretend onnx modeX')) })).rejects.toMatchObject({ name: 'ModelVerifyError', reason: 'sha256' });
    expect(fs.readdirSync(modelsDir(h))).toEqual([]);
    expect(() => verifiedModelPaths(h, entry())).toThrow(ModelVerifyError);
  });

  it('refuses a size mismatch', async () => {
    const h = home();
    await expect(fetchModel(h, entry(), { fetch: serve(Buffer.concat([GOOD, GOOD])) })).rejects.toMatchObject({ reason: 'size' });
  });

  it('a verified model loads; a tampered one is refused at load', async () => {
    const h = home();
    expect(await fetchModel(h, entry(), { fetch: serve(GOOD) })).toBe('fetched');
    expect(await fetchModel(h, entry(), { fetch: serve(Buffer.from('never fetched')) })).toBe('present');
    const p = verifiedModelPaths(h, entry()).model!;
    if (typeof process.getuid === 'function') expect(fs.statSync(modelsDir(h)).mode & 0o777).toBe(0o700);
    fs.writeFileSync(p, 'a pretend onnx modeZ');
    expect(() => verifiedModelPaths(h, entry())).toThrow(/does not verify/);
  });

  it('rejects malformed manifests (http URLs, bad hashes, escaping paths)', () => {
    expect(() => validateManifest({ schemaVersion: 'voiceModels:v1', models: [entry({ url: 'http://x/y' })] })).toThrow(/https/);
    expect(() => validateManifest({ schemaVersion: 'voiceModels:v1', models: [entry({ sha256: 'abc' })] })).toThrow(/sha256/);
    expect(() => validateManifest({ schemaVersion: 'voiceModels:v1', models: [entry({ files: { model: '../x' } })] })).toThrow(/relative/);
  });
});

describe('voice model mirror fallback (TD-2026-10-21-758, 8.0 M4)', () => {
  const MIRROR = 'https://github.com/ascend42/a-paradigm/releases/download/gnomon-voice-models-v1';
  /** upstream and mirror answer from a table; every URL asked is recorded */
  const routes = (table: Record<string, Buffer | number | 'throw'>, asked: string[]): FetchLike => async (url) => {
    asked.push(url);
    const v = table[url];
    if (v === 'throw') throw new TypeError('fetch failed');
    if (v === undefined || typeof v === 'number') return { ok: false, status: typeof v === 'number' ? v : 404, body: null };
    return { ok: true, status: 200, body: (async function* () { yield v; })() };
  };

  it('the shipped manifest names our Release mirror, and the mirror URL is <mirror>/<asset name>', () => {
    const m = loadManifest();
    expect(m.mirror).toBe(MIRROR);
    expect(mirrorUrlFor(MIRROR, entry())).toBe(`${MIRROR}/tiny.onnx`);
  });

  it('upstream down (HTTP or network): the mirror serves the pinned bytes', async () => {
    for (const fail of [503, 'throw'] as const) {
      const h = home();
      const asked: string[] = [];
      expect(await fetchModel(h, entry(), { mirror: MIRROR, fetch: routes({ [entry().url]: fail, [`${MIRROR}/tiny.onnx`]: GOOD }, asked) })).toBe('fetched');
      expect(asked).toEqual([entry().url, `${MIRROR}/tiny.onnx`]);
      expect(verifiedModelPaths(h, entry()).model).toBeTruthy();
    }
  });

  it('upstream bytes that miss the pin fall back to the mirror', async () => {
    const h = home();
    const asked: string[] = [];
    expect(await fetchModel(h, entry(), { mirror: MIRROR, fetch: routes({ [entry().url]: Buffer.from('a pretend onnx modeX'), [`${MIRROR}/tiny.onnx`]: GOOD }, asked) })).toBe('fetched');
    expect(asked).toHaveLength(2);
  });

  it('falsifier: a mirror serving bytes whose sha256 does not match the pin is refused, leaving nothing behind', async () => {
    const h = home();
    const p = fetchModel(h, entry(), { mirror: MIRROR, fetch: routes({ [entry().url]: 503, [`${MIRROR}/tiny.onnx`]: Buffer.from('a pretend onnx modeX') }, []) });
    await expect(p).rejects.toMatchObject({ name: 'ModelVerifyError', reason: 'sha256' });
    await expect(p).rejects.toThrow(/upstream: download failed \(HTTP 503\); mirror: sha256/);
    expect(fs.readdirSync(modelsDir(h))).toEqual([]);
    expect(() => verifiedModelPaths(h, entry())).toThrow(ModelVerifyError);
  });

  it('no mirror configured: upstream failure is final (no second request)', async () => {
    const asked: string[] = [];
    await expect(fetchModel(home(), entry(), { fetch: routes({ [entry().url]: 503 }, asked) })).rejects.toMatchObject({ reason: 'http' });
    expect(asked).toEqual([entry().url]);
  });

  it('rejects a malformed mirror (http, query, trailing slash) and clashing asset names', () => {
    const base = { schemaVersion: 'voiceModels:v1', models: [entry()] };
    for (const mirror of ['http://x.example/m', 'https://x.example/m/', 'https://x.example/m?a=1', 'https://x.example/m#f']) expect(() => validateManifest({ ...base, mirror })).toThrow(/mirror/);
    expect(() => validateManifest({ ...base, mirror: MIRROR, models: [entry(), entry({ id: 'tiny2', url: 'https://other.example/x/tiny.onnx' })] })).toThrow(/distinct file name/);
    expect(validateManifest({ ...base, mirror: MIRROR }).mirror).toBe(MIRROR);
  });
});
