/**
 * #manifest-loader + policy (spec §3.6, §4.3, §12.5, §15.4, §15.5, §15.7, §16;
 * §19.1 M1.5 row). Oracles: G-MAN-01 egress refusals · G-MAN-02 agent-written
 * manifest needs a card · G-MAN-03 rollback restores the previous hash ·
 * G-HON-04 manifest generation is a fixed point and install → uninstall leaves
 * ~/.claude and the repo byte-identical · G-LAW-04 install → uninstall leaves
 * the repo clean except project.yaml (the "one session" leg is M1.7) ·
 * G-WIN-04 layersHash / gitHash normalise CRLF and path case.
 * The copier's case-collision refusal can only be PLANTED on a case-sensitive
 * filesystem, so that leg is exercised on Linux CI (macOS/Windows alias the pair).
 * Falsifier (M1.5 row): "install→uninstall diff non-empty".
 *
 * Platform-independent (no process.platform branch): runs on macOS, Ubuntu
 * and Windows CI. Directory links use the `junction` type, which needs no
 * privilege on Windows and is an ordinary directory symlink on POSIX.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, EVENT_KIND_NAMES, isRefusalV1, validateCardV1 } from '@a-company/gnomon-contracts';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority, UnprovisionedRootAuthority } from '../src/kernel/identity/root-authority.js';
import {
  appendGrantRow,
  buildSessionPolicy,
  checkEgressHost,
  claudePermissions,
  collectGitInputs,
  collectLayerInputs,
  detectWidening,
  digestInputs,
  generateRepo,
  gitHash,
  recordPath,
  renderGenerated,
  readChecked,
  walkSource,
  SESSION_DENY_CLASSES,
  grantsPath,
  isAnthropicHost,
  layersHash,
  linkedFolders,
  loadMod,
  MANIFEST_FILE,
  ManifestRefusal,
  manifestHash,
  canonicalManifestHash,
  pinnedDir,
  policyHash,
  readGrants,
  readStaged,
  realpathLoose,
  removeTree,
  stageInstall,
  uninstallHome,
  uninstallRepo,
  validateManifest,
  type ManifestV2,
} from '../src/kernel/manifest/index.js';
import { decideInstallCard, mintTestPresence, rollbackModSnapshot } from '../src/kernel/testing.js';
import { installPresenceBinding, rollbackPresenceBinding } from '../src/kernel/manifest/install.js';
import { PKG_ROOT } from './helpers.js';
import { spawnSync } from 'node:child_process';
import { SESSION_DENY_REALISATION } from '../src/platform/session-denies.js';

const tmps: string[] = [];
function tmp(prefix = 'gnomon-man-'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});

const AGENT = 'p:abcdefgh/s-01hzzzzz';
const HUMAN = 'p:abcdefgh/matt';

function baseManifest(over: Partial<ManifestV2> = {}): ManifestV2 {
  return {
    manifest: 2,
    publisher: 'acme',
    kind: 'mod',
    name: 'diff-lens',
    version: '1.2.0',
    abi: 'mod-abi:v1',
    provides: {
      tools: [{ name: 'lens.diff', effects: ['read'] }],
      views: [{ id: 'diff.pane', slot: 'panel', placement: 'append' }],
      events: ['modns.acme.diff-lens.rendered'],
      commands: [{ id: 'lens.toggle', title: 'Toggle diff lens' }],
      keybindings: [{ key: 'ctrl+shift+d', command: 'lens.toggle' }],
    },
    requires: { capabilities: ['log.append:modns.acme.diff-lens.*'], egress: 'none' },
    ...over,
  };
}

/** The same mod under the first-party publisher (S0b: the first-party tier is publisher gnomon only). */
function fpManifest(over: Partial<ManifestV2> = {}): ManifestV2 {
  const b = baseManifest();
  return { ...b, publisher: 'gnomon', provides: { ...b.provides, events: ['modns.gnomon.diff-lens.rendered'] }, requires: { capabilities: ['log.append:modns.gnomon.diff-lens.*'], egress: 'none' }, ...over };
}

function writeMod(dir: string, m: unknown, files: Record<string, string> = {}): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify(m, null, 2));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

function refusalOf(fn: () => unknown): ManifestRefusal {
  try {
    fn();
  } catch (err) {
    if (err instanceof ManifestRefusal) {
      expect(isRefusalV1(err.refusal), 'a refusal:v1 shape').toBe(true);
      return err;
    }
    throw err;
  }
  throw new Error('expected a ManifestRefusal');
}

function events() {
  const seen: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  return { seen, emit: (kind: string, payload: Record<string, unknown>) => void seen.push({ kind, payload }), kinds: () => seen.map((e) => e.kind) };
}

/** Byte snapshot of a tree: posix rel path → sha256 (directories as `dir`). */
function treeBytes(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (abs: string, rel: string): void => {
    for (const n of fs.readdirSync(abs).sort()) {
      const a = path.join(abs, n);
      const r = rel ? `${rel}/${n}` : n;
      if (fs.lstatSync(a).isDirectory()) {
        out[`${r}/`] = 'dir';
        visit(a, r);
      } else out[r] = createHash('sha256').update(fs.readFileSync(a)).digest('hex');
    }
  };
  if (fs.existsSync(root)) visit(root, '');
  return out;
}

const root = () => new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
const presence = (purpose: 'mod.install' | 'mod.rollback' = 'mod.install') => mintTestPresence(purpose);
/** A mod.install token BOUND to the staged card's {cardId, contentHash} (T-2026-10-18-008). */
const bound = (home: string, name: string, cardId: string, decision: 'install' | 'deny' = 'install') =>
  mintTestPresence('mod.install', { bind: installPresenceBinding(cardId, readStaged(home, name, cardId)?.card.contentHash ?? 'none', decision) });
const rbBound = (name: string, to: string | undefined) => mintTestPresence('mod.rollback', { bind: rollbackPresenceBinding(name, to) });

/* ── validation ───────────────────────────────────────────────────────────── */

