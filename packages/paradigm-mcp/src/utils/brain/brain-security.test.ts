/**
 * Brain security: default-deny, hard-blocks, symlinks, detectors-before-persist,
 * quarantine minimality, storage isolation, fail-closed gates, choke-point lint.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initBrain, addShare, appendZones, brainDir, brainFile, brainsHome, hardBlockReason,
  loadBrainConfig, resolveGate, safeResolveGate, saveBrainConfig, BrainConfigError,
} from './config.js';
import { openBrainView, scanBrain } from './view.js';
import { detectSecrets, detectThirdParty, luhnValid } from './detect.js';
import { purgeBrain } from './purge.js';
import { appendEgress, egressSummary } from './egress.js';
import {
  materializeRedteam, SECRET_FILES, THIRD_PARTY_FILES, HEADING_SENTINEL, OUTSIDE_SENTINEL,
} from './__fixtures__/materialize.js';
import { makeSandbox, snapshotTree, type BrainSandbox } from './__fixtures__/env.js';
import type { BrainConfig, IndexRecord } from './types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../..');

let sb: BrainSandbox;
let root: string;
let rootHash: string;
let before: string[];
let records: IndexRecord[];
let indexText: string;

beforeAll(() => {
  sb = makeSandbox('brain-sec-');
  root = materializeRedteam(sb.tmp).root;
  before = snapshotTree(root);
  rootHash = initBrain(root, sb.opts).rootHash;
  scanBrain(rootHash, sb.opts);
  indexText = fs.readFileSync(brainFile(rootHash, 'index', sb.opts), 'utf8');
  records = JSON.parse(indexText).records;
});
afterAll(() => sb.cleanup());

const rec = (rel: string) => records.find((r) => r.relpath === rel);

describe('storage isolation', () => {
  it('never writes inside the user root', () => {
    expect(snapshotTree(root)).toEqual(before);
  });
  it('stores under <homedir>/.paradigm/brains/<16 hex>', () => {
    expect(rootHash).toMatch(/^[0-9a-f]{16}$/);
    expect(brainDir(rootHash, sb.opts)).toBe(path.join(sb.home, '.paradigm', 'brains', rootHash));
    expect(fs.existsSync(brainFile(rootHash, 'config', sb.opts))).toBe(true);
  });
  it('refuses roots that are the home dir, the fs root, hard-blocked, or overlap storage', () => {
    expect(() => initBrain(sb.home, sb.opts)).toThrow(BrainConfigError);
    expect(() => initBrain('/', sb.opts)).toThrow(BrainConfigError);
    for (const rel of ['Library/Notes', '.ssh', '.gnupg/x', '.config/google-chrome/Default']) {
      const d = path.join(sb.home, rel);
      fs.mkdirSync(d, { recursive: true });
      expect(() => initBrain(d, sb.opts)).toThrow(BrainConfigError);
    }
    expect(() => initBrain(brainsHome(sb.opts), sb.opts)).toThrow(BrainConfigError);
    expect(() => initBrain(path.join(sb.tmp, 'nope'), sb.opts)).toThrow(BrainConfigError);
  });
  it('refuses a tampered brain.yaml whose root does not match the id', () => {
    const other = path.join(sb.tmp, 'other');
    fs.mkdirSync(other);
    const h = initBrain(other, sb.opts).rootHash;
    const file = brainFile(h, 'config', sb.opts);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(other, root));
    expect(() => loadBrainConfig(h, sb.opts)).toThrow(BrainConfigError);
    expect(() => openBrainView(h, 'owner', sb.opts)).toThrow(BrainConfigError);
  });
});

describe('walk hardening', () => {
  it('hard-blocked files and stores are never recorded, even when shared', () => {
    for (const r of records) expect(hardBlockReason(path.join(root, r.relpath), sb.opts)).toBeNull();
    expect(records.some((r) => /kdbx|lastpass|bitwarden|Maildir|\.ssh/i.test(r.relpath))).toBe(false);
    expect(indexText).not.toContain('passwords.kdbx');
    addShare(rootHash, '**', sb.opts);
    scanBrain(rootHash, sb.opts);
    const owner = openBrainView(rootHash, 'owner', sb.opts);
    expect(owner.files().some((f) => /kdbx|lastpass|Maildir|\.ssh/i.test(f.relpath))).toBe(false);
  });
  it('hard-block patterns', () => {
    const o = sb.opts;
    expect(hardBlockReason(path.join(sb.home, 'Library/Mail/x'), o)).not.toBeNull();
    expect(hardBlockReason(path.join(sb.home, '.mozilla/profile'), o)).not.toBeNull();
    expect(hardBlockReason(path.join(sb.home, '.config/BraveSoftware/x'), o)).not.toBeNull();
    for (const n of ['a.mbox', 'b.pst', 'c.emlx', 'd.kdbx', 'e.1pif', 'f.opvault', 'my_bitwarden_export.json', 'LastPass-vault.csv']) {
      expect(hardBlockReason(path.join(sb.tmp, 'x', n), o)).not.toBeNull();
    }
    expect(hardBlockReason(path.join(sb.tmp, 'x', 'notes.md'), o)).toBeNull();
  });
  it('never follows symlinks (to /etc, ../outside, or an outside file)', () => {
    expect(records.some((r) => r.relpath.startsWith('link-etc') || r.relpath.startsWith('link-outside'))).toBe(false);
    expect(rec('obsidian/escape.md')).toBeUndefined();
    expect(indexText).not.toContain(OUTSIDE_SENTINEL);
    expect(indexText).not.toContain('passwd');
  });
});

describe('detectors run before persistence', () => {
  it('secret-bearing files are quarantined with only path + size kept', () => {
    for (const rel of SECRET_FILES) {
      const r = rec(rel);
      expect(r, rel).toBeDefined();
      expect(r!.status, rel).toBe('quarantined');
      expect(Object.keys(r!).sort()).toEqual(['ext', 'id', 'kind', 'relpath', 'size', 'status']);
    }
    expect(indexText).not.toContain(HEADING_SENTINEL);
    expect(indexText).not.toMatch(/AKIA|sk-ant-|ghp_|xoxb-|PRIVATE KEY|4111|123-45-6789|ERIKSSON/);
  });
  it('chat exports become third-party-data, folder flagged, zone appended', () => {
    for (const rel of THIRD_PARTY_FILES) expect(rec(rel)?.status, rel).toBe('third-party-data');
    const cfg = loadBrainConfig(rootHash, sb.opts);
    expect(cfg.zones).toContainEqual({ glob: 'chat-export/dm-alice/**', gate: 'third-party-data', source: 'detector' });
    const flagged = JSON.parse(indexText).flagged as Array<{ folder: string; reason: string }>;
    expect(flagged.some((f) => f.folder === 'secrets' && f.reason === 'secret')).toBe(true);
    expect(indexText).not.toContain('new address');
  });
  it('quarantined / third-party files never appear to the owner by name', () => {
    const owner = openBrainView(rootHash, 'owner', sb.opts);
    const out = JSON.stringify([owner.files(), owner.search('secrets'), owner.search('messages'), owner.lockedZones()]);
    for (const rel of [...SECRET_FILES, ...THIRD_PARTY_FILES]) expect(out).not.toContain(rel);
  });
  it('detector unit cases', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
    expect(detectSecrets('Keynote: the annual conference talk')).toEqual([]);
    expect(detectSecrets('api_key: your-api-key-here')).toEqual([]);
    expect(detectSecrets('PASSWORD=<changeme>')).toEqual([]);
    expect(detectSecrets('order 1234 5678 9012 3456 shipped')).not.toContain('card-number');
    expect(detectSecrets('db_password: Tr0ub4dor&3xyz')).toContain('secret-assignment');
    expect(detectThirdParty('notes/plain.md', '# just notes')).toBe(false);
    expect(detectThirdParty('x/messages.json', null)).toBe(true);
  });
});

describe('gates: default-deny, tighten-only, fail-closed', () => {
  const base: BrainConfig = {
    version: 1, root: '/x', default_gate: 'private', share: [], zones: [], agent_access: 'off',
    limits: { max_file_bytes: 1, max_files: 1, parse_ms: 1 },
  };
  it('default gate is private; share lowers to open; zones win over share', () => {
    expect(resolveGate('a.md', base)).toBe('private');
    const c = { ...base, share: ['Pub/**', 'Health/**'], zones: [{ glob: 'health/**', gate: 'medical' as const, source: 'name' as const }] };
    expect(resolveGate('Pub/a.md', c)).toBe('open');
    expect(resolveGate('Health/deep/a.md', c)).toBe('medical');
    expect(resolveGate('pub/a.md', c)).toBe('private'); // share is case-sensitive
  });
  it('gate resolution throw → quarantined', () => {
    const bad = { ...base, zones: [{ glob: '**', gate: 'bogus' as never, source: 'human' as const }] };
    expect(() => resolveGate('a.md', bad)).toThrow();
    expect(safeResolveGate('a.md', bad)).toBe('quarantined');
  });
  it('appendZones only tightens', () => {
    const added = appendZones(rootHash, [
      { glob: 'obsidian/**', gate: 'open', source: 'detector' },
      { glob: 'obsidian/**', gate: 'private', source: 'detector' },
    ], sb.opts);
    expect(added).toEqual([]);
  });
  it('unknown zone gate in brain.yaml loads as quarantined; zone gate open is coerced', () => {
    const cfg = loadBrainConfig(rootHash, sb.opts);
    const file = brainFile(rootHash, 'config', sb.opts);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + '');
    saveBrainConfig(rootHash, { ...cfg, zones: [...cfg.zones, { glob: 'obsidian/**', gate: 'wat' as never, source: 'human' }] }, sb.opts);
    expect(loadBrainConfig(rootHash, sb.opts).zones.find((z) => z.glob === 'obsidian/**')?.gate).toBe('quarantined');
    const owner = openBrainView(rootHash, 'owner', sb.opts);
    expect(owner.files().some((f) => f.relpath.startsWith('obsidian/'))).toBe(false);
    saveBrainConfig(rootHash, cfg, sb.opts);
  });
  it('name-based zones are auto-flagged (Health → medical)', () => {
    const cfg = loadBrainConfig(rootHash, sb.opts);
    expect(cfg.zones).toContainEqual({ glob: 'Health/**', gate: 'medical', source: 'name' });
    const owner = openBrainView(rootHash, 'owner', sb.opts);
    expect(owner.files().some((f) => f.relpath.startsWith('Health/'))).toBe(false);
    expect(owner.lockedZones()).toContainEqual({ folder: 'Health', gate: 'medical', count: 1 });
  });
});

describe('egress + purge', () => {
  it('egress summary and purge (archives egress, removes storage, leaves root alone)', () => {
    const other = path.join(sb.tmp, 'purge-me');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'a.md'), '# A\n');
    const h = initBrain(other, sb.opts).rootHash;
    scanBrain(h, sb.opts);
    expect(egressSummary(h, sb.opts).nothingLeft).toBe(true);
    appendEgress(h, { at: new Date().toISOString(), channel: 'mcp', op: 'search', fileIds: ['f_0123456789'], bytes: 10, root: other }, sb.opts);
    expect(egressSummary(h, sb.opts).nothingLeft).toBe(false);
    const res = purgeBrain(h, sb.opts);
    expect(res.removed).toBe(true);
    expect(res.egressArchive && fs.existsSync(res.egressArchive)).toBe(true);
    expect(fs.existsSync(brainDir(h, sb.opts))).toBe(false);
    expect(fs.readFileSync(path.join(other, 'a.md'), 'utf8')).toBe('# A\n');
    expect(() => purgeBrain('../../etc', sb.opts)).toThrow(BrainConfigError);
  });
});

describe('choke-point lint', () => {
  function tsFiles(dir: string, out: string[] = []): string[] {
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return out; }
    for (const n of names) {
      if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) continue;
      const abs = path.join(dir, n);
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) tsFiles(abs, out);
      else if (/\.(ts|tsx|mts|js|mjs)$/.test(n)) out.push(abs);
    }
    return out;
  }
  it('only view.ts imports index-store (repo-wide)', () => {
    const offenders: string[] = [];
    for (const pkg of fs.readdirSync(path.join(REPO, 'packages'))) {
      const src = path.join(REPO, 'packages', pkg, 'src');
      for (const f of tsFiles(src)) {
        if (path.resolve(f) === path.join(HERE, 'view.ts') || path.resolve(f) === path.join(HERE, 'index-store.ts')) continue;
        const text = fs.readFileSync(f, 'utf8');
        if (/(?:from|import\(|require\()\s*['"][^'"]*index-store(?:\.js|\.ts)?['"]/.test(text)) offenders.push(path.relative(REPO, f));
      }
    }
    expect(offenders).toEqual([]);
  });
  it('brain engine never uses console', () => {
    for (const f of tsFiles(HERE)) {
      if (f.endsWith('.test.ts')) continue;
      expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/\bconsole\.(log|info|warn|error|debug)\(/);
    }
  });
});
