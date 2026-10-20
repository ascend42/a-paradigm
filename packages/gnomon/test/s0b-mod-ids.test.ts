/**
 * S0b (the Desk O1): mod naming `<publisher>.<name>` and mod/format versioning, in the kernel (#manifest-loader).
 * .paradigm/research/paradigm-8/gnomon-mod-naming-versioning.md. Pure checks; platform-independent.
 */
import { describe, expect, it } from 'vitest';
import { MANIFEST_FORMAT } from '@a-company/gnomon-contracts';
import { aliasOf, checkGrantRow, FORMAT_1_SUPPORTED, HISTORICAL_FIRST_PARTY_PINS, LEGACY_ALIASES, ownsModKind, type ResolvedGrants } from '../src/kernel/manifest/grants.js';
import { blockFor, checkPublisherSource, checkServerCollision, publisherDisplay, type InstallCardDetail } from '../src/kernel/manifest/install.js';
import { canonicalManifestHash, enginesAdmit, manifestHash, readManifest, upgradeManifestV1, validateManifest, type ManifestV2 } from '../src/kernel/manifest/manifest.js';
import { ManifestRefusal } from '../src/kernel/manifest/refusal.js';

const base = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ manifest: 2, kind: 'mod', publisher: 'acme', name: 'board', version: '1.0.0', abi: 'mod-abi:v1', ...over });
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ManifestRefusal) return e.manifestCode;
    throw e;
  }
  return undefined;
};
const local = { tier: 'local' as const };
const grants = (over: Partial<ResolvedGrants> = {}): ResolvedGrants => ({ capabilities: new Map(), trust: new Map(), egress: new Map(), binds: [], installs: [], pins: [], publishers: new Map(), other: [], rejected: [], ...over });
const SHA = 'a'.repeat(40);

describe('S0b formats', () => {
  it('upgradeManifestV1 is pure: same output twice, input untouched, mcp names dropped, local namespace rewritten', () => {
    const v1 = { manifest: 1, kind: 'mod', name: 'pad', version: '1.0.0', abi: 'mod-abi:v1', provides: { mcp: [{ name: 'pad', command: '/bin/pad' }], events: ['modns.pad.saved'] }, requires: { capabilities: ['log.append:modns.pad.*'], egress: 'none' } };
    const before = JSON.stringify(v1);
    const a = upgradeManifestV1(v1, 'local');
    const b = upgradeManifestV1(v1, 'local');
    expect(a).toEqual(b);
    expect(JSON.stringify(v1)).toBe(before);
    expect(a).toMatchObject({ manifest: 2, publisher: 'local', name: 'pad', provides: { mcp: [{ command: '/bin/pad' }], events: ['modns.local.pad.saved'] }, requires: { capabilities: ['log.append:modns.local.pad.*'] } });
    expect('name' in ((a.provides as { mcp: object[] }).mcp[0] as object)).toBe(false);
  });

  it('a fresh format-1 install and an unknown future major are refused FORMAT; the raw bytes are the manifestHash', () => {
    const v1 = JSON.stringify({ manifest: 1, kind: 'mod', name: 'pad', version: '1.0.0', abi: 'mod-abi:v1' });
    expect(code(() => readManifest(v1, local))).toBe('FORMAT');
    const v1r = readManifest(v1, { tier: 'local', legacyPublisher: 'local' });
    expect(v1r.format).toBe(1);
    expect(v1r.manifestHash).toBe(canonicalManifestHash(JSON.parse(v1)));
    expect(v1r.upgradedHash).toMatch(/^sha256:/);
    const v3 = JSON.stringify(base({ manifest: 3, engines: { gnomon: '>=9.1.0' } }));
    expect(code(() => readManifest(v3, local))).toBe('FORMAT');
    const raw = `${JSON.stringify(base(), null, 4)}\n`;
    expect(readManifest(raw, local).manifestHash).toBe(manifestHash(raw));
    expect(readManifest(raw, local).manifestHash).not.toBe(readManifest(JSON.stringify(base()), local).manifestHash);
  });

  it('engines.gnomon: a tokenizer of space-joined comparators; refused ENGINE when it does not admit this kernel', () => {
    expect(enginesAdmit('>=8.0.0 <9.0.0', '8.0.0')).toBe(true);
    expect(enginesAdmit('>8.0.0', '8.0.0')).toBe(false);
    expect(enginesAdmit('^8.0.0', '8.0.0')).toBeNull();
    expect(enginesAdmit('>=8.0', '8.0.0')).toBeNull();
    expect(enginesAdmit('>= 8.0.0', '8.0.0')).toBeNull();
    expect(code(() => validateManifest(base({ engines: { gnomon: '>=9.0.0' } }), local))).toBe('ENGINE');
    expect(code(() => validateManifest(base({ engines: { gnomon: '~8' } }), local))).toBe('SCHEMA');
  });

  it('the alias table expires with format-1 support', () => {
    expect(FORMAT_1_SUPPORTED).toBe(MANIFEST_FORMAT.accepted.includes(1));
    // a test fails if format 1 is dropped while the frozen table remains
    expect(LEGACY_ALIASES.length === 0 || FORMAT_1_SUPPORTED).toBe(true);
    expect(Object.isFrozen(LEGACY_ALIASES)).toBe(true);
  });

  it('a legacy name maps to gnomon.N only for an alias, at the first-party tier, from a historical pin; else local.N', () => {
    const pin = [...HISTORICAL_FIRST_PARTY_PINS][0]!;
    expect(aliasOf('workshop', 'first-party', pin)).toBe('gnomon.workshop');
    expect(aliasOf('workshop', 'local', pin)).toBe('local.workshop');
    expect(aliasOf('workshop', 'first-party', `sha256:${'0'.repeat(64)}`)).toBe('local.workshop');
    expect(aliasOf('neurons', 'first-party', pin)).toBe('local.neurons');
    expect(ownsModKind('gnomon.workshop', 'modns.workshop.moved')).toBe(true);
    expect(ownsModKind('gnomon.workshop', 'modns.gnomon.workshop.moved')).toBe(true);
    expect(ownsModKind('local.workshop', 'modns.workshop.moved')).toBe(false);
    expect(ownsModKind('acme.work', 'modns.acme.workshop.x')).toBe(false); // whole segments
  });
});

