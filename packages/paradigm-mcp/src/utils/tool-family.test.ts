/**
 * #tool-family — listed family schema shape, op signatures, required-param audit.
 */
import { describe, it, expect } from 'vitest';
import { defineFamily, HANDLER_DEFAULTED, familyAnnotations } from './tool-family.js';
import type { ToolDefinition } from './tool-registry.js';

const loreRecord: ToolDefinition = {
  name: 'paradigm_lore_record',
  description: 'Record lore',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Title' },
      summary: { type: 'string', description: 'Summary' },
      symbols_touched: { type: 'array', items: { type: 'string' }, description: 'Symbols' },
      type: { type: 'string', enum: ['agent-session', 'insight'] },
      decisions: {
        type: 'array',
        description: 'Decisions made',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'id' },
            decision: { type: 'string', description: 'what' },
            rationale: { type: 'string', description: 'why' },
          },
          required: ['id', 'decision', 'rationale'],
        },
      },
      verification: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['pass', 'fail'] }, details: { type: 'object' } },
      },
    },
    required: ['title', 'summary', 'symbols_touched'],
  },
};

const loreGet: ToolDefinition = {
  name: 'paradigm_lore_get',
  description: 'Get lore',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
};

const protocolRecord: ToolDefinition = {
  name: 'paradigm_protocol_record',
  description: 'Record protocol',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      trigger: { type: 'array', items: { type: 'string' } },
      tags: { type: 'array', items: { type: 'string' } },
      steps: { type: 'array', items: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] } },
    },
    required: ['name', 'description', 'trigger', 'tags', 'steps'],
  },
};

const defs = new Map<string, ToolDefinition>([
  [loreRecord.name, loreRecord],
  [loreGet.name, loreGet],
  [protocolRecord.name, protocolRecord],
]);

describe('defineFamily listed schema', () => {
  const fam = defineFamily({ name: 'paradigm_lore', description: 'Lore.', ops: { record: 'paradigm_lore_record', get: 'paradigm_lore_get' } }, defs);
  const props = (fam.definition.inputSchema as { properties: Record<string, any> }).properties;

  it('keeps nested item shape: property names + nested required, no descriptions', () => {
    expect(props.decisions.type).toBe('array');
    expect(Object.keys(props.decisions.items.properties)).toEqual(['id', 'decision', 'rationale']);
    expect(props.decisions.items.required).toEqual(['id', 'decision', 'rationale']);
    expect(JSON.stringify(props.decisions)).not.toContain('description');
    expect(props.decisions.description).toBeUndefined();
    expect(Object.keys(props.verification.properties)).toEqual(['status', 'details']);
    expect(props.verification.properties.status.enum).toEqual(['pass', 'fail']);
  });

  it("full signatures list every param with required marked '*' and nested shapes inline", () => {
    const d = fam.definition.description!;
    expect(d).toContain('Ops (*=required):');
    expect(d).toContain('record(title*,summary*,symbols_touched*,type,decisions[{id*,decision*,rationale*}],verification{status,details})');
    expect(d).toContain('get(id*)');
  });

  it("'required' signatures list only required params", () => {
    const lean = defineFamily({ name: 'paradigm_lore', description: 'Lore.', ops: { record: 'paradigm_lore_record' }, signatures: 'required' }, defs);
    expect(lean.definition.description).toContain('record(title*,summary*,symbols_touched*)');
    expect(lean.definition.description).not.toContain('verification');
  });

  it('missing-required error echoes the nested shape', () => {
    const res = fam.resolve({ op: 'record', title: 't' });
    expect('error' in res && res.error).toMatch(/missing required: summary, symbols_touched/);
    expect('error' in res && res.error).toContain('decisions[{id*,decision*,rationale*}]');
  });
});

describe('required-param audit (handler defaults)', () => {
  it('protocol_record defaults trigger/tags/steps, so family validation does not require them', () => {
    expect(HANDLER_DEFAULTED.paradigm_protocol_record).toEqual(['trigger', 'tags', 'steps']);
    const fam = defineFamily({ name: 'paradigm_protocol', description: 'Protocols.', ops: { record: 'paradigm_protocol_record' } }, defs);
    const ok = fam.resolve({ op: 'record', name: 'n', description: 'd' });
    expect(ok).toEqual({ legacy: 'paradigm_protocol_record', args: { name: 'n', description: 'd' } });
    const bad = fam.resolve({ op: 'record', name: 'n' });
    expect('error' in bad && bad.error).toMatch(/missing required: description\./);
    expect(fam.definition.description).toContain('record(name*,description*,trigger,tags,steps[{action*}])');
  });

  it('params without a handler default stay required', () => {
    const fam = defineFamily({ name: 'paradigm_lore', description: 'Lore.', ops: { get: 'paradigm_lore_get' } }, defs);
    expect('error' in fam.resolve({ op: 'get' })).toBe(true);
  });
});

describe('per-op annotations (io.gnomon/op-annotations:v1)', () => {
  const ro: ToolDefinition = { name: 'x_list', description: '', inputSchema: { type: 'object' }, annotations: { title: 'List', readOnlyHint: true, destructiveHint: false, openWorldHint: false } };
  const wr: ToolDefinition = { name: 'x_create', description: '', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, destructiveHint: false } };
  const del: ToolDefinition = { name: 'x_delete', description: '', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } };
  const bare: ToolDefinition = { name: 'x_bare', description: '', inputSchema: { type: 'object' } };
  const d = new Map([ro, wr, del, bare].map(t => [t.name, t]));
  const fam = (ops: Record<string, string>) => defineFamily({ name: 'x', description: 'X.', ops }, d).definition;

  it('keeps only declared hints (no title), omits undeclared ops, and adds nothing to the listed definition', () => {
    const family = defineFamily({ name: 'x', description: 'X.', ops: { list: 'x_list', create: 'x_create', bare: 'x_bare' } }, d);
    expect(JSON.stringify(family.definition)).not.toContain('_meta');
    expect(family.opAnnotations).toEqual({
      list: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      create: { readOnlyHint: false, destructiveHint: false },
    });
  });

  it('top level: read-only only when every op is', () => {
    expect(fam({ list: 'x_list' }).annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(fam({ list: 'x_list', create: 'x_create' }).annotations).toEqual({ readOnlyHint: false, destructiveHint: false });
  });

  it('top level: destructive when any op is declared destructive or declares nothing', () => {
    expect(fam({ list: 'x_list', delete: 'x_delete' }).annotations!.destructiveHint).toBe(true);
    expect(fam({ list: 'x_list', bare: 'x_bare' }).annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
  });

  it('idempotent only when every op declares it; read-only + destructive still counts as destructive', () => {
    expect(fam({ delete: 'x_delete' }).annotations!.idempotentHint).toBe(true);
    expect(fam({ delete: 'x_delete', create: 'x_create' }).annotations!.idempotentHint).toBeUndefined();
    expect(familyAnnotations([{ readOnlyHint: true, destructiveHint: true }]).destructiveHint).toBe(true);
    expect(familyAnnotations([{ openWorldHint: false }, { openWorldHint: true }]).openWorldHint).toBe(true);
  });
});
