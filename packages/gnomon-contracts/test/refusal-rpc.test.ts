/**
 * refusal:v1 (G-CON-02 partial: Warpline's refusal shape is a strict subset)
 * and gnomon-rpc:v1 (hello negotiation, frozen verbs, clientApiId).
 *
 * Warpline is NEVER imported: its refusal.ts/admit.ts/predict.ts sources are
 * read as text to extract the enums and the exit table, and fixtures of
 * Warpline's shape are built from them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  refuse,
  refusalOf,
  validateRefusalV1,
  exitCodeFor,
  exitCodeForResult,
  jsonRpcCodeFor,
  REFUSAL_CODES,
  REFUSAL_GATES,
  RETRIABILITIES,
  WARPLINE_REFUSAL_CODES,
  MAX_CONTESTED,
  VOICE_REFUSAL_REASONS,
  LINK_REFUSAL_REASONS,
  RefusedError,
  negotiateHello,
  GNOMON_RPC_V1,
  VERBS,
  VERB_NAMES,
  RELAY_NAMES,
  CLIENT_METHODS,
  renderEnumValue,
  computeClientApiId,
  computeKitId,
  CLIENT_API_DESCRIPTOR,
  CLIENT_API_ID,
  KIT_ID,
  KIT_V1_DESCRIPTOR,
  CARD_KINDS,
  CARD_RESERVED_VALUES,
  type RefusalCode,
} from '../src/index.js';
import { jsonSchemaErrors, unionLiterals } from './helpers.js';

const wl = (rel: string) => readFileSync(fileURLToPath(new URL(`../../warpline/src/${rel}`, import.meta.url)), 'utf8');
const refusalSrc = wl('fabric/refusal.ts');
const W_CODES = unionLiterals(refusalSrc, 'RefusalCode');
const W_GATES = unionLiterals(refusalSrc, 'RefusalGate');
const W_RETRY = unionLiterals(refusalSrc, 'Retriability');
const W_ADMIT = unionLiterals(wl('fabric/admit.ts'), 'AdmitStatus');
const W_RULES = unionLiterals(wl('predict.ts'), 'KnotRule');
const W_EXIT: Record<string, number> = Object.fromEntries(
  [.../const EXIT_FOR[^{]*\{([^}]+)\}/.exec(refusalSrc)![1]!.matchAll(/([A-Z_]+):\s*(\d+)/g)].map((m) => [m[1]!, Number(m[2])]),
);
const refusalSchema = JSON.parse(readFileSync(fileURLToPath(new URL('../schemas/refusal.v1.schema.json', import.meta.url)), 'utf8'));

/** Build a refusal exactly as Warpline's shape would (no `data`, Warpline enums). */
function warplineRefusal(code: string, gate: string, retriable: string, verdict: string | null, rule: string | null, withOverride: boolean) {
  return {
    schemaVersion: 'refusal:v1',
    code,
    verdict,
    gate,
    retriable,
    contested: [{ stableKey: 'src/a.ts#f', symbol: 'f', rule, conflictingSlots: ['body'], rank: 'direct' }],
    contestedTotal: 40,
    pointers: { knotPayloadId: 'kp:abc', proposedStateId: 'st:1', rebasedOnto: 'sv:2', claimId: 'claim:v1:x', symbols: ['f'] },
    next: [{ verb: 'resolve', params: { knot: 'kp:abc' }, requires: ['resolution'], principal: 'human' }],
    ...(withOverride ? { override: { flag: 'acceptBreach', principal: 'human' } } : {}),
  };
}

