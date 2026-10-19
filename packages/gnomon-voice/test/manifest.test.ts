import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchModel, loadManifest, ModelVerifyError, modelsDir, validateManifest, verifiedModelPaths, type FetchLike, type ModelEntry } from '../src/manifest.js';

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