describe('#manifest-loader: manifest:v1 validation (§4.3, §12)', () => {
  it('accepts the §4.3 example mod and hashes it canonically (key order does not matter)', () => {
    const m = validateManifest(baseManifest(), { tier: 'local' });
    const reordered = JSON.parse(JSON.stringify({ requires: m.requires, provides: m.provides, name: m.name, publisher: m.publisher, kind: m.kind, manifest: 2, version: m.version, abi: m.abi }));
    // S0b: the canonical hash (format-1 rows, upgradedHash, distro marker) ignores key order; manifestHash is the RAW bytes
    expect(canonicalManifestHash(reordered)).toBe(canonicalManifestHash(m));
    expect(canonicalManifestHash(m)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(manifestHash(JSON.stringify(m))).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(manifestHash(JSON.stringify(reordered))).not.toBe(manifestHash(JSON.stringify(m)));
  });

  it.each([
    ['trust: field', { trust: 'first-party' }, 'SCHEMA'],
    ['source: field', { source: 'linked:/x' }, 'SCHEMA'],
    ['postinstall', { postinstall: 'curl evil' }, 'POSTINSTALL'],
    ['unknown key', { extra: 1 }, 'SCHEMA'],
    ['kind: mod without abi', { abi: undefined }, 'ABI'],
    ['unknown abi', { abi: 'mod-abi:v2' }, 'ABI'],
    ['kernel namespace name', { name: 'session' }, 'NAME'],
    ['kernel namespace name (modns)', { name: 'modns' }, 'NAME'],
    ['bad version', { version: 'latest' }, 'SCHEMA'],
  ])('refuses %s', (_label, over, code) => {
    const m = { ...baseManifest(), ...over } as Record<string, unknown>;
    for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
    expect(refusalOf(() => validateManifest(m, { tier: 'local' })).manifestCode).toBe(code);
  });

  it('kind: provider and kind: adapter are first-party only (A23-2, S25-H4); a provider ships only knowledge', () => {
    const provider = { manifest: 2, publisher: 'acme', kind: 'provider', name: 'lens-know', version: '1.0.0', provides: { knowledge: [{ name: 'lens', scheme: 'lens:', query: 'lens.search', maxTier: 'T3' }] }, requires: { capabilities: ['knowledge:provide'] } };
    expect(refusalOf(() => validateManifest(provider, { tier: 'local' })).manifestCode).toBe('TIER');
    expect(refusalOf(() => validateManifest(provider, { tier: `signed:gkey-p256:v1:${'a'.repeat(64)}` })).manifestCode).toBe('TIER');
    expect(validateManifest({ ...provider, publisher: 'gnomon' }, { tier: 'first-party' }).kind).toBe('provider');
    const adapter = { manifest: 2, publisher: 'acme', kind: 'adapter', name: 'local-adapter', version: '1.0.0' };
    expect(refusalOf(() => validateManifest(adapter, { tier: 'local' })).manifestCode).toBe('TIER');
    const fat = { ...provider, provides: { ...provider.provides, tools: [{ name: 'x.y', effects: ['read'] }] } };
    expect(refusalOf(() => validateManifest({ ...fat, publisher: 'gnomon' }, { tier: 'first-party' })).manifestCode).toBe('KNOWLEDGE');
  });

  it('provides.knowledge needs knowledge:provide and well-formed entries', () => {
    const m = baseManifest({ provides: { knowledge: [{ name: 'lens', scheme: 'lens:', query: 'lens.search', maxTier: 'T3' }] }, requires: { capabilities: [] } });
    expect(refusalOf(() => validateManifest(m, { tier: 'local' })).manifestCode).toBe('KNOWLEDGE');
    const ok = baseManifest({ provides: m.provides, requires: { capabilities: ['knowledge:provide'] } });
    expect(validateManifest(ok, { tier: 'local' }).provides!.knowledge).toHaveLength(1);
    const bad = baseManifest({ provides: { knowledge: [{ name: 'lens', scheme: 'lens', query: 'lens.search', maxTier: 'T3' }] }, requires: { capabilities: ['knowledge:provide'] } });
    expect(refusalOf(() => validateManifest(bad, { tier: 'local' })).manifestCode).toBe('SCHEMA');
  });

  it('Aegis M2: C0/ESC/C1 controls in mcp, hooks and commands strings are refused SCHEMA (they would reach install cards)', () => {
    for (const provides of [
      { mcp: [{ command: 'run\u001b]0;hidden\u0007', args: [] }] },
      { mcp: [{ command: 'run', args: ['a\u009db\u009c'] }] },
      { hooks: [{ event: 'Stop', command: 'echo\u009d hidden\u009c' }] },
      { commands: [{ id: 'lens.go', title: 'Go\u001b[2J' }] },
    ]) {
      expect(refusalOf(() => validateManifest(baseManifest({ provides }), { tier: 'local' })).manifestCode).toBe('SCHEMA');
    }
  });

  it('mod fields: effects, append-only card/status slots, modns events, reserved keys, command-bound keybindings', () => {
    const p = baseManifest().provides!;
    const cases: Array<[unknown, string]> = [
      [{ ...p, tools: [{ name: 'lens.diff', effects: ['exec'] }] }, 'SCHEMA'],
      [{ ...p, views: [{ id: 'v', slot: 'card.detail:install', placement: 'replace' }] }, 'SCHEMA'],
      [{ ...p, views: [{ id: 'v', slot: 'status.mod', placement: 'replace' }] }, 'SCHEMA'],
      [{ ...p, views: [{ id: 'v', slot: 'overlay', placement: 'append' }] }, 'SCHEMA'],
      [{ ...p, events: ['approval.request'] }, 'CAPABILITY'],
      [{ ...p, events: ['modns.acme.other.x'] }, 'CAPABILITY'],
      [{ ...p, keybindings: [{ key: 'y', command: 'lens.toggle' }] }, 'SCHEMA'],
      [{ ...p, keybindings: [{ key: 'Enter', command: 'lens.toggle' }] }, 'SCHEMA'],
      [{ ...p, keybindings: [{ key: '7', command: 'lens.toggle' }] }, 'SCHEMA'],
      [{ ...p, keybindings: [{ key: 'ctrl+k', command: 'not.declared' }] }, 'SCHEMA'],
    ];
    for (const [provides, code] of cases) expect(refusalOf(() => validateManifest(baseManifest({ provides } as Partial<ManifestV2>), { tier: 'local' })).manifestCode).toBe(code);
    expect(validateManifest(baseManifest({ provides: { ...p, views: [{ id: 'v', slot: 'card.detail:install', placement: 'append' }] } }), { tier: 'local' })).toBeTruthy();
  });

  it('capabilities: §15.4 forms only; first-party-only and grant-derived-only refused; log.append only on its own modns', () => {
    const caps = (c: string[], tier: 'local' | 'first-party' = 'local') => () => validateManifest(tier === 'first-party' ? fpManifest({ requires: { capabilities: c } }) : baseManifest({ requires: { capabilities: c } }), { tier });
    expect(refusalOf(caps(['approve'])).manifestCode).toBe('CAPABILITY');
    expect(refusalOf(caps(['band:write'])).manifestCode).toBe('CAPABILITY');
    expect(refusalOf(caps(['root.sign'])).manifestCode).toBe('CAPABILITY');
    expect(refusalOf(caps(['knowledge:federate'])).manifestCode).toBe('TIER');
    expect(refusalOf(caps(['link:send'])).manifestCode).toBe('TIER');
    expect(refusalOf(caps(['voice.approve:reversible'], 'first-party')).manifestCode).toBe('CAPABILITY');
    expect(refusalOf(caps(['log.append:approval.*'])).manifestCode).toBe('CAPABILITY');
    expect(caps(['knowledge:federate'], 'first-party')()).toBeTruthy();
    expect(caps(['log.read', 'hook:PreToolUse', 'resolver:lens', 'mod:read', 'turn.text:attached-session'])()).toBeTruthy();
  });
});

/* ── G-MAN-01 ─────────────────────────────────────────────────────────────── */

describe('G-MAN-01 egress refusals (Anthropic hosts refused in manifests and grants; never with knowledge)', () => {
  it.each(['api.anthropic.com', 'API.Anthropic.COM.', 'api.anthropic.com:443', 'anthropic.com', 'console.anthropic.com', 'claude.ai', 'x.claude.com', '*.anthropic.com', '*.com', '*'])(
    'G-MAN-01: manifest egress to %s is refused',
    (host) => {
      expect(isAnthropicHost(host)).toBe(true);
      const m = fpManifest({ requires: { capabilities: [], egress: [{ host, purpose: 'p' }] } });
      const r = refusalOf(() => validateManifest(m, { tier: 'first-party' }));
      expect(refusalOf(() => validateManifest(baseManifest({ requires: { capabilities: [], egress: [{ host, purpose: 'p' }] } }), { tier: 'local' })).manifestCode).toBe('EGRESS');
      expect(r.manifestCode).toBe('EGRESS');
      expect(r.refusal.code).toBe('FORBIDDEN');
    },
  );

  it('G-MAN-01: look-alikes are not Anthropic; malformed hosts are refused as not-a-host', () => {
    for (const h of ['notanthropic.com', 'anthropic.com.evil.io', 'claude.aix', 'api.github.com', '*.github.com']) expect(isAnthropicHost(h), h).toBe(false);
    for (const h of ['', 'https://example.com', 'a b', 'user@host', 'a.*.com']) expect(checkEgressHost(h).ok, h).toBe(false);
    expect(validateManifest(baseManifest({ requires: { capabilities: [], egress: [{ host: 'api.github.com', purpose: 'PR status' }] } }), { tier: 'local' })).toBeTruthy();
  });

  it.each([
    ['127.0.0.1', 'numeric'],
    ['10.0.0.1', 'numeric'],
    ['0x7f000001', 'numeric'],
    ['2130706433', 'numeric'],
    ['localhost', 'private-name'],
    ['foo.localhost', 'private-name'],
    ['printer.local', 'private-name'],
    ['db.internal', 'private-name'],
    ['intranet', 'single-label'],
    ['api.github.com:8443', 'port'],
  ])('G-MAN-01: egress host %s is refused (%s, Aegis F8)', (host, why) => {
    const v = checkEgressHost(host);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.why).toBe(why);
    expect(refusalOf(() => validateManifest(baseManifest({ requires: { capabilities: [], egress: [{ host, purpose: 'p' }] } }), { tier: 'local' })).manifestCode).toBe('EGRESS');
    expect(refusalOf(() => appendGrantRow(tmp(), root(), { kind: 'grant.egress', manifestHash: `sha256:${'4'.repeat(64)}`, hosts: [host] })).manifestCode).toBe('EGRESS');
  });

  it('G-MAN-01: a manifest with provides.knowledge and an egress list is refused', () => {
    const m = baseManifest({ provides: { knowledge: [{ name: 'lens', scheme: 'lens:', query: 'lens.search', maxTier: 'T3' }] }, requires: { capabilities: ['knowledge:provide'], egress: [{ host: 'api.github.com', purpose: 'p' }] } });
    expect(refusalOf(() => validateManifest(m, { tier: 'local' })).manifestCode).toBe('EGRESS');
  });

  it('G-MAN-01: grant.egress naming an Anthropic host is refused before signing, and a forged signed row never resolves', () => {
    const home = tmp();
    const auth = root();
    const mh = `sha256:${'1'.repeat(64)}`;
    expect(refusalOf(() => appendGrantRow(home, auth, { kind: 'grant.egress', manifestHash: mh, hosts: ['api.anthropic.com'] })).manifestCode).toBe('EGRESS');
    expect(fs.existsSync(grantsPath(home))).toBe(false);
    // a row signed by the root but naming Anthropic (bypassing the writer): the reader rejects it
    const row = { schemaVersion: 'grantRow:v1', kind: 'grant.egress', createdAt: new Date().toISOString(), manifestHash: mh, hosts: ['*.anthropic.com'] };
    fs.writeFileSync(grantsPath(home), `${JSON.stringify({ row, ...auth.signRow(row) })}\n`);
    const g = readGrants(home, auth);
    expect(g.egress.size).toBe(0);
    expect(g.rejected).toEqual([{ line: 1, reason: 'egress-anthropic' }]);
  });

  it('G-MAN-01: egress is never granted together with knowledge:provide (writer refuses, reader drops a forged pairing)', () => {
    const home = tmp();
    const auth = root();
    const mh = `sha256:${'2'.repeat(64)}`;
    appendGrantRow(home, auth, { kind: 'grant.capability', manifestHash: mh, capabilities: ['knowledge:provide'], read: ['/docs'] });
    expect(refusalOf(() => appendGrantRow(home, auth, { kind: 'grant.egress', manifestHash: mh, hosts: ['api.github.com'] })).manifestCode).toBe('EGRESS');
    const row = { schemaVersion: 'grantRow:v1', kind: 'grant.egress', createdAt: new Date().toISOString(), manifestHash: mh, hosts: ['api.github.com'] };
    fs.appendFileSync(grantsPath(home), `${JSON.stringify({ row, ...auth.signRow(row) })}\n`);
    const g = readGrants(home, auth);
    expect(g.egress.has(mh)).toBe(false);
    expect(g.rejected.map((r) => r.reason)).toEqual(['egress-with-knowledge']);
  });

  it('grants are fail-closed: unsigned, foreign-signed, malformed and unknown-kind rows never resolve; production cannot sign', () => {
    const home = tmp();
    const auth = root();
    const other = root();
    const ok = { schemaVersion: 'grantRow:v1', kind: 'grant.trust', createdAt: 'x', manifestHash: `sha256:${'3'.repeat(64)}`, tier: 'local' };
    const unknown = { ...ok, kind: 'grant.everything' };
    fs.writeFileSync(
      grantsPath(home),
      ['not json', JSON.stringify({ row: ok }), JSON.stringify({ row: ok, ...other.signRow(ok) }), JSON.stringify({ row: unknown, ...auth.signRow(unknown) }), JSON.stringify({ row: ok, ...auth.signRow(ok) })].join('\n'),
    );
    const g = readGrants(home, auth);
    expect(g.rejected.map((r) => r.reason)).toEqual(['malformed', 'unsigned', 'untrusted-signer', 'kind']);
    expect(g.trust.size).toBe(1);
    expect(readGrants(home, new UnprovisionedRootAuthority()).trust.size).toBe(0);
    expect(() => appendGrantRow(tmp(), new UnprovisionedRootAuthority(), { kind: 'grant.trust', manifestHash: ok.manifestHash, tier: 'local' })).toThrow(/M1\.3/);
  });
});

