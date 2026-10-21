/**
 * #gnomon-voice capture relay (T-2026-10-20-005 A1, TD-2026-10-20-086; spec §14.7 "Capture"): request.voice.report
 * {capture} → status.voice.capture{state, segId, reason?, level?, at}. Closed enums, voice principal only, a short
 * TTL, visible to the human and voice classes only (never a mod), and the V2 projection seam (partial words, when
 * phase B adds them, to the gui credential only). Pure: no keys, no paths.
 */
import { describe, expect, it } from 'vitest';
import { createKernelDispatcher, RpcRefusal } from '../src/kernel/socket/index.js';
import { checkStatusNumbers } from '../src/kernel/socket/status-numbers.js';
import { CAPTURE_DROP_REASONS, CAPTURE_STATES, CAPTURE_TEXT_MAX, VoiceReports, VOICE_CAPTURE_ACCEPT_WINDOW_MS, VOICE_CAPTURE_TTL_MS, VOICE_REPORT_TTL_MS, voiceStatusFor } from '../src/kernel/voice/voice-requests.js';

describe('#gnomon-voice capture: VoiceReports', () => {
  it('relays {state, segId, reason?, level?, at}; the latest report wins', () => {
    const t = 1_000_000;
    const rep = new VoiceReports(() => t);
    expect(rep.status().capture).toBeNull();
    rep.report({ capture: { state: 'hearing', segId: 's1', level: 0.42 } }, 'conn:V');
    expect(rep.status().capture).toEqual({ state: 'hearing', segId: 's1', level: 0.42, at: new Date(t).toISOString() });
    rep.report({ capture: { state: 'transcribing', segId: 's1' } }, 'conn:V');
    expect(rep.status().capture).toEqual({ state: 'transcribing', segId: 's1', at: new Date(t).toISOString() });
    for (const reason of CAPTURE_DROP_REASONS) {
      rep.report({ capture: { state: 'dropped', segId: 's2', reason } }, 'conn:V');
      expect(rep.status().capture).toMatchObject({ state: 'dropped', reason });
    }
    for (const state of CAPTURE_STATES.filter((s) => s !== 'dropped')) {
      rep.report({ capture: { state, segId: 's3' } }, 'conn:V');
      expect(rep.status().capture).toMatchObject({ state });
    }
  });

  it('refuses unknown keys, unknown states and reasons, a reason off dropped, a level off hearing or out of 0..1', () => {
    const rep = new VoiceReports(() => 1_000_000);
    const bad: unknown[] = [
      { capture: { state: 'hearing', segId: 's1', text: 'partial words' } }, // no text in A1
      { capture: { state: 'hearing', segId: 's1', extra: 1 } },
      { capture: { state: 'listening', segId: 's1' } },
      { capture: { state: 'dropped', segId: 's1' } },
      { capture: { state: 'dropped', segId: 's1', reason: 'cosmic-rays' } },
      { capture: { state: 'captured', segId: 's1', reason: 'echo' } },
      { capture: { state: 'transcribing', segId: 's1', level: 0.5 } },
      { capture: { state: 'hearing', segId: 's1', level: 1.5 } },
      { capture: { state: 'hearing', segId: 's1', level: -0.1 } },
      { capture: { state: 'hearing', segId: 's1', level: Number.NaN } },
      { capture: { state: 'hearing', segId: 'S 1' } },
      { capture: { state: 'hearing', segId: 'x'.repeat(33) } },
      { capture: { state: 'hearing' } },
      { capture: null },
      { capture: ['hearing'] },
      { capture: { state: 'hearing', segId: 's1' }, words: 'x' },
    ];
    for (const p of bad) expect(() => rep.report(p, 'conn:V'), JSON.stringify(p)).toThrow(TypeError);
    expect(rep.status().capture).toBeNull();
  });

  it('goes stale after the SHORT capture TTL (a crashed client never leaves hearing lit); other reports keep the long TTL', () => {
    let t = 1_000_000;
    const rep = new VoiceReports(() => t);
    rep.report({ capture: { state: 'hearing', segId: 's1', level: 0.3 }, notice: { text: 'hi' } }, 'conn:V');
    t += VOICE_CAPTURE_TTL_MS;
    expect(rep.status().capture).not.toBeNull();
    t += 1;
    expect(rep.status().capture).toBeNull();
    expect(rep.status().notice).not.toBeNull();
    expect(VOICE_CAPTURE_TTL_MS).toBeLessThan(VOICE_REPORT_TTL_MS);
  });

  it('V2 seam (Aegis L1): voiceStatusFor keeps capture text for a HUMAN on the gui credential only, and never an unknown field', () => {
    const voice = { attached: null, capture: { state: 'hearing', segId: 's1', level: 0.2, at: 'x', text: 'run the', other: 1 } };
    expect(voiceStatusFor(voice, 'gui', 'human').capture).toEqual({ state: 'hearing', segId: 's1', level: 0.2, at: 'x', text: 'run the' });
    for (const cred of ['device', 'read-token', undefined]) expect(voiceStatusFor(voice, cred, 'human').capture).toEqual({ state: 'hearing', segId: 's1', level: 0.2, at: 'x' });
    // a gui credential on any other class (or no class) never gets the words
    for (const cls of ['voice', 'agent', 'session', 'mod', undefined]) expect(voiceStatusFor(voice, 'gui', cls).capture, String(cls)).not.toHaveProperty('text');
    expect(voiceStatusFor({ capture: null }, 'gui', 'human')).toEqual({ capture: null });
  });

  it('Aegis M1: a drop the kernel contradicts shows as captured (kernel:accepted); terminal states are claim:client', () => {
    let t = 1_000_000;
    const rep = new VoiceReports(() => t);
    // the kernel accepted a turn on conn:V, then the client claims the segment was dropped
    rep.accepted('conn:V', 'turn');
    rep.report({ capture: { state: 'dropped', segId: 's1', reason: 'no-words' } }, 'conn:V');
    expect(rep.status().capture).toMatchObject({ state: 'captured', segId: 's1', claim: 'client', kernel: 'accepted', clientReason: 'no-words' });
    expect(rep.status().capture).not.toHaveProperty('reason');
    // the acceptance is consumed once: the next drop stands (and is marked as the client's claim)
    rep.report({ capture: { state: 'dropped', segId: 's2', reason: 'too-short' } }, 'conn:V');
    expect(rep.status().capture).toMatchObject({ state: 'dropped', reason: 'too-short', claim: 'client' });
    expect(rep.status().capture).not.toHaveProperty('kernel');
    // 'refused' is contradicted only by an accepted SEND (a logged turn whose send was refused is a real refusal)
    rep.accepted('conn:V', 'turn');
    rep.report({ capture: { state: 'dropped', segId: 's3', reason: 'refused' } }, 'conn:V');
    expect(rep.status().capture).toMatchObject({ state: 'dropped', reason: 'refused' });
    rep.accepted('conn:V', 'send');
    rep.report({ capture: { state: 'dropped', segId: 's4', reason: 'refused' } }, 'conn:V');
    expect(rep.status().capture).toMatchObject({ state: 'captured', kernel: 'accepted', clientReason: 'refused' });
    // vice versa: captured with nothing accepted is unconfirmed; with an acceptance it is accepted
    rep.report({ capture: { state: 'captured', segId: 's5' } }, 'conn:V');
    expect(rep.status().capture).toMatchObject({ state: 'captured', claim: 'client', kernel: 'unconfirmed' });
    rep.accepted('conn:V', 'turn');
    rep.report({ capture: { state: 'captured', segId: 's6' } }, 'conn:V');
    expect(rep.status().capture).toMatchObject({ kernel: 'accepted' });
    // another connection's acceptance, or one outside the window, never matches
    rep.accepted('conn:OTHER', 'turn');
    rep.report({ capture: { state: 'captured', segId: 's7' } }, 'conn:V');
    expect(rep.status().capture).toMatchObject({ kernel: 'unconfirmed' });
    rep.accepted('conn:V', 'turn');
    t += VOICE_CAPTURE_ACCEPT_WINDOW_MS + 1;
    rep.report({ capture: { state: 'dropped', segId: 's8', reason: 'echo' } }, 'conn:V');
    expect(rep.status().capture).toMatchObject({ state: 'dropped', reason: 'echo' });
    // the client can never send the kernel's fields itself
    for (const k of ['claim', 'kernel', 'clientReason']) expect(() => rep.report({ capture: { state: 'captured', segId: 's9', [k]: 'accepted' } }, 'conn:V'), k).toThrow(TypeError);
    // non-terminal states carry no claim mark
    rep.report({ capture: { state: 'hearing', segId: 's10' } }, 'conn:V');
    expect(rep.status().capture).not.toHaveProperty('claim');
  });

  it('Aegis M1: VoiceControl reports an accepted turn and an accepted direct send (never a refused or intercepted turn)', async () => {
    const { VoiceControl } = await import('../src/kernel/voice/voice-control.js');
    const seen: string[] = [];
    const HSID = 'hs:01JAAAAAAAAAAAAAAAAAAAAAAA';
    const SPK = 'spk:abcdefgh/founder';
    let clock = 10_000;
    const v = new VoiceControl({
      sessions: { ownerOf: () => 'p:abcdefgh/founder', send: async () => ({ turn: 't' }), stop: async () => ({ signals: [], exited: false }) },
      append: async () => ({ seq: 1, hash: 'h' }),
      enrolled: () => new Set([SPK]),
      voiceConnections: () => ['conn:V'],
      now: () => clock,
      onAccepted: (connId, kind) => void seen.push(`${connId}:${kind}`),
    });
    await v.humanAppend({ connId: 'conn:H', principal: 'p:abcdefgh/founder', principalClass: 'human', credential: 'gui' }, 'voice.session.start', { hsid: HSID });
    const vc = { connId: 'conn:V', principal: 'p:abcdefgh/voice' };
    let n = 0;
    const turn = (p: Record<string, unknown> = {}) => v.voiceAppend(vc, { kind: 'voice.turn.user', payload: { turnId: String(++n), speakerId: SPK, speakerEnrolled: true, forwarded: false, t0: clock, t1: clock + 500, text: 'run the tests', mode: 'ptt', ...p } });
    await turn();
    expect(seen).toEqual(['conn:V:turn']);
    await turn({ speakerId: 'spk:unknown-1', speakerEnrolled: false });
    await turn({ intercepted: 'decision', text: 'allow' });
    expect(seen).toEqual(['conn:V:turn']);
    await turn();
    await v.send(vc, { hsid: HSID, content: [{ text: 'run the tests' }] });
    expect(seen).toEqual(['conn:V:turn', 'conn:V:turn', 'conn:V:send']);
  });

  it('voice drops fix: a refused drop carries the kernel refusal and cause to status; bad or misplaced ones are refused', () => {
    const rep = new VoiceReports(() => 1_000_000);
    rep.report({ capture: { state: 'dropped', segId: 's1', reason: 'refused', refusal: 'voice-playback' } }, 'conn:V');
    expect(rep.status().capture).toMatchObject({ state: 'dropped', reason: 'refused', refusal: 'voice-playback', claim: 'client' });
    rep.report({ capture: { state: 'dropped', segId: 's2', reason: 'refused', refusal: 'voice-off', cause: 'aec' } }, 'conn:V');
    expect(rep.status().capture).toMatchObject({ refusal: 'voice-off', cause: 'aec' });
    expect(voiceStatusFor({ capture: rep.status().capture }, { principalClass: 'human', credential: 'device' }).capture).toMatchObject({ refusal: 'voice-off', cause: 'aec' });
    for (const c of [
      { state: 'dropped', segId: 's3', reason: 'echo', refusal: 'voice-echo' }, // refusal on reason refused only
      { state: 'dropped', segId: 's3', reason: 'refused', refusal: 'budget' }, // a voice-* reason only
      { state: 'dropped', segId: 's3', reason: 'refused', refusal: 'voice-off', cause: 'Some Words' },
      { state: 'dropped', segId: 's3', reason: 'refused', cause: 'aec' }, // a cause needs its refusal
      { state: 'captured', segId: 's3', refusal: 'voice-playback' },
    ]) expect(() => rep.report({ capture: c }, 'conn:V'), JSON.stringify(c)).toThrow(TypeError);
  });

  it('voice drops fix: a turn refused at receipt returns its reason and V2a cause to the client', async () => {
    const { VoiceControl } = await import('../src/kernel/voice/voice-control.js');
    const HSID = 'hs:01JAAAAAAAAAAAAAAAAAAAAAAA';
    const SPK = 'spk:abcdefgh/founder';
    const clock = 10_000;
    const v = new VoiceControl({
      sessions: { ownerOf: () => 'p:abcdefgh/founder', send: async () => ({ turn: 't' }), stop: async () => ({ signals: [], exited: false }), busy: () => ({ streaming: true, endedAt: null }) },
      append: async () => ({ seq: 1, hash: 'h' }),
      enrolled: () => new Set([SPK]),
      voiceConnections: () => ['conn:V'],
      now: () => clock,
      presence: async (req) => (await req.onAllow(), { cardId: 'card:1' }),
    });
    const human = { connId: 'conn:H', principal: 'p:abcdefgh/founder', principalClass: 'human', credential: 'gui' };
    await v.humanAppend(human, 'voice.session.start', { hsid: HSID, mode: 'conversation' });
    const vc = { connId: 'conn:V', principal: 'p:abcdefgh/voice' };
    const busy = (await v.voiceAppend(vc, { kind: 'voice.turn.user', payload: { turnId: '1', speakerId: SPK, speakerEnrolled: true, forwarded: false, t0: clock - 500, t1: clock, text: 'go', mode: 'conversation', aec: 'vpio' } })) as Record<string, unknown>;
    expect(busy).toMatchObject({ forwardable: false, refused: 'voice-playback' });
    expect(busy).not.toHaveProperty('refusedCause');
    const aec = (await v.voiceAppend(vc, { kind: 'voice.turn.user', payload: { turnId: '2', speakerId: SPK, speakerEnrolled: true, forwarded: false, t0: clock - 500, t1: clock, text: 'go', mode: 'conversation' } })) as Record<string, unknown>;
    expect(aec).toMatchObject({ forwardable: false, refused: 'voice-off', refusedCause: 'aec' });
  });

  it('calibration: client-local drops are tallied by reason (never a refused or contradicted one) and stamped on the next voice.turn.user', async () => {
    const rep = new VoiceReports(() => 1_000_000);
    rep.report({ capture: { state: 'dropped', segId: 'a1', reason: 'too-short' } }, 'conn:V');
    rep.report({ capture: { state: 'dropped', segId: 'a2', reason: 'too-short' } }, 'conn:V');
    rep.report({ capture: { state: 'dropped', segId: 'a3', reason: 'echo' } }, 'conn:V');
    rep.report({ capture: { state: 'dropped', segId: 'a4', reason: 'refused', refusal: 'voice-playback' } }, 'conn:V');
    rep.report({ capture: { state: 'dropped', segId: 'a5', reason: 'not-enrolled' } }, 'conn:V');
    expect(rep.takeLocalDrops()).toEqual({ echo: 1, 'too-short': 2 });
    expect(rep.takeLocalDrops()).toBeUndefined();
    const { VoiceControl } = await import('../src/kernel/voice/voice-control.js');
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const SPK = 'spk:abcdefgh/founder';
    let drops: Record<string, number> | undefined = { 'no-words': 3 };
    const v = new VoiceControl({
      sessions: { ownerOf: () => 'p:abcdefgh/founder', send: async () => ({ turn: 't' }), stop: async () => ({ signals: [], exited: false }) },
      append: async (row) => (rows.push({ kind: row.kind, payload: row.payload as Record<string, unknown> }), { seq: rows.length, hash: 'h' }),
      enrolled: () => new Set([SPK]),
      voiceConnections: () => ['conn:V'],
      now: () => 10_000,
      localDrops: () => { const d = drops; drops = undefined; return d; },
    });
    const vc = { connId: 'conn:V', principal: 'p:abcdefgh/voice' };
    // not attached: refused hash-only, but the calibration fields and the tally are kept
    await v.voiceAppend(vc, { kind: 'voice.turn.user', payload: { turnId: '1', speakerId: SPK, speakerEnrolled: true, forwarded: false, t0: 9_000, t1: 10_000, text: 'secret', mode: 'ptt', speakerScore: '0.65-0.8', gatedSpeechMs: 1230 } });
    expect(rows.at(-1)!.payload).toMatchObject({ refusedReason: 'voice-target', speakerScore: '0.65-0.8', gatedSpeechMs: 1230, localDrops: { 'no-words': 3 } });
    expect(JSON.stringify(rows.at(-1)!.payload)).not.toContain('secret');
    for (const bad of [{ localDrops: { echo: 1 } }, { speakerScore: 0.71 }, { gatedSpeechMs: 1234 }, { gatedSpeechMs: -10 }]) {
      await expect(v.voiceAppend(vc, { kind: 'voice.turn.user', payload: { turnId: String(Math.random()).slice(2, 12), speakerId: SPK, speakerEnrolled: true, forwarded: false, t0: 9_000, t1: 10_000, text: 'x', mode: 'ptt', ...bad } }), JSON.stringify(bad)).rejects.toThrow();
    }
  });

  it('Aegis L3: the capture slot remembers its connection and clears when that connection closes', () => {
    const rep = new VoiceReports(() => 1_000_000);
    rep.report({ capture: { state: 'hearing', segId: 's1' } }, 'conn:V');
    rep.connectionClosed('conn:OTHER');
    expect(rep.status().capture).not.toBeNull();
    rep.accepted('conn:V', 'turn');
    rep.connectionClosed('conn:V');
    expect(rep.status().capture).toBeNull();
    // its unmatched acceptances went too: a new connection's drop stands
    rep.report({ capture: { state: 'dropped', segId: 's2', reason: 'echo' } }, 'conn:V');
    expect(rep.status().capture).toMatchObject({ state: 'dropped' });
  });

  it('G-HON-03: status.voice.capture.level is a declared number', () => {
    expect(checkStatusNumbers({ voice: { capture: { state: 'hearing', segId: 's1', level: 0.5, at: 'x' } } })).toEqual([]);
  });
});

