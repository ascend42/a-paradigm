// TD-2026-10-20-514: regenerate the shared decision.sign vectors from the TS mirror (node >= 23 strips the types):
//   node --no-warnings scripts/gen-decision-vectors.ts ../gnomon-contracts/test/fixtures/decision-batch-vectors.json
import { writeFileSync } from 'node:fs';
import { canonicalJson } from '@a-company/gnomon-contracts';
import { checkDecisionBatch, decisionRowV2, intentOf, BatchRefusal } from '../src/kernel/identity/decision-batch.ts';
const C = 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ', C2 = 'card:01HZZZZZZZZZZZZZZZZZZZZZZY';
const H = 'sha256:' + 'a'.repeat(64), H2 = 'sha256:' + 'b'.repeat(64), MH = 'sha256:' + 'c'.repeat(64), MH2 = 'sha256:' + 'd'.repeat(64), PK = 'sha256:' + 'e'.repeat(64);
const ME = 'p:abcdefgh/matt', T = '2026-10-20T12:00:00.000Z';
const approve = (card = C, decision = 'install', hash = H) => `gnomon:approve:v1\n${card}\n${decision}\n${hash}\n${ME}`;
const approveV2 = (card = C, decision = 'answer', hash = H) => `gnomon:approve:v1\ngnomon:decision:v2\n${card}\n${decision}\n${hash}\n${ME}\n${H2}`;
const presence = 'gnomon:presence:v1\nmod.install\nsha256:00\nconn:01HZZZZZZZZZZZZZZZZZZZZZZA\nchallenge';
type R = Record<string, unknown>;
const trust = (o: R = {}) => ({ schemaVersion: 'grantRow:v1', kind: 'grant.trust', createdAt: T, manifestHash: MH, tier: 'community', cardId: C, ...o });
const cap = (o: R = {}) => ({ schemaVersion: 'grantRow:v1', kind: 'grant.capability', createdAt: T, manifestHash: MH, capabilities: ['tools:call', 'fs:read'], cardId: C, ...o });
const egress = (o: R = {}) => ({ schemaVersion: 'grantRow:v1', kind: 'grant.egress', createdAt: T, manifestHash: MH, hosts: ['api.example.com'], cardId: C, ...o });
const pub = (o: R = {}) => ({ schemaVersion: 'grantRow:v2', kind: 'grant.publisher', createdAt: T, publisher: 'acme', host: 'git.example.com', namespace: 'acme', cardId: C, ...o });
const inst = (o: R = {}) => ({ schemaVersion: 'grantRow:v2', kind: 'grant.install', createdAt: T, name: 'acme.diff-lens', manifestHash: MH, packageHash: PK, cardId: C, source: 'package', ...o });
const uninst = (o: R = {}) => ({ schemaVersion: 'grantRow:v2', kind: 'grant.uninstall', createdAt: T, name: 'acme.diff-lens', packageHash: PK, cardId: C, ...o });
const enrol = (o: R = {}) => ({ schemaVersion: 'voiceEnrolRow:v1', op: 'enrol', seq: 3, speakerId: 'spk:abcdefgh/ana', consentHash: H2, at: T, cardId: C, ...o });
const bind = () => ({ schemaVersion: 'grantRow:v1', kind: 'grant.bind', createdAt: T, principal: ME, manifestHash: MH, kinds: ['x'], cardId: C });
const strip = (r: R) => { const o: R = { ...r }; for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };
const row = (r: R) => `gnomon:row-sig:v1\n${canonicalJson(strip(r))}`;
// a batch: the decision row over `shownRows` (what the card showed), then the signed `rows`
function batch(cardKind: string, decision: string, rows: R[], o: { shownRows?: R[]; card?: string; contentHash?: string; intentText?: string; decisionFirst?: boolean } = {}) {
  const shownRows = (o.shownRows ?? rows).map((r) => intentOf(strip(r)));
  const intent = o.intentText ?? canonicalJson(shownRows);
  const dec = decisionRowV2({ cardId: o.card ?? C, cardKind, decision, contentHash: o.contentHash ?? H, approver: ME, rootRows: shownRows });
  if (o.intentText) dec.rowsDigest = decisionRowV2({ cardId: C, cardKind, decision, contentHash: H, approver: ME, rootRows: JSON.parse(o.intentText) }).rowsDigest;
  const all = [dec as R, ...rows];
  return { root: (o.decisionFirst === false ? [...rows.slice(0, 1), dec, ...rows.slice(1)] : all).map(row), intent };
}
const v: R[] = [];
function add(name: string, approvals: string[], b: { root: string[]; intent: string | null }) {
  let error: string | null = null, shown: string | null = null, why: string | null = null;
  try {
    if (b.intent === null) throw new BatchRefusal('bad-request', 'no intent');
    shown = checkDecisionBatch(approvals.map((s) => Buffer.from(s)), b.root.map((s) => Buffer.from(s)), Buffer.from(b.intent)).line;
  } catch (e) { if (!(e instanceof BatchRefusal)) throw e; error = e.code; why = e.why; }
  v.push({ name, approvals, root: b.root, intent: b.intent, error, ...(shown ? { shown } : {}), ...(why ? { why } : {}) });
}
const A = [approve(), presence];
const many = Array.from({ length: 60 }, (_, i) => `tools:call-${'x'.repeat(10)}-${i}`);
add('install: approve + presence, the decision row and all five grant rows', A, batch('install', 'install', [trust(), cap(), egress(), pub(), inst()]));
add('install: minimal (trust, install)', A, batch('install', 'install', [trust(), inst()]));
add('install: capabilities too long for the line compact to a count and digest', A, batch('install', 'install', [trust(), cap({ capabilities: many }), inst()]));
add('mod.mcp.config: the decision row only', [approve(C, 'allow'), presence], batch('mod.mcp.config', 'allow', []));
add('api-token: the decision row only', [approve(C, 'use-api-token'), presence], batch('api-token', 'use-api-token', []));
add('a decisionSig v2 approval anchors the same way', [approveV2(), presence], batch('grant', 'answer', []));
add('voice.enrol: one enrol row, seq and at volatile', [approve(C, 'allow'), presence], batch('voice.enrol', 'allow', [enrol()]));
add('uninstall, root-only form (presence + the decision row anchors)', [presence], batch('uninstall', 'allow', [uninst()]));
add('uninstall with no approvals messages at all', [], batch('uninstall', 'allow', [uninst()]));
add('the decision row is not first', A, batch('install', 'install', [trust(), inst()], { decisionFirst: false }));
add('two decision rows', A, (() => { const b = batch('install', 'install', [inst()]); return { root: [b.root[0]!, ...b.root], intent: b.intent }; })());
add('a v1 decision row is not accepted by decision.sign', A, { root: [row({ schemaVersion: 'gnomon-root-decision:v1', cardId: C, decision: 'install', contentHash: H, approver: ME })], intent: '[]' });
add('the decision row names another decision than the approval', A, batch('install', 'deny', [trust(), inst()]));
add('the decision row names another card than the approval', A, batch('install', 'install', [inst({ cardId: C2 })], { card: C2 }));
add('the decision row names another content hash than the approval', A, batch('install', 'install', [inst()], { contentHash: H2 }));
add('a grant row names another card', A, batch('install', 'install', [trust({ cardId: C2 }), inst()]));
add('a grant row carries no cardId', A, batch('install', 'install', [trust({ cardId: undefined }), inst()]));
add('two rows name different manifest hashes', A, batch('install', 'install', [trust({ manifestHash: MH2 }), inst()]));
add('root-only form without a decision row', [presence], { root: [row(uninst())], intent: '[]' });
add('the intent does not hash to rowsDigest', A, (() => { const b = batch('install', 'install', [trust(), inst()]); return { root: b.root, intent: canonicalJson([intentOf(trust({ tier: 'first-party' })), intentOf(inst())]) }; })());
add('C1 falsifier: an extra grant.egress row the card never showed', A, batch('install', 'install', [trust(), egress(), inst()], { shownRows: [trust(), inst()] }));
add('C1 falsifier: a changed egress host', A, batch('install', 'install', [trust(), egress({ hosts: ['evil.example.com'] }), inst()], { shownRows: [trust(), egress(), inst()] }));
add('C1 falsifier: reordered rows', A, batch('install', 'install', [egress(), trust(), inst()], { shownRows: [trust(), egress(), inst()] }));
add('C3: grant.install is not last', A, batch('install', 'install', [inst(), trust()]));
add('C3: two trust rows', A, batch('install', 'install', [trust(), trust(), inst()]));
add('C3: an install never signs grant.bind', A, batch('install', 'install', [bind(), inst()]));
add('C3: an install capability row never names a device', A, batch('install', 'install', [cap({ manifestHash: undefined, deviceId: 'dev:x' }), inst()]));
add('C3: the publisher row names another publisher', A, batch('install', 'install', [pub({ publisher: 'other' }), inst()]));
add('C3: an uninstall never signs a grant.install', [presence], batch('uninstall', 'allow', [inst()]));
add('C3: a mod.mcp.config decision signs no grant row', [approve(C, 'allow'), presence], batch('mod.mcp.config', 'allow', [trust()]));
add('C3: an unknown card kind', [approve(C, 'allow'), presence], batch('permission', 'allow', []));
add('F3: a voice enrolment row without a cardId is refused', [approve(C, 'allow'), presence], batch('voice.enrol', 'allow', [enrol({ cardId: undefined })]));
add('C3: a voice enrolment for another card', [approve(C, 'allow'), presence], batch('voice.enrol', 'allow', [enrol({ cardId: C2 })]));
add('C2: egress hosts that do not fit the line are refused, never truncated', A, batch('install', 'install', [trust(), egress({ hosts: Array.from({ length: 30 }, (_, i) => `h${i}-${'y'.repeat(40)}.example.com`) }), inst()]));
add('C2: a tier with a control character is refused', A, batch('install', 'install', [trust({ tier: 'first\u0007party' }), inst()]));
add('two approve messages', [approve(), approve()], batch('install', 'install', [inst()]));
add('two presence messages', [presence, presence], batch('install', 'install', [inst()]));
add('no root rows', A, { root: [], intent: '[]' });
add('nine root rows', A, { root: Array.from({ length: 9 }, () => row(trust())), intent: '[]' });
add('a root row that is not a JSON object', A, { root: ['gnomon:row-sig:v1\n[1,2]'], intent: '[]' });
add('no intent', A, { root: batch('install', 'install', [inst()]).root, intent: null });
add('a voice decision among the approvals', ['gnomon:approve-voice:v1\nx', presence], batch('install', 'install', [inst()]));
add('a row-sig message among the approvals', ['gnomon:row-sig:v1\n{}', presence], batch('install', 'install', [inst()]));
add('an approve message among the root rows', A, { root: ['gnomon:approve:v1\nx'], intent: '[]' });
// Aegis F2: JSON types compare strictly (a boolean is never a number), numbers by value
const typed = (x: unknown) => trust({ x });
const intentWith = (x: unknown) => canonicalJson([intentOf(strip(typed(x))), intentOf(strip(inst()))]);
add('F2: a boolean row field against a number in the intent is refused', A, batch('install', 'install', [typed(true), inst()], { intentText: intentWith(1) }));
add('F2: a number row field against a boolean in the intent is refused', A, batch('install', 'install', [typed(0), inst()], { intentText: intentWith(false) }));
add('F2: equal booleans sign', A, batch('install', 'install', [typed(true), inst()]));
add('F2: equal floats sign', A, batch('install', 'install', [typed(1.5), inst()]));
add('F2: an integer against a different float is refused', A, batch('install', 'install', [typed(2), inst()], { intentText: intentWith(2.5) }));
add('read paths are listed in full on the uncompacted line', A, batch('install', 'install', [trust(), cap({ read: ['/Users/x/notes', '/Users/x/docs'] }), inst()]));
add('read paths are only counted on a compacted line', A, batch('install', 'install', [trust(), cap({ capabilities: many, read: ['/Users/x/notes', '/Users/x/docs'] }), inst()]));
// 8.0:loops (gnomon-loops.md §3.1): a loop-trust signs exactly one loop.trusted row (needs a helper rebuilt with this table)
const looped = (o: R = {}) => ({ kind: 'loop.trusted', createdAt: T, loopId: 'flow-health', scope: 'repo', repoKey: H2, contentHash: MH, coreHash: MH2, closureDigest: PK, cardId: C, by: ME, ...o });
add('loop-trust: one loop.trusted row', [approve(C, 'allow'), presence], batch('loop-trust', 'allow', [looped()]));
add('C3: a loop-trust with no row', [approve(C, 'allow'), presence], batch('loop-trust', 'allow', []));
add('C3: a loop-trust never signs a grant row', [approve(C, 'allow'), presence], batch('loop-trust', 'allow', [looped(), trust()]));
add('C3: a loop.trusted row without its content hash', [approve(C, 'allow'), presence], batch('loop-trust', 'allow', [looped({ contentHash: undefined })]));
add('C3: a loop.trusted row for another card', [approve(C, 'allow'), presence], batch('loop-trust', 'allow', [looped({ cardId: C2 })]));
add('C3: a loop.trusted row with an unknown field', [approve(C, 'allow'), presence], batch('loop-trust', 'allow', [looped({ envelopeId: 'env-1' })]));
add('C3: a loop.trusted row with a malformed repo key', [approve(C, 'allow'), presence], batch('loop-trust', 'allow', [looped({ repoKey: 'sha256:xyz' })]));
add('C3: a loop.trusted row with an unknown scope', [approve(C, 'allow'), presence], batch('loop-trust', 'allow', [looped({ scope: 'global' })]));
add('helper 1.9.0: a loop.trusted row names the agent that asked (requestedBy)', [approve(C, 'allow'), presence], batch('loop-trust', 'allow', [looped({ by: 'root', requestedBy: 'p:abcdefgh/a-01hzzzzz' })]));
// TD-2026-10-22-769 (helper 1.9.0): a real home's local-model config signs exactly one gnomon-root-local:v1 row
const SHA_N = 'a'.repeat(64), SHA_T = 'b'.repeat(64);
const lep = (o: R = {}) => ({ id: 'ollama', base: 'http://127.0.0.1:11434', model: 'qwen3.5:9b', compat: 'ollama', loops: true, ...o });
const lrun = (o: R = {}) => ({ node: '/Applications/Gnomon.app/Contents/Resources/node/bin/node', nodeSha256: SHA_N, dir: '/Applications/Gnomon.app/Contents/Resources/kernel/dist/gnomon-local', treeSha256: SHA_T, entry: 'cli.js', ...o });
const lrow = (o: R = {}, local: R = {}) => ({ schemaVersion: 'gnomon-root-local:v1', version: 3, local: { endpoints: [lep()], runner: lrun(), ...local }, cardId: C, runnerSource: 'bundled', createdAt: T, ...o });
const LA = [approve(C, 'allow'), presence];
add('local.config: one gnomon-root-local:v1 row', LA, batch('local.config', 'allow', [lrow()]));
add('local.config: two endpoints, one for sessions only, on localhost and [::1]', LA, batch('local.config', 'allow', [lrow({}, { endpoints: [lep({ loops: undefined, base: 'http://localhost:8080/v1', id: 'coder', compat: 'llama.cpp' }), lep({ base: 'http://[::1]:1234', compat: 'lm-studio' })] })]));
add('Aegis M1: a runner dir over 256 characters is refused (the runner is never compacted)', LA, batch('local.config', 'allow', [lrow({}, { runner: lrun({ dir: `/${'d'.repeat(500)}` }) })]));
add('Aegis M1: a node path over 256 characters is refused', LA, batch('local.config', 'allow', [lrow({}, { runner: lrun({ node: `/${'e'.repeat(300)}` }) })]));
add('Aegis M1: a row that does not fit the line in full is refused too-large-to-show, never compacted', LA, batch('local.config', 'allow', [lrow({}, { endpoints: [lep({ model: 'm'.repeat(128) }), lep({ id: 'b', model: 'n'.repeat(128) }), lep({ id: 'c', model: 'o'.repeat(128) }), lep({ id: 'd', model: 'p'.repeat(128) })], runner: lrun({ dir: `/${'d'.repeat(250)}`, node: `/${'e'.repeat(250)}` }) })]));
add('Aegis L6: an override runner is marked on the line', LA, batch('local.config', 'allow', [lrow({ runnerSource: 'override' }, { runner: lrun({ dir: '/Users/x/code/gnomon-local/dist' }) })]));
add('Aegis L6: a row that does not say bundled or override is refused', LA, batch('local.config', 'allow', [lrow({ runnerSource: undefined })]));
add('Aegis L7: a loop.trusted by that is not a principal is refused', [approve(C, 'allow'), presence], batch('loop-trust', 'allow', [looped({ by: 'someone' })]));
add('Aegis L7: a loop.trusted requestedBy over 128 characters is refused', [approve(C, 'allow'), presence], batch('loop-trust', 'allow', [looped({ by: 'root', requestedBy: `p:abcdefgh/${'a'.repeat(130)}` })]));
add('C3: a local.config with no row', LA, batch('local.config', 'allow', []));
add('C3: a local.config never signs a grant row', LA, batch('local.config', 'allow', [lrow(), trust()]));
add('C3: a local.config row for another card', LA, batch('local.config', 'allow', [lrow({ cardId: C2 })]));
add('C3: a LAN endpoint is refused (loopback only in 8.0)', LA, batch('local.config', 'allow', [lrow({}, { endpoints: [lep({ base: 'http://192.168.1.20:11434' })] })]));
add('C3: a public endpoint is refused', LA, batch('local.config', 'allow', [lrow({}, { endpoints: [lep({ base: 'https://api.anthropic.com' })] })]));
add('C3: a loopback base with a trailing newline is refused', LA, batch('local.config', 'allow', [lrow({}, { endpoints: [lep({ base: 'http://127.0.0.1:11434\n' })] })]));
add('C3: port 0 is refused', LA, batch('local.config', 'allow', [lrow({}, { endpoints: [lep({ base: 'http://127.0.0.1:0' })] })]));
add('C3: a cloud compat is refused', LA, batch('local.config', 'allow', [lrow({}, { endpoints: [lep({ compat: 'openai' })] })]));
add('C3: five endpoints are refused', LA, batch('local.config', 'allow', [lrow({}, { endpoints: ['a', 'b', 'c', 'd', 'e'].map((id) => lep({ id })) })]));
add('C3: an endpoint field outside the closed set (surface)', LA, batch('local.config', 'allow', [lrow({}, { endpoints: [lep({ surface: 'full' })] })]));
add('C3: a lane limit outside the closed set (ctxFloor)', LA, batch('local.config', 'allow', [lrow({}, { ctxFloor: 8192 })]));
add('C3: a row field outside the closed set', LA, batch('local.config', 'allow', [lrow({ signer: 'x' })]));
add('C3: no runner pin', LA, batch('local.config', 'allow', [lrow({}, { runner: undefined })]));
add('C3: a relative runner dir', LA, batch('local.config', 'allow', [lrow({}, { runner: lrun({ dir: 'gnomon-local/dist' }) })]));
add('C3: a runner entry that climbs out', LA, batch('local.config', 'allow', [lrow({}, { runner: lrun({ entry: '../cli.js' }) })]));
add('C3: a short tree hash', LA, batch('local.config', 'allow', [lrow({}, { runner: lrun({ treeSha256: 'abc' }) })]));
add('C3: a fractional version', LA, batch('local.config', 'allow', [lrow({ version: 1.5 })]));
add('C3: a boolean version', LA, batch('local.config', 'allow', [lrow({ version: true })]));
add('C3: a loops flag that is not a boolean', LA, batch('local.config', 'allow', [lrow({}, { endpoints: [lep({ loops: 1 })] })]));
add('C2: a model with a control character cannot be shown', LA, batch('local.config', 'allow', [lrow({}, { endpoints: [lep({ model: 'qwen\u0007' })] })]));
const out = {
  schema: 'gnomon-decision-batch-vectors:v2',
  note: 'TD-2026-10-20-514 + Aegis C1-C3/C7: the decision.sign rules (helper 1.8.0; 1.9.0 adds loop-trust requestedBy and local.config, TD-2026-10-22-769). Generated from the TS mirror (packages/gnomon/src/kernel/identity/decision-batch.ts) and read by packages/gnomon/test/decision-batch.test.ts and packages/gnomon-helper/darwin/Tests (Swift). Every approvals[], root[] and intent string is the EXACT bytes (UTF-8); intent null = the field is absent. error null = signed, and shown is the helper line byte-exact; else the refusal code. LF-pinned (.gitattributes).',
  vectors: v,
};
writeFileSync(process.argv[2]!, JSON.stringify(out, null, 2) + '\n');
console.log(v.map((x) => `${x.error ?? 'ok'}\t${x.name}\t${x.why ?? ''}`).join('\n'));