/* ── snapshot copier ──────────────────────────────────────────────────────── */

describe('#manifest-loader: the snapshot copier and packageHash (§12.5, §16)', () => {
  const stage = (home: string, src: string, ev = events()) =>
    stageInstall({ home, source: src, via: 'linked', requestedBy: AGENT, trust: root(), emit: ev.emit });

  it('packageHash is over the copy, excludes .git unread, and is stable across copies', () => {
    const src = writeMod(path.join(tmp(), 'diff-lens'), baseManifest(), { 'dist/index.js': 'export {}\n', '.git/config': '[core]\n' });
    const h1 = tmp();
    const h2 = tmp();
    const a = stage(h1, src);
    const b = stage(h2, src);
    if (a.state !== 'staged' || b.state !== 'staged') throw new Error('expected staged');
    expect(a.record.detail.packageHash).toBe(b.record.detail.packageHash);
    const dir = pinnedDir(h1, 'acme.diff-lens', a.record.detail.packageHash);
    expect(fs.existsSync(path.join(dir, 'dist', 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(false);
    fs.writeFileSync(path.join(src, '.git', 'config'), '[core]\nchanged\n');
    const c = stage(tmp(), src);
    expect(c.state === 'staged' && c.record.detail.packageHash).toBe(a.record.detail.packageHash);
  });

  it.each<[string, (src: string) => void, string]>([
    ['a junction / directory link', (src) => fs.symlinkSync(path.join(src, '..'), path.join(src, 'up'), 'junction'), 'symlink'],
    ['a hardlinked file (nlink > 1)', (src) => fs.linkSync(path.join(src, MANIFEST_FILE), path.join(src, 'twin.json')), 'hardlink'],
    ['a .node native addon', (src) => fs.writeFileSync(path.join(src, 'addon.NODE'), 'x'), 'native-addon'],
  ])('the copier refuses %s (mod.snapshot.refused + manifest.refuse{SNAPSHOT}, no card)', (_label, plant, reason) => {
    const src = writeMod(path.join(tmp(), 'diff-lens'), baseManifest());
    plant(src);
    const home = tmp();
    const ev = events();
    const r = refusalOf(() => stage(home, src, ev));
    expect(r.manifestCode).toBe('SNAPSHOT');
    expect(r.detail.snapshotReason).toBe(reason);
    expect(ev.kinds()).toEqual(['mod.snapshot.refused', 'manifest.refuse']);
    expect(ev.seen[0]!.payload).toMatchObject({ name: 'acme.diff-lens', reason });
    expect(fs.existsSync(path.join(home, 'mods', 'acme.diff-lens', 'staged'))).toBe(false);
  });

  it('the copier refuses a case collision (two keys that fold to one path)', async () => {
    const { computePackageHash } = await import('../src/kernel/manifest/snapshot.js');
    // A case collision can only be planted on a case-sensitive filesystem (Linux CI); on a case-insensitive one
    // (default macOS, Windows) `Docs` aliases `docs`, which is exactly why the copier refuses the pair elsewhere.
    const src = writeMod(path.join(tmp(), 'diff-lens'), baseManifest(), { 'docs/readme.md': '1' });
    let collided = false;
    try {
      fs.mkdirSync(path.join(src, 'Docs'));
      collided = true; // case-sensitive FS: `Docs` and `docs` coexist
    } catch {
      collided = false; // case-insensitive FS: the second mkdir aliases the first — the collision cannot be planted
    }
    if (collided) {
      fs.writeFileSync(path.join(src, 'Docs', 'readme.md'), '2');
      const r = refusalOf(() => stage(tmp(), src));
      expect(r.detail.snapshotReason).toBe('case-collision');
    }
    expect(computePackageHash([{ path: 'b', sha256: 'x', size: 1 }, { path: 'a', sha256: 'y', size: 1 }])).toBe(
      computePackageHash([{ path: 'a', sha256: 'y', size: 1 }, { path: 'b', sha256: 'x', size: 1 }]),
    );
  });

  it('the copier refuses a file symlink and a fifo where the platform can create them, and a walk→read inode swap', () => {
    const src = writeMod(path.join(tmp(), 'diff-lens'), baseManifest());
    let made = true;
    try {
      fs.symlinkSync(path.join(src, MANIFEST_FILE), path.join(src, 'alias.json'), 'file');
    } catch {
      made = false; // no symlink privilege (stock Windows)
    }
    if (made) expect(refusalOf(() => stage(tmp(), src)).detail.snapshotReason).toBe('symlink');
    const f = writeMod(path.join(tmp(), 'diff-lens'), baseManifest());
    const mk = spawnSync('mkfifo', [path.join(f, 'pipe')]);
    // Capability is what the filesystem made, not mkfifo's exit code: Git for
    // Windows ships an MSYS mkfifo that exits 0 and leaves a REGULAR file on
    // NTFS (no fifo exists to refuse, and a regular file is rightly copied).
    // MSYS mkfifo on Windows exits 0 and makes a plain file or nothing at all: judge by what exists
    if (mk.status === 0 && fs.lstatSync(path.join(f, 'pipe'), { throwIfNoEntry: false })?.isFIFO()) expect(refusalOf(() => stage(tmp(), f)).detail.snapshotReason).toBe('special-file');
    // inode swap between the walk and the read
    const w = writeMod(path.join(tmp(), 'diff-lens'), baseManifest(), { 'a.js': 'one' });
    const entries = walkSource(w, 'acme.diff-lens', () => undefined);
    const e = entries.find((x) => x.rel === 'a.js')!;
    fs.writeFileSync(path.join(w, 'b.js'), 'evil');
    fs.renameSync(path.join(w, 'b.js'), path.join(w, 'a.js'));
    expect(refusalOf(() => readChecked(e, 'acme.diff-lens', () => undefined)).detail.snapshotReason).toBe('changed-during-copy');
  });

  it('tier is derived, never asserted: a linked folder is local, a signature without a trusted key is refused (Aegis F4)', () => {
    const src = writeMod(path.join(tmp(), 'diff-lens'), baseManifest());
    const st = stage(tmp(), src);
    expect(st.state === 'staged' && st.record.detail.tier).toBe('local');
    const r = refusalOf(() => stageInstall({ home: tmp(), source: src, via: 'package', requestedBy: AGENT, trust: root(), signature: { keyId: `gkey-p256:v1:${'a'.repeat(64)}`, sig: 'x' } }));
    expect(r.manifestCode).toBe('TIER');
    const prov = writeMod(path.join(tmp(), 'lens-know'), { manifest: 2, publisher: 'acme', kind: 'provider', name: 'lens-know', version: '1.0.0', provides: { knowledge: [{ name: 'lens', scheme: 'lens:', query: 'lens.search', maxTier: 'T3' }] }, requires: { capabilities: ['knowledge:provide'] } });
    expect(refusalOf(() => stageInstall({ home: tmp(), source: prov, via: 'package', requestedBy: AGENT, trust: root() })).manifestCode).toBe('TIER');
  });

  it('lockfile rule: node_modules needs an npm lockfile, and the card lists every package@version', () => {
    const src = writeMod(path.join(tmp(), 'diff-lens'), baseManifest(), { 'node_modules/left-pad/index.js': 'module.exports=1\n', 'node_modules/left-pad/package.json': '{"version":"1.3.0"}' });
    expect(refusalOf(() => stage(tmp(), src)).manifestCode).toBe('LOCKFILE');
    fs.writeFileSync(path.join(src, 'yarn.lock'), '# yarn\n');
    expect(refusalOf(() => stage(tmp(), src)).detail.lockfile).toBe('yarn.lock');
    fs.writeFileSync(
      path.join(src, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'diff-lens' }, 'node_modules/left-pad': { version: '1.3.0' }, 'node_modules/a/node_modules/b': { version: '2.0.0' } } }),
    );
    const st = stage(tmp(), src);
    expect(st.state === 'staged' && st.record.detail.packages).toEqual(['b@2.0.0', 'left-pad@1.3.0']);
    // shipped version ≠ lockfile version
    fs.writeFileSync(path.join(src, 'node_modules', 'left-pad', 'package.json'), '{"version":"9.9.9"}');
    expect(refusalOf(() => stage(tmp(), src)).detail.why).toBe('version-mismatch');
    fs.writeFileSync(path.join(src, 'node_modules', 'left-pad', 'package.json'), '{"version":"1.3.0"}');
    // a shipped package the lockfile does not list
    writeMod(src, baseManifest(), { 'node_modules/sneaky/index.js': 'x', 'node_modules/sneaky/package.json': '{"version":"1.0.0"}' });
    expect(refusalOf(() => stage(tmp(), src)).detail.why).toBe('not-in-lockfile');
  });

  it('lockfile rule is case-folded and applies at any depth (Aegis F11)', () => {
    const a = writeMod(path.join(tmp(), 'diff-lens'), baseManifest(), { 'Node_Modules/x/index.js': 'x' });
    expect(refusalOf(() => stage(tmp(), a)).detail.why).toBe('node_modules-case');
    const b = writeMod(path.join(tmp(), 'diff-lens'), baseManifest(), { 'vendor/node_modules/x/index.js': 'x', 'vendor/node_modules/x/package.json': '{"version":"1.0.0"}' });
    const r = refusalOf(() => stage(tmp(), b));
    expect(r.manifestCode).toBe('LOCKFILE');
    expect(r.detail.path).toBe('vendor/node_modules');
    fs.writeFileSync(path.join(b, 'vendor', 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/x': { version: '1.0.0' } } }));
    const st = stage(tmp(), b);
    expect(st.state === 'staged' && st.record.detail.packages).toEqual(['vendor:x@1.0.0']);
  });

  it('no postinstall anywhere: package.json lifecycle install scripts are refused', () => {
    const src = writeMod(path.join(tmp(), 'diff-lens'), baseManifest(), { 'package.json': JSON.stringify({ name: 'x', scripts: { postinstall: 'node evil.js' } }) });
    const r = refusalOf(() => stage(tmp(), src));
    expect(r.manifestCode).toBe('POSTINSTALL');
    expect(r.detail.scripts).toEqual(['postinstall']);
  });
});

/* ── G-MAN-02 ─────────────────────────────────────────────────────────────── */

describe('G-MAN-02 an agent-written manifest needs a card (an install stages a pending card; nothing takes effect)', () => {
  it('G-MAN-02: staging writes a pending card:v1 record, signs no grant, and loadMod refuses until decided', () => {
    const home = tmp();
    const auth = root();
    const src = writeMod(path.join(tmp(), 'diff-lens'), baseManifest());
    const ev = events();
    const st = stageInstall({ home, source: src, via: 'package', requestedBy: AGENT, hsid: undefined, trust: auth, emit: ev.emit });
    if (st.state !== 'staged') throw new Error('expected staged');
    const { card, detail } = st.record;
    expect(validateCardV1(card, { mode: 'strict' })).toEqual([]);
    expect(card).toMatchObject({ kind: 'install', state: 'pending', requestedBy: AGENT, actions: [] });
    expect(detail).toMatchObject({ name: 'acme.diff-lens', source: 'package', tier: 'local', effects: ['read'], egress: [], replaces: null, stagedBy: AGENT });
    expect(ev.kinds()).toEqual(['manifest.staged']);
    expect(fs.existsSync(grantsPath(home))).toBe(false);
    expect(refusalOf(() => loadMod({ home, name: 'acme.diff-lens', trust: auth })).manifestCode).toBe('NOT_INSTALLED');
    // re-staging the same bytes raises no second card
    const again = stageInstall({ home, source: src, via: 'package', requestedBy: AGENT, trust: auth });
    expect(again.state === 'staged' && again.cardId).toBe(st.cardId);
  });

  it('G-MAN-02: the decision needs presence for mod.install and a root that can sign (production refuses, M1.3)', () => {
    const home = tmp();
    const auth = root();
    const src = writeMod(path.join(tmp(), 'diff-lens'), baseManifest());
    const st = stageInstall({ home, source: src, via: 'package', requestedBy: AGENT, trust: auth });
    if (st.state !== 'staged') throw new Error('expected staged');
    for (const bad of [undefined, 'presence', mintTestPresence('log.gap.acknowledge'), mintTestPresence('mod.rollback')]) {
      expect(refusalOf(() => decideInstallCard(home, 'acme.diff-lens', st.cardId, 'install', { presenceToken: bad, authority: auth })).manifestCode).toBe('GRANT');
    }
    expect(() => decideInstallCard(home, 'acme.diff-lens', st.cardId, 'install', { presenceToken: bound(home, 'acme.diff-lens', st.cardId), authority: new UnprovisionedRootAuthority() })).toThrow(/M1\.3/);
    expect(readGrants(home, auth).installs).toEqual([]);
    const ev = events();
    const decided = decideInstallCard(home, 'acme.diff-lens', st.cardId, 'install', { presenceToken: bound(home, 'acme.diff-lens', st.cardId), authority: auth, emit: ev.emit });
    expect(decided.card.state).toBe('decided');
    expect(ev.kinds()).toEqual(['manifest.installed', 'mod.installed']);
    const loaded = loadMod({ home, name: 'acme.diff-lens', trust: auth });
    expect(loaded.state).toBe('ready');
    expect(decideInstallCard(home, 'acme.diff-lens', st.cardId, 'install', { presenceToken: bound(home, 'acme.diff-lens', st.cardId), authority: auth }).card.state).toBe('decided'); // idempotent
    expect(refusalOf(() => decideInstallCard(home, 'acme.diff-lens', st.cardId, 'deny', { presenceToken: bound(home, 'acme.diff-lens', st.cardId, 'deny'), authority: auth })).manifestCode).toBe('NOT_INSTALLED');
  });

  it('decide trusts nothing in the staged record: bad cardId, name mismatch, tampered detail, stale and reused presence (Aegis F5/F6)', () => {
    const home = tmp();
    const auth = root();
    const st = stageInstall({ home, source: writeMod(path.join(tmp(), 'diff-lens'), baseManifest()), via: 'package', requestedBy: AGENT, trust: auth });
    if (st.state !== 'staged') throw new Error('expected staged');
    expect(refusalOf(() => decideInstallCard(home, 'acme.diff-lens', '../../x', 'install', { presenceToken: bound(home, 'acme.diff-lens', '../../x'), authority: auth })).manifestCode).toBe('SCHEMA');
    expect(refusalOf(() => decideInstallCard(home, 'acme.other-mod', st.cardId, 'install', { presenceToken: bound(home, 'acme.other-mod', st.cardId), authority: auth })).manifestCode).toBe('NOT_INSTALLED');
    const stale = mintTestPresence('mod.install', { ageMs: 61_000, bind: installPresenceBinding(st.cardId, readStaged(home, 'acme.diff-lens', st.cardId)!.card.contentHash, 'install') });
    expect(refusalOf(() => decideInstallCard(home, 'acme.diff-lens', st.cardId, 'install', { presenceToken: stale, authority: auth })).detail.presence).toBe('stale');
    // tamper: widen the staged detail and re-hash it (the card agrees with its detail but not with the snapshot)
    const file = path.join(home, 'mods', 'acme.diff-lens', 'staged', `${st.cardId.replace(':', '-')}.json`);
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    rec.detail.capabilities = [];
    fs.writeFileSync(file, JSON.stringify(rec));
    expect(refusalOf(() => decideInstallCard(home, 'acme.diff-lens', st.cardId, 'install', { presenceToken: bound(home, 'acme.diff-lens', st.cardId), authority: auth })).manifestCode).toBe('INTEGRITY');
    rec.card.contentHash = `sha256:${createHash('sha256').update(canonicalJson(rec.detail)).digest('hex')}`;
    fs.writeFileSync(file, JSON.stringify(rec));
    expect(refusalOf(() => decideInstallCard(home, 'acme.diff-lens', st.cardId, 'install', { presenceToken: bound(home, 'acme.diff-lens', st.cardId), authority: auth })).manifestCode).toBe('INTEGRITY');
    expect(readGrants(home, auth).installs).toEqual([]);
    // restore and decide; the token is single-use; a re-decide is idempotent and appends nothing
    fs.writeFileSync(file, `${JSON.stringify(st.record)}\n`);
    const tok = bound(home, 'acme.diff-lens', st.cardId);
    decideInstallCard(home, 'acme.diff-lens', st.cardId, 'install', { presenceToken: tok, authority: auth });
    expect(refusalOf(() => decideInstallCard(home, 'acme.diff-lens', st.cardId, 'install', { presenceToken: tok, authority: auth })).detail.presence).toBe('used');
    const rows = fs.readFileSync(grantsPath(home), 'utf8');
    expect(decideInstallCard(home, 'acme.diff-lens', st.cardId, 'install', { presenceToken: bound(home, 'acme.diff-lens', st.cardId), authority: auth }).card.state).toBe('decided');
    expect(fs.readFileSync(grantsPath(home), 'utf8')).toBe(rows);
    const lines = rows.trim().split('\n').map((l) => JSON.parse(l).row.kind);
    expect(lines[lines.length - 1]).toBe('grant.install');
  });

  it('a denied card grants nothing', () => {
    const home = tmp();
    const auth = root();
    const st = stageInstall({ home, source: writeMod(path.join(tmp(), 'diff-lens'), baseManifest()), via: 'package', requestedBy: AGENT, trust: auth });
    if (st.state !== 'staged') throw new Error('expected staged');
    decideInstallCard(home, 'acme.diff-lens', st.cardId, 'deny', { presenceToken: bound(home, 'acme.diff-lens', st.cardId, 'deny'), authority: auth });
    expect(readGrants(home, auth).installs).toEqual([]);
    expect(refusalOf(() => loadMod({ home, name: 'acme.diff-lens', trust: auth })).manifestCode).toBe('NOT_INSTALLED');
  });

  it('load re-checks integrity and grants: a tampered snapshot or an ungranted capability refuses', () => {
    const home = tmp();
    const auth = root();
    const m = baseManifest({ requires: { capabilities: ['log.append:modns.acme.diff-lens.*', 'log.read'], egress: [{ host: 'api.github.com', purpose: 'p' }] } });
    const st = stageInstall({ home, source: writeMod(path.join(tmp(), 'diff-lens'), m), via: 'package', requestedBy: AGENT, trust: auth });
    if (st.state !== 'staged') throw new Error('expected staged');
    decideInstallCard(home, 'acme.diff-lens', st.cardId, 'install', { presenceToken: bound(home, 'acme.diff-lens', st.cardId), authority: auth });
    expect(loadMod({ home, name: 'acme.diff-lens', trust: auth }).state).toBe('ready');
    const g = readGrants(home, auth);
    expect([...g.egress.get(st.record.detail.manifestHash)!]).toEqual(['api.github.com']);
    const dir = pinnedDir(home, 'acme.diff-lens', st.record.detail.packageHash);
    fs.chmodSync(dir, 0o700);
    fs.writeFileSync(path.join(dir, 'planted.js'), 'evil');
    expect(refusalOf(() => loadMod({ home, name: 'acme.diff-lens', trust: auth })).manifestCode).toBe('INTEGRITY');
  });
});

/* ── linked folders + widening ────────────────────────────────────────────── */

describe('#manifest-loader: linked folders — pin, pause, re-approve (§12.5) and manifest widening', () => {
  it('a change in a linked folder pauses the mod, stages a re-approve card with the file diff and the widening; the snapshot is unchanged', () => {
    const home = tmp();
    const auth = root();
    const src = writeMod(path.join(tmp(), 'diff-lens'), baseManifest(), { 'dist/view.js': 'v1\n' });
    const ev = events();
    const st = stageInstall({ home, source: src, via: 'linked', requestedBy: HUMAN, trust: auth, emit: ev.emit });
    if (st.state !== 'staged') throw new Error('expected staged');
    expect(st.record.detail.source).toBe(`linked:${fs.realpathSync.native(src)}`);
    decideInstallCard(home, 'acme.diff-lens', st.cardId, 'install', { presenceToken: bound(home, 'acme.diff-lens', st.cardId), authority: auth, emit: ev.emit });
    expect(ev.kinds()).toContain('mod.linked');
    expect(linkedFolders(home, auth)).toEqual([fs.realpathSync.native(src)]);
    const ready = loadMod({ home, name: 'acme.diff-lens', trust: auth });
    expect(ready.state).toBe('ready');

    // edit + widen: a new write tool
    fs.writeFileSync(path.join(src, 'dist', 'view.js'), 'v2\n');
    const wide = baseManifest();
    wide.provides!.tools!.push({ name: 'lens.write', effects: ['write'] });
    fs.writeFileSync(path.join(src, MANIFEST_FILE), JSON.stringify(wide, null, 2));
    const ev2 = events();
    const paused = loadMod({ home, name: 'acme.diff-lens', trust: auth, emit: ev2.emit });
    if (paused.state !== 'paused') throw new Error('expected paused');
    expect(paused.files.changed.map((f) => f.path).sort()).toEqual(['dist/view.js', MANIFEST_FILE].sort());
    expect(ev2.kinds()).toEqual(['mod.paused', 'manifest.widened', 'manifest.staged']);
    expect(ev2.seen[1]!.payload.fields).toEqual(['effects', 'tools']);
    expect(fs.readFileSync(path.join(paused.snapshotDir, 'dist', 'view.js'), 'utf8')).toBe('v1\n');
    const rec = readStaged(home, 'acme.diff-lens', paused.cardId!)!;
    expect(rec.detail.replaces?.packageHash).toBe(st.record.detail.packageHash);
    expect(rec.card.block.children).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('WIDENED') })]));
    // still paused on the next load, and no second card
    const again = loadMod({ home, name: 'acme.diff-lens', trust: auth });
    expect(again.state === 'paused' && again.cardId).toBe(paused.cardId);
    // approving re-pins; the old snapshot is kept for rollback
    decideInstallCard(home, 'acme.diff-lens', paused.cardId!, 'install', { presenceToken: bound(home, 'acme.diff-lens', paused.cardId!), authority: auth });
    const now = loadMod({ home, name: 'acme.diff-lens', trust: auth });
    expect(now.state === 'ready' && now.packageHash).toBe(rec.detail.packageHash);
    expect(fs.existsSync(pinnedDir(home, 'acme.diff-lens', st.record.detail.packageHash))).toBe(true);
  });

  it('an added hook or MCP server is a widening and shows a WIDENED line on the re-approve card (Aegis F3)', () => {
    const home = tmp();
    const auth = root();
    const src = writeMod(path.join(tmp(), 'diff-lens'), baseManifest());
    const st = stageInstall({ home, source: src, via: 'linked', requestedBy: HUMAN, trust: auth });
    if (st.state !== 'staged') throw new Error('staged');
    decideInstallCard(home, 'acme.diff-lens', st.cardId, 'install', { presenceToken: bound(home, 'acme.diff-lens', st.cardId), authority: auth });
    const m = baseManifest();
    m.provides!.hooks = [{ event: 'PreToolUse', command: 'node steal.js' }];
    m.provides!.mcp = [{ command: 'node', args: ['srv.js'] }];
    fs.writeFileSync(path.join(src, MANIFEST_FILE), JSON.stringify(m));
    const ev = events();
    const paused = loadMod({ home, name: 'acme.diff-lens', trust: auth, emit: ev.emit });
    if (paused.state !== 'paused') throw new Error('paused');
    expect(ev.seen.find((e) => e.kind === 'manifest.widened')!.payload.fields).toEqual(['mcp', 'hooks']);
    const rec = readStaged(home, 'acme.diff-lens', paused.cardId!)!;
    const texts = (rec.card.block.children as Array<{ text: string }>).map((c) => c.text);
    expect(texts.find((t) => t.startsWith('WIDENED'))).toMatch(/hooks \+.*PreToolUse.*steal\.js/);
    expect(texts.some((t) => t.includes('hooks: PreToolUse: node steal.js'))).toBe(true);
    expect(rec.detail.mcp).toEqual(['gm_acme_diff-lens: node srv.js']); // S0b: the kernel derives the server name
  });

  it('detectWidening reports additions by field and ignores removals', () => {
    const a = baseManifest();
    const b = baseManifest({ requires: { capabilities: ['log.append:modns.acme.diff-lens.*', 'log.read'], egress: [{ host: 'api.github.com', purpose: 'p' }] } });
    b.provides!.keybindings!.push({ key: 'ctrl+x', command: 'lens.toggle' });
    b.provides!.events!.push('modns.acme.diff-lens.more');
    expect(detectWidening(a, b).map((w) => w.field)).toEqual(['egress', 'capabilities', 'events', 'keybindings']);
    expect(detectWidening(b, a)).toEqual([]);
    expect(detectWidening(null, a).map((w) => w.field)).toEqual(['effects', 'capabilities', 'events', 'tools', 'views', 'commands', 'keybindings']);
  });
});