type Who = { kind: 'human' | 'agent' | 'session' | 'mod' | 'voice' | 'peer'; credential?: 'device' | 'gui' } | { kind: 'readToken' };

/** A dispatcher whose request.voice.report port and status.voice are a real VoiceReports. */
function crig(o: { voice?: Record<string, unknown> } = {}) {
  const logged: Array<{ kind: string; payload: unknown }> = [];
  let t = 1_000_000;
  const reports = new VoiceReports(() => t);
  const d = createKernelDispatcher({
    authenticator: {
      now: () => Date.now(),
      checkToken: () => ({ ok: true }),
      authenticate: (s: Record<string, unknown>, p: { who: Who }) => {
        s.phase = 'authenticated';
        s.principal = 'p:abcdefgh/x';
        if (p.who.kind === 'readToken') {
          Object.assign(s, { credential: 'read-token', tokenId: 'rtk:T', tokenExpiresAtMs: Date.now() + 60_000 });
          return { ok: true, credential: 'read-token', principal: 'p:abcdefgh/x', tokenId: 'rtk:T', expiresAt: new Date(Date.now() + 60_000).toISOString() };
        }
        Object.assign(s, { principalKind: p.who.kind, deviceId: 'dev:abcdefgh/mac', credential: p.who.credential ?? 'device' });
        if (p.who.credential === 'gui') return { ok: true, credential: 'gui', principal: 'p:abcdefgh/x', deviceId: 'dev:abcdefgh/mac', via: 'launch', guiToken: 'g', commit: () => undefined, abort: () => undefined };
        return { ok: true, credential: 'device', principal: 'p:abcdefgh/x', principalKind: p.who.kind, deviceId: 'dev:abcdefgh/mac', keyId: 'k' };
      },
    } as never,
    status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: 'k', custody: 'partial', source: 'test' }), root: () => ({ state: 'dev-test', rootKeyId: null }) },
    log: async (kind, payload) => void logged.push({ kind, payload }),
    voice: { status: () => ({ attached: null, ...reports.status() }), connectionClosed: () => undefined, attachedHsid: () => null, ...o.voice } as never,
    voiceClient: {
      start: async () => ({ phase: 'running' }),
      stop: async () => ({ phase: 'stopped' }),
      connectionClosed: (connId) => reports.connectionClosed(connId),
      report: (p, connId) => reports.report(p, connId),
    },
  });
  let n = 0;
  let last: unknown;
  const connect = async (who: Who) => {
    const ctx = { connId: `conn:c-${++n}`, closed: false, authed: 0, close() { ctx.closed = true; }, authenticated() { ctx.authed++; }, notify: () => true, writableLength: () => 0, writeHighWater: 1 << 16 };
    d.onConnect(ctx as never);
    last = ctx;
    await d.handle({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 1, method: 'auth', params: { who } }, ctx as never);
    return (method: string, params: unknown = {}) => d.handle({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 2, method, params }, ctx as never) as Promise<Record<string, unknown>>;
  };
  return { d, logged, reports, connect, tick: (ms: number) => (t += ms), lastCtx: () => last };
}

