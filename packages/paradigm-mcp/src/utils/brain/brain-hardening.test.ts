/**
 * Brain hardening (Aegis 7.14.0 findings): ReDoS-free detectors with a
 * pre-emptive budget, case/NFC-folded hard-blocks, TOCTOU-safe reads, tamper
 * evidence on brain.yaml, token-based name zones, purge --forget-log,
 * listBrains caching and the PARADIGM_BRAIN_HOME override.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import {
  initBrain, brainFile, brainDir, brainsHome, hardBlockReason, loadBrainConfig, listBrains,
  nameZoneGate, resolveHomedir, saveBrainConfig, setAgentAccess, addShare, BrainConfigError,
  brainConfigTestHooks, reviewBrainConfig,
} from './config.js';
import { detect, detectSecrets, DetectorTimeoutError, ibanValid } from './detect.js';
import { readVerified } from './walk.js';
import { openBrainView, scanBrain } from './view.js';
import { readEgress, egressSummary, appendEgress } from './egress.js';
import { purgeBrain } from './purge.js';
import { makeSandbox, type BrainSandbox } from './__fixtures__/env.js';
import { TAMPER_BANNER } from './types.js';

let sb: BrainSandbox;
beforeAll(() => { sb = makeSandbox('brain-hard-'); });
afterAll(() => sb.cleanup());

// ── 1. ReDoS ─────────────────────────────────────────────────────────

describe('detectors are linear (red team)', () => {
  const TWO_MB = 2 * 1024 * 1024;
  const time = (fn: () => unknown) => { const t = performance.now(); fn(); return performance.now() - t; };

  it('a 2MB `key_key_…` line scans in under 500ms', () => {
    const line = 'key_'.repeat(TWO_MB / 4);
    const ms = time(() => detectSecrets(line));
    expect(ms).toBeLessThan(500);
  });

  it('other adversarial 2MB shapes stay fast', () => {
    const shapes = [
      'key=xxxx='.repeat(TWO_MB / 9),                 // assignment scanner, placeholder values
      'a'.repeat(TWO_MB),                              // one huge token
      '1 '.repeat(TWO_MB / 2),                         // card scanner
      'AA00 '.repeat(TWO_MB / 5),                      // IBAN candidates
      'eyJ' + 'a'.repeat(TWO_MB),                      // JWT prefix, no dots
      '-----BEGIN ' + 'A '.repeat(TWO_MB / 2),         // PEM
      '"author": '.repeat(TWO_MB / 10),                // discord anchor
      '"ts": "1.2" '.repeat(TWO_MB / 12),              // slack anchor
    ];
    for (const s of shapes) {
      const ms = time(() => detect('x.json', s));
      expect(ms, s.slice(0, 20)).toBeLessThan(1500);
    }
  });

  it('the budget is pre-emptive: an exhausted budget throws DetectorTimeoutError', () => {
    const text = 'harmless line of notes\n'.repeat(200_000);
    expect(() => detect('big.md', text, { budgetMs: 0.001 })).toThrow(DetectorTimeoutError);
    expect(detect('big.md', text).secrets).toEqual([]);
  });

  it('a scan quarantines a file whose detection exceeds parse_ms (detector-timeout, fail closed)', () => {
    const root = path.join(sb.tmp, 'timeout-root');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'huge.md'), '# Title\n' + 'plain words on a line\n'.repeat(80_000));
    fs.writeFileSync(path.join(root, 'small.md'), '# Small\n');
    const { rootHash, config } = initBrain(root, sb.opts);
    saveBrainConfig(rootHash, { ...config, limits: { ...config.limits, parse_ms: 1 } }, sb.opts);
    scanBrain(rootHash, sb.opts);
    const idx = JSON.parse(fs.readFileSync(brainFile(rootHash, 'index', sb.opts), 'utf8'));
    const huge = idx.records.find((r: { relpath: string }) => r.relpath === 'huge.md');
    expect(huge).toMatchObject({ status: 'quarantined', skipReason: 'detector-timeout' });
    expect(huge.title).toBeUndefined();
  });

  it('secret-assignment: key token + value scanner', () => {
    expect(detectSecrets('db_password: Tr0ub4dor&3xyz')).toContain('secret-assignment');
    expect(detectSecrets('{"clientSecret": "s3cr3tValue99"}')).toContain('secret-assignment');
    expect(detectSecrets('export API_KEY=abcd1234efgh')).toContain('secret-assignment');
    expect(detectSecrets('Keynote: the annual conference talk')).toEqual([]);
    expect(detectSecrets('monkey: bananas_are_great')).toEqual([]);
    expect(detectSecrets('password: short')).toEqual([]);
    expect(detectSecrets('time 10:30:45 meeting')).toEqual([]);
  });

  it('PLACEHOLDER applies to the VALUE only (a placeholder-ish KEY does not hide a real value)', () => {
    expect(detectSecrets('example_api_key: Tr0ub4dor&3xyz')).toContain('secret-assignment');
    expect(detectSecrets('placeholder_token = 9f8e7d6c5b4a3210')).toContain('secret-assignment');
    expect(detectSecrets('api_key: your-api-key-here')).toEqual([]);
    expect(detectSecrets('token: xxxxxxxxxxxx')).toEqual([]);
    expect(detectSecrets('PASSWORD=${DB_PASSWORD_FROM_ENV}')).toEqual([]);
  });

  it('new detectors: Google, Stripe, JWT, IBAN (mod-97)', () => {
    expect(detectSecrets(`maps key AIza${'B'.repeat(35)} here`)).toContain('google-api-key');
    expect(detectSecrets(`stripe sk_live_${'a1B2'.repeat(6)}`)).toContain('stripe-key');
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(detectSecrets(`Authorization: Bearer ${jwt}`)).toContain('jwt');
    expect(ibanValid('GB82WEST12345698765432')).toBe(true);
    expect(ibanValid('GB82WEST12345698765433')).toBe(false);
    expect(detectSecrets('pay to GB82 WEST 1234 5698 7654 32 please')).toContain('iban');
    expect(detectSecrets('rent DE89370400440532013000')).toContain('iban');
    expect(detectSecrets('rent DE89370400440532013001')).not.toContain('iban');
    expect(detectSecrets('model AB12CDEFGHIJKLMNOP is fine')).not.toContain('iban');
  });

  it('a secret past the first 4096 chars of a long line is still found (windowed, not dropped)', () => {
    const line = 'x'.repeat(10_000) + ' AKIAABCDEFGHIJKLMNOP ' + 'y'.repeat(10_000);
    expect(detectSecrets(line)).toContain('aws-access-key');
  });
});

// ── 2. hard-block case / NFC bypass ──────────────────────────────────

describe('hard-blocks fold case and Unicode normalization', () => {
  it('~/library, ~/LIBRARY, ~/.config/Google-Chrome, ~/.SSH are refused', () => {
    const h = sb.home;
    for (const rel of ['library/Notes', 'LIBRARY/Mail/x', 'Library/x', '.config/Google-Chrome/Default', '.CONFIG/CHROMIUM/x', '.config/bravesoftware/y', '.SSH/id', 'notes/.GnuPG/x']) {
      expect(hardBlockReason(path.join(h, rel), sb.opts), rel).not.toBeNull();
    }
    expect(hardBlockReason(path.join(h, 'LibraryNotes/x'), sb.opts)).toBeNull();
  });

  it('NFD spellings of the home path are refused', () => {
    const nfcHome = path.join(sb.tmp, 'José-home');
    fs.mkdirSync(path.join(nfcHome, 'Library', 'Notes'), { recursive: true });
    const nfdHome = nfcHome.normalize('NFD');
    expect(nfdHome).not.toBe(nfcHome);
    const o = { homedir: nfcHome };
    expect(hardBlockReason(path.join(nfdHome, 'Library', 'Notes'), o)).not.toBeNull();
    expect(hardBlockReason(path.join(nfdHome, 'library', 'notes'), o)).not.toBeNull();
    expect(hardBlockReason(path.join(nfcHome.normalize('NFD'), 'Documents'), o)).toBeNull();
    // and the home given in NFD blocks NFC paths
    expect(hardBlockReason(path.join(nfcHome, 'Library', 'x'), { homedir: nfdHome })).not.toBeNull();
  });

  it('initBrain refuses a differently-cased spelling of a hard-blocked folder', () => {
    fs.mkdirSync(path.join(sb.home, 'Library', 'Notes'), { recursive: true });
    fs.mkdirSync(path.join(sb.home, '.config', 'google-chrome', 'Default'), { recursive: true });
    expect(() => initBrain(path.join(sb.home, 'library', 'Notes'), sb.opts)).toThrow(BrainConfigError);
    expect(() => initBrain(path.join(sb.home, '.config', 'Google-Chrome', 'Default'), sb.opts)).toThrow(BrainConfigError);
  });
});

// ── 3. TOCTOU ────────────────────────────────────────────────────────

describe('lstat/read TOCTOU', () => {
  it('readVerified refuses a file swapped after the walk (new inode or symlink)', () => {
    const dir = path.join(sb.tmp, 'toctou');
    fs.mkdirSync(dir);
    const secret = path.join(sb.tmp, 'outside-secret.txt');
    fs.writeFileSync(secret, 'AKIAABCDEFGHIJKLMNOP');
    const f = path.join(dir, 'note.md');
    fs.writeFileSync(f, '# Note\n');
    const st = fs.lstatSync(f);
    const entry = { abs: f, ino: st.ino, dev: st.dev };
    const ok = readVerified(entry, 1_000_000);
    expect(Buffer.isBuffer(ok) && ok.toString()).toBe('# Note\n');

    // swapped for a symlink → O_NOFOLLOW refuses
    fs.unlinkSync(f);
    fs.symlinkSync(secret, f);
    expect(readVerified(entry, 1_000_000)).toBe('changed');

    // swapped for a different regular file → inode mismatch
    fs.unlinkSync(f);
    fs.writeFileSync(path.join(dir, 'other.md'), 'x');
    fs.writeFileSync(f, '# Replaced\n');
    const st2 = fs.lstatSync(f);
    if (st2.ino !== st.ino) expect(readVerified(entry, 1_000_000)).toBe('changed');
    expect(readVerified({ abs: f, ino: st2.ino, dev: st2.dev + 1 }, 1_000_000)).toBe('changed');
    // vanished → changed
    expect(readVerified({ abs: path.join(dir, 'gone.md'), ino: 1, dev: 1 }, 10)).toBe('changed');
  });
});

// ── 6. brain.yaml tamper evidence ────────────────────────────────────

describe('brain.yaml tampering', () => {
  let root: string;
  let rootHash: string;
  beforeAll(() => {
    root = path.join(sb.tmp, 'tamper-root');
    fs.mkdirSync(path.join(root, 'Public'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Public', 'a.md'), '# A\n');
    rootHash = initBrain(root, sb.opts).rootHash;
    addShare(rootHash, 'Public/**', sb.opts);
    scanBrain(rootHash, sb.opts);
  });

  it('writers record a sha256 in .config-hash; a clean load is not tampered', () => {
    expect(fs.readFileSync(brainFile(rootHash, 'configHash', sb.opts), 'utf8')).toMatch(/^[0-9a-f]{64}\n$/);
    const cfg = loadBrainConfig(rootHash, sb.opts);
    expect(cfg.tampered).toBeUndefined();
  });

  it('an out-of-band edit pauses agent access (fail closed), logs ONE egress event, and is sticky', () => {
    setAgentAccess(rootHash, 'metadata', sb.opts);
    expect(openBrainView(rootHash, 'agent', sb.opts).enabled).toBe(true);
    const file = brainFile(rootHash, 'config', sb.opts);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace("share:\n  - Public/**", "share:\n  - '**'"));

    const cfg = loadBrainConfig(rootHash, sb.opts);
    expect(cfg.tampered).toBe(true);
    expect(cfg.agent_access).toBe('off');
    expect(openBrainView(rootHash, 'agent', sb.opts).enabled).toBe(false);
    expect(listBrains(sb.opts).find((b) => b.rootHash === rootHash)).toMatchObject({ tampered: true, agentAccess: 'off' });
    loadBrainConfig(rootHash, sb.opts);
    const events = readEgress(rootHash, sb.opts).filter((r) => r.channel === 'config');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ channel: 'config', op: 'tamper-detected', fileIds: [] });
    // a local config event is not "something left this Mac"
    expect(egressSummary(rootHash, sb.opts)).toMatchObject({ nothingLeft: true, count: 0 });

    // a later Paradigm write (e.g. a scan appending zones) does NOT launder the tamper
    scanBrain(rootHash, sb.opts);
    expect(loadBrainConfig(rootHash, sb.opts).tampered).toBe(true);

    // the engine never rubber-stamps: an unacknowledged access change is refused
    expect(() => setAgentAccess(rootHash, 'metadata', sb.opts)).toThrow(BrainConfigError);
    const review = reviewBrainConfig(rootHash, sb.opts);
    expect(review.tampered).toBe(true);
    expect(review.changes).toContain('+ shared: **');
    expect(review.changes).toContain('- shared: Public/**');
    // the lastgood snapshot was not overwritten by the post-tamper scan
    expect(review.lastGood?.share).toEqual(['Public/**']);

    // the human reviewing + confirming is the acknowledgement
    setAgentAccess(rootHash, 'metadata', { ...sb.opts, acknowledgeTamper: true });
    const after = loadBrainConfig(rootHash, sb.opts);
    expect(after.tampered).toBeUndefined();
    expect(after.agent_access).toBe('metadata');
    expect(TAMPER_BANNER).toBe('Settings changed outside Paradigm — agent access paused. Run `paradigm brain status` to review.');
  });

  it('a deleted .config-hash also counts as tampering', () => {
    fs.unlinkSync(brainFile(rootHash, 'configHash', sb.opts));
    expect(loadBrainConfig(rootHash, sb.opts)).toMatchObject({ tampered: true, agent_access: 'off' });
    setAgentAccess(rootHash, 'off', { ...sb.opts, acknowledgeTamper: true });
    expect(loadBrainConfig(rootHash, sb.opts).tampered).toBeUndefined();
  });
});

describe('tamper check vs a concurrent save (no false positive)', () => {
  let rootHash: string;
  beforeAll(() => {
    const root = path.join(sb.tmp, 'race-root');
    fs.mkdirSync(root);
    rootHash = initBrain(root, sb.opts).rootHash;
  });
  const file = () => brainFile(rootHash, 'config', sb.opts);
  const sha = (t: string) => require('node:crypto').createHash('sha256').update(t, 'utf8').digest('hex');

  it('mid-save state (pending hash written, brain.yaml new, .config-hash old) loads clean', () => {
    const next = fs.readFileSync(file(), 'utf8').replace('share: []', "share:\n  - Pub/**");
    fs.writeFileSync(brainFile(rootHash, 'configHashPending', sb.opts), sha(next) + '\n');
    fs.writeFileSync(file(), next);
    const cfg = loadBrainConfig(rootHash, sb.opts);
    expect(cfg.tampered).toBeUndefined();
    expect(fs.existsSync(brainFile(rootHash, 'configTampered', sb.opts))).toBe(false);
    fs.renameSync(brainFile(rootHash, 'configHashPending', sb.opts), brainFile(rootHash, 'configHash', sb.opts));
  });

  it('a mismatch that the writer resolves within the ~50ms re-check is not tamper', () => {
    const next = fs.readFileSync(file(), 'utf8').replace("  - Pub/**", "  - Pub2/**");
    fs.writeFileSync(file(), next); // yaml ahead of its hash (older writer ordering)
    let calls = 0;
    brainConfigTestHooks.beforeTamperRecheck = () => {
      calls++;
      fs.writeFileSync(brainFile(rootHash, 'configHash', sb.opts), sha(next) + '\n'); // writer catches up
    };
    try {
      expect(loadBrainConfig(rootHash, sb.opts).tampered).toBeUndefined();
    } finally {
      brainConfigTestHooks.beforeTamperRecheck = undefined;
    }
    expect(calls).toBe(1);
    expect(fs.existsSync(brainFile(rootHash, 'configTampered', sb.opts))).toBe(false);
  });

  it('interleaved saveBrainConfig + loads never trip the pause', () => {
    for (let i = 0; i < 20; i++) {
      const cfg = loadBrainConfig(rootHash, sb.opts);
      saveBrainConfig(rootHash, { ...cfg, share: [`P${i}/**`] }, sb.opts);
      expect(loadBrainConfig(rootHash, sb.opts).tampered).toBeUndefined();
    }
    expect(fs.existsSync(brainFile(rootHash, 'configHashPending', sb.opts))).toBe(false);
    expect(fs.readFileSync(brainFile(rootHash, 'configLastGood', sb.opts), 'utf8')).toBe(fs.readFileSync(file(), 'utf8'));
  });
});

describe('whitespace padding cannot split a key from its value', () => {
  it('a value pushed past the window by spaces is still detected', () => {
    expect(detectSecrets('password:' + ' '.repeat(10_000) + 'Tr0ub4dor&3xyz')).toContain('secret-assignment');
    expect(detectSecrets('api_key =' + '\t'.repeat(9_000) + '"abcd1234efgh"')).toContain('secret-assignment');
  });
});

// ── 7. name zones / purge --forget-log ───────────────────────────────

describe('name-based zones match keyword TOKENS', () => {
  it('"Health Records", "Taxes 2024", "MedicalBills", "my-bank" → gated; lookalikes are not', () => {
    expect(nameZoneGate('Health Records')).toBe('medical');
    expect(nameZoneGate('Taxes 2024')).toBe('financial');
    expect(nameZoneGate('MedicalBills')).toBe('medical');
    expect(nameZoneGate('my-bank')).toBe('financial');
    expect(nameZoneGate('PASSPORT scans')).toBe('identity');
    expect(nameZoneGate('Kids')).toBeNull();
    expect(nameZoneGate('Syntax')).toBeNull();
    expect(nameZoneGate('Healthy Recipes')).toBeNull();
  });
});

describe('purge --forget-log', () => {
  it('default archives and keeps; forgetLog deletes the log AND earlier archives', () => {
    const mk = (n: string) => {
      const d = path.join(sb.tmp, n);
      fs.mkdirSync(d);
      fs.writeFileSync(path.join(d, 'a.md'), '# A\n');
      return d;
    };
    const d = mk('forget-me');
    let h = initBrain(d, sb.opts).rootHash;
    appendEgress(h, { at: new Date().toISOString(), channel: 'mcp', op: 'search', fileIds: [], bytes: 1, root: d }, sb.opts);
    const first = purgeBrain(h, sb.opts);
    expect(first.egressArchive && fs.existsSync(first.egressArchive)).toBe(true);

    h = initBrain(d, sb.opts).rootHash;
    appendEgress(h, { at: new Date().toISOString(), channel: 'mcp', op: 'search', fileIds: [], bytes: 1, root: d }, sb.opts);
    const second = purgeBrain(h, { ...sb.opts, forgetLog: true });
    expect(second).toMatchObject({ removed: true, egressArchive: null, archivesDeleted: 1 });
    expect(fs.existsSync(first.egressArchive!)).toBe(false);
    expect(fs.existsSync(brainDir(h, sb.opts))).toBe(false);
    const archive = path.join(brainsHome(sb.opts), '_archive');
    expect((fs.existsSync(archive) ? fs.readdirSync(archive) : []).filter((n) => n.startsWith(h))).toEqual([]);
    expect(fs.readFileSync(path.join(d, 'a.md'), 'utf8')).toBe('# A\n');
  });
});

// ── 8. isolation + cache ─────────────────────────────────────────────

describe('PARADIGM_BRAIN_HOME + listBrains cache', () => {
  it('resolveHomedir honours opts > PARADIGM_BRAIN_HOME > os.homedir', () => {
    expect(resolveHomedir({ homedir: '/x/y' })).toBe(path.resolve('/x/y'));
    expect(resolveHomedir()).toBe(path.resolve(process.env.PARADIGM_BRAIN_HOME!));
    expect(resolveHomedir()).not.toBe(path.resolve(os.userInfo().homedir));
  });

  it('listBrains is cached but sees brain.yaml rewrites', () => {
    const a = listBrains(sb.opts);
    const b = listBrains(sb.opts);
    expect(b).toEqual(a);
    b.pop();
    expect(listBrains(sb.opts)).toEqual(a); // callers cannot mutate the cache
    const d = path.join(sb.tmp, 'cache-root');
    fs.mkdirSync(d);
    const h = initBrain(d, sb.opts).rootHash;
    expect(listBrains(sb.opts).some((x) => x.rootHash === h)).toBe(true);
    setAgentAccess(h, 'metadata', sb.opts);
    expect(listBrains(sb.opts).find((x) => x.rootHash === h)?.agentAccess).toBe('metadata');
  });
});