describe('G-CON-02 (partial): Warpline refusal:v1 is a strict subset of Gnomon refusal:v1', () => {
  it('extracted Warpline enums are non-empty (the parse worked)', () => {
    expect(W_CODES).toHaveLength(12);
    expect(W_GATES.length).toBeGreaterThan(0);
    expect(W_ADMIT.length).toBeGreaterThan(0);
    expect(W_RULES.length).toBeGreaterThan(0);
  });
  it('codes, gates and retriability are subsets; the twelve codes are listed in order', () => {
    expect([...WARPLINE_REFUSAL_CODES]).toEqual(W_CODES);
    for (const c of W_CODES) expect(REFUSAL_CODES).toContain(c);
    for (const g of W_GATES) expect(REFUSAL_GATES).toContain(g);
    expect([...RETRIABILITIES]).toEqual(W_RETRY);
  });
  it('exit codes for Warpline codes equal Warpline’s table', () => {
    for (const c of W_CODES) expect(exitCodeFor(c as RefusalCode)).toBe(W_EXIT[c]);
  });
  it('the Refusal interface keys are a subset of Gnomon’s', () => {
    const body = /export interface Refusal \{([\s\S]*?)\n\}/.exec(refusalSrc)![1]!;
    const keys = [...body.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThanOrEqual(9);
    for (const k of keys) expect(Object.keys(refusalSchema.properties)).toContain(k);
    expect(refusalOf({ refusal: refuse({ code: 'AUTH' }) })).toBeDefined();
    expect(MAX_CONTESTED).toBe(Number(/MAX_CONTESTED = (\d+)/.exec(refusalSrc)![1]));
  });
  it('every Warpline-shaped refusal validates (TS strict + JSON Schema), over the full enum product', () => {
    let n = 0;
    for (const code of W_CODES)
      for (const gate of W_GATES)
        for (const retriable of W_RETRY)
          for (const verdict of [...W_ADMIT, null])
            for (const rule of [W_RULES[n % W_RULES.length]!, null]) {
              const r = warplineRefusal(code, gate, retriable, verdict, rule, n % 2 === 0);
              const errs = validateRefusalV1(r);
              if (errs.length) throw new Error(`${JSON.stringify(r)}: ${errs.join('; ')}`);
              expect(jsonSchemaErrors(refusalSchema, r)).toEqual([]);
              n++;
            }
    expect(n).toBeGreaterThan(1000);
  });
});

describe('refuse() / refusalOf() (Warpline semantics + Gnomon codes)', () => {
  it('ranks direct before ripple, caps at 32, keeps the full total, prunes pointers', () => {
    const contested = Array.from({ length: 40 }, (_, i) => ({
      stableKey: `k${String(i).padStart(2, '0')}`,
      symbol: 's',
      rule: null,
      conflictingSlots: [],
      rank: (i % 2 ? 'direct' : 'ripple') as 'direct' | 'ripple',
    }));
    const r = refuse({ code: 'GATE_REFUSED', verdict: 'KNOT', contested, pointers: { knotPayloadId: '', symbols: [] } });
    expect(r.contested).toHaveLength(32);
    expect(r.contestedTotal).toBe(40);
    expect(r.contested.slice(0, 20).every((c) => c.rank === 'direct')).toBe(true);
    expect(r.pointers).toEqual({});
    expect(JSON.stringify(refuse({ code: 'GATE_REFUSED', verdict: 'KNOT', contested }))).toBe(
      JSON.stringify(refuse({ code: 'GATE_REFUSED', verdict: 'KNOT', contested: [...contested].reverse() })),
    );
  });
  it('Gnomon code defaults per §4.6', () => {
    const b = refuse({ code: 'BUDGET_DENIED' });
    expect([b.gate, b.retriable, b.next[0]!.verb, b.next[0]!.principal, exitCodeFor('BUDGET_DENIED')]).toEqual(['budget', 'retry-with-override', 'approve', 'human', 6]);
    const p = refuse({ code: 'PERMIT_REQUIRED' });
    expect([p.gate, p.retriable, p.next[0]!.verb, p.next[0]!.principal, exitCodeFor('PERMIT_REQUIRED')]).toEqual(['budget', 'retry-corrected', 'permit.reserve', 'agent', 2]);
    const c = refuse({ code: 'CAS_LOST' });
    expect([c.gate, c.retriable, c.next[0]!.verb, exitCodeFor('CAS_LOST')]).toEqual(['claim', 'retry-corrected', 'status', 7]);
    const bi = refuse({ code: 'BILLING_REFUSED' });
    expect([bi.gate, bi.retriable, bi.next[0]!.verb, exitCodeFor('BILLING_REFUSED')]).toEqual(['billing', 'never', 'approve', 8]);
    const m = refuse({ code: 'MODEL_UNAVAILABLE' });
    expect([m.gate, m.retriable, m.next[0]!.verb, exitCodeFor('MODEL_UNAVAILABLE')]).toEqual(['model', 'retry-with-override', 'approve', 9]);
    expect(refuse({ code: 'AUTH' }).next).toEqual([]);
  });
  it('exit and JSON-RPC code maps are total and the RPC codes distinct', () => {
    const rpc = REFUSAL_CODES.map((c) => jsonRpcCodeFor(c));
    expect(new Set(rpc).size).toBe(REFUSAL_CODES.length);
    expect(jsonRpcCodeFor('MODEL_UNAVAILABLE')).toBe(-32031);
    for (const c of REFUSAL_CODES) expect(Number.isInteger(exitCodeFor(c))).toBe(true);
    expect(exitCodeForResult({})).toBe(0);
    expect(exitCodeForResult({ refusal: refuse({ code: 'STALE_BASE' }) })).toBe(5);
  });
  it('refusalOf finds direct, one-envelope, and JSON-RPC error refusals only', () => {
    const r = refuse({ code: 'FORBIDDEN', gate: 'voice', data: { reason: 'voice-off' } });
    expect(refusalOf({ refusal: r })).toBe(r);
    expect(refusalOf({ shadow: true, result: { refusal: r } })).toBe(r);
    expect(refusalOf({ error: { code: -32002, message: 'x', data: r } })).toBe(r);
    expect(refusalOf({ a: { b: { refusal: r } } })).toBeUndefined();
    expect(refusalOf({ refusal: { code: 'AUTH' } })).toBeUndefined();
    expect(new RefusedError(r, 'no').refusal).toBe(r);
  });
  it('voice and link reasons are reserved (M1.1) and validate', () => {
    expect(VOICE_REFUSAL_REASONS).toContain('voice-off');
    // 25 from §14.7 (P8-D58) + voice-strictness (§4.11, P8-D86–D88).
    expect(VOICE_REFUSAL_REASONS).toHaveLength(26);
    expect(VOICE_REFUSAL_REASONS).toContain('voice-strictness');
    expect(LINK_REFUSAL_REASONS).toContain('warpline-sync-absent');
    for (const reason of [...VOICE_REFUSAL_REASONS, ...LINK_REFUSAL_REASONS]) {
      expect(validateRefusalV1(refuse({ code: 'FORBIDDEN', gate: reason.startsWith('voice') ? 'voice' : 'link', data: { reason } }))).toEqual([]);
    }
  });
});

describe('gnomon-rpc:v1 hello negotiation (§4.9)', () => {
  it('chooses the highest shared version and intersects features', () => {
    const r = negotiateHello({ clientApis: ['gnomon-rpc:v1', 'gnomon-rpc:v2'], features: ['a', 'b'] }, ['gnomon-rpc:v1', 'gnomon-rpc:v2'], ['b', 'c']);
    expect(r).toEqual({ ok: true, clientApi: 'gnomon-rpc:v2', features: ['b'] });
    expect(negotiateHello({ clientApis: ['gnomon-rpc:v2', 'gnomon-rpc:v1'], features: [] })).toMatchObject({ ok: true, clientApi: GNOMON_RPC_V1 });
  });
  it('a client naming none the kernel speaks ⇒ UNSUPPORTED{data:{offered[]}}', () => {
    const r = negotiateHello({ clientApis: ['gnomon-rpc:v7'], features: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.code).toBe('UNSUPPORTED');
      expect(r.refusal.data).toEqual({ offered: ['gnomon-rpc:v7'] });
      expect(validateRefusalV1(r.refusal)).toEqual([]);
    }
  });
});

describe('frozen client surface (§5): 12 verbs + 2 relays', () => {
  it('names, order and freezing', () => {
    expect(VERB_NAMES).toEqual([
      'status', 'session.open', 'session.send', 'session.stop', 'log.append', 'log.read',
      'permit.reserve', 'approve', 'contract.register', 'contract.claim', 'oracle.run', 'ref.resolve',
    ]);
    expect(RELAY_NAMES).toEqual(['mod.view', 'mod.command']);
    expect(CLIENT_METHODS).toHaveLength(14);
    expect(Object.isFrozen(VERBS)).toBe(true);
    expect(Object.isFrozen(VERBS[0]!.access)).toBe(true);
    expect(() => (VERBS as unknown as unknown[]).push({})).toThrow();
  });
  it('approve is the only human-only verb; the peer column is refused everywhere', () => {
    expect(VERBS.filter((v) => v.humanOnly).map((v) => v.verb)).toEqual(['approve']);
    expect(VERBS.every((v) => v.access.peer === false)).toBe(true);
  });
  it('unknown additive enum values render opaquely', () => {
    expect(renderEnumValue('card.kind', 'permission')).toEqual({ known: true, value: 'permission' });
    expect(renderEnumValue('card.kind', 'quorum')).toEqual({ known: false, opaque: 'quorum' });
    expect(renderEnumValue('principal.kind', 'peer').known).toBe(true);
  });
  it('M1.1 reservations (P8-D58, P8-R9) are in the card enums', () => {
    for (const set of Object.values(CARD_RESERVED_VALUES)) for (const k of set.kind) expect(CARD_KINDS).toContain(k);
  });
});

describe('clientApiId / kitId (§12.3, §12.8)', () => {
  it('stable: recomputation is identical and well-formed', () => {
    expect(computeClientApiId()).toBe(CLIENT_API_ID);
    expect(computeKitId()).toBe(KIT_ID);
    expect(CLIENT_API_ID).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it('moves with a verb change and with a kit change; key order does not matter', () => {
    const d = JSON.parse(JSON.stringify(CLIENT_API_DESCRIPTOR));
    expect(computeClientApiId(d)).toBe(CLIENT_API_ID);
    d.verbs[0].params = ['x?'];
    expect(computeClientApiId(d)).not.toBe(CLIENT_API_ID);
    const kit2 = computeKitId({ ...KIT_V1_DESCRIPTOR, blocks: [...KIT_V1_DESCRIPTOR.blocks, 'Chart'] });
    expect(computeClientApiId(CLIENT_API_DESCRIPTOR, kit2)).not.toBe(CLIENT_API_ID);
    const reordered = Object.fromEntries(Object.entries(CLIENT_API_DESCRIPTOR).reverse());
    expect(computeClientApiId(reordered)).toBe(CLIENT_API_ID);
  });
});