async function refusal(p: unknown): Promise<{ code: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RpcRefusal) return { code: e.refusal.code };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('#gnomon-voice capture: the dispatcher', () => {
  it('voice principal only: every other class is refused and the slot stays empty; nothing is written as a row', async () => {
    const r = crig();
    for (const who of [{ kind: 'human' }, { kind: 'human', credential: 'gui' }, { kind: 'agent' }, { kind: 'session' }, { kind: 'mod' }, { kind: 'readToken' }, { kind: 'peer' }] as Who[]) {
      const call = await r.connect(who);
      await expect(call('log.append', { kind: 'request.voice.report', payload: { capture: { state: 'hearing', segId: 's1' } } }), JSON.stringify(who)).rejects.toBeInstanceOf(RpcRefusal);
    }
    expect(r.reports.status().capture).toBeNull();
    const voice = await r.connect({ kind: 'voice' });
    expect(await voice('log.append', { kind: 'request.voice.report', payload: { capture: { state: 'hearing', segId: 's1', level: 0.5 } } })).toEqual({ ok: true });
    expect(r.logged.filter((x) => x.kind.startsWith('request.') || x.kind.includes('capture'))).toEqual([]);
  });

  it('unknown keys and bad values are BAD_REQUEST', async () => {
    const r = crig();
    const voice = await r.connect({ kind: 'voice' });
    for (const payload of [{ capture: { state: 'hearing', segId: 's1', text: 'hi' } }, { capture: { state: 'dropped', segId: 's1', reason: 'nope' } }, { capture: { state: 'hearing', segId: 's1' }, other: 1 }]) {
      expect(await refusal(voice('log.append', { kind: 'request.voice.report', payload })), JSON.stringify(payload)).toMatchObject({ code: 'BAD_REQUEST' });
    }
    expect(r.reports.status().capture).toBeNull();
  });

  it('the human (device and gui) and the voice class see status.voice.capture; a mod, an agent and a read token never do', async () => {
    const r = crig();
    const voice = await r.connect({ kind: 'voice' });
    await voice('log.append', { kind: 'request.voice.report', payload: { capture: { state: 'dropped', segId: 's4', reason: 'not-enrolled' } } });
    for (const who of [{ kind: 'human' }, { kind: 'human', credential: 'gui' }, { kind: 'voice' }] as Who[]) {
      const st = await (await r.connect(who))('status');
      expect((st.voice as Record<string, unknown>).capture, JSON.stringify(who)).toMatchObject({ state: 'dropped', segId: 's4', reason: 'not-enrolled' });
    }
    for (const who of [{ kind: 'mod' }, { kind: 'agent' }, { kind: 'session' }, { kind: 'readToken' }] as Who[]) {
      // a mod's status is a scoped view (refused until M1.11); the others get no voice block at all
      const st = await (await r.connect(who))('status').catch((e: unknown) => (e instanceof RpcRefusal ? { refused: true } : Promise.reject(e)));
      expect((st as Record<string, unknown>).voice, JSON.stringify(who)).toBeUndefined();
      expect(JSON.stringify(st)).not.toContain('not-enrolled');
    }
  });

  it('Aegis L3: the reporting voice connection closing clears status.voice.capture', async () => {
    const r = crig();
    const voice = await r.connect({ kind: 'voice' });
    await voice('log.append', { kind: 'request.voice.report', payload: { capture: { state: 'hearing', segId: 's1' } } });
    expect(r.reports.status().capture).not.toBeNull();
    r.d.onDisconnect(r.lastCtx() as never);
    expect(r.reports.status().capture).toBeNull();
  });

  it('TTL: a hearing report from a client that then crashed is gone from status after VOICE_CAPTURE_TTL_MS', async () => {
    const r = crig();
    const voice = await r.connect({ kind: 'voice' });
    await voice('log.append', { kind: 'request.voice.report', payload: { capture: { state: 'hearing', segId: 's1', level: 0.7 } } });
    const human = await r.connect({ kind: 'human', credential: 'gui' });
    expect(((await human('status')).voice as Record<string, unknown>).capture).toMatchObject({ state: 'hearing' });
    r.tick(VOICE_CAPTURE_TTL_MS + 1);
    expect(((await human('status')).voice as Record<string, unknown>).capture).toBeNull();
  });
});

