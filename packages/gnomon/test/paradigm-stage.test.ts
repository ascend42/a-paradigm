/**
 * TD-2026-10-27-833 (#paradigm-stage): staging the first-party Paradigm MCP into the Gnomon home, pinning and verifying it.
 */
// @gnomon-platform: darwin, linux
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { autoStage, PARADIGM_BUNDLE_SCHEMA, readParadigmPin, recheckStaged, selectStageFiles, stageParadigm, stageRoot, StageRefused, verifyStaged, type ParadigmSource } from '../src/kernel/local/paradigm-stage.js';

let root: string | null = null;
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    for (const d of walkDirs(r)) fs.chmodSync(d, 0o700);
    fs.rmSync(r, { recursive: true, force: true });
  }
  root = null;
});
function walkDirs(d: string): string[] {
  const out = [d];
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.lstatSync(p).isDirectory()) out.push(...walkDirs(p));
  }
  return out;
}

function fixture(o: { bundle?: boolean } = {}): { home: string; src: ParadigmSource } {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-pstage-')));
  roots.push(root);
  const pkg = path.join(root, 'lib', 'node_modules', '@a-company', 'paradigm');
  fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(pkg, 'node_modules', 'dep'), { recursive: true });
  fs.mkdirSync(path.join(pkg, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@a-company/paradigm', version: '9.9.9', bin: { 'paradigm-mcp': './dist/mcp.js' } }));
  fs.writeFileSync(path.join(pkg, 'dist', 'mcp.js'), 'console.log(1)\n');
  fs.writeFileSync(path.join(pkg, 'node_modules', 'dep', 'index.js'), 'module.exports = 1\n');
  fs.symlinkSync('../dep/index.js', path.join(pkg, 'node_modules', '.bin', 'dep'));
  if (o.bundle) {
    const b = path.join(pkg, 'dist', 'mcp-bundle');
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(b, 'paradigm-mcp.mjs'), 'export {}\n');
    fs.writeFileSync(path.join(b, 'sql-wasm.wasm'), Buffer.from([0, 97, 115, 109]));
    fs.writeFileSync(path.join(b, 'manifest.json'), JSON.stringify({ schema: PARADIGM_BUNDLE_SCHEMA, entry: 'paradigm-mcp.mjs', files: [{ relativePath: 'paradigm-mcp.mjs' }, { relativePath: 'sql-wasm.wasm' }] }));
  }
  const home = path.join(root, 'gnomon-home');
  fs.mkdirSync(home);
  return { home, src: { dir: pkg, entry: path.join(pkg, 'dist', 'mcp.js'), version: '9.9.9', linked: false } };
}

