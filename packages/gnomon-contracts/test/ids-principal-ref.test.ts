/** Ids (ULID, hsid, hsid-short, turn), principals (rootKeyId compare), ref:v1. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ulid,
  monotonicUlidFactory,
  isUlid,
  ulidTime,
  mintHsid,
  hsidShort,
  deriveHsidV1d,
  isHsid,
  HSID_SHORT_PATTERN,
  turnId,
  parseTurnId,
  mintId,
  isId,
  keyId8,
  repoScope,
  sha256,
  hex,
  canonicalJson,
  samePrincipal,
  isLocalPrincipal,
  foreignDisplayId,
  parsePrincipalId,
  nsFromRootPublicKey,
  PRINCIPAL_KINDS,
  parseRef,
  peerRef,
  validateRefV1,
  expandRefAlias,
  REF_SCHEMES,
  RESERVED_REF_SCHEMES,
} from '../src/index.js';

describe('sha256 / canonical JSON', () => {
  it('matches node:crypto', () => {
    for (const s of ['', 'abc', 'x'.repeat(1000), 'héllo 🌍 \u{1F600}', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64)]) {
      expect(hex(sha256(s))).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
  it('canonical JSON sorts keys and refuses non-finite', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: undefined })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(() => canonicalJson({ a: NaN })).toThrow();
  });
});

describe('ULID', () => {
  it('format and time round-trip', () => {
    const id = ulid({ clock: () => 1_760_000_000_000 });
    expect(isUlid(id)).toBe(true);
    expect(ulidTime(id)).toBe(1_760_000_000_000);
  });
  it('monotonic within one ms and when the clock steps back; unique', () => {
    let t = 1_760_000_000_000;
    const clock = () => t;
    const next = monotonicUlidFactory({ clock });
    const ids: string[] = [];
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) t -= 5; // clock regression
      if (i === 1500) t += 10;
      ids.push(next());
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });
  it('increment carries across bytes and overflow throws', () => {
    const next = monotonicUlidFactory({ clock: () => 1, random: (n) => new Uint8Array(n).fill(0xff) });
    next();
    expect(() => next()).toThrow(/overflow/);
    const next2 = monotonicUlidFactory({ clock: () => 1, random: (n) => Uint8Array.from({ length: n }, (_, i) => (i === n - 1 ? 0xff : 0)) });
    const a = next2();
    const b = next2();
    expect(b > a).toBe(true);
  });
  it('random bits come from globalThis.crypto.getRandomValues', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => ulid({ clock: () => 0 })));
    expect(ids.size).toBe(1000);
  });
});

describe('hsid, hsid-short, turn ids (§4.2)', () => {
  it('hsid-short = lowercase base32 of the 80 random bits: 16 chars, no time bits', () => {
    const h = mintHsid({ clock: () => 1_760_000_000_000 });
    const s = hsidShort(h);
    expect(s).toMatch(HSID_SHORT_PATTERN);
    expect(s).toHaveLength(16);
    expect(s).toBe(h.slice(-16).toLowerCase());
    // two hsids minted in the same ms share their time chars but not their shorts
    const h2 = mintHsid({ clock: () => 1_760_000_000_000 });
    expect(h2.slice(8, 18)).toBe(h.slice(8, 18));
    expect(hsidShort(h2)).not.toBe(s);
  });
  it('hsid-short carries >= 80 bits of entropy: unique over 20k, every symbol used in every position', () => {
    const shorts = Array.from({ length: 20000 }, () => hsidShort(mintHsid({ clock: () => 0 })));
    expect(new Set(shorts).size).toBe(shorts.length);
    for (let pos = 0; pos < 16; pos++) {
      expect(new Set(shorts.map((s) => s[pos])).size).toBe(32);
    }
  });
  it('is undefined for derived hsids', () => {
    expect(() => hsidShort(deriveHsidV1d('p:a1b2c3d4/ascend', 'u'))).toThrow();
  });
  it('v1d is deterministic and keyed on the namespaced principal', () => {
    const a = deriveHsidV1d('p:a1b2c3d4/ascend', '5f1c');
    expect(a).toBe(deriveHsidV1d('p:a1b2c3d4/ascend', '5f1c'));
    expect(a).not.toBe(deriveHsidV1d('p:b1b2c3d4/ascend', '5f1c'));
    expect(isHsid(a)).toBe(true);
  });
  it('turn ids', () => {
    const h = mintHsid();
    expect(turnId(h, 1)).toBe(`turn:${h}/1`);
    expect(parseTurnId(turnId(h, 42))).toEqual({ hsid: h, n: 42 });
    expect(() => turnId(h, 0)).toThrow();
    expect(parseTurnId(`turn:${h}/01`)).toBeUndefined();
  });
  it('prefixed ULID ids (ev/log/conn/card/arm/permit/brief/msg)', () => {
    for (const k of ['ev', 'log', 'conn', 'card', 'arm', 'permit', 'brief', 'msg'] as const) {
      const id = mintId(k);
      expect(isId(k, id)).toBe(true);
    }
    expect(mintId('permit').startsWith('permit:v1:')).toBe(true);
    expect(isId('card', 'card:nope')).toBe(false);
  });
  it('key ids and repo scope', () => {
    expect(keyId8(`gkey-p256:v1:${'ab12'.repeat(16)}`)).toBe('ab12ab12');
    expect(repoScope('my-repo')).toMatch(/^repo:[0-9a-f]{16}$/);
  });
});

describe('principals: compare by full rootKeyId, never ns (G-ID-08 contract half)', () => {
  const rootA = `gkey-p256:v1:${'a'.repeat(64)}`;
  const rootB = `gkey-p256:v1:${'b'.repeat(64)}`;

  it('kinds include peer', () => {
    expect(PRINCIPAL_KINDS).toEqual(['human', 'agent', 'session', 'kernel', 'mod', 'voice', 'peer']);
  });
  it('same ns, different root ⇒ different principals (ground ns collision)', () => {
    expect(samePrincipal({ principalId: 'p:a1b2c3d4/ascend', rootKeyId: rootA }, { principalId: 'p:a1b2c3d4/ascend', rootKeyId: rootB })).toBe(false);
  });
  it('same root, same name ⇒ same, even when ns text differs', () => {
    expect(samePrincipal({ principalId: 'p:a1b2c3d4/ascend', rootKeyId: rootA }, { principalId: 'p:zzzzzzzz/ascend', rootKeyId: rootA })).toBe(true);
    expect(samePrincipal({ principalId: 'p:a1b2c3d4/ascend', rootKeyId: rootA }, { principalId: 'p:a1b2c3d4/kernel', rootKeyId: rootA })).toBe(false);
  });
  it('a foreign display id never parses as local', () => {
    const f = foreignDisplayId({ principalId: 'p:a1b2c3d4/kernel', rootKeyId: rootB });
    expect(f).toBe('p:a1b2c3d4/kernel@bbbbbbbb');
    expect(parsePrincipalId(f)).toEqual({ ns: 'a1b2c3d4', name: 'kernel', foreign: true, rootKeyId8: 'bbbbbbbb' });
    expect(isLocalPrincipal({ principalId: f, rootKeyId: rootA }, rootA)).toBe(false);
    expect(isLocalPrincipal({ principalId: 'p:a1b2c3d4/ascend', rootKeyId: rootB }, rootA)).toBe(false);
    expect(isLocalPrincipal({ principalId: 'p:a1b2c3d4/ascend', rootKeyId: rootA }, rootA)).toBe(true);
  });
  it('malformed rootKeyId never compares equal', () => {
    expect(samePrincipal({ principalId: 'p:a1b2c3d4/x', rootKeyId: 'x' }, { principalId: 'p:a1b2c3d4/x', rootKeyId: 'x' })).toBe(false);
  });
  it('ns derivation is 8 lowercase base32 chars', () => {
    expect(nsFromRootPublicKey(new Uint8Array([1, 2, 3]))).toMatch(/^[0-9a-hjkmnp-tv-z]{8}$/);
  });
});

describe('ref:v1 (§4.4)', () => {
  it('all listed schemes register, peer is reserved, voice is dropped', () => {
    for (const s of ['ev', 'hsid', 'cc', 'gkey', 'dev', 'permit', 'card', 'contract', 'node', 'pev', 'peer', 'spec', 'sym', 'wl', 'n', 's', 'td', 'l', 't', 'knot', 'doodle']) {
      expect(REF_SCHEMES).toContain(s);
    }
    expect(RESERVED_REF_SCHEMES).toEqual(['peer']);
    expect(parseRef('voice:abc')).toBeUndefined();
  });
  it('aliases', () => {
    expect(expandRefAlias('#approval-broker')).toBe('sym:#approval-broker');
    expect(expandRefAlias('$spawn')).toBe('sym:$spawn');
    expect(expandRefAlias('TD-2026-07-21-766')).toBe('td:TD-2026-07-21-766');
    expect(expandRefAlias('L-2026-10-17-x')).toBe('l:L-2026-10-17-x');
    expect(expandRefAlias('T-2026-10-14-003')).toBe('t:T-2026-10-14-003');
    expect(parseRef('^peer-paired')).toMatchObject({ scheme: 'sym', id: '^peer-paired', registered: true });
  });
  it('rev after the last @', () => {
    expect(parseRef('spec:docs/specs/gnomon.md@abc123')).toMatchObject({ scheme: 'spec', id: 'docs/specs/gnomon.md', rev: 'abc123' });
  });
  it('peer refs wrap a source ref and never nest', () => {
    const log = mintId('log');
    const ev = mintId('ev');
    const r = peerRef(log, ev);
    expect(r).toBe(`peer:${log}/${ev}`);
    expect(parseRef(r)!.peer!.inner.scheme).toBe('ev');
    expect(parseRef(`peer:${log}/${r}`)).toBeUndefined();
    expect(parseRef('peer:notalog/ev:x')).toBeUndefined();
  });
  it('strict refuses unregistered schemes; tolerant parses them', () => {
    expect(validateRefV1('zz:1').length).toBeGreaterThan(0);
    expect(validateRefV1('zz:1', { mode: 'tolerant' })).toEqual([]);
    expect(validateRefV1('has space:1').length).toBeGreaterThan(0);
    expect(validateRefV1('ev:').length).toBeGreaterThan(0);
  });
});