describe('S0b identity', () => {
  it('reserved, kernel-token, device-name and confusable publishers are refused PUBLISHER; local only kernel-assigned', () => {
    for (const p of ['kernel', 'paradigm', 'claude', 'workshop', 'modns', 'session', 'con', 'lpt1', 'gn0mon', 'c1aude', 'a-company', 'warpline', 'nevr', 'nevrland', 'conductor', 'acompany']) {
      expect(code(() => validateManifest(base({ publisher: p }), local)), p).toBe('PUBLISHER');
    }
    expect(code(() => validateManifest(base({ publisher: 'local' }), local))).toBe('PUBLISHER');
    expect(code(() => validateManifest(base({ name: 'aux' }), local))).toBe('NAME');
    expect(code(() => validateManifest(base({ name: 'com3' }), local))).toBe('NAME');
  });

  it('gnomon ⇔ first-party, both ways; first-party display names refused for any other publisher (names, prefixes, skeletons)', () => {
    expect(code(() => validateManifest(base({ publisher: 'gnomon' }), local))).toBe('PUBLISHER');
    expect(code(() => validateManifest(base(), { tier: 'first-party' }))).toBe('PUBLISHER');
    expect(validateManifest(base({ publisher: 'gnomon', name: 'neurons' }), { tier: 'first-party' }).name).toBe('neurons');
    for (const n of ['workshop', 'ledger-pro', 'neur0ns', 'paradigm-context', 'claude-helper', 'constellation']) expect(code(() => validateManifest(base({ name: n }), local)), n).toBe('PUBLISHER');
  });

  it('the 60-character id cap is separate from the segment regexes', () => {
    expect(validateManifest(base({ publisher: 'p'.repeat(35), name: 'n'.repeat(24) }), local).name).toBe('n'.repeat(24));
    expect(code(() => validateManifest(base({ publisher: 'p'.repeat(36), name: 'n'.repeat(24) }), local))).toBe('SCHEMA');
  });

  it('env own-prefix is <PUB>__<NAME>__ below first-party; the denylist still applies', () => {
    const mcp = (env: string[]) => base({ provides: { mcp: [{ command: '/bin/x', config: { env } }] } });
    expect(() => validateManifest(mcp(['ACME__BOARD__URL']), local)).not.toThrow();
    expect(code(() => validateManifest(mcp(['ACME_BOARD_URL']), local))).toBe('SCHEMA');
    expect(code(() => validateManifest(mcp(['BOARD__URL']), local))).toBe('SCHEMA');
    expect(() => validateManifest(mcp(['OPENAI_API_KEY']), local)).not.toThrow();
    expect(code(() => validateManifest(mcp(['PATH']), local))).toBe('SCHEMA');
    // config.secret must name a declared env entry
    expect(code(() => validateManifest(base({ provides: { mcp: [{ command: '/bin/x', config: { env: ['ACME__BOARD__T'], secret: ['ACME__BOARD__X'] } }] } }), local))).toBe('SCHEMA');
    expect(() => validateManifest(base({ provides: { mcp: [{ command: '/bin/x', config: { env: ['ACME__BOARD__T'], secret: ['ACME__BOARD__T'] } }] } }), local)).not.toThrow();
  });

  it('provides.mcp: one entry, no name; the qualified handoff tool fits 64', () => {
    expect(code(() => validateManifest(base({ provides: { mcp: [{ name: 'x', command: '/bin/x' }] } }), local))).toBe('SCHEMA');
    expect(code(() => validateManifest(base({ provides: { mcp: [{ command: '/bin/x' }, { command: '/bin/y' }] } }), local))).toBe('SCHEMA');
    const offer = (tool: string) => ({ kind: 'map', phase: 'diverge', title: 'Map it', summary: 'Maps it.', contextIn: [], resultOut: 'map', reach: 'mcp', handoffTool: tool, related: [], restraint: 'Not for a quick question.' });
    const at = (tool: string) => base({ provides: { mcp: [{ command: '/bin/x' }], offers: [offer(tool)] } });
    const room = 64 - 'mcp__gm_acme_board__'.length;
    expect(() => validateManifest(at('t'.repeat(room)), local)).not.toThrow();
    expect(code(() => validateManifest(at('t'.repeat(room + 1)), local))).toBe('SCHEMA');
  });
});