describe('#paradigm-stage: stage', () => {
  it('copies the tree (no .bin links), dirs 0700, files 0400, deterministic hash, pin written', () => {
    const { home, src } = fixture();
    const pin = stageParadigm(home, src, { sourceKind: 'npm-global', now: () => 0 });
    expect(pin).toMatchObject({ version: '9.9.9', sourceKind: 'npm-global', layout: 'tree', entry: 'dist/mcp.js', source: src.dir, dirty: null });
    const dir = path.join(stageRoot(home), `9.9.9-${pin.treeSha256.slice(0, 12)}`);
    expect((fs.statSync(dir).mode & 0o777).toString(8)).toBe('700');
    expect((fs.statSync(path.join(dir, 'dist')).mode & 0o777).toString(8)).toBe('700');
    expect((fs.statSync(path.join(dir, 'dist', 'mcp.js')).mode & 0o777).toString(8)).toBe('400');
    expect(fs.existsSync(path.join(dir, 'node_modules', '.bin'))).toBe(false);
    expect(readParadigmPin(home)).toEqual(pin);
    // deterministic: the same source hashes the same in another home
    const other = path.join(root!, 'home2');
    fs.mkdirSync(other);
    expect(stageParadigm(other, src, { sourceKind: 'npm-global' }).treeSha256).toBe(pin.treeSha256);
  });

  it('stages exactly the bundle files when the install ships a bundle manifest', () => {
    const { home, src } = fixture({ bundle: true });
    const pin = stageParadigm(home, src, { sourceKind: 'npm-global' });
    expect(pin.layout).toBe('bundle');
    expect(pin.entry).toBe('paradigm-mcp.mjs');
    const v = verifyStaged(home);
    expect(v.ok && fs.readdirSync(v.dir).sort()).toEqual(['paradigm-mcp.mjs', 'sql-wasm.wasm']);
  });

  it('refuses a symlink, a hardlink and an entry resolving outside the tree', () => {
    const a = fixture();
    fs.symlinkSync('/etc/hosts', path.join(a.src.dir, 'dist', 'link.js'));
    expect(() => stageParadigm(a.home, a.src, { sourceKind: 'npm-global' })).toThrow(expect.objectContaining({ why: 'symlink' }));
    fs.rmSync(path.join(a.src.dir, 'dist', 'link.js'));
    fs.linkSync(path.join(a.src.dir, 'dist', 'mcp.js'), path.join(a.src.dir, 'dist', 'hard.js'));
    expect(() => stageParadigm(a.home, a.src, { sourceKind: 'npm-global' })).toThrow(expect.objectContaining({ why: 'hardlink' }));
    fs.rmSync(path.join(a.src.dir, 'dist', 'hard.js'));
    // a bundle manifest naming a path outside the tree
    const b = path.join(a.src.dir, 'dist', 'mcp-bundle');
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(b, 'manifest.json'), JSON.stringify({ schema: PARADIGM_BUNDLE_SCHEMA, entry: 'x.mjs', files: [{ relativePath: '../../../../x.mjs' }] }));
    expect(() => selectStageFiles(a.src)).toThrow(StageRefused);
    expect(readParadigmPin(a.home)).toBeNull();
  });
});

describe('#paradigm-stage: verify', () => {
  it('a tampered staged file is pin-mismatch; the pre-spawn recheck catches a change after open', () => {
    const { home, src } = fixture();
    stageParadigm(home, src, { sourceKind: 'npm-global' });
    const v = verifyStaged(home);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(recheckStaged(v.snapshot)).toBeNull();
    const f = path.join(v.dir, 'dist', 'mcp.js');
    fs.chmodSync(path.dirname(f), 0o700);
    fs.chmodSync(f, 0o600);
    fs.writeFileSync(f, 'console.log(2)\n');
    fs.chmodSync(f, 0o400);
    expect(recheckStaged(v.snapshot)).toMatch(/changed/);
    expect(verifyStaged(home)).toMatchObject({ ok: false, why: expect.stringMatching(/changed/) });
  });

  it('an extra file in the staged dir is a mismatch', () => {
    const { home, src } = fixture();
    stageParadigm(home, src, { sourceKind: 'npm-global' });
    const v = verifyStaged(home);
    if (!v.ok) throw new Error('not ok');
    fs.writeFileSync(path.join(v.dir, 'planted.js'), 'x', { mode: 0o400 });
    expect(verifyStaged(home)).toMatchObject({ ok: false, why: expect.stringMatching(/unexpected/) });
  });
});

describe('#paradigm-stage: when', () => {
  it('npm-global stages on a version change only; a linked checkout never auto-stages', () => {
    const { home, src } = fixture();
    expect(autoStage(home, src)).toMatchObject({ staged: true });
    expect(autoStage(home, src)).toMatchObject({ staged: false });
    // a file change with the same version does not restage
    fs.writeFileSync(path.join(src.dir, 'dist', 'mcp.js'), 'console.log(3)\n');
    expect(autoStage(home, src)).toMatchObject({ staged: false });
    expect(autoStage(home, { ...src, version: '9.9.10' })).toMatchObject({ staged: true, pin: expect.objectContaining({ version: '9.9.10' }) });
    const linked = fixture();
    expect(autoStage(linked.home, { ...linked.src, linked: true })).toMatchObject({ staged: false, pin: null, why: 'linked-checkout' });
    expect(fs.existsSync(stageRoot(linked.home))).toBe(false);
  });
});
