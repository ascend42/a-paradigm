/**
 * $voice-turn with FakeAudioIO + stub engines + a fake kernel link (no models, no audio, no network):
 * VAD → STT → append → send, the attachment/ceiling gate, half-duplex + tail, barge-in, refusals, G-VOX-05.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeAudioIO } from '../src/fake-audio-io.js';
import { gatedSpeechMsOf, PRINT_SCHEMA, readPrints, speakerScoreBucket, type VoicePrint } from '../src/speaker.js';
import { captureRefusalOf, CAPTURE_DROP_REASONS, CAPTURE_REPORT_MIN_MS, levelOf, VoiceClient, type ClientMode, type Delivery, type Notice } from '../src/voice-client.js';
import { recordEnrolment } from '../src/enrol.js';
import { FakeLink, refusal, stubEngines, StubSpeaker, StubVad, tone, toneWav } from './stubs.js';

const MATT: VoicePrint = { schemaVersion: PRINT_SCHEMA, name: 'matt', model: 'stub', dim: 2, phrases: 3, embedding: [1, 0], createdAt: '2026-10-19T00:00:00Z' };
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

let clients: VoiceClient[] = [];
afterEach(async () => {
  for (const c of clients) await c.close();
  clients = [];
});

async function setup(o: { mode?: ClientMode; attachMode?: string | null; texts?: string[]; delivery?: Delivery } = {}) {
  const audio = new FakeAudioIO();
  const engines = stubEngines(o.texts ?? []);
  const link = new FakeLink();
  if (o.attachMode === null) link.att = null;
  else if (o.attachMode) link.att = { ...link.att!, mode: o.attachMode };
  const notices: Notice[] = [];
  const client = new VoiceClient({ audio, engines, link, ns: 'abcd1234', prints: () => [MATT], mode: o.mode ?? 'ptt', delivery: o.delivery ?? 'direct', now: () => audio.clock, notice: (n) => notices.push(n) });
  clients.push(client);
  await client.start();
  return { audio, engines, link, client, notices };
}

function ptt(audio: FakeAudioIO, ms: number, amp: number): void {
  audio.hotkey(true);
  audio.captureWav(toneWav(ms, amp));
  audio.hotkey(false);
}

describe('$voice-turn user side', () => {
  it('PTT: STT → voice.turn.user (enrolled) → session.send with the same text', async () => {
    const { audio, engines, link, client } = await setup({ texts: ['run the tests'] });
    audio.silence(100);
    ptt(audio, 800, 0.5);
    await client.idle();
    expect(engines.stt.heard).toHaveLength(1);
    expect(link.appends).toHaveLength(1);
    const p = link.appends[0]!;
    expect(p.kind).toBe('voice.turn.user');
    expect(p.payload).toMatchObject({ speakerId: 'spk:abcd1234/matt', speakerEnrolled: true, forwarded: true, mode: 'ptt', aec: 'headphones', aecTransport: 'wired', text: 'run the tests' });
    expect(p.payload.t1 as number).toBeGreaterThan(p.payload.t0 as number);
    expect(String(p.payload.turnId)).toMatch(/^u\d{13}-\d{4}$/);
    expect(link.sends).toEqual([{ hsid: 'hs:01TEST', text: 'run the tests' }]);
  });

  it('AMBIENT: a VAD segment is a turn (when the ceiling allows ambient)', async () => {
    const { audio, link, client } = await setup({ mode: 'ambient', attachMode: 'conversation', texts: ['what changed'] });
    audio.captureWav(toneWav(700, 0.5));
    audio.silence(400);
    await client.idle();
    // TD-2026-10-20-125: an ambient turn never sends itself, even under --delivery direct; it is dictated (composer)
    expect(link.appends[0]!.payload).toMatchObject({ mode: 'conversation', text: 'what changed', speakerEnrolled: true, forwarded: false });
    expect(link.sends).toHaveLength(0);
  });

  it('turn ids are monotone (the kernel order: length, then lexical)', async () => {
    const { audio, link, client } = await setup({ texts: ['one', 'two'] });
    ptt(audio, 600, 0.5);
    audio.silence(100);
    ptt(audio, 600, 0.5);
    await client.idle();
    const [a, b] = link.appends.map((x) => String(x.payload.turnId));
    expect(a!.length === b!.length && b! > a!).toBe(true);
  });

  it('an unknown speaker is logged without text and never sent', async () => {
    const { audio, link, client, notices } = await setup({ texts: ['secret words'] });
    ptt(audio, 800, 0.2);
    await client.idle();
    expect(link.appends[0]!.payload).toMatchObject({ speakerId: 'spk:unknown-1', speakerEnrolled: false, forwarded: false, text: '', textWithheld: true });
    expect(JSON.stringify(link.appends)).not.toContain('secret words');
    expect(link.sends).toHaveLength(0);
    expect(notices.at(-1)!.text).toMatch(/not enrolled/);
  });

  it('never forwards when not attached (no append, no send)', async () => {
    const { audio, link, client, notices } = await setup({ attachMode: null, mode: 'ambient' });
    expect(client.mode).toBe('off');
    ptt(audio, 800, 0.5);
    audio.captureWav(toneWav(800, 0.5));
    audio.silence(400);
    await client.idle();
    expect(link.appends).toHaveLength(0);
    expect(link.sends).toHaveLength(0);
    expect(notices[0]!.text).toMatch(/not attached/);
  });

  it('the human ceiling bounds the mode: ambient asked under a ptt attachment narrows to ptt', async () => {
    const { audio, link, client } = await setup({ mode: 'ambient', attachMode: 'ptt' });
    expect(client.mode).toBe('ptt');
    audio.captureWav(toneWav(800, 0.5)); // no hotkey: continuous speech is not a turn under ptt
    audio.silence(400);
    await client.idle();
    expect(link.appends).toHaveLength(0);
    expect(client.setMode('ambient')).toBe('ptt');
    expect(client.setMode('off')).toBe('off');
    ptt(audio, 800, 0.5);
    await client.idle();
    expect(link.appends).toHaveLength(0);
  });

  it('an unknown ceiling name fails closed to off', async () => {
    const { client } = await setup({ attachMode: 'telepathy' });
    expect(client.mode).toBe('off');
  });

  it('a refusal is shown and never retried', async () => {
    const { audio, link, client, notices } = await setup({ texts: ['hi'] });
    link.sendError = refusal('voice-echo');
    ptt(audio, 800, 0.5);
    await client.idle();
    await settle();
    expect(link.appends).toHaveLength(1);
    expect(link.sends).toHaveLength(0);
    const n = notices.find((x) => x.refusal)!;
    expect(n.refusal).toMatchObject({ code: 'FORBIDDEN', reason: 'voice-echo' });
    expect(n.text).toMatch(/while I was speaking/);
  });

  it('a follow that ends (attachment change) re-reads status and re-follows', async () => {
    const { link, client } = await setup();
    const first = link.row;
    link.att = { voiceSessionId: 'vs:02NEXT', hsid: 'hs:02NEXT', mode: 'ptt' };
    link.end!('attachment-changed');
    await settle();
    expect(link.row).toBeDefined();
    expect(link.row).not.toBe(first);
    expect(client.attachment?.hsid).toBe('hs:02NEXT');
  });
});

describe('$voice-turn agent side + half-duplex', () => {
  it('speaks the reply summary per sentence and logs voice.turn.agent windows', async () => {
    const { audio, engines, link, client } = await setup();
    link.reply('Tests pass. Two were flaky.\n\n```diff\n- a\n+ b\n```');
    await settle();
    expect(audio.isPlaying).toBe(true);
    audio.tick(1000);
    await settle();
    audio.tick(1000);
    await client.idle();
    expect(engines.tts.said).toEqual(['Tests pass.', 'Two were flaky.']);
    const agent = link.appends.filter((a) => a.kind === 'voice.turn.agent');
    expect(agent).toHaveLength(2);
    expect(agent[0]!.payload).toMatchObject({ textPlanned: 'Tests pass.', textSpoken: 'Tests pass.' });
    expect((agent[0]!.payload.t1 as number) - (agent[0]!.payload.t0 as number)).toBe(1000);
  });

  it('never forwards speech during playback or the 750 ms tail; forwards after', async () => {
    const { audio, link, client } = await setup({ mode: 'ambient', attachMode: 'conversation', texts: ['late enough'] });
    link.reply('One sentence only.');
    await settle();
    expect(audio.isPlaying).toBe(true);
    audio.captureWav(toneWav(250, 0.5)); // < 300 ms: not a barge-in, but inside playback
    audio.silence(900); // the 1000 ms playback ends inside this window
    await settle();
    expect(audio.isPlaying).toBe(false);
    audio.captureWav(toneWav(400, 0.5)); // starts within the 750 ms tail
    audio.silence(400);
    await client.idle();
    expect(link.appends.filter((a) => a.kind === 'voice.turn.user')).toHaveLength(0);
    audio.silence(800);
    audio.captureWav(toneWav(500, 0.5)); // after the tail
    audio.silence(400);
    await client.idle();
    expect(link.appends.filter((a) => a.kind === 'voice.turn.user').map((a) => a.payload.text)).toEqual(['late enough']);
    expect(link.sends).toEqual([]); // TD-2026-10-20-125: ambient fills the composer, never a direct send
  });

  it('barge-in: VAD speech ≥ 300 ms during playback stops it and drops the rest; the speech is not forwarded', async () => {
    const { audio, engines, link, client } = await setup({ mode: 'ambient', attachMode: 'conversation' });
    engines.tts.msPerSentence = 3000;
    link.reply('First long sentence here. Second sentence never said.');
    await settle();
    expect(audio.isPlaying).toBe(true);
    audio.captureWav(toneWav(400, 0.5));
    await settle();
    expect(audio.isPlaying).toBe(false);
    expect(audio.played[0]!.completed).toBe(false);
    audio.silence(400);
    await client.idle();
    // pipelined: the second sentence was synthesized during the first, but the barge-in dropped it unplayed
    expect(engines.tts.said).toEqual(['First long sentence here.', 'Second sentence never said.']);
    expect(audio.played).toHaveLength(1);
    const agent = link.appends.filter((a) => a.kind === 'voice.turn.agent');
    expect(agent[0]!.payload).toMatchObject({ textSpoken: '', interrupted: true });
    expect(link.appends.filter((a) => a.kind === 'voice.turn.user')).toHaveLength(0);
    expect(link.sends).toHaveLength(0);
  });

  it('speech under 300 ms during playback is not a barge-in', async () => {
    const { audio, link } = await setup({ mode: 'ambient', attachMode: 'conversation' });
    link.reply('Keep talking.');
    await settle();
    audio.captureWav(toneWav(200, 0.5));
    expect(audio.isPlaying).toBe(true);
  });

  it('barge-in: pressing the PTT hotkey during playback stops it', async () => {
    const { audio, link } = await setup();
    link.reply('Something to say.');
    await settle();
    expect(audio.isPlaying).toBe(true);
    audio.hotkey(true);
    expect(audio.isPlaying).toBe(false);
    audio.hotkey(false);
  });

  it('edits are summarized as "edited N files" at the end of the turn; questions are always read', async () => {
    const { audio, engines, link, client } = await setup();
    link.reply('I fixed it.', [
      { name: 'Edit', input: { file_path: '/r/a.ts' } },
      { name: 'Write', input: { file_path: '/r/b.ts' } },
      { name: 'Edit', input: { file_path: '/r/a.ts' } },
      { name: 'AskUserQuestion', input: { questions: [{ question: 'Ship it now?', options: [{ label: 'Yes' }, { label: 'No' }] }] } },
    ]);
    link.endTurn();
    for (let i = 0; i < 6; i++) {
      await settle();
      audio.tick(1000);
    }
    await client.idle();
    expect(engines.tts.said).toEqual(['I fixed it.', 'Ship it now?', 'Options: Yes, or No.', 'Edited 2 files.']);
  });
});

describe('capture states (T-2026-10-20-005 A1, TD-2026-10-20-086)', () => {
  const seen = new Set<string>();
  const dropReasons = (link: FakeLink): string[] => {
    const r = link.capture.filter((c) => c.state === 'dropped').map((c) => c.reason!);
    r.forEach((x) => seen.add(x));
    return r;
  };
  const states = (link: FakeLink): string[] => link.capture.map((c) => c.state);

  it('PTT: key-down is hearing, then transcribing, then captured, all for one segId', async () => {
    const { audio, link, client } = await setup({ texts: ['run the tests'] });
    audio.hotkey(true);
    await settle();
    expect(link.capture.at(-1)).toMatchObject({ state: 'hearing', segId: 's1' });
    audio.captureWav(toneWav(800, 0.5));
    audio.hotkey(false);
    await client.idle();
    expect(states(link)).toEqual(['hearing', 'transcribing', 'captured']);
    expect(new Set(link.capture.map((c) => c.segId))).toEqual(new Set(['s1']));
    expect(client.capture).toMatchObject({ state: 'captured', segId: 's1' });
  });

  it('AMBIENT: VAD start is hearing, then transcribing, then captured (composer delivery)', async () => {
    const { audio, link, client } = await setup({ mode: 'ambient', attachMode: 'conversation', delivery: 'composer', texts: ['what changed'] });
    audio.silence(100);
    expect(link.capture).toHaveLength(0);
    audio.captureWav(toneWav(700, 0.5));
    audio.silence(400);
    await client.idle();
    expect(states(link)).toEqual(['hearing', 'transcribing', 'captured']);
    expect(link.sends).toEqual([]);
  });

  it('too-short: a short hold, and a press with no audio at all', async () => {
    const { audio, link, client } = await setup();
    ptt(audio, 100, 0.5);
    audio.hotkey(true);
    audio.hotkey(false);
    await client.idle();
    expect(dropReasons(link)).toEqual(['too-short', 'too-short']);
    expect(link.appends).toHaveLength(0);
  });

  it('echo: speech inside our playback or its tail is dropped as echo', async () => {
    const { audio, link, client } = await setup({ mode: 'ambient', attachMode: 'conversation' });
    link.reply('One sentence only.');
    await settle();
    audio.captureWav(toneWav(250, 0.5)); // < 300 ms: not a barge-in, inside playback
    audio.silence(900);
    await settle();
    audio.captureWav(toneWav(400, 0.5)); // inside the 750 ms tail
    audio.silence(400);
    await client.idle();
    expect(dropReasons(link)).toEqual(['echo', 'echo']);
  });

  it('barge-in (AMBIENT): the speech that cut the reply off is dropped as barge-in, never echo', async () => {
    const { audio, engines, link, client } = await setup({ mode: 'ambient', attachMode: 'conversation' });
    engines.tts.msPerSentence = 3000;
    link.reply('First long sentence here. Second sentence never said.');
    await settle();
    audio.captureWav(toneWav(400, 0.5));
    await settle();
    audio.silence(400);
    await client.idle();
    const r = dropReasons(link);
    expect(r.length).toBeGreaterThan(0);
    expect(new Set(r)).toEqual(new Set(['barge-in']));
    expect(link.appends.filter((a) => a.kind === 'voice.turn.user')).toHaveLength(0);
  });

  it('barge-in (PTT): a hold that stopped playback is dropped as barge-in at release', async () => {
    const { audio, link, client } = await setup();
    link.reply('Something to say.');
    await settle();
    audio.hotkey(true);
    await settle();
    audio.captureWav(toneWav(600, 0.5));
    audio.hotkey(false);
    await client.idle();
    expect(dropReasons(link)).toEqual(['barge-in']);
  });

  it('not-attached: a detach while hearing drops the live segment', async () => {
    const { audio, link, client } = await setup();
    audio.hotkey(true);
    audio.captureWav(toneWav(400, 0.5));
    link.att = null;
    await client.refresh();
    audio.hotkey(false);
    await client.idle();
    expect(dropReasons(link)).toEqual(['not-attached']);
    expect(link.appends).toHaveLength(0);
  });

  it('no-words: an empty transcript', async () => {
    const { audio, link, client } = await setup({ texts: ['  '] });
    ptt(audio, 800, 0.5);
    await client.idle();
    expect(dropReasons(link)).toEqual(['no-words']);
  });

  it('not-enrolled: an unknown speaker is dropped with the reason only (no text anywhere in the report)', async () => {
    const { audio, link, client } = await setup({ texts: ['secret words'] });
    ptt(audio, 800, 0.2);
    await client.idle();
    expect(dropReasons(link)).toEqual(['not-enrolled']);
    expect(JSON.stringify(link.capture)).not.toContain('secret');
  });

  it('refused: a kernel refusal of the send is a drop', async () => {
    const { audio, link, client } = await setup({ texts: ['hi'] });
    link.sendError = refusal('voice-busy');
    ptt(audio, 800, 0.5);
    await client.idle();
    expect(dropReasons(link)).toEqual(['refused']);
  });

  it('voice drops fix: a turn the kernel refused at receipt ends as dropped with its reason, never captured (composer delivery)', async () => {
    const { audio, link, client } = await setup({ texts: ['and the docs too'], delivery: 'composer', mode: 'ambient', attachMode: 'conversation' });
    link.turnVerdict = { refused: 'voice-playback' };
    audio.captureWav(toneWav(900, 0.5));
    audio.silence(900);
    await client.idle();
    const end = link.capture.filter((c) => c.state === 'dropped' || c.state === 'captured');
    expect(end).toEqual([{ state: 'dropped', segId: expect.any(String), reason: 'refused', refusal: 'voice-playback' }]);
    expect(dropReasons(link)).toEqual(['refused']);
    expect(link.sends).toHaveLength(0);
  });

  it('voice drops fix: a V2a cause rides with the refusal; a direct send is never tried after a refused turn', async () => {
    const { audio, link, client } = await setup({ texts: ['hi'] });
    link.turnVerdict = { refused: 'voice-off', refusedCause: 'aec' };
    ptt(audio, 800, 0.5);
    await client.idle();
    expect(link.capture.find((c) => c.state === 'dropped')).toMatchObject({ reason: 'refused', refusal: 'voice-off', cause: 'aec' });
    expect(link.sends).toHaveLength(0);
  });

  it('voice drops fix: a send refusal carries its voice-* reason; a malformed reason is left out', async () => {
    const { audio, link, client } = await setup({ texts: ['hi'] });
    link.sendError = refusal('voice-echo');
    ptt(audio, 800, 0.5);
    await client.idle();
    expect(link.capture.find((c) => c.state === 'dropped')).toMatchObject({ reason: 'refused', refusal: 'voice-echo' });
    expect(captureRefusalOf('voice-playback', 'Bad Cause')).toEqual({ refusal: 'voice-playback' });
    expect(captureRefusalOf('budget')).toEqual({});
  });

  it('calibration: voice.turn.user carries the coarse speaker score bucket, never the number or audio', async () => {
    const { audio, link, client } = await setup({ texts: ['run the tests'] });
    ptt(audio, 800, 0.5);
    await client.idle();
    const p = link.appends.find((x) => x.kind === 'voice.turn.user')!.payload;
    expect(p.speakerScore).toBe('ge0.8');
    expect(speakerScoreBucket(-1)).toBe('none');
    expect(speakerScoreBucket(0.49)).toBe('lt0.5');
    expect(speakerScoreBucket(0.5)).toBe('0.5-0.65');
    expect(speakerScoreBucket(0.65)).toBe('0.65-0.8');
    expect(speakerScoreBucket(0.8)).toBe('ge0.8');
    expect(gatedSpeechMsOf(1234.4)).toBe(1230);
    expect(gatedSpeechMsOf(undefined)).toBeUndefined();
  });

  it('TD-2026-10-21-514: turning the mic off discards the open segment (dropped mic-off)', async () => {
    const { audio, link, client } = await setup({ mode: 'ambient', attachMode: 'conversation', texts: ['never sent'] });
    audio.captureWav(toneWav(600, 0.5));
    audio.silence(400);
    await client.toggleMic(); // before the queued utterance runs: its audio is discarded
    audio.silence(400);
    await client.idle();
    expect(dropReasons(link)).toContain('mic-off');
    expect(link.appends.filter((x) => x.kind === 'voice.turn.user')).toEqual([]); // only the mic-state report was appended
  });

  it('every reason of the closed enum is emitted by some drop site', () => {
    expect([...seen].sort()).toEqual([...CAPTURE_DROP_REASONS].sort());
  });

  it('capture rides request.voice.report only: never a log row, never text', async () => {
    const { audio, link, client } = await setup({ texts: ['run the tests'] });
    ptt(audio, 800, 0.5);
    await client.idle();
    expect(link.capture.length).toBeGreaterThan(0);
    expect(link.appends.map((a) => a.kind)).toEqual(['voice.turn.user']);
    expect(link.appends.some((a) => 'capture' in a.payload)).toBe(false);
    for (const c of link.capture) expect(Object.keys(c).every((k) => ['state', 'segId', 'reason', 'level'].includes(k))).toBe(true);
  });

  it('A2: the real level rides hearing reports only, ≤ 5 Hz; terminal states always go', async () => {
    const { audio, link, client } = await setup({ texts: ['ok'] });
    audio.emitLevel(-10); // not hearing: no report
    await settle();
    expect(link.capture).toHaveLength(0);
    audio.hotkey(true);
    const t0 = audio.clock;
    for (let i = 0; i < 50; i++) {
      audio.tick(20);
      audio.emitLevel(-60 + i);
      if (i % 10 === 9) await settle(); // let the report chain drain (a waiting update is otherwise coalesced, L4)
    }
    const heldMs = audio.clock - t0;
    audio.captureWav(toneWav(400, 0.5));
    audio.hotkey(false);
    await client.idle();
    const hearing = link.capture.filter((c) => c.state === 'hearing');
    expect(hearing.length).toBeGreaterThan(1);
    expect(hearing.length).toBeLessThanOrEqual(Math.ceil((heldMs + 400) / CAPTURE_REPORT_MIN_MS) + 1);
    for (const h of hearing) expect(h.level).toBeGreaterThanOrEqual(0);
    for (const h of hearing) expect(h.level).toBeLessThanOrEqual(1);
    expect(link.capture.filter((c) => c.state !== 'hearing').every((c) => c.level === undefined)).toBe(true);
    expect(link.capture.at(-1)!.state).toBe('captured');
    expect(levelOf(-60)).toBe(0);
    expect(levelOf(0)).toBe(1);
    expect(levelOf(-Infinity)).toBe(0);
    expect(levelOf(-30)).toBe(0.5);
  });

  it('Aegis L4: with a slow kernel, waiting level updates are replaced by the newest, never queued; terminal ones are never lost', async () => {
    const { audio, link, client } = await setup({ texts: ['ok'] });
    let open!: () => void;
    link.captureGate = new Promise<void>((r) => (open = r));
    audio.hotkey(true); // hearing s1: in flight, held by the gate
    for (let i = 0; i < 40; i++) {
      audio.tick(CAPTURE_REPORT_MIN_MS); // past the throttle every time: 40 sends while the first is still in flight
      audio.emitLevel(-50 + i);
    }
    audio.captureWav(toneWav(400, 0.5));
    audio.hotkey(false);
    await settle();
    open();
    link.captureGate = undefined;
    await client.idle();
    const states = link.capture.map((c) => c.state);
    // the first hearing, at most one coalesced hearing (the newest level), then the segment's own edges
    expect(states.filter((s) => s === 'hearing').length).toBeLessThanOrEqual(3);
    expect(states.slice(-2)).toEqual(['transcribing', 'captured']);
    const lastHearing = link.capture.filter((c) => c.state === 'hearing').at(-1)!;
    expect(lastHearing.level).toBe(levelOf(-50 + 39));
  });

  it('a mode change while hearing abandons the segment (idle, no reason)', async () => {
    const { audio, link, client } = await setup();
    audio.hotkey(true);
    client.setMode('off');
    await client.idle();
    expect(states(link)).toEqual(['hearing', 'idle']);
  });
});

describe('G-VOX-05: no audio on disk', () => {
  it('a full run (capture, STT, playback, barge-in) creates no file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-novox-'));
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      const { audio, link, client } = await setup({ mode: 'ambient', attachMode: 'conversation', texts: ['x', 'y'] });
      audio.captureWav(toneWav(700, 0.5));
      audio.silence(400);
      link.reply('Hello there. More words.');
      await settle();
      audio.captureWav(toneWav(400, 0.5));
      audio.silence(2000);
      await client.idle();
      expect(fs.readdirSync(tmp)).toEqual([]);
    } finally {
      process.chdir(cwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('the capture/STT/playback modules never import the filesystem', () => {
    const src = fileURLToPath(new URL('../src/', import.meta.url));
    for (const f of ['voice-client.ts', 'audio-io.ts', 'fake-audio-io.ts', 'speakable.ts', 'types.ts', 'engines/sherpa.ts']) {
      const text = fs.readFileSync(path.join(src, f), 'utf8');
      expect(text, f).not.toMatch(/from 'node:fs'|require\('fs'\)|from 'fs'|writeWave/);
    }
  });
});

describe('enrolment', () => {
  it('records 3 phrases, averages the embeddings and stores only the print (0600 under 0700)', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-enrol-'));
    try {
      const audio = new FakeAudioIO();
      const prompts: string[] = [];
      const r = await recordEnrolment({
        audio, vad: new StubVad(), speaker: new StubSpeaker(), model: 'stub', home, name: 'matt',
        prompt: (phrase) => {
          prompts.push(phrase);
          audio.capture(tone(1500, 0.5));
          audio.silence(400);
        },
      });
      expect(prompts).toHaveLength(3);
      expect(r.print.embedding).toEqual([1, 0]);
      expect(readPrints(home).map((p) => p.name)).toEqual(['matt']);
      expect(fs.readdirSync(path.join(home, 'voice', 'prints', 'matt'))).toEqual(['print.json']);
      if (typeof process.getuid === 'function') {
        expect(fs.statSync(r.file).mode & 0o777).toBe(0o600);
        expect(fs.statSync(path.join(home, 'voice', 'prints')).mode & 0o777).toBe(0o700);
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