describe('S0b publisher against the source', () => {
  const m = (publisher: string) => validateManifest(base({ publisher }), local) as ManifestV2;
  const gh = (owner: string) => `git:https://github.com/${owner}/board#${SHA}`;
  it('github.com: the publisher must be the URL owner (spoofing refused)', () => {
    expect(checkPublisherSource(m('acme'), gh('acme'), grants())).toBeNull();
    expect(checkPublisherSource(m('acme'), gh('Acme'), grants())).toBeNull();
    expect(code(() => checkPublisherSource(m('acme'), gh('evil'), grants()))).toBe('PUBLISHER');
  });

  it('founder brands: ascend42 only as github.com/ascend42; a-company from no source', () => {
    expect(checkPublisherSource(m('ascend42'), gh('ascend42'), grants())).toBeNull();
    expect(code(() => checkPublisherSource(m('ascend42'), 'package', grants()))).toBe('PUBLISHER');
    expect(code(() => checkPublisherSource(m('ascend42'), `git:https://gitlab.com/ascend42/board#${SHA}`, grants()))).toBe('PUBLISHER');
    expect(code(() => validateManifest(base({ publisher: 'a-company' }), local))).toBe('PUBLISHER');
  });

  it('other hosts: TOFU (host, namespace) binding; another binding refused unless re-bound; display "acme @ host"', () => {
    const src = `git:https://gitlab.com/acme/sub/board#${SHA}`;
    expect(checkPublisherSource(m('acme'), src, grants())).toEqual({ host: 'gitlab.com', namespace: 'acme/sub', rebind: false });
    const bound = grants({ publishers: new Map([['acme', { host: 'gitlab.com', namespace: 'acme/sub' }]]) });
    expect(checkPublisherSource(m('acme'), src, bound)).toBeNull();
    const elsewhere = `git:https://codeberg.org/acme/board#${SHA}`;
    expect(code(() => checkPublisherSource(m('acme'), elsewhere, bound))).toBe('PUBLISHER');
    expect(checkPublisherSource(m('acme'), elsewhere, bound, { rebind: true })).toEqual({ host: 'codeberg.org', namespace: 'acme', rebind: true });
    expect(code(() => checkPublisherSource(m('acme'), gh('acme'), bound))).toBe('PUBLISHER');
    expect(publisherDisplay('acme', src)).toBe('acme @ gitlab.com');
    expect(publisherDisplay('acme', 'linked:/x')).toBe('acme (unverified, local folder)');
    expect(publisherDisplay('acme', gh('acme'))).toBe('acme');
  });

  it('COLLISION: the derived server name against the user .mcp.json', () => {
    const withMcp = validateManifest(base({ provides: { mcp: [{ command: '/bin/x' }] } }), local);
    expect(checkServerCollision('/nonexistent', withMcp, grants())).toBe('gm_acme_board');
    expect(code(() => checkServerCollision('/nonexistent', withMcp, grants(), ['gm_acme_board']))).toBe('COLLISION');
    expect(checkServerCollision('/nonexistent', validateManifest(base(), local), grants(), ['gm_acme_board'])).toBeUndefined();
  });
});