describe('#gnomon-voice B1 live words: status.voice.capture.text', () => {
  const T = (committed: string, tail: string) => ({ committed, tail });

  it('accepts {committed, tail} on hearing / transcribing only; refuses it on a terminal state or a bad shape', () => {
    const rep = new VoiceReports(() => 1_000_000);
    rep.report({ capture: { state: 'hearing', segId: 's1', level: 0.4, text: T('run the', 'tests') } }, 'conn:V');
    expect(rep.status().capture).toMatchObject({ state: 'hearing', text: { committed: 'run the', tail: 'tests' } });
    rep.report({ capture: { state: 'transcribing', segId: 's1', text: T('run the tests', '') } }, 'conn:V');
    expect(rep.status().capture?.text).toEqual({ committed: 'run the tests', tail: '' });
    for (const c of [
      { state: 'captured', segId: 's1', text: T('a', '') },
      { state: 'dropped', segId: 's1', reason: 'echo', text: T('a', '') },
      { state: 'idle', segId: 's1', text: T('a', '') },
      { state: 'hearing', segId: 's1', text: 'run the' },
      { state: 'hearing', segId: 's1', text: { committed: 'a' } },
      { state: 'hearing', segId: 's1', text: { committed: 'a', tail: 1 } },
      { state: 'hearing', segId: 's1', text: { committed: 'a', tail: '', extra: '' } },
      { state: 'hearing', segId: 's1', text: T('x'.repeat(5_000), '') },
    ]) expect(() => rep.report({ capture: c }, 'conn:V'), JSON.stringify(c).slice(0, 80)).toThrow(TypeError);
    // a terminal report replaces the slot: the words are gone with it
    rep.report({ capture: { state: 'captured', segId: 's1' } }, 'conn:V');
    expect(rep.status().capture).not.toHaveProperty('text');
  });

  it('sanitises (control, bidi, zero-width to spaces, whitespace collapsed) and caps committed + tail at CAPTURE_TEXT_MAX', () => {
    const rep = new VoiceReports(() => 1_000_000);
    rep.report({ capture: { state: 'hearing', segId: 's1', text: T('run\u0000the‮  te​sts\n', '⁦now⁩') } }, 'conn:V');
    expect(rep.status().capture?.text).toEqual({ committed: 'run the te sts', tail: 'now' });
    // Aegis L3: tag characters, variation selectors and Hangul fillers
    rep.report({ capture: { state: 'hearing', segId: 's1', text: T('a\u{E0041}\u{E007F}b\uFE0Fc\u{E0100}d', '\u115Fe\u3164f\uFFA0g') } }, 'conn:V');
    expect(rep.status().capture?.text).toEqual({ committed: 'a b c d', tail: 'e f g' });
    rep.report({ capture: { state: 'hearing', segId: 's1', text: T('a'.repeat(500), 'b'.repeat(500)) } }, 'conn:V');
    const t = rep.status().capture!.text!;
    expect(t.committed).toBe('a'.repeat(500));
    expect(t.committed.length + 1 + t.tail.length).toBeLessThanOrEqual(CAPTURE_TEXT_MAX);
    rep.report({ capture: { state: 'hearing', segId: 's1', text: T('c'.repeat(900), 'd') } }, 'conn:V');
    expect(rep.status().capture!.text).toEqual({ committed: 'c'.repeat(CAPTURE_TEXT_MAX), tail: '' });
    // nothing left after sanitising: no text field at all
    rep.report({ capture: { state: 'hearing', segId: 's1', text: T(' \u0007 ', '') } }, 'conn:V');
    expect(rep.status().capture).not.toHaveProperty('text');
  });

  it('TTL: the words go stale with the capture slot (VOICE_CAPTURE_TTL_MS)', () => {
    let t = 1_000_000;
    const rep = new VoiceReports(() => t);
    rep.report({ capture: { state: 'hearing', segId: 's1', text: T('run', 'the') } }, 'conn:V');
    t += VOICE_CAPTURE_TTL_MS;
    expect(rep.status().capture?.text).toEqual({ committed: 'run', tail: 'the' });
    t += 1;
    expect(rep.status().capture).toBeNull();
  });

  it('voice principal only, never a row: only a HUMAN on the gui credential ever sees the words', async () => {
    const r = crig();
    for (const who of [{ kind: 'human' }, { kind: 'human', credential: 'gui' }, { kind: 'agent' }, { kind: 'mod' }, { kind: 'readToken' }] as Who[]) {
      await expect((await r.connect(who))('log.append', { kind: 'request.voice.report', payload: { capture: { state: 'hearing', segId: 's1', text: T('forged', '') } } }), JSON.stringify(who)).rejects.toBeInstanceOf(RpcRefusal);
    }
    expect(r.reports.status().capture).toBeNull();
    const voice = await r.connect({ kind: 'voice' });
    expect(await voice('log.append', { kind: 'request.voice.report', payload: { capture: { state: 'hearing', segId: 's1', level: 0.5, text: T('secret words', 'here') } } })).toEqual({ ok: true });
    // in memory only: nothing was written to the log
    expect(JSON.stringify(r.logged)).not.toContain('secret');
    const gui = (await (await r.connect({ kind: 'human', credential: 'gui' }))('status')).voice as Record<string, unknown>;
    expect(gui.capture).toMatchObject({ state: 'hearing', text: { committed: 'secret words', tail: 'here' } });
    for (const who of [{ kind: 'human' }, { kind: 'voice' }, { kind: 'mod' }, { kind: 'agent' }, { kind: 'session' }, { kind: 'readToken' }] as Who[]) {
      const st = await (await r.connect(who))('status').catch((e: unknown) => (e instanceof RpcRefusal ? { refused: true } : Promise.reject(e)));
      expect(JSON.stringify(st), JSON.stringify(who)).not.toContain('secret');
    }
  });

  it("Dictate (Aegis re-check): status.voice.unverified reaches a human on the gui credential only, for that human's own sessions", async () => {
    const asked: Array<string | undefined> = [];
    const r = crig({
      voice: {
        // a status() that (wrongly) carried words is never passed through to anyone but the per-viewer gui projection
        status: () => ({ attached: null, unverified: [{ seq: 9, hsid: 'hs:other', text: 'leaked words' }] }),
        unverifiedFor: (principal: string | undefined) => (asked.push(principal), principal === 'p:abcdefgh/x' ? [{ seq: 1, hsid: 'hs:mine', text: 'secret draft' }] : []),
      },
    });
    const gui = (await (await r.connect({ kind: 'human', credential: 'gui' }))('status')).voice as Record<string, unknown>;
    expect(gui.unverified).toEqual([{ seq: 1, hsid: 'hs:mine', text: 'secret draft' }]);
    expect(asked).toEqual(['p:abcdefgh/x']); // asked for THIS connection's principal
    for (const who of [{ kind: 'human' }, { kind: 'human', credential: 'device' }, { kind: 'voice' }, { kind: 'mod' }, { kind: 'agent' }, { kind: 'session' }, { kind: 'readToken' }] as Who[]) {
      const st = await (await r.connect(who))('status').catch((e: unknown) => (e instanceof RpcRefusal ? { refused: true } : Promise.reject(e)));
      expect(JSON.stringify(st), JSON.stringify(who)).not.toContain('secret draft');
      expect(JSON.stringify(st), JSON.stringify(who)).not.toContain('leaked');
      expect((st as { voice?: Record<string, unknown> }).voice ?? {}, JSON.stringify(who)).not.toHaveProperty('unverified');
    }
    expect(asked).toHaveLength(1); // only the gui human was ever asked
  });
});
