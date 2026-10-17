/**
 * G-CON-01 — every PR-3 schema validates its fixtures and rejects malformed
 * ones, through BOTH the hand-written TS validator and the generated JSON
 * Schema; the committed schemas/*.json are a fixed point of src/schemas.ts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_SCHEMAS,
  serializeSchema,
  validateEventV1,
  validateRefusalV1,
  validateCardV1,
  validateHelloParams,
  validateHelloResult,
  defaultLabelsFor,
  EVENT_KINDS,
  EVENT_KIND_NAMES,
  isKnownKind,
  opaqueEventView,
  CARD_KINDS,
  CARD_STATES,
  CARD_FLAGS,
  REFUSAL_CODES,
  REFUSAL_GATES,
  AUDIENCES,
  SENSITIVITIES,
  KIT_ID,
  CLIENT_API_ID,
  isCardDecidable,
} from '../src/index.js';
import { jsonSchemaErrors } from './helpers.js';
import * as F from './fixtures.js';

const schemaDir = fileURLToPath(new URL('../schemas/', import.meta.url));
const onDisk = (name: string) => readFileSync(schemaDir + name, 'utf8');
const S = (name: string) => JSON.parse(onDisk(name));

describe('schemas/ is a fixed point of src/schemas.ts', () => {
  for (const [name, schema] of Object.entries(CONTRACT_SCHEMAS)) {
    it(`${name} matches the generated schema (run \`npm run schemas\` if this fails)`, () => {
      expect(onDisk(name)).toBe(serializeSchema(schema));
    });
  }
  it('client-api.ids.json pins kitId and clientApiId', () => {
    expect(S('client-api.ids.json')).toEqual({ kitId: KIT_ID, clientApiId: CLIENT_API_ID });
  });
});

describe('schema ↔ TS enum lockstep', () => {
  it('event', () => {
    const s = S('event.v1.schema.json');
    expect(s.properties.audience.enum).toEqual([...AUDIENCES]);
    expect(s.properties.sensitivity.enum).toEqual([...SENSITIVITIES]);
    expect(s['x-gnomon-kinds']).toEqual([...EVENT_KIND_NAMES]);
  });
  it('refusal', () => {
    const s = S('refusal.v1.schema.json');
    expect(s.properties.code.enum).toEqual([...REFUSAL_CODES]);
    expect(s.properties.gate.enum).toEqual([...REFUSAL_GATES]);
    expect(s.properties.gate['x-gnomon-additive']).toBe(true);
    expect(s.properties.code['x-gnomon-additive']).toBeUndefined();
  });
  it('card', () => {
    const s = S('card.v1.schema.json');
    expect(s.properties.kind.enum).toEqual([...CARD_KINDS]);
    expect(s.properties.state.enum).toEqual([...CARD_STATES]);
    expect(s.properties.flags.items.enum).toEqual([...CARD_FLAGS]);
  });
});

type Validator = (v: unknown) => string[];
const suites: Array<{
  name: string;
  schema: () => any;
  validate: Validator;
  good: unknown[];
  bad: Array<[string, unknown]>;
  tsOnly?: string[];
}> = [
  { name: 'event:v1', schema: () => S('event.v1.schema.json'), validate: (v) => validateEventV1(v), good: [F.goodEvent, F.minimalEvent, F.peerLinkEvent], bad: F.badEvents },
  { name: 'refusal:v1', schema: () => S('refusal.v1.schema.json'), validate: (v) => validateRefusalV1(v), good: F.goodRefusals, bad: F.badRefusals },
  {
    name: 'card:v1',
    schema: () => S('card.v1.schema.json'),
    validate: (v) => validateCardV1(v),
    good: [F.goodCard, F.heldVoiceCard, F.handoffCard],
    bad: F.badCards,
    tsOnly: ['held without heldUntil', 'handoff without direction'],
  },
  {
    name: 'hello params',
    schema: () => {
      const s = S('gnomon-rpc.v1.hello.schema.json');
      return { ...s.$defs.params, $defs: s.$defs };
    },
    validate: (v) => validateHelloParams(v),
    good: [F.goodHello, { clientApis: ['gnomon-rpc:v2', 'gnomon-rpc:v1'], features: [], client: { name: 'c', version: '1' } }],
    bad: F.badHellos,
  },
];

describe('G-CON-01: fixtures validate, malformed are rejected', () => {
  for (const s of suites) {
    for (const [i, g] of s.good.entries()) {
      it(`${s.name} good[${i}] passes TS + JSON Schema`, () => {
        expect(s.validate(g)).toEqual([]);
        expect(jsonSchemaErrors(s.schema(), g)).toEqual([]);
      });
    }
    for (const [label, b] of s.bad) {
      it(`${s.name} rejects: ${label}`, () => {
        expect(s.validate(b).length).toBeGreaterThan(0);
        if (!s.tsOnly?.includes(label)) expect(jsonSchemaErrors(s.schema(), b).length).toBeGreaterThan(0);
      });
    }
  }

  it('hello result', () => {
    const r = { clientApi: 'gnomon-rpc:v1', features: [], nonce: 'n', serverKeyId: 'gkey:v1:x', serverSig: 's', clientApiId: CLIENT_API_ID, kitId: KIT_ID };
    expect(validateHelloResult(r)).toEqual([]);
    expect(validateHelloResult({ ...r, clientApi: 'http' }).length).toBeGreaterThan(0);
    expect(validateHelloResult({ ...r, nonce: undefined }).length).toBeGreaterThan(0);
  });
});

describe('compatible-additive rule (§4.9)', () => {
  const futureCard = { ...F.goodCard, kind: 'quorum-vote', state: 'escrowed', flags: ['sparkles'], via: 'telepathy', presence: 'retina' };

  it('strict (producer) refuses unknown additive values; tolerant (client) accepts them', () => {
    expect(validateCardV1(futureCard).length).toBeGreaterThan(0);
    expect(validateCardV1(futureCard, { mode: 'tolerant' })).toEqual([]);
    expect(jsonSchemaErrors(S('card.v1.schema.json'), futureCard, true)).toEqual([]);
  });

  it('a card in an unknown state is never decidable; held only withdraws', () => {
    expect(isCardDecidable({ state: 'escrowed' }, 'allow')).toBe(false);
    expect(isCardDecidable({ state: 'pending' }, 'allow')).toBe(true);
    expect(isCardDecidable({ state: 'pending' }, 'withdraw')).toBe(false);
    expect(isCardDecidable({ state: 'held' }, 'withdraw')).toBe(true);
    expect(isCardDecidable({ state: 'held' }, 'allow')).toBe(false);
  });

  it('unknown fields are ignored in tolerant mode, refused in strict', () => {
    const e = { ...F.minimalEvent, futureField: 1 };
    expect(validateEventV1(e).length).toBeGreaterThan(0);
    expect(validateEventV1(e, { mode: 'tolerant' })).toEqual([]);
  });

  it('unknown event kinds: strict refuses, tolerant accepts and renders opaquely', () => {
    const e = { ...F.minimalEvent, kind: 'future.thing' };
    expect(validateEventV1(e).length).toBeGreaterThan(0);
    expect(validateEventV1(e, { mode: 'tolerant' })).toEqual([]);
    expect(opaqueEventView(e)).toEqual({ kind: 'future.thing', principal: e.principal, at: e.at });
  });

  it('closed enums stay closed even in tolerant mode (refusal code, sensitivity)', () => {
    expect(validateRefusalV1({ ...F.goodRefusals[0], code: 'TEAPOT' }, { mode: 'tolerant' }).length).toBeGreaterThan(0);
    expect(validateEventV1({ ...F.minimalEvent, sensitivity: 'meh' }, { mode: 'tolerant' }).length).toBeGreaterThan(0);
  });

  it('unknown refusal gate / reason tolerated by clients', () => {
    const r = { ...F.goodRefusals[0], gate: 'quantum', data: { reason: 'voice-new-thing' } };
    expect(validateRefusalV1(r).length).toBeGreaterThan(0);
    expect(validateRefusalV1(r, { mode: 'tolerant' })).toEqual([]);
  });
});

describe('event kinds and default labels (§9.1, S32 §6, G-LOG-09 contract half)', () => {
  it('every registered kind has private audience and a valid default sensitivity', () => {
    for (const k of EVENT_KIND_NAMES) {
      const d = defaultLabelsFor(k)!;
      expect(d.audience).toBe('private');
      expect(SENSITIVITIES).toContain(d.sensitivity);
    }
  });
  it('sensitive defaults per §9.1', () => {
    expect(defaultLabelsFor('session.inject')!.sensitivity).toBe('sensitive');
    expect(defaultLabelsFor('turn.event')!.sensitivity).toBe('sensitive');
    expect(defaultLabelsFor('voice.turn.user')!.sensitivity).toBe('sensitive');
    expect(defaultLabelsFor('voice.turn.agent')!.sensitivity).toBe('sensitive');
    expect(defaultLabelsFor('voice.enrol')!.sensitivity).toBe('secret');
    expect(EVENT_KINDS['approval.request']!.fieldLabels).toEqual({ tool_input: 'sensitive' });
    expect(EVENT_KINDS['oracle.result']!.fieldLabels).toEqual({ evidence: 'sensitive' });
    expect(defaultLabelsFor('session.spawned')!.sensitivity).toBe('normal');
    expect(defaultLabelsFor('link.brief.sent')!.sensitivity).toBe('normal');
  });
  it('an unregistered kind has no default (the kernel must refuse it, not guess)', () => {
    expect(defaultLabelsFor('nope.kind')).toBeUndefined();
    expect(isKnownKind('modns.doodle.session.start')).toBe(true);
    expect(defaultLabelsFor('modns.doodle.session.start', 'sensitive')!.sensitivity).toBe('sensitive');
    expect(isKnownKind('credit.outcome')).toBe(true);
  });
  it('M1.1 reservations are present and tagged', () => {
    expect(EVENT_KINDS['approval.voice.arm']!.reserved).toBe('M1.1:P8-D58');
    expect(EVENT_KINDS['request.voice.arm']!.reserved).toBe('M1.1:P8-D58');
    expect(EVENT_KINDS['link.paired']!.reserved).toBe('M1.1:P8-R9');
    expect(EVENT_KINDS['request.link.revoke']!.reserved).toBe('M1.1:P8-R9');
  });
  it('checkDefaultLabels refuses a relaxed label (L6)', () => {
    const e = { ...F.minimalEvent, kind: 'turn.event', sensitivity: 'normal' };
    expect(validateEventV1(e, { checkDefaultLabels: true }).join()).toMatch(/looser/);
    expect(validateEventV1({ ...e, sensitivity: 'secret' }, { checkDefaultLabels: true })).toEqual([]);
  });
});