describe('S0b install card', () => {
  const detail = (over: Partial<InstallCardDetail> = {}): InstallCardDetail => ({
    name: 'acme.board', publisher: 'acme', publisherDisplay: 'acme (unverified, local folder)', format: 2, versionClass: 'update', prevVersion: '1.0.0',
    kind: 'mod', version: '1.1.0', source: 'linked:/src/board', tier: 'local', manifestHash: `sha256:${'1'.repeat(64)}`, packageHash: `sha256:${'2'.repeat(64)}`,
    effects: [], egress: [], capabilities: [], events: [], tools: [], views: [], readPaths: [], packages: [], commands: [], keybindings: [], knowledge: [], mcp: [], hooks: [], opaque: {},
    replaces: { packageHash: `sha256:${'3'.repeat(64)}`, manifestHash: `sha256:${'4'.repeat(64)}` }, widened: [], files: { added: [], changed: [], removed: [] }, stagedBy: 'p:x/y', ...over,
  });
  const lines = (d: InstallCardDetail) => (blockFor(d).block as { children: Array<{ text: string }> }).children.map((c) => c.text);
  it('line 3 classifies the bytes; the header verb and publisher; a downgrade is prominent', () => {
    const l = lines(detail());
    expect(l[0]).toMatch(/^Update mod acme\.board 1\.1\.0 \(mod\) by acme \(unverified, local folder\) from /);
    expect(l[3]).toBe('version: update 1.0.0 → 1.1.0');
    const d = lines(detail({ versionClass: 'downgrade', version: '0.9.0' }));
    expect(d[0]).toMatch(/^Downgrade mod/);
    expect(d[3]).toBe('DOWNGRADE: 1.0.0 → 0.9.0 (older version; check why)');
    expect(lines(detail({ versionClass: 'same-version-new-bytes', version: '1.0.0' }))[0]).toMatch(/^Re-approve mod/);
    expect(lines(detail({ replaces: null, versionClass: 'first', prevVersion: undefined }))[0]).toMatch(/^Install mod/);
  });

  it('a short card only when nothing widens; a folder replacing git gets the full card with SOURCE CHANGED', () => {
    expect(lines(detail()).some((t) => t.startsWith('nothing widens'))).toBe(true);
    const swapped = lines(detail({ sourceChangedFrom: `git:https://github.com/acme/board#${SHA}` }));
    expect(swapped.some((t) => t.startsWith('nothing widens'))).toBe(false);
    expect(swapped).toContain(`SOURCE CHANGED: git:https://github.com/acme/board#${SHA} → linked:/src/board`);
    expect(swapped.some((t) => t.startsWith('effects:'))).toBe(true);
    const looks = lines(detail({ looksLike: 'acrne' }));
    expect(looks).toContain('publisher acme looks like acrne (installed)');
  });
});

