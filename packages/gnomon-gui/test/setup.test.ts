/**
 * #gui-setup: the setup fragment, the state machine over a fake
 * gnomon-setup:v1 connection, and the screens over a fake DOM (no DOM env;
 * like the bare-entry tests, the source is also read for the no-innerHTML rule).
 */
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authServerPreimage, SETUP_API, SETUP_API_ID } from '@a-company/gnomon-contracts';
import { describe, expect, it } from 'vitest';
import { RpcError } from '../src/core/client.js';
import { parseLaunchFragment, parseSetupFragment } from '../src/core/launch.js';
import { keyIdOfSpki } from '../src/core/server-sig.js';
import { digestInstruction, GLOSSARY, groupDigest, IDENTITY_CARDS, purgeCopy, TWO_PROMPTS_NOTICE } from '../src/setup/digest.js';
import { presenceOf, SetupFlow, type SetupClient, type SetupState } from '../src/setup/route.js';
import { screenFor, type SDoc, type SEl } from '../src/setup/screens.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOK = 'A'.repeat(43);
const EP = 'ws://127.0.0.1:5555/rpc';

function fakeEl(tag: string): SEl & { tag: string; kids: SEl[]; attrs: Record<string, string>; on: Record<string, (ev: { preventDefault(): void }) => void> } {
  const e = {
    tag,
    textContent: null as string | null,
    className: '',
    value: '',
    disabled: false,
    kids: [] as SEl[],
    attrs: {} as Record<string, string>,
    on: {} as Record<string, (ev: { preventDefault(): void }) => void>,
    appendChild(c: SEl) {
      e.kids.push(c);
      return c;
    },
    setAttribute(n: string, v: string) {
      e.attrs[n] = v;
    },
    addEventListener(t: string, fn: (ev: { preventDefault(): void }) => void) {
      e.on[t] = fn;
    },
    replaceChildren(...c: SEl[]) {
      e.kids = c;
    },
  };
  return e;
}
const DOC: SDoc = { createElement: (t) => fakeEl(t) };
type FE = ReturnType<typeof fakeEl>;
const text = (els: SEl[]): string => els.map((e) => [(e as FE).textContent ?? '', text((e as FE).kids)].join(' ')).join(' ');
const buttons = (els: SEl[]): FE[] => els.flatMap((e) => [...((e as FE).tag === 'button' ? [e as FE] : []), ...buttons((e as FE).kids)]);

/** A fake setup server: answers like the #setup-endpoint, signing hello with an ephemeral key. */
function server(o: { tamperSig?: boolean; failBegin?: string; failPurge?: boolean } = {}) {
  const kp = generateKeyPairSync('ed25519');
  const spki = kp.publicKey.export({ type: 'spki', format: 'der' });
  const calls: Array<[string, unknown]> = [];
  let note: (m: string, p: unknown) => void = () => undefined;
  let close: (c: number) => void = () => undefined;
  const client: SetupClient = {
    async call<T>(method: string, params?: unknown): Promise<T> {
      calls.push([method, params]);
      const p = params as Record<string, string>;
      if (method === 'hello') {
        const nonce = 'n'.repeat(43);
        const sig = sign(null, Buffer.from(authServerPreimage(nonce, p.clientNonce!, EP, { clientApi: SETUP_API, features: [] })), kp.privateKey).toString('base64');
        return { clientApi: SETUP_API, features: [], nonce, clientNonce: p.clientNonce, serverKeyId: keyIdOfSpki(new Uint8Array(spki)), serverSig: o.tamperSig ? sig.replace(/^./, sig[0] === 'A' ? 'B' : 'A') : sig, setupApiId: SETUP_API_ID } as T;
      }
      if (method === 'auth') return { authenticated: true } as T;
      if (method === 'setup.preflight') return { checks: [{ id: 'helper', status: 'pass', detail: 'signed helper pinned' }, { id: 'sip', status: 'warn', detail: 'off', fix: 'csrutil enable' }, { bogus: true }], leftover: [], existing: null, ok: true, defaultName: 'founder' } as T;
      if (method === 'setup.name') {
        if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(p.name!)) throw new RpcError({ code: 'BAD_REQUEST', reason: 'setup-params', message: 'bad', next: [], data: null });
        return { name: p.name } as T;
      }
      if (method === 'setup.purge' && o.failPurge) throw new RpcError({ code: 'FORBIDDEN', reason: 'in-use', message: 'generation g is the live identity of /x', next: [], data: null });
      if (method === 'setup.begin' && o.failBegin) throw new RpcError({ code: 'FORBIDDEN', reason: 'provision-failed', message: 'the helper crashed', next: [], data: { reason: 'provision-failed', leftoverGen: o.failBegin } });
      if (method === 'setup.begin') {
        note('setup.presence', { n: 1, of: 2, purpose: 'approvals-binding', digest12: '3f2a91c07be4' });
        note('setup.presence', { n: 2, of: 2, purpose: 'device-row', digest12: 'aaaabbbbcccc' });
        return { rootKeyId: 'pkey:r', principalId: 'p:ns/founder', deviceId: 'dev:ns/mac', files: ['/h/keys/identity.json'] } as T;
      }
      if (method === 'setup.finish') return { finished: true } as T;
      throw new Error(method);
    },
    onNotification: (fn) => ((note = fn), () => undefined),
    onClose: (fn) => ((close = fn), () => undefined),
  };
  return { client, calls, spki: Buffer.from(spki).toString('base64url'), closeNow: (c: number) => close(c) };
}