/* ── G-MAN-03 ─────────────────────────────────────────────────────────────── */

describe('G-MAN-03 rollback restores the previous hash', () => {
  it('G-MAN-03: rollback re-pins the previously approved snapshot (human-only: presence + root), and the bytes load again', () => {
    const home = tmp();
    const auth = root();
    const src = writeMod(path.join(tmp(), 'diff-lens'), baseManifest(), { 'dist/index.js': 'one\n' });
    const s1 = stageInstall({ home, source: src, via: 'package', requestedBy: HUMAN, trust: auth });
    if (s1.state !== 'staged') throw new Error('staged');
    decideInstallCard(home, 'acme.diff-lens', s1.cardId, 'install', { presenceToken: bound(home, 'acme.diff-lens', s1.cardId), authority: auth });
    fs.writeFileSync(path.join(src, 'dist', 'index.js'), 'two\n');
    const s2 = stageInstall({ home, source: src, via: 'package', requestedBy: HUMAN, trust: auth });
    if (s2.state !== 'staged') throw new Error('staged');
    decideInstallCard(home, 'acme.diff-lens', s2.cardId, 'install', { presenceToken: bound(home, 'acme.diff-lens', s2.cardId), authority: auth });
    const h1 = s1.record.detail.packageHash;
    const h2 = s2.record.detail.packageHash;
    expect(h1).not.toBe(h2);
    expect((loadMod({ home, name: 'acme.diff-lens', trust: auth }) as { packageHash: string }).packageHash).toBe(h2);

    expect(refusalOf(() => rollbackModSnapshot(home, 'acme.diff-lens', undefined, { presenceToken: presence('mod.install'), authority: auth })).manifestCode).toBe('GRANT');
    expect(refusalOf(() => rollbackModSnapshot(home, 'acme.diff-lens', undefined, { presenceToken: mintTestPresence('mod.rollback', { ageMs: 61_000, bind: rollbackPresenceBinding('acme.diff-lens', undefined) }), authority: auth })).detail.presence).toBe('stale');
    // production (no root): the grant table resolves nothing and nothing can be signed — refused, the pin unchanged
    expect(() => rollbackModSnapshot(home, 'acme.diff-lens', undefined, { presenceToken: rbBound('acme.diff-lens', undefined), authority: new UnprovisionedRootAuthority() })).toThrow(ManifestRefusal);
    expect((loadMod({ home, name: 'acme.diff-lens', trust: auth }) as { packageHash: string }).packageHash).toBe(h2);
    const ev = events();
    const rbTok = rbBound('acme.diff-lens', undefined);
    const row = rollbackModSnapshot(home, 'acme.diff-lens', undefined, { presenceToken: rbTok, authority: auth, emit: ev.emit });
    expect(refusalOf(() => rollbackModSnapshot(home, 'acme.diff-lens', undefined, { presenceToken: rbTok, authority: auth })).detail.presence).toBe('used');
    expect(row.packageHash).toBe(h1);
    expect(ev.seen).toEqual([{ kind: 'mod.rolled-back', payload: { name: 'acme.diff-lens', toPackageHash: h1 } }]);
    const back = loadMod({ home, name: 'acme.diff-lens', trust: auth });
    if (back.state !== 'ready') throw new Error('ready');
    expect(back.packageHash).toBe(h1);
    expect(fs.readFileSync(path.join(back.snapshotDir, 'dist', 'index.js'), 'utf8')).toBe('one\n');
    // explicit target, and never to an unapproved snapshot
    expect(rollbackModSnapshot(home, 'acme.diff-lens', h2, { presenceToken: rbBound('acme.diff-lens', h2), authority: auth }).packageHash).toBe(h2);
    expect(refusalOf(() => rollbackModSnapshot(home, 'acme.diff-lens', `sha256:${'9'.repeat(64)}`, { presenceToken: rbBound('acme.diff-lens', `sha256:${'9'.repeat(64)}`), authority: auth })).manifestCode).toBe('NOT_INSTALLED');
  });
});