describe('S0b reservations, skeletons and boundaries (tester additions)', () => {
  const m = (publisher: string) => validateManifest(base({ publisher }), local) as ManifestV2;
  const gh = (owner: string) => `git:https://github.com/${owner}/board#${SHA}`;
  it('founder brands: a-company, warpline, nevr, nevrland, conductor refused at validation, so from every source', () => {
    for (const p of ['a-company', 'warpline', 'nevr', 'nevrland', 'conductor']) {
      expect(code(() => validateManifest(base({ publisher: p }), local)), p).toBe('PUBLISHER');
      expect(code(() => validateManifest(base({ publisher: p }), { tier: `signed:gkey-p256:v1:${'a'.repeat(64)}` })), p).toBe('PUBLISHER');
      // and the source check refuses too (defence in depth: github.com/a-company belongs to someone else)
      expect(code(() => checkPublisherSource({ ...m('acme'), publisher: p }, gh(p), grants())), p).toBe('PUBLISHER');
    }
  });

  it('ascend42 and its skeletons: github.com/ascend42 only; folder, other host and look-alike owners refused', () => {
    expect(validateManifest(base({ publisher: 'ascend42' }), local).publisher).toBe('ascend42');
    expect(code(() => checkPublisherSource(m('ascend42'), 'linked:/src/board', grants()))).toBe('PUBLISHER');
    for (const p of ['a5cend42', 'ascencl42', 'ascend-42']) {
      const c = code(() => checkPublisherSource(m(p), gh(p), grants()));
      const v = code(() => validateManifest(base({ publisher: p }), local));
      expect(c === 'PUBLISHER' || v === 'PUBLISHER', p).toBe(true);
    }
  });

  it('skeletons of reserved publishers and first-party names are refused; an unrelated publisher passes', () => {
    for (const p of ['gn0mon', 'cIaude', 'anthr0pic', 'paradlgm', 'w0rkshop', 'ledg3r', 'neur0ns', 'warp1ine', 'nevr-land']) {
      expect(code(() => validateManifest(base({ publisher: p.toLowerCase() }), local)), p).toBe('PUBLISHER');
    }
    expect(validateManifest(base({ publisher: 'zebra-labs' }), local).publisher).toBe('zebra-labs');
  });

  it('Windows device names in both segments', () => {
    for (const d of ['con', 'prn', 'aux', 'nul', 'com0', 'com9', 'lpt0', 'lpt9']) {
      expect(code(() => validateManifest(base({ publisher: d }), local)), `publisher ${d}`).toBe('PUBLISHER');
      expect(code(() => validateManifest(base({ name: d }), local)), `name ${d}`).toBe('NAME');
    }
    expect(validateManifest(base({ name: 'console' }), local).name).toBe('console'); // whole segment only
  });

  it('segment regexes: 39/24 chars, no leading/trailing/double hyphen, ASCII only; 39+1+24 = 64 > 60 refused', () => {
    expect(code(() => validateManifest(base({ publisher: 'p'.repeat(40) }), local))).toBe('SCHEMA');
    expect(code(() => validateManifest(base({ name: 'n'.repeat(25) }), local))).toBe('SCHEMA');
    for (const p of ['-acme', 'acme-', 'ac--me', 'Acme', 'acmé', 'ac_me']) expect(code(() => validateManifest(base({ publisher: p }), local)), p).toBe('SCHEMA');
    expect(code(() => validateManifest(base({ name: '1board' }), local))).toBe('SCHEMA');
    expect(code(() => validateManifest(base({ publisher: 'p'.repeat(39), name: 'n'.repeat(24) }), local))).toBe('SCHEMA');
    expect(validateManifest(base({ publisher: 'p'.repeat(36), name: 'n'.repeat(23) }), local).name).toHaveLength(23);
  });

  it('env prefix: hyphens become a single _, so a forged __ cannot reach another mod', () => {
    const mcp = (pub: string, name: string, env: string[]) => base({ publisher: pub, name, provides: { mcp: [{ command: '/bin/x', config: { env } }] } });
    expect(() => validateManifest(mcp('my-co', 'dash-board', ['MY_CO__DASH_BOARD__URL']), local)).not.toThrow();
    // my.co-x / my-co.x style splits cannot produce each other's prefix
    expect(code(() => validateManifest(mcp('my', 'co-dash', ['MY__CO__DASH__URL']), local))).toBe('SCHEMA');
  });

  it('a FORMAT refusal for a future major names the Gnomon it needs', () => {
    try {
      readManifest(JSON.stringify(base({ manifest: 3, engines: { gnomon: '>=9.1.0' } })), local);
      throw new Error('expected FORMAT');
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestRefusal);
      expect((e as ManifestRefusal).message).toMatch(/needs Gnomon ≥ 9\.1\.0/);
    }
    expect(code(() => validateManifest(base({ engines: { gnomon: `>=${'1'.repeat(70)}.0.0` } }), local))).toBe('SCHEMA');
  });
});

