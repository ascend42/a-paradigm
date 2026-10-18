/**
 * #identity presence (spec §19.1 release gate (c), P8-D84; T-2026-10-17-009(c),
 * Aegis S34-10) — PresenceToken is a branded type minted only by the presence
 * module: unforgeable by type (compiled fixture) and at runtime (brand check,
 * private mint key), purpose-bound, single-use and fresh. Production cannot
 * obtain one before M1.3 (`requestPresence` refuses).
 */
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { consumePresence, PRESENCE_TOKEN_TTL_MS, PresenceToken, requestPresence } from '../src/kernel/identity/presence.js';
import { mintTestPresence } from '../src/kernel/testing.js';
import { PKG_ROOT } from './helpers.js';

describe('#identity PresenceToken (runtime)', () => {
  it('a minted token is accepted once for its purpose, then reads `used`', () => {
    const t = mintTestPresence();
    expect(PresenceToken.is(t)).toBe(true);
    expect(t).toMatchObject({ purpose: 'log.gap.acknowledge', method: 'test-seam' });
    expect(Object.isFrozen(t)).toBe(true);
    expect(consumePresence(t, 'log.gap.acknowledge')).toBe('ok');
    expect(consumePresence(t, 'log.gap.acknowledge')).toBe('used');
  });

  it('stale (older than the TTL) and future-dated tokens read `stale` and are not burned', () => {
    const now = Date.now();
    const old = mintTestPresence('log.gap.acknowledge', { mintedAt: now - PRESENCE_TOKEN_TTL_MS - 1 });
    expect(consumePresence(old, 'log.gap.acknowledge', now)).toBe('stale');
    const future = mintTestPresence('log.gap.acknowledge', { mintedAt: now + 10_000 });
    expect(consumePresence(future, 'log.gap.acknowledge', now)).toBe('stale');
    expect(consumePresence(future, 'log.gap.acknowledge', now + 10_000)).toBe('ok');
  });

  it('forgeries fail the brand check: strings, look-alikes, prototype objects, copies, proxies', () => {
    const real = mintTestPresence();
    const forgeries: unknown[] = [
      'stub-presence',
      '',
      undefined,
      null,
      { purpose: 'log.gap.acknowledge', method: 'test-seam', mintedAt: Date.now() },
      Object.create(PresenceToken.prototype),
      { ...real },
      Object.assign(Object.create(PresenceToken.prototype), real),
      new Proxy(real, {}),
    ];
    for (const f of forgeries) {
      expect(PresenceToken.is(f)).toBe(false);
      expect(consumePresence(f, 'log.gap.acknowledge')).toBe('not-a-token');
    }
    expect(consumePresence(real, 'log.gap.acknowledge')).toBe('ok'); // the proxy did not burn it
  });

  it('nothing outside the module can construct one: no mint key, no subclass, no Reflect.construct', () => {
    const Ctor = PresenceToken as unknown as new (...a: unknown[]) => PresenceToken;
    expect(() => new Ctor(Symbol('gnomon.presence.mint'), 'log.gap.acknowledge', 'test-seam', Date.now())).toThrow(TypeError);
    class Sub extends Ctor {}
    expect(() => new Sub()).toThrow(TypeError);
    expect(() => Reflect.construct(Ctor, [undefined, 'log.gap.acknowledge', 'test-seam', Date.now()])).toThrow(TypeError);
  });

  it('production presence is not available before M1.3: requestPresence refuses UNSUPPORTED{presence-unavailable}', async () => {
    const err = await requestPresence('log.gap.acknowledge').then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RefusedError);
    expect((err as RefusedError).refusal).toMatchObject({ code: 'UNSUPPORTED', data: { reason: 'presence-unavailable', milestone: 'M1.3' } });
  });
});

describe('#identity PresenceToken (type level)', () => {
  const fixture = path.join(PKG_ROOT, 'test', 'type-fixtures', 'presence-forgery.ts');
  const options: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2023.d.ts'],
    types: ['node'],
    typeRoots: [path.resolve(PKG_ROOT, '..', '..', 'node_modules', '@types')],
    skipLibCheck: true,
  };
  const diagnosticsOf = (stripExpectErrors: boolean): readonly ts.Diagnostic[] => {
    const host = ts.createCompilerHost(options);
    const read = host.readFile.bind(host);
    host.readFile = (f) => {
      const text = read(f);
      return stripExpectErrors && path.resolve(f) === fixture && text ? text.replace(/\/\/ @ts-expect-error.*$/gm, '') : text;
    };
    const program = ts.createProgram([fixture], options, host);
    const sf = program.getSourceFile(fixture)!;
    return [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
  };
  const fmt = (ds: readonly ts.Diagnostic[]) => ds.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));

  it('every forgery in the fixture is a type error (no unused @ts-expect-error)', () => {
    expect(fmt(diagnosticsOf(false))).toEqual([]);
  }, 60_000);

  it('self-test: without the expectations each forgery line errors (8 forgeries)', () => {
    const ds = diagnosticsOf(true);
    const lines = new Set(ds.map((d) => d.file!.getLineAndCharacterOfPosition(d.start!).line));
    expect(lines.size).toBeGreaterThanOrEqual(8);
  }, 60_000);
});
