/**
 * symbol-integrity.test — Symbol Integrity Phase 1 regression tests
 * (T-2026-10-13-001). Written FIRST, before the fix: these are expected to
 * FAIL on the pre-fix code and pass once the builder lands Phase 1.
 *
 * Contract under test:
 *  1. Gate identity — a gate declared in portal.yaml (v2 MAP form) and
 *     referenced from a .purpose component (`gates: [^authenticated]`) yields
 *     exactly ONE `^authenticated` entry, whose description is the portal
 *     declaration (not the synthesized "Referenced from ..."), and whose
 *     referencedBy edge reaches the component.
 *  2. Undeclared references — a symbol only ever REFERENCED (never defined)
 *     is marked `declared === false`; declared symbols are not.
 *  3. Within-category duplicates — two .purpose files defining the same
 *     component id are surfaced by aggregation, not silently collapsed.
 *  4. Lookup normalization — getSymbol is EXACT (edges, hashing); the
 *     user-input resolver resolveSymbol tolerates case differences and bare
 *     (prefix-less) names when unambiguous; ambiguous bare names → candidates.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { aggregateFromDirectory } from './aggregator.js';
import { buildSymbolIndex, getSymbol, getReferencesTo, resolveSymbol } from './symbol-index.js';
import { findDuplicateDeclarations } from './integrity.js';
import type { AggregationResult, SymbolIndex } from './types.js';

let tmpDir: string;

function write(rel: string, content: string): string {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

async function load(): Promise<{ result: AggregationResult; idx: SymbolIndex }> {
  const result = await aggregateFromDirectory(tmpDir);
  return { result, idx: buildSymbolIndex(result) };
}

const PORTAL_MAP = [
  'version: 2.0.0',
  'gates:',
  '  authenticated:',
  '    description: User must be logged in',
  '    check: session.user != null',
  '    prizes: []',
  '',
].join('\n');

const BILLING_PURPOSE = [
  'version: "2.0"',
  'components:',
  '  billing-page:',
  '    description: Billing page',
  '    gates: [^authenticated]',
  '',
].join('\n');

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'symbol-integrity-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('gate identity (portal map-form gate referenced from .purpose)', () => {
  beforeEach(() => {
    write('portal.yaml', PORTAL_MAP);
    write('src/billing/.purpose', BILLING_PURPOSE);
  });

  it('getSymbol returns the portal declaration, not the synthesized reference', async () => {
    const { idx } = await load();
    const entry = getSymbol(idx, '^authenticated');
    expect(entry, '^authenticated should resolve').toBeDefined();
    expect(entry!.description).toBe('User must be logged in');
  });

  it('getReferencesTo(^authenticated) reaches #billing-page', async () => {
    const { idx } = await load();
    const refs = getReferencesTo(idx, '^authenticated').map((e) => e.symbol);
    expect(refs).toEqual(['#billing-page']);
  });

  it('produces exactly one ^authenticated entry in the index', async () => {
    const { idx } = await load();
    const matches = [...idx.entries.values()].filter((e) => e.symbol === '^authenticated');
    expect(
      matches.map((e) => ({ id: e.id, source: e.source, description: e.description })),
    ).toHaveLength(1);
  });
});

describe('undeclared references', () => {
  beforeEach(() => {
    write(
      'src/app/.purpose',
      [
        'version: "2.0"',
        'components:',
        '  app-shell:',
        '    description: App shell',
        '    gates: [^ghost, ^admin-only]',
        'gates:',
        '  admin-only:',
        '    description: Admin role required',
        '',
      ].join('\n'),
    );
  });

  it('marks a referenced-but-never-defined symbol as declared === false', async () => {
    const { idx } = await load();
    const ghost = getSymbol(idx, '^ghost');
    expect(ghost, '^ghost should still be indexed as a reference').toBeDefined();
    // `declared` is a new Phase 1 field — loose typing so this fails at runtime, not compile.
    expect((ghost as any).declared).toBe(false);
  });

  it('does not mark an inline-declared gate as undeclared', async () => {
    const { idx } = await load();
    const admin = getSymbol(idx, '^admin-only');
    expect(admin).toBeDefined();
    expect(admin!.description).toBe('Admin role required');
    expect((admin as any).declared).not.toBe(false);
  });

  it('does not mark a declared component as undeclared', async () => {
    const { idx } = await load();
    const shell = getSymbol(idx, '#app-shell');
    expect(shell).toBeDefined();
    expect((shell as any).declared).not.toBe(false);
  });
});

describe('within-category duplicates', () => {
  it('surfaces the same component id defined in two .purpose files', async () => {
    write('src/a/.purpose', 'version: "2.0"\ncomponents:\n  foo:\n    description: Foo in A\n');
    write('src/b/.purpose', 'version: "2.0"\ncomponents:\n  foo:\n    description: Foo in B\n');
    const { result } = await load();

    // Settled surface: aggregation.duplicateSymbols lists '#foo' with BOTH
    // files (the src/a definition is shadowed by src/b, last-wins).
    const dup = (result.duplicateSymbols ?? []).find((d) => d.symbol === '#foo');
    expect(dup, `duplicateSymbols was ${JSON.stringify(result.duplicateSymbols ?? [])}`).toBeDefined();
    expect([...dup!.files].sort()).toEqual([
      path.join(tmpDir, 'src/a/.purpose'),
      path.join(tmpDir, 'src/b/.purpose'),
    ].sort());
  });
});

describe('lookup normalization', () => {
  it('resolveSymbol resolves case-insensitive and bare unambiguous names', async () => {
    write('portal.yaml', PORTAL_MAP);
    write('src/billing/.purpose', BILLING_PURPOSE);
    const { idx } = await load();
    expect(resolveSymbol(idx, '^Authenticated').entry?.symbol).toBe('^authenticated');
    expect(resolveSymbol(idx, 'authenticated').entry?.symbol).toBe('^authenticated');
  });

  it('getSymbol stays EXACT — no case folding, no bare names', async () => {
    write('src/foo/.purpose', 'version: "2.0"\ncomponents:\n  foo:\n    description: Foo\n');
    const { idx } = await load();
    expect(getSymbol(idx, '#foo')?.symbol).toBe('#foo');
    expect(getSymbol(idx, '#Foo')).toBeUndefined();
    expect(getSymbol(idx, 'foo')).toBeUndefined();
    // ...edges resolve exactly too.
    expect(getReferencesTo(idx, '#Foo')).toEqual([]);
  });

  it('resolveSymbol returns candidates for an ambiguous bare name (#auth and ^auth)', async () => {
    write(
      'src/auth/.purpose',
      [
        'version: "2.0"',
        'components:',
        '  auth:',
        '    description: Auth module',
        'gates:',
        '  auth:',
        '    description: Auth gate',
        '',
      ].join('\n'),
    );
    const { idx } = await load();
    // Sanity: both exist under their prefixed names.
    expect(getSymbol(idx, '#auth')).toBeDefined();
    expect(getSymbol(idx, '^auth')).toBeDefined();
    const r = resolveSymbol(idx, 'auth');
    expect(r.entry).toBeUndefined();
    expect(r.candidates.map((c) => c.symbol).sort()).toEqual(['#auth', '^auth']);
  });
});

describe('canonical merge keeps every contributor\'s reference edges', () => {
  it('keeps edges from a .purpose gate block when the portal declaration wins', async () => {
    write('portal.yaml', PORTAL_MAP);
    write(
      'src/auth/.purpose',
      [
        'version: "2.0"',
        'components:',
        '  session-store:',
        '    description: Session store',
        'gates:',
        '  authenticated:',
        '    description: Purpose-side gate notes',
        '    requires: ["#session-store"]',
        '    signals: ["!login-required"]',
        'signals:',
        '  login-required:',
        '    description: Emitted when a login is required',
        '',
      ].join('\n'),
    );
    const { idx } = await load();
    const gate = getSymbol(idx, '^authenticated')!;
    expect(gate.description).toBe('User must be logged in'); // portal won
    expect(gate.references).toEqual(expect.arrayContaining(['#session-store', '!login-required']));
    expect(getReferencesTo(idx, '#session-store').map((e) => e.symbol)).toContain('^authenticated');
    expect(getReferencesTo(idx, '!login-required').map((e) => e.symbol)).toContain('^authenticated');
  });

  it('keeps portal flow gate edges when a .purpose flow with the same symbol wins', async () => {
    write(
      'portal.yaml',
      [
        'version: 2.0.0',
        'gates:',
        '  authenticated:',
        '    description: User must be logged in',
        '    prizes: []',
        'flows:',
        '  checkout:',
        '    description: Portal checkout flow',
        '    gates: ["^authenticated"]',
        '',
      ].join('\n'),
    );
    write(
      'src/checkout/.purpose',
      'version: "2.0"\nflows:\n  checkout:\n    description: Checkout flow (purpose)\n',
    );
    const { idx } = await load();
    const flow = getSymbol(idx, '$checkout')!;
    expect(flow.description).toBe('Checkout flow (purpose)'); // purpose won
    expect(flow.references).toContain('^authenticated');
    expect(getReferencesTo(idx, '^authenticated').map((e) => e.symbol)).toContain('$checkout');
  });

  it('connects a collapsed prize signal to EVERY gate that awards it', async () => {
    write(
      'portal.yaml',
      [
        'version: 2.0.0',
        'gates:',
        '  gate-a:',
        '    description: Gate A',
        '    prizes:',
        '      - id: welcome',
        '  gate-b:',
        '    description: Gate B',
        '    prizes:',
        '      - id: welcome',
        '',
      ].join('\n'),
    );
    const { result, idx } = await load();
    expect(result.symbols.filter((e) => e.symbol === '!welcome')).toHaveLength(1);
    const awarding = getReferencesTo(idx, '!welcome').map((e) => e.symbol).sort();
    expect(awarding).toEqual(['^gate-a', '^gate-b']);
    // Two gates awarding one prize is one signal, not a duplicate declaration.
    expect(findDuplicateDeclarations(result.symbols).map((d) => d.symbol)).not.toContain('!welcome');
  });
});

describe('portal prize + .purpose signal exemption', () => {
  const PRIZE_PORTAL = [
    'version: 2.0.0',
    'gates:',
    '  onboarding:',
    '    description: Onboarding gate',
    '    prizes:',
    '      - id: welcome',
    '  invite:',
    '    description: Invite gate',
    '    prizes:',
    '      - id: welcome',
    '',
  ].join('\n');
  const SIGNAL_PURPOSE = 'version: "2.0"\nsignals:\n  welcome:\n    description: Welcome signal\n';

  it('does not flag a signal declared once in .purpose and once as a portal prize', async () => {
    write('portal.yaml', PRIZE_PORTAL.replace(/  invite:[\s\S]*$/, ''));
    write('src/onboarding/.purpose', SIGNAL_PURPOSE);
    const { result } = await load();
    expect(findDuplicateDeclarations(result.symbols).map((d) => d.symbol)).not.toContain('!welcome');
  });

  it('still exempts it when several portal gates award the same prize', async () => {
    write('portal.yaml', PRIZE_PORTAL);
    write('src/onboarding/.purpose', SIGNAL_PURPOSE);
    const { result } = await load();
    expect(findDuplicateDeclarations(result.symbols).map((d) => d.symbol)).not.toContain('!welcome');
  });

  it('does flag the signal when a SECOND .purpose file also declares it', async () => {
    write('portal.yaml', PRIZE_PORTAL);
    write('src/onboarding/.purpose', SIGNAL_PURPOSE);
    write('src/invite/.purpose', SIGNAL_PURPOSE);
    const { result } = await load();
    expect(findDuplicateDeclarations(result.symbols).map((d) => d.symbol)).toContain('!welcome');
  });
});

describe('one duplicate rule (aggregation === integrity)', () => {
  it('aggregation.duplicateSymbols applies the portal + .purpose exemption', async () => {
    write('portal.yaml', PORTAL_MAP);
    write(
      'src/auth/.purpose',
      'version: "2.0"\ngates:\n  authenticated:\n    description: Purpose-side gate\n',
    );
    write('src/a/.purpose', 'version: "2.0"\ncomponents:\n  foo:\n    description: A\n');
    write('src/b/.purpose', 'version: "2.0"\ncomponents:\n  foo:\n    description: B\n');
    const { result } = await load();
    const fromAggregation = (result.duplicateSymbols ?? []).map((d) => d.symbol).sort();
    expect(fromAggregation).not.toContain('^authenticated');
    expect(fromAggregation).toContain('#foo');
    expect(result.duplicateSymbols ?? []).toEqual(findDuplicateDeclarations(result.symbols));
  });
});
