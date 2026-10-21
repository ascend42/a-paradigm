/**
 * 8.0:TD-2026-10-20-812 (the Desk + the context meter, one clientApiId move). Falsifiers: offer-spec:v1 is closed and
 * bounded; offerBlockOf finds exactly one strict-JSON ```offer block and refuses two, an unclosed or oversized block,
 * a fence inside another fence, and adversarial input, in linear time; every new kind is registered, reserved under
 * the Desk tag and has a closed payload check (no free text but the bounded question).
 */
import { describe, expect, it } from 'vitest';
import {
  CLIENT_API_DESCRIPTOR,
  CONTRACT_SCHEMAS,
  EVENT_KINDS,
  KIND_PAYLOADS,
  OFFER_BLOCK_MAX,
  OFFER_DECISIONS,
  OFFER_PHASES,
  OFFER_QUESTION_MAX,
  OFFER_SUPPRESS_REASONS,
  OFFER_TEXT_MAX,
  OFFERS_PER_MOD_MAX,
  RESERVATION_TAGS,
  defaultLabelsFor,
  mintHsid,
  mintId,
  offerBlockOf,
  validateKindPayload,
  validateOfferSpecV1,
  CONTEXT_SOURCES,
  isOfferQuestion,
} from '../src/index.js';

describe('shared rules (Aegis review of the GUI slice)', () => {
  it('CONTEXT_SOURCES is closed and the question rule is one exported function', () => {
    expect([...CONTEXT_SOURCES]).toEqual(['recent-messages', 'open-files', 'repo-path', 'selection', 'session-summary']);
    expect(isOfferQuestion('Want me to map this?')).toBe(true);
    for (const bad of ['', ' padded ', 'two\nlines', 'bidi\u202e', 'zw\u200b', 'q'.repeat(OFFER_QUESTION_MAX + 1), 7]) expect(isOfferQuestion(bad)).toBe(false);
  });
});

const SPEC = {
  kind: 'map-the-idea',
  phase: 'diverge',
  title: 'Map it on the board',
  summary: 'Lays the ideas of this conversation out as a constellation you can rearrange.',
  contextIn: ['recent-messages', 'repo-path'],
  resultOut: 'board',
  reach: 'mcp',
  handoffTool: 'constellation_open',
  related: ['cluster-themes'],
  restraint: 'Not when the human is debugging or has asked for a single answer.',
} as const;

const fence = (body: string): string => ['```offer', body, '```'].join('\n');
const BLOCK = '{"mod": "gnomon.constellation", "kind": "map-the-idea", "question": "Want me to map this on the board?"}';

describe('offer-spec:v1', () => {
  it('accepts a full spec; the constants are closed', () => {
    expect(validateOfferSpecV1(SPEC)).toEqual([]);
    expect([...OFFER_PHASES]).toEqual(['diverge', 'synthesize', 'commit']);
    expect([...OFFER_DECISIONS]).toEqual(['open', 'not-now', 'stop-here']);
    expect(OFFERS_PER_MOD_MAX).toBe(6);
  });
  it.each([
    ['an extra key', { ...SPEC, prompt: 'do anything' }],
    ['a missing key', (({ restraint: _r, ...rest }) => rest)(SPEC)],
    ['an unknown phase', { ...SPEC, phase: 'explore' }],
    ['a reach other than mcp', { ...SPEC, reach: 'http' }],
    ['a newline in the title', { ...SPEC, title: 'Map\nit' }],
    ['a bidi control in the summary', { ...SPEC, summary: 'safe \u202e txt.exe' }],
    ['a zero-width in the restraint', { ...SPEC, restraint: 'no\u200bpe' }],
    ['an over-long title', { ...SPEC, title: 'x'.repeat(61) }],
    ['edge whitespace', { ...SPEC, title: ' Map ' }],
    ['a contextIn source outside CONTEXT_SOURCES', { ...SPEC, contextIn: ['conversation'] }],
    ['a duplicate contextIn source', { ...SPEC, contextIn: ['selection', 'selection'] }],
    ['too many contextIn entries', { ...SPEC, contextIn: Array.from({ length: 9 }, () => 'selection') }],
    ['a duplicate related token', { ...SPEC, related: ['a', 'a'] }],
    ['a handoff tool with a space', { ...SPEC, handoffTool: 'open board' }],
  ])('refuses %s', (_why, v) => {
    expect(validateOfferSpecV1(v).length).toBeGreaterThan(0);
  });
  it('is published as a schema and its limits ride the client-API descriptor', () => {
    expect(Object.keys(CONTRACT_SCHEMAS)).toContain('offer-spec.v1.schema.json');
    const d = CLIENT_API_DESCRIPTOR as unknown as { desk: { offer: { phases: string[]; perMod: number; block: { questionMax: number; maxChars: number } } } };
    expect(d.desk.offer.phases).toEqual([...OFFER_PHASES]);
    expect(d.desk.offer.perMod).toBe(OFFERS_PER_MOD_MAX);
    expect(d.desk.offer.block).toMatchObject({ questionMax: OFFER_QUESTION_MAX, maxChars: OFFER_BLOCK_MAX });
  });
});