/* ── G-HON-04 + G-LAW-04 ──────────────────────────────────────────────────── */

describe('G-HON-04 / G-LAW-04 generated files: fixed point and exact uninstall (law 4)', () => {
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const distro = (): ManifestV2 => ({
    manifest: 2,
    publisher: 'gnomon',
    kind: 'distro',
    name: 'paradigm-distro',
    version: '8.0.0',
    description: 'test distro',
    provides: { mcp: [{ command: 'paradigm-mcp', args: ['.'] }], hooks: [{ event: 'Stop', command: 'gnomon hook stop' }, { event: 'PreToolUse', command: 'gnomon hook pre' }] },
  });

  function fixture() {
    const repo = tmp('gnomon-repo-');
    fs.writeFileSync(path.join(repo, 'README.md'), '# repo\r\n');
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export {}\n');
    // HOME / USERPROFILE point at a fixture home, so anything that reached for os.homedir()/.claude lands in `claude`
    const fakeHome = tmp('gnomon-userhome-');
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    expect(os.homedir()).toBe(fakeHome);
    const claude = path.join(fakeHome, '.claude');
    fs.mkdirSync(claude);
    fs.writeFileSync(path.join(fakeHome, '.claude.json'), '{"mcpServers":{}}\n');
    fs.writeFileSync(path.join(claude, 'settings.json'), '{"x":1}\n');
    fs.mkdirSync(path.join(claude, 'skills'));
    fs.writeFileSync(path.join(claude, 'skills', 's.md'), 's');
    const home = tmp('gnomon-home-');
    return { repo, claude, home };
  }

  it('G-HON-04: manifest generation is a fixed point (regenerating writes nothing, bytes identical)', () => {
    const { repo, home } = fixture();
    const first = generateRepo(repo, validateManifest(distro(), { tier: 'first-party' }), { home });
    expect(first.written).toEqual(expect.arrayContaining(['.gnomon/generated/plugin.json', '.gnomon/generated/.mcp.json', '.gnomon/generated/hooks.json', '.gnomon/.gitignore', '.gnomon/project.yaml']));
    const before = treeBytes(repo);
    const second = generateRepo(repo, distro(), { home });
    expect(second.written).toEqual([]);
    expect(treeBytes(repo)).toEqual(before);
    const mcp = JSON.parse(fs.readFileSync(path.join(repo, '.gnomon', 'generated', '.mcp.json'), 'utf8'));
    expect(mcp._gnomon).toEqual({ generatedBy: 'gnomon', manifestHash: canonicalManifestHash(distro()), doNotEdit: true });
    expect(mcp.mcpServers['gm_gnomon_paradigm-distro']).toEqual({ command: 'paradigm-mcp', args: ['.'] });
  });

  it('G-HON-04: install → uninstall leaves ~/.claude and the repo byte-identical (no project.yaml written)', () => {
    const { repo, claude, home } = fixture();
    const repoBefore = treeBytes(repo);
    const claudeBefore = treeBytes(path.dirname(claude));
    generateRepo(repo, distro(), { home, writeProjectYaml: false });
    expect(treeBytes(path.dirname(claude))).toEqual(claudeBefore);
    const rep = uninstallRepo(repo, { home });
    expect(rep.keptEdited).toEqual([]);
    expect(treeBytes(repo)).toEqual(repoBefore);
    expect(treeBytes(path.dirname(claude))).toEqual(claudeBefore);
  });

  it('G-LAW-04 falsifier "install→uninstall diff non-empty": repo clean except the committed project.yaml, ~/.claude byte-identical, ~/.gnomon removed or its export path returned', () => {
    const { repo, claude, home } = fixture();
    const auth = root();
    const repoBefore = treeBytes(repo);
    const claudeBefore = treeBytes(path.dirname(claude));
    // install: generated files + a staged and approved mod in the home dir
    const ev = events();
    generateRepo(repo, distro(), { home, emit: ev.emit });
    const st = stageInstall({ home, source: writeMod(path.join(tmp(), 'diff-lens'), baseManifest()), via: 'package', requestedBy: HUMAN, trust: auth });
    if (st.state !== 'staged') throw new Error('staged');
    decideInstallCard(home, 'acme.diff-lens', st.cardId, 'install', { presenceToken: bound(home, 'acme.diff-lens', st.cardId), authority: auth });
    // uninstall
    uninstallRepo(repo, { home, emit: ev.emit });
    const after = treeBytes(repo);
    const diff = Object.keys({ ...repoBefore, ...after }).filter((k) => repoBefore[k] !== after[k]).sort();
    expect(diff).toEqual(['.gnomon/', '.gnomon/project.yaml']);
    expect(treeBytes(path.dirname(claude))).toEqual(claudeBefore);
    expect(uninstallHome(home, { mode: 'keep' })).toEqual({ removed: false, exportPath: home });
    expect(fs.existsSync(home)).toBe(true);
    expect(uninstallHome(home, { mode: 'remove' }).removed).toBe(true);
    expect(fs.existsSync(home)).toBe(false);
    tmps.splice(tmps.indexOf(home), 1);
    expect(ev.kinds()).toEqual(['manifest.generate', 'manifest.uninstall']);
  });

  it.todo('G-LAW-04: install → ONE SESSION → uninstall on macOS and Windows (the session leg needs #session-runner, M1.7)');

  it('uninstall never deletes a user-edited generated file; generate never overwrites a file that is not ours', () => {
    const { repo, home } = fixture();
    generateRepo(repo, distro(), { home });
    const hooks = path.join(repo, '.gnomon', 'generated', 'hooks.json');
    fs.writeFileSync(hooks, '{"mine":true}\n');
    expect(refusalOf(() => generateRepo(repo, distro(), { home })).manifestCode).toBe('GENERATED');
    const rep = uninstallRepo(repo, { home });
    expect(rep.keptEdited).toEqual(['.gnomon/generated/hooks.json']);
    expect(fs.readFileSync(hooks, 'utf8')).toBe('{"mine":true}\n');
    const fresh = tmp('gnomon-repo-');
    fs.mkdirSync(path.join(fresh, '.gnomon', 'generated'), { recursive: true });
    fs.writeFileSync(path.join(fresh, '.gnomon', 'generated', 'plugin.json'), '{}');
    expect(refusalOf(() => generateRepo(fresh, distro(), { home })).manifestCode).toBe('GENERATED');
    // a marker-bearing file the kernel never recorded is not ours either (the repo is not an ownership anchor)
    const forged = tmp('gnomon-repo-');
    fs.mkdirSync(path.join(forged, '.gnomon', 'generated'), { recursive: true });
    fs.writeFileSync(path.join(forged, '.gnomon', 'generated', 'plugin.json'), renderGenerated(distro()).get('.gnomon/generated/plugin.json')!);
    expect(refusalOf(() => generateRepo(forged, distro(), { home })).manifestCode).toBe('GENERATED');
  });

  it('confinement: a recorded ../ path is never touched; a planted .gnomon/generated link and a dangling file link to ~/.claude are refused', () => {
    const { repo, home, claude } = fixture();
    generateRepo(repo, distro(), { home });
    const outside = path.join(path.dirname(repo), `victim-${path.basename(repo)}.txt`);
    fs.writeFileSync(outside, 'keep me');
    tmps.push(outside);
    const rp = recordPath(home, repo);
    const rec = JSON.parse(fs.readFileSync(rp, 'utf8'));
    const victimSha = createHash('sha256').update('keep me').digest('hex');
    rec.files.push({ path: `../${path.basename(outside)}`, sha256: victimSha });
    rec.createdDirs.push('..');
    fs.writeFileSync(rp, JSON.stringify(rec));
    const u = uninstallRepo(repo, { home });
    expect(u.ignored).toEqual([`../${path.basename(outside)}`, '..']);
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep me');

    // planted directory link: .gnomon/generated → ~/.claude
    const r2 = tmp('gnomon-repo-');
    fs.mkdirSync(path.join(r2, '.gnomon'));
    fs.symlinkSync(claude, path.join(r2, '.gnomon', 'generated'), 'junction');
    const before = treeBytes(claude);
    expect(refusalOf(() => generateRepo(r2, distro(), { home })).detail.why).toMatch(/symlink or junction/);
    expect(treeBytes(claude)).toEqual(before);

    // dangling file link: .gnomon/generated/hooks.json → ~/.claude/settings.local.json (privileged on Windows: skipped there)
    const r3 = tmp('gnomon-repo-');
    fs.mkdirSync(path.join(r3, '.gnomon', 'generated'), { recursive: true });
    let linked = true;
    try {
      fs.symlinkSync(path.join(claude, 'settings.local.json'), path.join(r3, '.gnomon', 'generated', 'hooks.json'), 'file');
    } catch {
      linked = false; // no symlink privilege (stock Windows): the junction case above covers the class
    }
    if (linked) {
      expect(refusalOf(() => generateRepo(r3, distro(), { home })).detail.why).toMatch(/symlink or junction/);
      expect(fs.existsSync(path.join(claude, 'settings.local.json'))).toBe(false);
    }
  });
});

