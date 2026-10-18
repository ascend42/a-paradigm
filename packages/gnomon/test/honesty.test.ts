/**
 * Honesty CI (spec §9.7 law 2; §19.1 M1.12 G-HON-02..07; M1.12 slice 3): a real
 * gate over the Gnomon tree, plus falsifiers proving each rule can fail.
 * Platform-independent (reads files only; the live-status half of G-HON-03 /
 * G-HON-07 runs against a spawned kernel in test/m112-conformance.test.ts).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkStatusNumbers } from '../src/kernel/socket/status-numbers.js';
import { scanFabrication, scanGuardNames, scanLatencyDocs, scanSteering, type SourceText } from './honesty.js';
import { PKG_ROOT } from './helpers.js';

const REPO = path.resolve(PKG_ROOT, '..', '..');
const SKIP = new Set(['node_modules', 'dist', '.build', '.git', 'results', 'test', 'tests', 'fixtures', '__pycache__']);

function walk(dir: string, keep: (f: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out;
}
const read = (files: string[]): SourceText[] => files.map((f) => ({ file: path.relative(REPO, f).split(path.sep).join('/'), text: readFileSync(f, 'utf8') }));

const gnomonPackages = readdirSync(path.join(REPO, 'packages'))
  .filter((n) => n === 'gnomon' || n.startsWith('gnomon-'))
  .map((n) => path.join(REPO, 'packages', n));
const CODE = /\.(m|c)?[jt]sx?$|\.py$/;
const shipped = read(gnomonPackages.flatMap((p) => [...walk(path.join(p, 'src'), (f) => CODE.test(f) && !f.endsWith('.d.ts')), ...walk(path.join(p, 'example'), (f) => CODE.test(f))]));
const manifests = read(gnomonPackages.flatMap((p) => walk(p, (f) => path.basename(f) === 'gnomon-manifest.json')));
const docs = read([
  ...gnomonPackages.flatMap((p) => walk(p, (f) => path.basename(f) === '.purpose' || /README\.md$/.test(f))),
  path.join(REPO, 'docs', 'specs', 'gnomon-client-api.md'),
]);

describe('honesty CI: the Gnomon tree passes (the gate)', () => {
  it('scans a non-trivial tree (a gate that reads nothing proves nothing)', () => {
    expect(shipped.length).toBeGreaterThan(100);
    expect(manifests.length).toBeGreaterThan(0);
    expect(docs.some((d) => d.file === 'docs/specs/gnomon-client-api.md')).toBe(true);
  });
  it('G-HON-02: no fabricated mechanisms in shipped source', () => {
    expect(scanFabrication(shipped)).toEqual([]);
  });
  it('G-HON-05: no Task-steering descriptions in source or manifests', () => {
    expect(scanSteering([...shipped, ...manifests])).toEqual([]);
  });
  it('G-HON-06: every guard name states its scope', () => {
    expect(scanGuardNames(shipped)).toEqual([]);
  });
  it('G-HON-07 (docs): every measured latency names its method and machine', () => {
    expect(scanLatencyDocs(docs)).toEqual([]);
  });
});

describe('honesty CI falsifiers: every rule fails on a planted violation', () => {
  const f = (text: string, file = 'packages/gnomon/src/x.ts'): SourceText[] => [{ file, text }];
  it('G-HON-02', () => {
    expect(scanFabrication(f('const confidence = Math.random();')).map((x) => x.detail)).toEqual(['Math.random outside an ids module (use node:crypto): Math.random']);
    expect(scanFabrication(f('const id = Math.random();', 'packages/gnomon-contracts/src/ids.ts'))).toEqual([]);
    expect(scanFabrication(f("return { status: 'simulated' };"))).toHaveLength(1);
    expect(scanFabrication(f('await sleep(1500); // processing'))).toHaveLength(1);
    expect(scanFabrication(f('const speedup = 3.2;'))).toHaveLength(1);
    expect(scanFabrication(f('// a neural router'))).toHaveLength(1);
    expect(scanFabrication(f('await new Promise((r) => setTimeout(r, 20)); // polling'))).toEqual([]);
  });
  it('G-HON-05', () => {
    expect(scanSteering(f("{ name: 'x', description: 'Use this instead of the native Task tool.' }"))).toHaveLength(1);
    expect(scanSteering(f('{"title": "Always call this before editing"}', 'm/gnomon-manifest.json'))).toHaveLength(1);
    expect(scanSteering(f("{ description: 'Claude Code has no learning loop' }"))).toHaveLength(1);
    expect(scanSteering(f("{ description: 'Read a UTF-8 text file.' }"))).toEqual([]);
  });
  it('G-HON-06', () => {
    expect(scanGuardNames(f('export function isSafe(p: string) { return true; }'))).toHaveLength(1);
    expect(scanGuardNames(f('const checkSecurity = () => {};'))).toHaveLength(1);
    expect(scanGuardNames(f('export function isKnownKind(k: string) {}'))).toEqual([]);
  });
  it('G-HON-07 (docs)', () => {
    expect(scanLatencyDocs(f('Append is fast: p99 0.4 ms.', 'README.md'))).toHaveLength(1);
    expect(scanLatencyDocs(f('measured p99 0.4 ms over 10000 events on the founder\'s Mac (M2, test:perf)', 'README.md'))).toEqual([]);
    expect(scanLatencyDocs(f('the budget is p99 < 5 ms', 'README.md'))).toEqual([]);
  });
  it('G-HON-03 / G-HON-07 (status): a bare count, a subset past its denominator, an unprovenanced latency', () => {
    expect(checkStatusNumbers({ cardsPending: 3 }).map((x) => x.rule)).toEqual(['G-HON-03']);
    expect(checkStatusNumbers({ cards: { n: 1, pendingForYou: 2 } }).map((x) => x.detail)).toEqual(['2 exceeds its denominator cards.n = 1']);
    expect(checkStatusNumbers({ cards: { pendingForYou: 0 } })).toHaveLength(1);
    expect(checkStatusNumbers({ drops: { n: 5, of: 2 } })).toHaveLength(1);
    expect(checkStatusNumbers({ append: { p99Ms: 0.4 } }, { 'append.p99Ms': 'latency' }).map((x) => x.rule)).toEqual(['G-HON-07']);
    expect(checkStatusNumbers({ append: { p99Ms: 0.4, method: 'hrtime over 10⁴ appends', machine: 'darwin-arm64' } }, { 'append.p99Ms': 'latency' })).toEqual([]);
    expect(checkStatusNumbers({ unlocks: { n: 2 }, clientConformance: { n: 0, of: 1 }, log: { seq: 9 } })).toEqual([]);
  });
});