describe('#gui-setup fragment', () => {
  it('parses #setup=<tok>&k=<spki>[&cwd=…] and never mixes with the launch form', () => {
    expect(parseSetupFragment(`#setup=${TOK}&k=abc`)).toEqual({ setupToken: TOK, setupPublicKey: 'abc' });
    expect(parseSetupFragment(`#setup=${TOK}&k=abc&cwd=L1VzZXJz`)).toMatchObject({ cwd: 'L1VzZXJz' });
    expect(parseSetupFragment(`#setup=${TOK}&k=abc&launch=x`)).toBeNull();
    expect(parseSetupFragment(`#setup=short&k=abc`)).toBeNull();
    expect(parseSetupFragment(`#setup=${TOK}&setup=${TOK}&k=abc`)).toBeNull();
    expect(parseLaunchFragment(`#setup=${TOK}&k=abc`)).toBeNull();
    expect(parseSetupFragment(`#launch=${TOK}&k=abc`)).toBeNull();
  });
});

describe('#gui-setup flow', () => {
  it('walks welcome → preflight → name → identity (server digests) → success → handoff; the page sends only name and clicks', async () => {
    const s = server();
    const seen: SetupState[] = [];
    const f = new SetupFlow(s.client, 'browser', (x) => seen.push(x));
    await f.connect({ setupToken: TOK, setupPublicKey: s.spki, endpointPath: EP, subtle: webcrypto.subtle as SubtleCrypto });
    expect(f.state.phase).toBe('welcome');
    await f.preflight();
    expect(f.state.checks.map((c) => c.id)).toEqual(['helper', 'sip']); // a malformed row is dropped
    f.toName();
    await f.submitName('Bad Name');
    expect(f.state.phase).toBe('name');
    expect(f.state.nameError).toMatch(/lowercase/);
    await f.submitName('founder');
    expect(f.state.phase).toBe('identity');
    await f.begin();
    expect(seen.some((x) => x.presence?.digest12 === '3f2a91c07be4' && x.presence.n === 1)).toBe(true);
    expect(f.state.phase).toBe('success');
    await f.finish();
    expect(f.state.phase).toBe('handoff');
    const sent = s.calls.map(([m, p]) => [m, Object.keys((p ?? {}) as object).sort().join(',')]);
    expect(sent).toEqual([
      ['hello', 'client,clientApis,clientNonce,features'],
      ['auth', 'setupToken'],
      ['setup.preflight', ''],
      ['setup.name', 'name'],
      ['setup.name', 'name'],
      ['setup.begin', ''],
      ['setup.finish', ''],
    ]);
  });

  it('a hello not signed by the fragment key sends no auth (same check as the launch path)', async () => {
    const s = server({ tamperSig: true });
    const f = new SetupFlow(s.client, 'browser', () => undefined);
    await f.connect({ setupToken: TOK, setupPublicKey: s.spki, endpointPath: EP, subtle: webcrypto.subtle as SubtleCrypto });
    expect(f.state.phase).toBe('aborted');
    expect(s.calls.map((c) => c[0])).toEqual(['hello']);
  });

  it('a closed socket mid-setup shows aborted; a malformed presence digest is never shown', () => {
    const s = server();
    const f = new SetupFlow(s.client, 'wrapper', () => undefined);
    s.closeNow(1006);
    expect(f.state).toMatchObject({ phase: 'aborted', error: { reason: 'socket-closed' } });
    expect(presenceOf({ n: 1, of: 2, purpose: 'device-row', digest12: '<img src=x>' })).toBeNull();
  });
});