describe('offerBlockOf (goldens)', () => {
  it('finds one block and returns the reply without it', () => {
    const r = offerBlockOf(`Here is the plan.\n\n${fence(BLOCK)}\n`);
    expect(r).toEqual({ offer: { mod: 'gnomon.constellation', kind: 'map-the-idea', question: 'Want me to map this on the board?' }, body: 'Here is the plan.' });
  });
  it('tolerates CRLF, trailing fence spaces and trailing blank lines', () => {
    const r = offerBlockOf(`A\r\n\`\`\`offer  \r\n${BLOCK}\r\n\`\`\`\t\r\n  \r\n`);
    expect(r?.offer.mod).toBe('gnomon.constellation');
    expect(r?.body).toBe('A');
  });
  it('M4: the block must END the reply; a block followed by text (an injected block mid-reply) is refused', () => {
    expect(offerBlockOf(`A\n${fence(BLOCK)}\nB`)).toBeNull();
    expect(offerBlockOf(`Tool output said:\n${fence(BLOCK)}\n\nAnyway, here is my answer.`)).toBeNull();
  });
  it('L2: a bare CR is refused', () => {
    expect(offerBlockOf(`A\rB\n${fence(BLOCK)}`)).toBeNull();
    expect(offerBlockOf(`A\n${fence(BLOCK)}\r`)).toBeNull();
  });
  it('L1: an OTHER fence may be indented up to 3 spaces; the offer opener is column 0 only', () => {
    const quoted = ['   ````md', fence(BLOCK), '   ````'].join('\n');
    expect(offerBlockOf(quoted)).toBeNull();
    expect(offerBlockOf(`${quoted}\n${fence(BLOCK)}`)?.offer.kind).toBe('map-the-idea');
    expect(offerBlockOf(` \`\`\`offer\n${BLOCK}\n\`\`\``)).toBeNull();
  });
  it('L3: lone surrogates, private-use code points and mark piles are refused in the question', () => {
    const q = (question: string) => offerBlockOf(fence(JSON.stringify({ mod: 'acme.m', kind: 'k', question })));
    expect(q('ok \ud800?')).toBeNull();
    expect(q('ok \ue000?')).toBeNull();
    expect(q('e\u0301\u0302\u0303\u0304?')).toBeNull();
    expect(q('e\u0301\u0302\u0303?')?.offer.question).toBe('e\u0301\u0302\u0303?');
  });
  it('no block, or a plain code block, is no offer', () => {
    expect(offerBlockOf('just words')).toBeNull();
    expect(offerBlockOf('```json\n' + BLOCK + '\n```')).toBeNull();
    expect(offerBlockOf(null)).toBeNull();
    expect(offerBlockOf(42)).toBeNull();
  });
  it('two blocks are refused (ambiguous)', () => {
    expect(offerBlockOf(`${fence(BLOCK)}\n\n${fence(BLOCK)}`)).toBeNull();
  });
  it('an unclosed block is refused', () => {
    expect(offerBlockOf(`text\n\`\`\`offer\n${BLOCK}\n`)).toBeNull();
  });
  it('a fence quoted inside another code block is ignored (CommonMark fence lengths, ``` and ~~~)', () => {
    const quoted = ['````markdown', fence(BLOCK), '````'].join('\n');
    expect(offerBlockOf(quoted)).toBeNull();
    expect(offerBlockOf(['~~~', fence(BLOCK), '~~~'].join('\n'))).toBeNull();
    // ... but a real block after the quoted one counts
    expect(offerBlockOf(`${quoted}\n\n${fence(BLOCK)}`)?.offer.kind).toBe('map-the-idea');
    // a 3-backtick outer fence closes at the offer's own closing line; the stray ``` then opens a block to the end
    expect(offerBlockOf(['```markdown', fence(BLOCK), '```', '', fence(BLOCK)].join('\n'))).toBeNull();
  });
  it('an indented fence is not a fence', () => {
    expect(offerBlockOf(`  \`\`\`offer\n${BLOCK}\n  \`\`\``)).toBeNull();
  });
  it('an oversized block is refused', () => {
    const big = JSON.stringify({ mod: 'gnomon.constellation', kind: 'map-the-idea', question: 'q?', pad: 'x'.repeat(OFFER_BLOCK_MAX) });
    expect(offerBlockOf(fence(big))).toBeNull();
    const manyLines = ['```offer', ...Array.from({ length: 2000 }, () => ''), '```'].join('\n');
    expect(offerBlockOf(manyLines)).toBeNull();
  });
  it('an over-long reply is never scanned', () => {
    expect(offerBlockOf(`${'x'.repeat(OFFER_TEXT_MAX)}\n${fence(BLOCK)}`)).toBeNull();
  });
  it.each([
    ['YAML, not JSON', 'mod: constellation\nkind: map-the-idea\nquestion: ok?'],
    ['an extra key', '{"mod":"gnomon.constellation","kind":"map-the-idea","question":"ok?","tool":"rm"}'],
    ['a __proto__ key', '{"mod":"gnomon.constellation","kind":"map-the-idea","question":"ok?","__proto__":{"x":1}}'],
    ['a missing question', '{"mod":"gnomon.constellation","kind":"map-the-idea"}'],
    ['an array body', '["constellation","map-the-idea","ok?"]'],
    ['a newline in the question', '{"mod":"gnomon.constellation","kind":"map-the-idea","question":"line\\nbreak"}'],
    ['an ESC in the question', '{"mod":"gnomon.constellation","kind":"map-the-idea","question":"\\u001b[31mred"}'],
    ['a bidi override in the question', '{"mod":"gnomon.constellation","kind":"map-the-idea","question":"ok\\u202e?"}'],
    ['an over-long question', JSON.stringify({ mod: 'gnomon.constellation', kind: 'map-the-idea', question: 'q'.repeat(OFFER_QUESTION_MAX + 1) })],
    ['a bad mod name', '{"mod":"../x","kind":"map-the-idea","question":"ok?"}'],
    ['trailing garbage', `${BLOCK} trailing`],
  ])('refuses %s', (_why, body) => {
    expect(offerBlockOf(fence(body))).toBeNull();
  });
  it('a question of exactly OFFER_QUESTION_MAX code points (astral) is accepted', () => {
    const q = '\u{1F600}'.repeat(OFFER_QUESTION_MAX);
    expect(offerBlockOf(fence(JSON.stringify({ mod: 'acme.m', kind: 'k', question: q })))?.offer.question).toBe(q);
  });
  it('adversarial inputs finish in linear time (ReDoS falsifier)', () => {
    const inputs = [
      '`'.repeat(200_000),
      '```offer'.repeat(20_000),
      `${'```\n'.repeat(50_000)}`,
      `\`\`\`offer${' '.repeat(200_000)}`,
      `${'\n'.repeat(200_000)}\`\`\`offer\n${'{'.repeat(1000)}\n\`\`\``,
      `\`\`\`offer\n${'['.repeat(OFFER_BLOCK_MAX - 2)}\n\`\`\``,
    ];
    const t0 = performance.now();
    for (const s of inputs) expect(offerBlockOf(s)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

const hsid = mintHsid();
const offerId = mintId('offer');
const turn = `turn:${hsid}/3`;
const SHOWN = { offerId, hsid, mod: 'gnomon.constellation', kind: 'map-the-idea', phase: 'diverge', title: 'Map it on the board', contextIn: ['recent-messages'], question: 'Want me to map this?', replyTurnId: turn };

describe('8.0:TD-2026-10-20-812 kinds', () => {
  const NEW = ['offer.shown', 'offer.decided', 'offer.kept', 'request.offer.decide', 'request.offer.mute', 'request.mod.install', 'request.session.restart', 'session.context.threshold'];
  it('registers every kind kernel-owned, normal, reserved under the Desk tag, with a closed payload', () => {
    expect(RESERVATION_TAGS).toContain('8.0:TD-2026-10-20-812');
    for (const k of NEW) {
      expect(EVENT_KINDS[k], k).toMatchObject({ owner: 'kernel', sensitivity: 'normal', reserved: '8.0:TD-2026-10-20-812' });
      expect(KIND_PAYLOADS[k], k).toBeDefined();
      expect(defaultLabelsFor(k)).toEqual({ audience: 'private', sensitivity: 'normal' });
    }
  });
  it('offer.shown: closed; question bounded and control-refused', () => {
    expect(validateKindPayload('offer.shown', SHOWN)).toEqual([]);
    expect(validateKindPayload('offer.shown', { ...SHOWN, extra: 1 }).length).toBeGreaterThan(0);
    expect(validateKindPayload('offer.shown', { ...SHOWN, question: 'a\u0007b' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('offer.shown', { ...SHOWN, question: 'q'.repeat(OFFER_QUESTION_MAX + 1) }).length).toBeGreaterThan(0);
    expect(validateKindPayload('offer.shown', { ...SHOWN, phase: 'later' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('offer.shown', { ...SHOWN, contextIn: ['secrets'] }).length).toBeGreaterThan(0);
    expect(validateKindPayload('offer.shown', { ...SHOWN, contextIn: Array.from({ length: 9 }, () => 'selection') }).length).toBeGreaterThan(0);
    const { contextIn: _c, ...noContext } = SHOWN;
    expect(validateKindPayload('offer.shown', noContext).length).toBeGreaterThan(0);
    expect(validateKindPayload('offer.shown', { ...SHOWN, offerId: 'card:01J00000000000000000000000' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('offer.shown', { ...SHOWN, replyTurnId: 'turn:x' }).length).toBeGreaterThan(0);
  });
  it.each([...OFFER_DECISIONS])('offer.decided / request.offer.decide take %s', (decision) => {
    expect(validateKindPayload('offer.decided', { offerId, hsid, decision })).toEqual([]);
    expect(validateKindPayload('request.offer.decide', { offerId, decision })).toEqual([]);
  });
  it('an unknown decision and free text are refused', () => {
    expect(validateKindPayload('offer.decided', { offerId, hsid, decision: 'maybe' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('request.offer.decide', { offerId, decision: 'open', note: 'hi' }).length).toBeGreaterThan(0);
  });
  it('offer.kept names the mod and the handoff tool', () => {
    expect(validateKindPayload('offer.kept', { offerId, hsid, mod: 'gnomon.constellation', tool: 'constellation_open' })).toEqual([]);
    expect(validateKindPayload('offer.kept', { offerId, hsid, mod: 'gnomon.constellation', tool: 'rm -rf' }).length).toBeGreaterThan(0);
  });
  it('request.offer.mute (S0b): scope repo only, the session hsid (the kernel derives the repo), a boolean', () => {
    const repo = 'repo:0123456789abcdef';
    expect(validateKindPayload('request.offer.mute', { mod: 'gnomon.neurons', scope: 'repo', hsid, muted: true })).toEqual([]);
    expect(validateKindPayload('request.offer.mute', { mod: 'gnomon.neurons', scope: 'repo', hsid, muted: false })).toEqual([]);
    expect(validateKindPayload('request.offer.mute', { mod: 'gnomon.neurons', scope: 'global', hsid, muted: true }).length).toBeGreaterThan(0);
    expect(validateKindPayload('request.offer.mute', { mod: 'gnomon.neurons', scope: 'repo', hsid, muted: 'yes' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('request.offer.mute', { mod: 'gnomon.neurons', scope: 'repo', muted: true }).length).toBeGreaterThan(0);
    // the human no longer names the repo: a repo key is refused on the request
    expect(validateKindPayload('request.offer.mute', { mod: 'gnomon.neurons', scope: 'repo', hsid, repo, muted: true }).length).toBeGreaterThan(0);
    // a bare (pre-S0b) mod name is refused
    expect(validateKindPayload('request.offer.mute', { mod: 'neurons', scope: 'repo', hsid, muted: true }).length).toBeGreaterThan(0);
    // offer.muted: the kernel-written result names the derived repo
    expect(validateKindPayload('offer.muted', { mod: 'gnomon.neurons', repo, muted: true, hsid })).toEqual([]);
    expect(validateKindPayload('offer.muted', { mod: 'gnomon.neurons', muted: true, hsid }).length).toBeGreaterThan(0);
  });
  it('request.mod.install{git}: https only, no userinfo, no control, url only', () => {
    const ok = (p: unknown) => expect(validateKindPayload('request.mod.install', p)).toEqual([]);
    const bad = (p: unknown) => expect(validateKindPayload('request.mod.install', p).length).toBeGreaterThan(0);
    ok({ source: 'git', url: 'https://github.com/ascend42/constellation.git' });
    ok({ source: 'git', url: 'https://git.example.com:8443/team/mod' });
    // S0b: an optional commit, 40 hex, git only (a sha256-format 64-hex repo is refused in 8.0)
    ok({ source: 'git', url: 'https://github.com/acme/mod', commit: 'a'.repeat(40) });
    bad({ source: 'git', url: 'https://github.com/acme/mod', commit: 'a'.repeat(64) });
    bad({ source: 'git', url: 'https://github.com/acme/mod', commit: 'A'.repeat(40) });
    bad({ source: 'folder', path: '/Users/me/mod', commit: 'a'.repeat(40) });
    bad({ source: 'git', url: 'http://github.com/a/b' });
    bad({ source: 'git', url: 'git@github.com:a/b.git' });
    bad({ source: 'git', url: 'ssh://github.com/a/b' });
    bad({ source: 'git', url: 'https://user:pw@github.com/a/b' });
    bad({ source: 'git', url: 'https://github.com/a/b\n--upload-pack=x' });
    bad({ source: 'git', url: 'https://github.com/a b' });
    bad({ source: 'git', url: `https://github.com/${'a'.repeat(600)}` });
    bad({ source: 'git' });
    bad({ source: 'git', url: 'https://github.com/a/b', path: '/tmp/x' });
    bad({ source: 'registry', url: 'https://github.com/a/b' });
  });
  it('request.mod.install{folder}: an absolute path only', () => {
    const ok = (p: unknown) => expect(validateKindPayload('request.mod.install', p)).toEqual([]);
    const bad = (p: unknown) => expect(validateKindPayload('request.mod.install', p).length).toBeGreaterThan(0);
    ok({ source: 'folder', path: '/Users/me/mods/neurons' });
    ok({ source: 'folder', path: 'C:\\Users\\me\\mods\\neurons' });
    bad({ source: 'folder', path: 'mods/neurons' });
    bad({ source: 'folder', path: '/Users/me/../../etc' });
    bad({ source: 'folder', path: '/Users/me/mod\u0000' });
    bad({ source: 'folder', path: '/Users/me/mod', url: 'https://x.y/z' });
    // M3: UNC/device prefixes, ':' past the drive, dot-and-space segments
    ok({ source: 'folder', path: '/Users/me/./mods/neurons' });
    for (const p of ['//server/share/mod', '\\\\server\\share\\mod', '\\\\?\\C:\\mod', '\\\\.\\pipe\\mod', 'C:\\mods\\x:stream', '/Users/me/a:b', '/Users/.../mod', '/Users/. /mod', 'C:\\mods\\ ..\\x', '/Users/ /mod']) bad({ source: 'folder', path: p });
    bad({ source: 'folder' });
  });
  it('request.session.restart: hsid, optional checkpointRef', () => {
    expect(validateKindPayload('request.session.restart', { hsid })).toEqual([]);
    expect(validateKindPayload('request.session.restart', { hsid, checkpointRef: 'ckpt-2026-10-20T19.53.00' })).toEqual([]);
    expect(validateKindPayload('request.session.restart', { hsid, checkpointRef: '../x' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('request.session.restart', {}).length).toBeGreaterThan(0);
  });
  it('session.context.threshold: integers, ratio in [0,1] and consistent', () => {
    expect(validateKindPayload('session.context.threshold', { hsid, usedTokens: 160_000, windowTokens: 200_000, ratio: 0.8 })).toEqual([]);
    expect(validateKindPayload('session.context.threshold', { hsid, usedTokens: 160_000, windowTokens: 200_000, ratio: 0.5 }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.context.threshold', { hsid, usedTokens: 300_000, windowTokens: 200_000, ratio: 1 }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.context.threshold', { hsid, usedTokens: 1, windowTokens: 0, ratio: 1 }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.context.threshold', { hsid, usedTokens: 1.5, windowTokens: 2, ratio: 0.75 }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.context.threshold', { hsid, usedTokens: 1, windowTokens: 2, ratio: Number.NaN }).length).toBeGreaterThan(0);
  });
});

describe('isOfferTitle (Aegis S1 M1)', () => {
  it('refuses < > " ` in a title, on the spec and on offer.shown', async () => {
    const { isOfferTitle, validateOfferSpecV1 } = await import('../src/offer.js');
    const { validateKindPayload } = await import('../src/event.js');
    expect(isOfferTitle('Map it on the board')).toBe(true);
    for (const t of ['<b>x', 'a > b', 'say "hi"', 'run `rm`']) expect(isOfferTitle(t), t).toBe(false);
    const spec = { kind: 'map', phase: 'diverge', title: 'Map <it>', summary: 's', contextIn: [], resultOut: 'r', reach: 'mcp', handoffTool: 'open', related: [], restraint: 'r' };
    expect(validateOfferSpecV1(spec).some((e) => e.includes('title'))).toBe(true);
    const shown = { offerId: 'offer:01J00000000000000000000001', hsid: 'hsid:v1:01J00000000000000000000000', mod: 'acme.m', kind: 'map', phase: 'diverge', title: 'a "b"', contextIn: [], question: 'q?', replyTurnId: 'turn:hsid:v1:01J00000000000000000000000/1' };
    expect(validateKindPayload('offer.shown', shown).some((e) => e.includes('title'))).toBe(true);
  });
});

describe('8.0:T-2026-10-21-006 offer.suppressed (founder ruling: suppressions on the signed log)', () => {
  const hsid = mintHsid();
  const turn = `turn:${hsid}/7`;
  const ok = (p: unknown) => expect(validateKindPayload('offer.suppressed', p)).toEqual([]);
  const bad = (p: unknown) => expect(validateKindPayload('offer.suppressed', p).length).toBeGreaterThan(0);
  it('review C1: the turn must be one of the payload hsid\'s turns', () => {
    ok({ hsid, turn, why: 'no-block' });
    const other = mintHsid();
    bad({ hsid, turn: `turn:${other}/7`, why: 'no-block' });
    expect(validateKindPayload('offer.suppressed', { hsid, turn: `turn:${other}/7`, why: 'no-block' }).join(' ')).toMatch(/turn of the payload hsid/);
  });
  it('is registered kernel-owned, normal, under its own tag, and its reasons ride the descriptor', () => {
    expect(RESERVATION_TAGS).toContain('8.0:T-2026-10-21-006');
    expect(EVENT_KINDS['offer.suppressed']).toMatchObject({ owner: 'kernel', sensitivity: 'normal', reserved: '8.0:T-2026-10-21-006' });
    expect(defaultLabelsFor('offer.suppressed')).toEqual({ audience: 'private', sensitivity: 'normal' });
    expect(KIND_PAYLOADS['offer.suppressed']).toEqual(['hsid', 'turn', 'why', 'name', 'offerKind']);
    const d = CLIENT_API_DESCRIPTOR as unknown as { desk: { suppress: { reasons: string[]; unnamed: string[] } } };
    expect(d.desk.suppress.reasons).toEqual([...OFFER_SUPPRESS_REASONS]);
    expect(d.desk.suppress.unnamed).toEqual(['no-block', 'malformed']);
  });
  it.each(['no-block', 'malformed'])('%s names no mod or kind', (why) => {
    ok({ hsid, turn, why });
    bad({ hsid, turn, why, name: 'gnomon.constellation', offerKind: 'map-the-idea' });
    bad({ hsid, turn, why, name: 'gnomon.constellation' });
  });
  it.each(['turn-streaming', 'pending-card', 'not-offerable', 'kind-undeclared'])('%s names the mod and the kind', (why) => {
    ok({ hsid, turn, why, name: 'gnomon.constellation', offerKind: 'map-the-idea' });
    bad({ hsid, turn, why });
    bad({ hsid, turn, why, name: 'gnomon.constellation' });
    bad({ hsid, turn, why, offerKind: 'map-the-idea' });
  });
  it('closed: names only, never text; a closed reason; a real hsid and turn', () => {
    bad({ hsid, turn, why: 'no-block', question: 'Want me to map this?' });
    bad({ hsid, turn, why: 'bored' });
    bad({ hsid, turn, why: 'not-offerable', name: 'Map it on the board!', offerKind: 'map-the-idea' });
    bad({ hsid, turn, why: 'kind-undeclared', name: 'gnomon.constellation', offerKind: 'Delete The Repo' });
    bad({ hsid: 'h', turn, why: 'no-block' });
    bad({ hsid, turn: 'turn:x', why: 'no-block' });
    bad({ hsid, why: 'no-block' });
  });
});