/* ── G-WIN-04 ─────────────────────────────────────────────────────────────── */

describe('G-WIN-04 layersHash / gitHash normalise CRLF and path case', () => {
  it('G-WIN-04: the digest ignores CRLF vs LF and path case, and still sees a content change or a removal', () => {
    const lf = digestInputs('t', [{ key: 'project:.claude/settings.json', bytes: Buffer.from('{\n"a":1\n}\n') }, { key: 'project:CLAUDE.md', bytes: Buffer.from('hi\n') }]);
    const crlf = digestInputs('t', [{ key: 'project:CLAUDE.md', bytes: Buffer.from('hi\r\n') }, { key: 'PROJECT:.Claude\\Settings.json', bytes: Buffer.from('{\r\n"a":1\r\n}\r\n') }]);
    expect(crlf).toBe(lf);
    expect(digestInputs('t', [{ key: 'project:CLAUDE.md', bytes: Buffer.from('hi!\n') }, { key: 'project:.claude/settings.json', bytes: Buffer.from('{\n"a":1\n}\n') }])).not.toBe(lf);
    expect(digestInputs('t', [{ key: 'project:CLAUDE.md', bytes: null }, { key: 'project:.claude/settings.json', bytes: Buffer.from('{\n"a":1\n}\n') }])).not.toBe(lf);
    // two keys folding to one are both kept, order-independent
    const x = digestInputs('t', [{ key: 'p:A', bytes: Buffer.from('1') }, { key: 'p:a', bytes: Buffer.from('2') }]);
    expect(digestInputs('t', [{ key: 'p:a', bytes: Buffer.from('2') }, { key: 'p:A', bytes: Buffer.from('1') }])).toBe(x);
  });

  function layerTree(eol: string, upper: boolean) {
    // only names the code ENUMERATES (readdir) vary in case; fixed names (.claude, CLAUDE.md, config) stay as spelled,
    // so the test holds on case-sensitive filesystems too (Ubuntu CI)
    const cwd = tmp('gnomon-proj-');
    const user = path.join(tmp('gnomon-user-'), '.claude');
    fs.mkdirSync(user);
    const d = '.claude';
    fs.mkdirSync(path.join(cwd, d));
    fs.writeFileSync(path.join(cwd, d, upper ? 'Settings.json' : 'settings.json'), `{${eol}"x":1${eol}}${eol}`);
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), `rules${eol}`);
    fs.writeFileSync(path.join(user, upper ? 'Settings.json' : 'settings.json'), `{}${eol}`);
    fs.writeFileSync(path.join(path.dirname(user), '.claude.json'), `{"mcpServers":{}}${eol}`);
    fs.mkdirSync(path.join(user, 'skills'));
    fs.writeFileSync(path.join(user, 'skills', upper ? 'Alpha.md' : 'alpha.md'), 'x');
    const git = path.join(cwd, '.git');
    fs.mkdirSync(path.join(git, 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(git, 'info'));
    fs.writeFileSync(path.join(git, 'config'), `[core]${eol}\tbare = false${eol}`);
    fs.writeFileSync(path.join(git, 'hooks', upper ? 'Pre-Commit' : 'pre-commit'), `#!/bin/sh${eol}`);
    fs.writeFileSync(path.join(git, 'info', 'exclude'), `*.log${eol}`);
    fs.writeFileSync(path.join(cwd, '.gitattributes'), `* text=auto${eol}`);
    return { cwd, user };
  }

  it('G-WIN-04: layersHash and gitHash of the same layers written with CRLF + different path case are equal; a hook edit moves gitHash', () => {
    const a = layerTree('\n', false);
    const b = layerTree('\r\n', true);
    const L = (t: { cwd: string; user: string }) => layersHash({ cwd: t.cwd, userClaudeDir: t.user, managedPaths: [] });
    expect(L(b)).toBe(L(a));
    expect(gitHash(b.cwd)).toBe(gitHash(a.cwd));
    fs.appendFileSync(path.join(a.cwd, '.git', 'hooks', 'pre-commit'), 'curl evil\n');
    expect(gitHash(a.cwd)).not.toBe(gitHash(b.cwd));
    fs.writeFileSync(path.join(b.cwd, '.claude', 'settings.local.json'), '{}');
    expect(L(b)).not.toBe(L(a));
    expect(collectLayerInputs({ cwd: a.cwd, userClaudeDir: a.user, managedPaths: [path.join(a.cwd, 'no-managed.json')] }).some((i) => i.key.startsWith('managed:') && i.bytes === null)).toBe(true);
  });

  it('gitHash follows a linked worktree `.git` file to the common dir', () => {
    const main = layerTree('\n', false);
    const wt = tmp('gnomon-wt-');
    const wtGit = path.join(main.cwd, '.git', 'worktrees', 'wt');
    fs.mkdirSync(wtGit, { recursive: true });
    fs.writeFileSync(path.join(wtGit, 'commondir'), '../..\n');
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${wtGit}\n`);
    fs.copyFileSync(path.join(main.cwd, '.gitattributes'), path.join(wt, '.gitattributes'));
    const before = gitHash(wt);
    fs.appendFileSync(path.join(main.cwd, '.git', 'config'), '[filter "x"]\n');
    expect(gitHash(wt)).not.toBe(before);
  });
});

/* ── per-session policy ───────────────────────────────────────────────────── */

describe('#manifest-loader: per-session policy data (§15.5 session profile; realised into a platform profile by M1.7)', () => {
  it('carries the key, settings, linked-folder, endpoint-port and process-info denies, realpath\'d, with a stable policyHash', () => {
    const home = tmp('gnomon-home-');
    const cwd = tmp('gnomon-proj-');
    const user = tmp('gnomon-user-');
    const linked = tmp('gnomon-linked-');
    const p = buildSessionPolicy({ home, cwd, userClaudeDir: user, managedSettingsPaths: ['/managed/managed-settings.json'], linkedFolders: [linked], endpointPort: 41234, browserProfileDirs: [path.join(user, 'browser')] });
    const R = (x: string) => realpathLoose(x);
    const has = (list: typeof p.denyRead, pth: string, match: string) => list.some((d) => d.path === R(pth) && d.match === match);
    for (const [rel, m] of [['keys', 'subpath'], ['warpline', 'subpath'], ['link', 'subpath'], ['head', 'literal']] as const) {
      expect(has(p.denyRead, path.join(home, rel), m), `read ${rel}`).toBe(true);
      expect(has(p.denyWrite, path.join(home, rel), m), `write ${rel}`).toBe(true);
    }
    expect(has(p.denyRead, path.join(cwd, '.warpline', 'daemon-tokens.jsonl'), 'literal')).toBe(true);
    expect(has(p.denyRead, path.join(user, 'browser'), 'subpath')).toBe(true);
    expect(has(p.denyWrite, home, 'subpath')).toBe(true);
    expect(has(p.denyWrite, user, 'subpath')).toBe(true);
    expect(has(p.denyWrite, path.join(path.dirname(user), '.claude.json'), 'literal')).toBe(true);
    for (const g of ['hooks', 'info']) expect(has(p.denyWrite, path.join(cwd, '.git', g), 'subpath')).toBe(true);
    expect(has(p.denyWrite, path.join(cwd, '.git', 'config'), 'literal')).toBe(true);
    expect(p.denyClasses).toEqual([...SESSION_DENY_CLASSES]);
    expect(has(p.denyWrite, path.join(cwd, '.claude'), 'subpath')).toBe(true);
    expect(has(p.denyWrite, path.join(cwd, 'CLAUDE'), 'prefix')).toBe(true);
    expect(has(p.denyWrite, '/managed/managed-settings.json', 'literal')).toBe(true);
    expect(has(p.denyWrite, linked, 'subpath')).toBe(true);
    expect(p.denyLoopbackPorts).toEqual([41234]);
    expect(p.processInfo).toBe('deny-others');
    expect(p.realisedBy).toBe('M1.7');
    // realpath'd: the tmp dir's resolved form (macOS /var → /private/var)
    expect(p.denyWrite.find((d) => d.class === 'linked-folder')!.path).toBe(fs.realpathSync.native(linked));
    const again = buildSessionPolicy({ home, cwd, userClaudeDir: user, managedSettingsPaths: ['/managed/managed-settings.json'], linkedFolders: [linked], endpointPort: 41234, browserProfileDirs: [path.join(user, 'browser')] });
    expect(policyHash(again)).toBe(policyHash(p));
    expect(policyHash(buildSessionPolicy({ home, cwd, userClaudeDir: user, managedSettingsPaths: [], linkedFolders: [], endpointPort: 41235 }))).not.toBe(policyHash(p));
    expect(buildSessionPolicy({ home, cwd, userClaudeDir: user, managedSettingsPaths: [], linkedFolders: [], endpointPort: null }).denyLoopbackPorts).toEqual([]);
    expect(() => buildSessionPolicy({ home, cwd, userClaudeDir: user, managedSettingsPaths: [], linkedFolders: [], endpointPort: 70000 })).toThrow(/port/);
    const perms = claudePermissions(p).permissions.deny;
    expect(perms.some((r) => r.startsWith('Read(') && r.includes('keys/**'))).toBe(true);
    expect(perms.some((r) => r.startsWith('Edit(') && r.endsWith('.claude.json)'))).toBe(true);
  });

  it('every input layersHash and gitHash read is covered by a write deny (Aegis F2)', () => {
    const home = tmp('gnomon-home-');
    const cwd = tmp('gnomon-proj-');
    const wt = tmp('gnomon-wt-');
    const user = path.join(tmp('gnomon-user-'), '.claude');
    for (const d of [path.join(user, 'skills'), path.join(user, 'agents'), path.join(cwd, '.claude', 'commands'), path.join(cwd, '.git', 'hooks'), path.join(wt, '.claude')]) fs.mkdirSync(d, { recursive: true });
    for (const f of [path.join(user, 'settings.json'), path.join(user, 'settings.local.json'), path.join(user, 'CLAUDE.md'), path.join(path.dirname(user), '.claude.json'), path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'commands', 'x.md'), path.join(cwd, 'CLAUDE.md'), path.join(cwd, 'CLAUDE.local.md'), path.join(cwd, '.git', 'config'), path.join(cwd, '.git', 'hooks', 'pre-commit'), path.join(wt, 'CLAUDE.md')]) fs.writeFileSync(f, 'x');
    const managed = path.join(tmp('gnomon-managed-'), 'managed-settings.json');
    const p = buildSessionPolicy({ home, cwd, worktree: wt, userClaudeDir: user, managedSettingsPaths: [managed], linkedFolders: [], endpointPort: null });
    const covered = (abs: string): boolean => {
      const r = realpathLoose(abs);
      return p.denyWrite.some((d) => (d.match === 'literal' ? r === d.path : d.match === 'subpath' ? r === d.path || r.startsWith(d.path + path.sep) : r.startsWith(d.path)));
    };
    const inputs = [...collectLayerInputs({ cwd, worktree: wt, userClaudeDir: user, managedPaths: [managed] }), ...collectGitInputs(cwd).filter((i) => !i.key.startsWith('repo:'))];
    expect(inputs.length).toBeGreaterThan(10);
    expect(inputs.filter((i) => !i.abs || !covered(i.abs)).map((i) => i.key)).toEqual([]);
  });

  it('every platform-neutral deny class has a mechanism row for every platform (the platform registry)', () => {
    for (const plat of ['darwin', 'win32', 'linux'] as const) {
      expect(Object.keys(SESSION_DENY_REALISATION[plat]).sort()).toEqual([...SESSION_DENY_CLASSES].sort());
    }
  });
});

/* ── events ───────────────────────────────────────────────────────────────── */

describe('#manifest-loader emits only §9.1 registry kinds', () => {
  it('every kind the loader emits is in the contracts kind registry', () => {
    const dir = path.join(PKG_ROOT, 'src', 'kernel', 'manifest');
    const kinds = new Set<string>();
    for (const f of fs.readdirSync(dir)) {
      for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/emit\('([a-z][a-z0-9.-]*)'/g)) kinds.add(m[1]!);
    }
    expect(kinds.size).toBeGreaterThan(8);
    expect([...kinds].filter((k) => !EVENT_KIND_NAMES.includes(k))).toEqual([]);
  });
});

/* ── Aegis S0b review fixes ───────────────────────────────────────────────── */

describe('Aegis S0b M3: version class by packageHash history', () => {
  it('re-staging earlier approved bytes that are not the current pin is a revert with the DOWNGRADE line, never first or update', () => {
    const home = tmp();
    const auth = root();
    const v1 = writeMod(path.join(tmp(), 'diff-lens'), baseManifest({ version: '1.0.0' }));
    const v2 = writeMod(path.join(tmp(), 'diff-lens'), baseManifest({ version: '1.1.0' }));
    const stage = (src: string) => {
      const st = stageInstall({ home, source: src, via: 'package', requestedBy: HUMAN, trust: auth });
      if (st.state !== 'staged') throw new Error('staged');
      return st;
    };
    const s1 = stage(v1);
    expect(s1.record.detail.versionClass).toBe('first');
    decideInstallCard(home, 'acme.diff-lens', s1.cardId, 'install', { presenceToken: bound(home, 'acme.diff-lens', s1.cardId), authority: auth });
    const s2 = stage(v2);
    expect(s2.record.detail.versionClass).toBe('update');
    decideInstallCard(home, 'acme.diff-lens', s2.cardId, 'install', { presenceToken: bound(home, 'acme.diff-lens', s2.cardId), authority: auth });
    // a plain downgrade by semver
    const back = stage(v1);
    expect(back.record.detail.versionClass).toBe('downgrade');
    // roll back to 1.0.0, then re-stage the 1.1.0 bytes: approved before, not the current pin → revert
    rollbackModSnapshot(home, 'acme.diff-lens', undefined, { presenceToken: rbBound('acme.diff-lens', undefined), authority: auth });
    const again = stage(v2);
    expect(again.record.detail.versionClass).toBe('revert');
    const texts = (again.record.card.block as { children: Array<{ text: string }> }).children.map((c) => c.text);
    expect(texts[0]).toMatch(/^Downgrade mod acme\.diff-lens/);
    expect(texts[3]).toMatch(/^DOWNGRADE: revert to previously approved bytes, 1\.0\.0 → 1\.1\.0/);
  });

  it('a current pin whose manifest cannot be re-read is never classified first', () => {
    const home = tmp();
    const auth = root();
    const v1 = writeMod(path.join(tmp(), 'diff-lens'), baseManifest({ version: '1.0.0' }));
    const s1 = stageInstall({ home, source: v1, via: 'package', requestedBy: HUMAN, trust: auth });
    if (s1.state !== 'staged') throw new Error('staged');
    decideInstallCard(home, 'acme.diff-lens', s1.cardId, 'install', { presenceToken: bound(home, 'acme.diff-lens', s1.cardId), authority: auth });
    const pinMf = path.join(pinnedDir(home, 'acme.diff-lens', s1.record.detail.packageHash), MANIFEST_FILE);
    fs.chmodSync(path.dirname(pinMf), 0o700);
    fs.chmodSync(pinMf, 0o600);
    fs.writeFileSync(pinMf, 'not json');
    const v2 = writeMod(path.join(tmp(), 'diff-lens'), baseManifest({ version: '1.1.0' }));
    const s2 = stageInstall({ home, source: v2, via: 'package', requestedBy: HUMAN, trust: auth });
    if (s2.state !== 'staged') throw new Error('staged');
    expect(s2.record.detail.versionClass).not.toBe('first');
  });
});