describe('#gui-setup screens', () => {
  const flow = { preflight: async () => undefined, purge: async () => undefined, toName: () => undefined, submitName: async () => undefined, begin: async () => undefined, complete: async () => undefined, finish: async () => undefined };
  const base = (p: Partial<SetupState>): SetupState => ({ phase: 'welcome', checks: [], leftover: [], ok: true, existing: null, defaultName: 'founder', name: null, nameError: null, presence: null, busy: false, result: null, error: null, surface: 'browser', notice: null, ...p });

  it('identity: announces exactly 2 prompts; the live card shows the digest big and grouped with the helper-line copy', () => {
    const els = screenFor(DOC, base({ phase: 'identity', presence: { n: 1, of: 2, purpose: 'approvals-binding', digest12: '3f2a91c07be4' } }), flow);
    const t = text(els);
    expect(t).toContain('EXACTLY 2 Touch ID (or your password) prompts');
    expect(TWO_PROMPTS_NOTICE).toContain('A third prompt to SIGN during setup is an attack');
    for (const g of Object.values(GLOSSARY)) expect(t).toContain(g);
    expect(t).toContain(IDENTITY_CARDS['approvals-binding'].title);
    expect(t).toContain(IDENTITY_CARDS['device-row'].title);
    expect(t).toContain(groupDigest('3f2a91c07be4'));
    expect(t).toContain('must begin with "Gnomon Helper: root key signs 1: 3f2a91c07be4"');
    expect(t).toContain('trust the terminal');
    expect(digestInstruction('x')).toContain('Cancelling is always safe');
  });

  it('preflight rows carry pass/warn/fail and the fix; leftovers get a purge button with the not-used-by-~/.gnomon copy', () => {
    const els = screenFor(DOC, base({ phase: 'preflight', checks: [{ id: 'sip', status: 'warn', detail: 'off', fix: 'csrutil enable' }], leftover: ['abcdefabcdef'] }), flow);
    expect(text(els)).toContain('fix: csrutil enable');
    expect(purgeCopy('g')).toContain('~/.gnomon does not use');
    expect(purgeCopy('g')).toContain('Another Gnomon home');
    expect(buttons(els).map((b) => b.textContent)).toEqual(['Delete generation abcdefabcdef']);
  });

  it('success lists keyId, principal, device and files; hand-off differs by surface', () => {
    const r = { rootKeyId: 'pkey:r', principalId: 'p:ns/f', deviceId: 'dev:ns/m', files: ['/h/keys/identity.json'] };
    const t = text(screenFor(DOC, base({ phase: 'success', result: r }), flow));
    for (const v of Object.values(r).flat()) expect(t).toContain(v);
    expect(text(screenFor(DOC, base({ phase: 'handoff' }), flow))).toContain('terminal now prints the launch URL');
    expect(text(screenFor(DOC, base({ phase: 'handoff', surface: 'wrapper' }), flow))).toContain('this window continues');
  });

  it('no innerHTML in the setup sources: every string goes through textContent', () => {
    for (const f of ['route.ts', 'screens.ts', 'digest.ts']) expect(readFileSync(path.join(ROOT, 'src', 'setup', f), 'utf8')).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });

  it('an already-set-up home offers Finish setup (unregistered) or Start Gnomon (registered), never a dead end', () => {
    const b1 = buttons(screenFor(DOC, base({ phase: 'preflight', existing: { rootKeyId: 'r', createdAt: 't', registered: false } }), flow)).map((b) => b.textContent);
    expect(b1).toEqual(['Finish setup']);
    const b2 = buttons(screenFor(DOC, base({ phase: 'preflight', existing: { rootKeyId: 'r', createdAt: 't', registered: true } }), flow)).map((b) => b.textContent);
    expect(b2).toEqual(['Start Gnomon']);
  });
});

describe('#gui-setup recovery (the screens are the complete path)', () => {
  async function ready(o: Parameters<typeof server>[0]) {
    const s = server(o);
    const f = new SetupFlow(s.client, 'browser', () => undefined);
    await f.connect({ setupToken: TOK, setupPublicKey: s.spki, endpointPath: EP, subtle: webcrypto.subtle as SubtleCrypto });
    await f.preflight();
    return { s, f };
  }
  it('a refused purge returns to the checks with a notice; setup goes on', async () => {
    const { f } = await ready({ failPurge: true });
    f.state.leftover = ['abcdefabcdef'];
    await f.purge('abcdefabcdef');
    expect(f.state.phase).toBe('preflight');
    expect(f.state.notice).toContain('live identity');
  });
  it('a failed begin with a leftover generation returns to the checks and names it (never "nothing half-done")', async () => {
    const { f } = await ready({ failBegin: 'abcdefabcdef' });
    f.toName();
    await f.submitName('founder');
    await f.begin();
    expect(f.state.phase).toBe('preflight');
    expect(f.state.notice).toContain('generation abcdefabcdef were left');
    expect(text(screenFor(DOC, f.state, f))).not.toContain('half-done');
  });
});
