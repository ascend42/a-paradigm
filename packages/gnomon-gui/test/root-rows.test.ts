/**
 * Aegis C1e (TD-2026-10-20-514): a root-class card shows, in full, what its ONE touch signs ("This decision signs"),
 * from the kernel's {type:'root-rows', rootDecisions, detail} node verified against contentHash. No Approve on a
 * root-class card whose node is missing, fails the hash, or holds a row this GUI cannot render. After the decision the
 * logged rowsDigest is compared with the shown rows' digest (a mismatch is flagged red). A helper < 1.8.0 adds a
 * one-line notice.
 */
import { describe, expect, it } from 'vitest';
import { cardContentHash, renderCard, rootRowsOf, rowsDigestOf, type MiniDoc, type MiniEl } from '../src/core/render.js';
import { GuiStore } from '../src/core/store.js';

class FText {
  constructor(readonly data: string) {}
}
class FEl implements MiniEl {
  className = '';
  readonly attrs = new Map<string, string>();
  readonly children: Array<FEl | FText> = [];
  constructor(readonly tag: string) {}
  appendChild(c: unknown): unknown {
    this.children.push(c as FEl | FText);
    return c;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  get text(): string {
    return this.children.map((c) => (c instanceof FText ? c.data : c.text)).join('');
  }
  all(): FEl[] {
    return [this, ...this.children.flatMap((c) => (c instanceof FEl ? c.all() : []))];
  }
}
const fdoc: MiniDoc = { createElement: (t) => new FEl(t), createTextNode: (s) => new FText(s) };

const C = 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const MH = `sha256:${'c'.repeat(64)}`;
const PK = `sha256:${'e'.repeat(64)}`;
const HOSTS = Array.from({ length: 12 }, (_, i) => `host-${i}.example.com`);
const ROWS = [
  { schemaVersion: 'grantRow:v1', kind: 'grant.trust', manifestHash: MH, tier: 'community', cardId: C },
  { schemaVersion: 'grantRow:v1', kind: 'grant.capability', manifestHash: MH, capabilities: ['tools:call', 'knowledge:provide'], read: ['/Users/x/notes'], cardId: C },
  { schemaVersion: 'grantRow:v1', kind: 'grant.egress', manifestHash: MH, hosts: HOSTS, cardId: C },
  { schemaVersion: 'grantRow:v2', kind: 'grant.publisher', publisher: 'acme', host: 'gitlab.com', namespace: 'acme', cardId: C },
  { schemaVersion: 'grantRow:v2', kind: 'grant.install', name: 'acme.board', manifestHash: MH, packageHash: PK, cardId: C, source: 'git:gitlab.com/acme/board@' + 'b'.repeat(40) },
];

function card(rows: unknown[] | null, o: { tamper?: boolean; kind?: string; rootDecisions?: string[]; detail?: Record<string, unknown>; nodes?: number; nodeDecisions?: string[] } = {}) {
  const kind = o.kind ?? 'install';
  const decs = o.rootDecisions ?? (kind === 'install' ? ['install'] : kind === 'api-token' ? ['use-api-token'] : ['allow']);
  const detail = { name: 'acme.board', ...(o.detail ?? {}), ...(rows ? { rootRows: rows, rootDecisions: decs } : {}) };
  const base = { cardId: C, kind, requestedBy: 'p:abcdefgh/matt', flags: [] as string[] };
  const contentHash = cardContentHash(base, detail);
  const shown = o.tamper ? { ...detail, name: 'acme.other' } : detail;
  const node = { type: 'root-rows', rootDecisions: o.nodeDecisions ?? decs, detail: shown };
  const children: unknown[] = [{ type: 'Text', text: 'a card' }, ...(rows ? Array.from({ length: o.nodes ?? 1 }, () => node) : [])];
  return { ...base, state: 'pending', contentHash, block: { schemaVersion: 'display-block:v1', type: 'Box', children } } as Record<string, unknown>;
}
const view = (c: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ cardId: C, kind: String(c.kind), requestedBy: 'p:abcdefgh/matt', hsid: null, repo: null, state: 'pending', contentHash: String(c.contentHash), flags: [], decisions: String(c.kind) === 'install' ? ['install', 'deny'] : ['allow', 'deny'], decidable: true, rootRows: rootRowsOf(c), ...extra });
const keysOf = (el: FEl) => el.all().filter((e) => e.attrs.has('data-decision')).map((e) => e.attrs.get('data-decision'));