describe('Aegis S0b M4: re-binding back to github.com', () => {
  const m = (publisher: string) => validateManifest(base({ publisher }), local) as ManifestV2;
  const gh = (owner: string) => `git:https://github.com/${owner}/board#${SHA}`;
  it('a GitHub re-bind returns a github.com binding; that binding is then the same identity', () => {
    const onGitlab = grants({ publishers: new Map([['acme', { host: 'gitlab.com', namespace: 'acme' }]]) });
    expect(code(() => checkPublisherSource(m('acme'), gh('acme'), onGitlab))).toBe('PUBLISHER');
    expect(checkPublisherSource(m('acme'), gh('acme'), onGitlab, { rebind: true })).toEqual({ host: 'github.com', namespace: 'acme', rebind: true });
    const onGithub = grants({ publishers: new Map([['acme', { host: 'github.com', namespace: 'acme' }]]) });
    expect(checkPublisherSource(m('acme'), gh('acme'), onGithub)).toBeNull();
    // and leaving GitHub again needs a re-bind
    expect(code(() => checkPublisherSource(m('acme'), `git:https://gitlab.com/acme/board#${SHA}`, onGithub))).toBe('PUBLISHER');
  });

  it('grant.publisher on github.com is valid only when the namespace is the publisher', () => {
    const row = (namespace: string) => ({ schemaVersion: 'grantRow:v2', kind: 'grant.publisher', createdAt: '2026-10-20T00:00:00.000Z', publisher: 'acme', host: 'github.com', namespace });
    expect(checkGrantRow(row('acme'))).toBeNull();
    expect(checkGrantRow(row('evil'))).toBe('host');
  });
});

describe('Aegis S0b L3: the implicit github claim uses effective pins only', () => {
  const m = (publisher: string) => validateManifest(base({ publisher }), local) as ManifestV2;
  const row = (kind: 'grant.install' | 'grant.uninstall', source: string) =>
    ({ schemaVersion: 'grantRow:v2', kind, createdAt: '2026-10-20T00:00:00.000Z', name: 'acme.board', manifestHash: `sha256:${'1'.repeat(64)}`, packageHash: `sha256:${'2'.repeat(64)}`, cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ', source }) as never;
  const gl = `git:https://gitlab.com/acme/board#${SHA}`;
  it('an uninstalled github mod no longer claims the publisher; a live one still does', () => {
    const gh = row('grant.install', `git:https://github.com/acme/board#${SHA}`);
    const live = grants({ installs: [gh], pins: [gh] });
    expect(code(() => checkPublisherSource(m('acme'), gl, live))).toBe('PUBLISHER');
    const gone = grants({ installs: [gh], pins: [gh, row('grant.uninstall', 'package')] });
    expect(checkPublisherSource(m('acme'), gl, gone)).toMatchObject({ host: 'gitlab.com', namespace: 'acme', rebind: false });
    const moved = row('grant.install', 'package');
    const nowFolder = grants({ installs: [gh, moved], pins: [gh, moved] });
    expect(checkPublisherSource(m('acme'), gl, nowFolder)).toMatchObject({ rebind: false });
  });
});