describe('Aegis C1e: "This decision signs"', () => {
  it('renders every root row IN FULL (every egress host, tier, capabilities + read paths, publisher → host/namespace, mod id/source/packageHash prefix) and keeps Approve', () => {
    const c = card(ROWS);
    const el = renderCard({ doc: fdoc }, view(c), c.block) as FEl;
    const t = el.text;
    expect(t).toContain('This decision signs');
    for (const h of HOSTS) expect(t).toContain(h);
    expect(t).toContain('trust tier community');
    expect(t).toContain('capabilities: tools:call, knowledge:provide · reads: /Users/x/notes');
    expect(t).toContain('publisher acme → gitlab.com/acme');
    expect(t).toContain(`install acme.board from git:gitlab.com/acme/board@${'b'.repeat(40)} · packageHash ${PK.slice(0, 19)}…`);
    expect(keysOf(el)).toEqual(['install', 'deny']);
  });

  it('an empty rootRows shows "its decision row only" and keeps Approve', () => {
    const c = card([], { kind: 'api-token', rootDecisions: ['use-api-token'] });
    const el = renderCard({ doc: fdoc }, { ...view(c), decisions: ['use-api-token', 'deny'] }, c.block) as FEl;
    expect(el.text).toContain('its decision row only');
    expect(keysOf(el)).toEqual(['use-api-token', 'deny']);
  });

  for (const [what, c] of [
    ['no root-rows node', card(null)],
    ['a node whose detail fails contentHash', card(ROWS, { tamper: true })],
    ['a row kind it cannot render', card([...ROWS.slice(0, 4), { schemaVersion: 'grantRow:v1', kind: 'grant.bind', cardId: C }, ROWS[4]])],
  ] as const) {
    it(`${what}: NO Approve on the root-class card (deny stays), and a visible reason`, () => {
      const el = renderCard({ doc: fdoc }, view(c), c.block) as FEl;
      expect(rootRowsOf(c)).toBeNull();
      expect(keysOf(el)).toEqual(['deny']);
      expect(el.text).toContain('there is no Approve here');
    });
  }

  it('a non-root card (permission) is untouched', () => {
    const c = { ...card(null, { kind: 'permission' }) };
    const el = renderCard({ doc: fdoc }, view(c), c.block) as FEl;
    expect(keysOf(el)).toEqual(['allow', 'deny']);
    expect(el.text).not.toContain('This decision signs');
  });

  it('Q2: a helper below 1.8.0 adds a one-line notice on a root card', () => {
    const c = card(ROWS);
    const el = renderCard({ doc: fdoc }, view(c, { batchUnavailable: true }), c.block) as FEl;
    expect(el.text).toContain('older than 1.8.0');
  });
});

describe('Aegis M1: a card made root by the kernel fails closed (voice enrol, uninstall, mod.mcp.config)', () => {
  const ENROL = [{ schemaVersion: 'voiceEnrolRow:v1', op: 'enrol', speakerId: 'spk:abcdefgh/ana', consentHash: MH, cardId: C }];
  const UNINST = [{ schemaVersion: 'grantRow:v2', kind: 'grant.uninstall', name: 'acme.board', packageHash: PK, cardId: C }];
  const families: Array<[string, (o: Parameters<typeof card>[1]) => Record<string, unknown>]> = [
    ['voice enrol', (o) => card(ENROL, { kind: 'strictness', detail: { op: 'voice.enrol' }, ...o })],
    ['uninstall', (o) => card(UNINST, { kind: 'grant', detail: { action: 'mod.uninstall' }, ...o })],
    ['mod.mcp.config', (o) => card([], { kind: 'grant', detail: { action: 'mod.mcp.config' }, ...o })],
  ];
  for (const [what, mk] of families) {
    it(`${what}: a verified node keeps Allow and shows the section`, () => {
      const c = mk({});
      const el = renderCard({ doc: fdoc }, view(c), c.block) as FEl;
      expect(keysOf(el)).toEqual(['allow', 'deny']);
      expect(el.text).toContain('This decision signs');
    });
    for (const [bad, o] of [
      ['a bad-hash node', { tamper: true }],
      ['a duplicate node', { nodes: 2 }],
      ['a node claiming no root decisions (rootDecisions: [] in the hashed detail)', { rootDecisions: [] }],
      ['a node whose rootDecisions differ from the hashed detail', { nodeDecisions: [] }],
    ] as const) {
      it(`${what}: ${bad} → only deny`, () => {
        const c = mk(o);
        expect(rootRowsOf(c)).toBeNull();
        const el = renderCard({ doc: fdoc }, view(c), c.block) as FEl;
        expect(keysOf(el)).toEqual(['deny']);
      });
    }
  }
  it('uninstall / mcp.config with the node missing: grant kind is root by table → only deny', () => {
    const c = card(null, { kind: 'grant', detail: { action: 'mod.uninstall' } });
    const el = renderCard({ doc: fdoc }, view(c), c.block) as FEl;
    expect(keysOf(el)).toEqual(['deny']);
  });
  it('a standing grant (op standing, rootDecisions []) keeps Allow', () => {
    const c = card([], { kind: 'grant', rootDecisions: [], detail: { op: 'standing' } });
    expect(keysOf(renderCard({ doc: fdoc }, view(c), c.block) as FEl)).toEqual(['allow', 'deny']);
  });
});

describe('Aegis C1e: the logged rowsDigest against the shown rows', () => {
  const req = (c: Record<string, unknown>) => ({ seq: 1, kind: 'approval.request', payload: { card: c, flags: [] } });
  it('a matching rowsDigest: no flag; a different or missing one: flagged', () => {
    const c = card(ROWS);
    const ok = new GuiStore();
    ok.apply([req(c), { seq: 2, kind: 'approval.decide', payload: { cardId: C, decision: 'install', rowsDigest: rowsDigestOf(ROWS) } }]);
    expect(ok.rootMismatches).toEqual([]);
    const bad = new GuiStore();
    const what = bad.apply([req(c), { seq: 2, kind: 'approval.decide', payload: { cardId: C, decision: 'install', rowsDigest: `sha256:${'0'.repeat(64)}` } }]);
    expect(what.has('root-mismatch')).toBe(true);
    expect(bad.rootMismatches).toEqual([{ cardId: C, decision: 'install', shown: rowsDigestOf(ROWS), logged: `sha256:${'0'.repeat(64)}` }]);
    const missing = new GuiStore();
    missing.apply([req(c), { seq: 2, kind: 'approval.decide', payload: { cardId: C, decision: 'install' } }]);
    expect(missing.rootMismatches).toHaveLength(1);
    const deny = new GuiStore();
    deny.apply([req(c), { seq: 2, kind: 'approval.decide', payload: { cardId: C, decision: 'deny' } }]);
    expect(deny.rootMismatches).toEqual([]);
  });
});

describe('TD-2026-10-22-769 (Mika F3): the local.config card renders its gnomon-root-local:v1 row, or offers no Allow', () => {
  const ep = (o: Record<string, unknown> = {}) => ({ id: 'ollama', base: 'http://127.0.0.1:11434', model: 'qwen2.5-coder:14b', compat: 'ollama', loops: true, ...o });
  const run = (o: Record<string, unknown> = {}) => ({ node: '/Applications/Gnomon.app/Contents/Resources/node/bin/node', nodeSha256: '5e2a90c1'.padEnd(64, '0'), dir: '/Applications/Gnomon.app/Contents/Resources/kernel/dist/gnomon-local', treeSha256: '9c41e0b2'.padEnd(60, '1') + '3a7f', entry: 'cli.js', ...o });
  const row = (o: Record<string, unknown> = {}, local: Record<string, unknown> = {}) => ({ schemaVersion: 'gnomon-root-local:v1', version: 1, local: { endpoints: [ep()], runner: run(), ...local }, cardId: C, ...o });
  const grant = (r: Record<string, unknown>) => card([r], { kind: 'grant', detail: { action: 'local.config' } });

  it('every signed field in full, and Allow is offered', () => {
    const c = grant(row({}, { endpoints: [ep(), ep({ id: 'coder', base: 'http://localhost:8080/v1', model: 'big', compat: 'llama.cpp', loops: undefined })] }));
    const rr = rootRowsOf(c);
    expect(rr).not.toBeNull();
    expect(rr!.lines).toEqual([
      'local model config v1; endpoint ollama · Ollama at http://127.0.0.1:11434 · model qwen2.5-coder:14b · loops may use it; endpoint coder · llama.cpp at http://localhost:8080/v1 · model big · sessions only; runner /Applications/Gnomon.app/Contents/Resources/kernel/dist/gnomon-local/cli.js · tree 9c41e0b2…3a7f · node /Applications/Gnomon.app/Contents/Resources/node/bin/node · sha 5e2a90c1…',
    ]);
    const el = renderCard({ doc: fdoc }, view(c), c.block) as FEl;
    expect(el.text).toContain('This decision signs');
    expect(keysOf(el)).toEqual(['allow', 'deny']);
  });

  it('fails closed (no Allow, deny kept) on anything it cannot render', () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ['a LAN endpoint', row({}, { endpoints: [ep({ base: 'http://192.168.1.20:11434' })] })],
      ['a public endpoint', row({}, { endpoints: [ep({ base: 'https://api.anthropic.com' })] })],
      ['a cloud compat', row({}, { endpoints: [ep({ compat: 'openai' })] })],
      ['five endpoints', row({}, { endpoints: ['a', 'b', 'c', 'd', 'e'].map((id) => ep({ id })) })],
      ['an unknown endpoint field', row({}, { endpoints: [ep({ surface: 'full' })] })],
      ['an unknown local field', row({}, { ctxFloor: 8192 })],
      ['an unknown row field', row({ signer: 'x' })],
      ['no runner', row({}, { runner: undefined })],
      ['a short tree hash', row({}, { runner: run({ treeSha256: 'abc' }) })],
      ['a climbing entry', row({}, { runner: run({ entry: '../cli.js' }) })],
      ['a fractional version', row({ version: 1.5 })],
      ['a loops flag that is a number', row({}, { endpoints: [ep({ loops: 1 })] })],
    ];
    for (const [name, r] of bad) {
      const clean = JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
      const c = grant(clean);
      expect(rootRowsOf(c), name).toBeNull();
      const el = renderCard({ doc: fdoc }, view(c), c.block) as FEl;
      expect(keysOf(el), name).toEqual(['deny']);
    }
  });
});
